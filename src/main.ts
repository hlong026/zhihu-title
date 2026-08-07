/** Electron 主进程：单窗口 + 白名单 IPC，安全基线对齐主应用。 */

import { app, BrowserWindow, Menu, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpc } from "./ipc.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | undefined;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    title: "标题链接采集工具",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  // 外部链接一律交给系统浏览器，禁止窗口内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("https://www.zhihu.com/") ||
      url.startsWith("https://zhuanlan.zhihu.com/")
    ) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  void mainWindow.loadFile(pagePath());
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function pagePath(): string {
  // 打包布局：dist/ 与 renderer-dist/ 平级
  const packaged = join(currentDirectory, "..", "renderer-dist", "index.html");
  if (existsSync(packaged)) return packaged;
  return join(currentDirectory, "..", "..", "renderer-dist", "index.html");
}

void app.whenReady().then(() => {
  registerIpc(
    // 懒创建窗口前先注册 IPC：BrowserWindow 由 registerIpc 回调闭包引用
    createWindowAndGet(),
    join(app.getPath("userData"), "jobs"),
  );
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function createWindowAndGet(): BrowserWindow {
  createWindow();
  if (!mainWindow) throw new Error("窗口创建失败");
  return mainWindow;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
