/** 渲染进程与主进程的桥接：对 window.title2link 做类型封装。 */

import type {
  CollectRecord,
  ExportResult,
  ImportPreview,
  ImportResult,
  JobSnapshot,
  JobUpdateEvent,
  RecordsPage,
  SettingsView,
} from "../src/shared/types";

export type SlimRecord = Omit<CollectRecord, "content">;

interface Title2LinkBridge {
  getSettings(): Promise<SettingsView>;
  saveKey(key: string): Promise<{ ok: boolean }>;
  saveConcurrency(concurrency: number): Promise<{ ok: boolean }>;
  saveIncludeContent(includeContent: boolean): Promise<{ ok: boolean }>;
  saveAiKey(key: string): Promise<{ ok: boolean }>;
  saveAiSettings(patch: {
    aiBaseUrl?: string;
    aiModel?: string;
    autoLabel?: boolean;
    labelCategories?: string[];
  }): Promise<{ ok: boolean }>;
  restoreLast(): Promise<ImportResult | undefined>;
  importExcel(): Promise<ImportPreview | undefined>;
  confirmImport(filePath: string, rowCount?: number): Promise<ImportResult>;
  start(): Promise<JobSnapshot>;
  startLabeling(): Promise<JobSnapshot>;
  stop(): Promise<{ ok: boolean }>;
  getState(): Promise<JobSnapshot | undefined>;
  getRecords(status?: string, limit?: number): Promise<RecordsPage>;
  confirm(row: number, url: string): Promise<SlimRecord>;
  skip(row: number): Promise<SlimRecord>;
  exportExcel(): Promise<ExportResult | undefined>;
  onUpdate(callback: (event: JobUpdateEvent) => void): () => void;
}

const bridge = (window as unknown as { title2link: Title2LinkBridge })
  .title2link;

if (!bridge) {
  throw new Error("preload 桥接未就绪，请在桌面应用内运行");
}

export const title2link = bridge;
