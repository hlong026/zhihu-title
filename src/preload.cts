/** 受限 Preload：仅暴露 title2link:* 白名单能力，不暴露 ipcRenderer 本体。 */

import { contextBridge, ipcRenderer } from "electron";

const api = {
  getSettings: () => ipcRenderer.invoke("title2link:get-settings"),
  saveKey: (key: string) => ipcRenderer.invoke("title2link:save-key", { key }),
  saveConcurrency: (concurrency: number) =>
    ipcRenderer.invoke("title2link:save-concurrency", { concurrency }),
  saveIncludeContent: (includeContent: boolean) =>
    ipcRenderer.invoke("title2link:save-include-content", { includeContent }),
  saveAiKey: (key: string) =>
    ipcRenderer.invoke("title2link:save-ai-key", { key }),
  saveAiSettings: (patch: {
    aiBaseUrl?: string;
    aiModel?: string;
    autoLabel?: boolean;
    labelCategories?: string[];
  }) => ipcRenderer.invoke("title2link:save-ai-settings", patch),
  restoreLast: () => ipcRenderer.invoke("title2link:restore-last"),
  importExcel: () => ipcRenderer.invoke("title2link:import"),
  confirmImport: (filePath: string, rowCount?: number) =>
    ipcRenderer.invoke("title2link:confirm-import", { filePath, rowCount }),
  start: () => ipcRenderer.invoke("title2link:start"),
  startLabeling: () => ipcRenderer.invoke("title2link:start-labeling"),
  stop: () => ipcRenderer.invoke("title2link:stop"),
  getState: () => ipcRenderer.invoke("title2link:get-state"),
  getRecords: (status?: string, limit?: number) =>
    ipcRenderer.invoke("title2link:get-records", { status, limit }),
  confirm: (row: number, url: string) =>
    ipcRenderer.invoke("title2link:confirm", { row, url }),
  skip: (row: number) => ipcRenderer.invoke("title2link:skip", { row }),
  exportExcel: () => ipcRenderer.invoke("title2link:export"),
  onUpdate: (callback: (event: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on("title2link:update", listener);
    return () => ipcRenderer.removeListener("title2link:update", listener);
  },
};

contextBridge.exposeInMainWorld("title2link", api);

export type Title2LinkApi = typeof api;
