import { useState } from "react";
import { title2link } from "../bridge";
import type {
  ImportPreview,
  JobSnapshot,
  SettingsView,
} from "../../src/shared/types";

interface TaskPageProps {
  snapshot: JobSnapshot | null;
  settings: SettingsView | null;
  onSnapshotChange: (snapshot: JobSnapshot | null) => void;
  refreshSettings: () => Promise<void>;
  notify: (kind: "info" | "error", text: string) => void;
}

export default function TaskPage({
  snapshot,
  settings,
  onSnapshotChange,
  refreshSettings,
  notify,
}: TaskPageProps) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMode, setImportMode] = useState<"all" | "custom">("all");
  const [customCount, setCustomCount] = useState("");

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = () =>
    guard(async () => {
      const result = await title2link.importExcel();
      if (!result) return;
      setImportMode("all");
      setCustomCount(String(Math.min(100, result.total)));
      setPreview(result);
    });

  const handleConfirmImport = () =>
    guard(async () => {
      if (!preview) return;
      let rowCount: number | undefined;
      if (importMode === "custom") {
        const parsed = Number(customCount);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          notify("error", "请输入有效的行数（正整数）");
          return;
        }
        rowCount = Math.min(parsed, preview.total);
      }
      const result = await title2link.confirmImport(
        preview.sourcePath,
        rowCount,
      );
      setPreview(null);
      onSnapshotChange((await title2link.getState()) ?? null);
      const scope =
        rowCount !== undefined && rowCount < preview.total
          ? `已导入前 ${result.total} 行（表格共 ${preview.total} 行）`
          : `已导入 ${result.total} 行`;
      notify(
        "info",
        result.resumed > 0
          ? `${scope}，其中 ${result.resumed} 行有历史进度，将断点续跑`
          : scope,
      );
    });

  const handleStart = () =>
    guard(async () => {
      if (!settings?.hasKey) {
        notify("error", "请先在“设置”中填写 API Key");
        return;
      }
      onSnapshotChange(await title2link.start());
      notify("info", "开始采集");
    });

  const handleStop = () =>
    guard(async () => {
      await title2link.stop();
      notify("info", "已发送停止指令，进行中的请求会陆续中止");
    });

  const handleAutoLabel = async (checked: boolean) => {
    try {
      await title2link.saveAiSettings({ autoLabel: checked });
      await refreshSettings();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleStartLabeling = () =>
    guard(async () => {
      if (!settings?.hasAiKey) {
        notify("error", "请先在“设置”中填写 AI Key");
        return;
      }
      onSnapshotChange(await title2link.startLabeling());
      notify("info", "开始内容打标");
    });

  const handleExport = () =>
    guard(async () => {
      const result = await title2link.exportExcel();
      if (!result) return;
      notify(
        "info",
        `已导出 ${result.linked} 条链接（待人工 ${result.review}，未找到 ${result.notFound}，失败 ${result.failed}，跳过 ${result.skipped}）`,
      );
    });

  const running = snapshot?.running ?? false;
  const labeling = snapshot?.labeling ?? false;
  const busyAll = busy || running || labeling;
  const finished = snapshot ? snapshot.total - snapshot.pending : 0;
  const remaining = snapshot ? snapshot.pending + snapshot.failed : 0;
  const percent =
    snapshot && snapshot.total > 0
      ? Math.round((finished / snapshot.total) * 100)
      : 0;

  return (
    <div className="page">
      <section className="card">
        <h2>第一步：导入表格</h2>
        <p className="hint">
          支持
          .xlsx，第一行为表头，需包含“标题”列。同一文件重复导入会自动接续上次进度。
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={handleImport}
            disabled={busyAll}
          >
            选择表格文件…
          </button>
        </div>
        {snapshot ? (
          <div className="imported-info">
            <div>
              当前文件：<strong>{snapshot.fileName}</strong>（共{" "}
              {snapshot.total} 行）
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>第二步：开始采集</h2>
        <p className="hint">
          并发数当前为 {settings?.concurrency ?? "—"}（可在“设置”中调整）。
          {settings && !settings.hasKey ? " 尚未填写 API Key。" : ""}
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings?.autoLabel ?? false}
            onChange={(event) => void handleAutoLabel(event.target.checked)}
            disabled={busyAll}
          />
          采集完成后自动对正文进行内容打标
          {settings?.autoLabel && !settings.hasAiKey
            ? "（尚未配置 AI Key，请在“设置”中填写）"
            : ""}
        </label>
        <div className="actions">
          {running ? (
            <button
              type="button"
              className="btn danger"
              onClick={handleStop}
              disabled={busy}
            >
              停止采集
            </button>
          ) : labeling ? (
            <button
              type="button"
              className="btn danger"
              onClick={handleStop}
              disabled={busy}
            >
              停止打标
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={handleStart}
                disabled={busy || !snapshot || remaining === 0}
              >
                {snapshot && finished > 0 && finished < snapshot.total
                  ? "继续采集"
                  : "开始采集"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleStartLabeling}
                disabled={busy || !snapshot || finished === 0}
                title="对已采纳且有正文且未打标成功的行执行内容打标"
              >
                开始打标
              </button>
            </>
          )}
        </div>
        {snapshot ? (
          <div className="progress-block">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="progress-text">
              {finished} / {snapshot.total}（{percent}%）
              {snapshot.message ? ` · ${snapshot.message}` : ""}
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>第三步：导出结果</h2>
        <p className="hint">
          在原表尾部追加「文章链接」「采集状态」「原文字数」「内容标签」列
          {settings?.includeContent ? "与「正文」列（已勾选导出正文）" : ""}。
          仅精确匹配、高相似采纳与已确认的行回填链接，待人工的行链接留空。
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={handleExport}
            disabled={busyAll || !snapshot || finished === 0}
          >
            导出结果表格…
          </button>
        </div>
      </section>

      {snapshot ? (
        <section className="card stat-grid">
          <Stat label="精确匹配" value={snapshot.exact} tone="good" />
          <Stat label="高相似采纳" value={snapshot.auto} tone="good" />
          <Stat label="已确认" value={snapshot.confirmed} tone="good" />
          <Stat label="待人工" value={snapshot.review} tone="warn" />
          <Stat label="未找到" value={snapshot.notFound} tone="warn" />
          <Stat label="采集失败" value={snapshot.failed} tone="bad" />
          <Stat label="已跳过" value={snapshot.skipped} tone="muted" />
          <Stat label="待采集" value={snapshot.pending} tone="muted" />
          <Stat label="已打标" value={snapshot.labeled} tone="good" />
          <Stat
            label="打标失败"
            value={snapshot.labelFailed}
            tone={snapshot.labelFailed > 0 ? "warn" : "muted"}
          />
        </section>
      ) : null}

      {preview ? (
        <div className="modal-overlay">
          <div className="modal">
            <h2>选择导入行数</h2>
            <p className="hint">
              文件 <strong>{preview.fileName}</strong> 共解析出 {preview.total}{" "}
              行有效标题。
            </p>
            <label className="modal-option">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "all"}
                onChange={() => setImportMode("all")}
              />
              <span>全部导入（{preview.total} 行）</span>
            </label>
            <label className="modal-option">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "custom"}
                onChange={() => setImportMode("custom")}
              />
              <span>只导入前</span>
              <input
                type="number"
                className="row-count-input"
                min={1}
                max={preview.total}
                value={customCount}
                disabled={importMode !== "custom"}
                onFocus={() => setImportMode("custom")}
                onChange={(event) => setCustomCount(event.target.value)}
              />
              <span>行</span>
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setPreview(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleConfirmImport}
                disabled={busy}
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
