/** IPC 白名单注册：渲染进程只能通过 title2link:* channel 访问能力。 */

import { BrowserWindow, dialog, ipcMain } from "electron";
import { basename, dirname, join } from "node:path";
import { JobManager, type LabelOptions } from "./job-manager.js";
import {
  getAiApiKey,
  getApiKey,
  getSettingsView,
  saveAiApiKey,
  saveAiSettings,
  saveApiKey,
  saveConcurrency,
  saveIncludeContent,
} from "./settings.js";
import type {
  CollectStatus,
  ExportResult,
  ImportPreview,
  ImportResult,
  JobSnapshot,
} from "./shared/types.js";

const ALLOWED_RECORD_FILTERS: ReadonlySet<string> = new Set([
  "pending",
  "exact",
  "auto",
  "confirmed",
  "review",
  "not_found",
  "failed",
  "skipped",
]);

/** 单次查询记录数上限，避免万级行全量序列化压垮 IPC */
const MAX_RECORDS_PER_QUERY = 5_000;

/** 打标并发上限：AI 接口限流敏感，不随采集并发无限放大 */
const MAX_LABEL_CONCURRENCY = 5;

/** 从设置组装打标参数；未配置 AI Key 时返回 undefined */
async function buildLabelOptions(): Promise<LabelOptions | undefined> {
  const settings = await getSettingsView();
  const aiApiKey = await getAiApiKey();
  if (!aiApiKey) return undefined;
  return {
    aiApiKey,
    aiBaseUrl: settings.aiBaseUrl,
    aiModel: settings.aiModel,
    categories: settings.labelCategories,
    concurrency: Math.min(settings.concurrency, MAX_LABEL_CONCURRENCY),
  };
}

/** 人工确认只接受知乎域名下的 https 链接，拒绝渲染进程传入任意外部地址 */
function isZhihuUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "zhihu.com" ||
        parsed.hostname.endsWith(".zhihu.com"))
    );
  } catch {
    return false;
  }
}

export function registerIpc(
  mainWindow: BrowserWindow,
  jobsDir: string,
): JobManager {
  const manager = new JobManager(jobsDir, (event) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("title2link:update", event);
    }
  });

  ipcMain.handle("title2link:get-settings", () => getSettingsView());

  ipcMain.handle(
    "title2link:save-key",
    async (_event, payload: { key: string }) => {
      await saveApiKey(String(payload?.key ?? ""));
      return { ok: true };
    },
  );

  ipcMain.handle(
    "title2link:save-concurrency",
    async (_event, payload: { concurrency: number }) => {
      await saveConcurrency(Number(payload?.concurrency));
      return { ok: true };
    },
  );

  ipcMain.handle(
    "title2link:save-include-content",
    async (_event, payload: { includeContent: boolean }) => {
      await saveIncludeContent(Boolean(payload?.includeContent));
      return { ok: true };
    },
  );

  ipcMain.handle(
    "title2link:save-ai-key",
    async (_event, payload: { key: string }) => {
      await saveAiApiKey(String(payload?.key ?? ""));
      return { ok: true };
    },
  );

  ipcMain.handle(
    "title2link:save-ai-settings",
    async (
      _event,
      payload: {
        aiBaseUrl?: string;
        aiModel?: string;
        autoLabel?: boolean;
        labelCategories?: string[];
      },
    ) => {
      const categories = Array.isArray(payload?.labelCategories)
        ? payload.labelCategories.map((item) => String(item))
        : undefined;
      await saveAiSettings({
        aiBaseUrl:
          typeof payload?.aiBaseUrl === "string"
            ? payload.aiBaseUrl
            : undefined,
        aiModel:
          typeof payload?.aiModel === "string" ? payload.aiModel : undefined,
        autoLabel:
          typeof payload?.autoLabel === "boolean"
            ? payload.autoLabel
            : undefined,
        labelCategories: categories,
      });
      return { ok: true };
    },
  );

  ipcMain.handle("title2link:restore-last", () => manager.restoreLast());

  ipcMain.handle(
    "title2link:import",
    async (): Promise<ImportPreview | undefined> => {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: "选择要采集的表格",
        filters: [{ name: "Excel 表格", extensions: ["xlsx"] }],
        properties: ["openFile"],
      });
      if (picked.canceled || picked.filePaths.length === 0) return undefined;
      return manager.previewImport(picked.filePaths[0]);
    },
  );

  ipcMain.handle(
    "title2link:confirm-import",
    async (
      _event,
      payload: { filePath?: string; rowCount?: number },
    ): Promise<ImportResult> => {
      const filePath = String(payload?.filePath ?? "");
      if (!filePath) throw new Error("缺少文件路径");
      const rowCount =
        payload?.rowCount === undefined || payload.rowCount === null
          ? undefined
          : Number(payload.rowCount);
      if (
        rowCount !== undefined &&
        (!Number.isInteger(rowCount) || rowCount <= 0)
      ) {
        throw new Error("无效的导入行数");
      }
      return manager.importExcel(filePath, rowCount);
    },
  );

  ipcMain.handle("title2link:start", async (): Promise<JobSnapshot> => {
    const settings = await getSettingsView();
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("请先在设置中填写 API Key");
    let autoLabelOptions: LabelOptions | undefined;
    if (settings.autoLabel) {
      autoLabelOptions = await buildLabelOptions();
      if (!autoLabelOptions) {
        throw new Error(
          "已开启自动打标，但尚未配置 AI Key；请在设置中填写，或取消勾选自动打标",
        );
      }
    }
    return manager.start(apiKey, settings.concurrency, autoLabelOptions);
  });

  ipcMain.handle(
    "title2link:start-labeling",
    async (): Promise<JobSnapshot> => {
      const options = await buildLabelOptions();
      if (!options) throw new Error("请先在设置中填写 AI Key");
      return manager.startLabeling(options);
    },
  );

  ipcMain.handle("title2link:stop", () => {
    manager.stop();
    return { ok: true };
  });

  ipcMain.handle("title2link:get-state", () => {
    try {
      return manager.getSnapshot();
    } catch {
      return undefined;
    }
  });

  ipcMain.handle(
    "title2link:get-records",
    (_event, payload?: { status?: string; limit?: number }) => {
      const status =
        payload?.status && ALLOWED_RECORD_FILTERS.has(payload.status)
          ? (payload.status as CollectStatus)
          : undefined;
      const rawLimit = Number(payload?.limit);
      const limit =
        Number.isInteger(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, MAX_RECORDS_PER_QUERY)
          : undefined;
      return manager.getRecords(status, limit);
    },
  );

  ipcMain.handle(
    "title2link:confirm",
    async (_event, payload: { row: number; url: string }) => {
      const row = Number(payload?.row);
      const url = String(payload?.url ?? "");
      if (!Number.isInteger(row) || row <= 0) throw new Error("无效的行号");
      if (!isZhihuUrl(url)) throw new Error("无效的候选链接");
      const apiKey = await getApiKey();
      return manager.confirmCandidate(row, url, apiKey);
    },
  );

  ipcMain.handle(
    "title2link:skip",
    async (_event, payload: { row: number }) => {
      const row = Number(payload?.row);
      if (!Number.isInteger(row) || row <= 0) throw new Error("无效的行号");
      return manager.skipRow(row);
    },
  );

  ipcMain.handle(
    "title2link:export",
    async (): Promise<ExportResult | undefined> => {
      const settings = await getSettingsView();
      const snapshot = manager.getSnapshot();
      const defaultName = `${basename(snapshot.fileName, ".xlsx")}-已回填.xlsx`;
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: "导出结果表格",
        defaultPath: join(dirname(snapshot.sourcePath), defaultName),
        filters: [{ name: "Excel 表格", extensions: ["xlsx"] }],
      });
      if (picked.canceled || !picked.filePath) return undefined;
      return manager.export(picked.filePath, {
        includeContent: settings.includeContent,
      });
    },
  );

  return manager;
}
