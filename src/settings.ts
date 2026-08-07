/** 设置存储：API Key 用系统级加密（safeStorage）落盘，明文仅存在于主进程。 */

import { app, safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  DEFAULT_CONCURRENCY,
  DEFAULT_LABEL_CATEGORIES,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  type SettingsView,
} from "./shared/types.js";

interface SettingsFile {
  /** safeStorage 加密后的搜索 Key，base64 */
  keyCipher?: string;
  /** safeStorage 加密后的打标 AI Key，base64 */
  aiKeyCipher?: string;
  concurrency?: number;
  includeContent?: boolean;
  aiBaseUrl?: string;
  aiModel?: string;
  autoLabel?: boolean;
  labelCategories?: string[];
}

let cache: SettingsFile | undefined;

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

async function load(): Promise<SettingsFile> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(settingsPath(), "utf8")) as SettingsFile;
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * 保存设置：整个 load→merge→write 过程串行执行，
 * 避免并发保存时后写者基于旧快照合并、先写者的补丁被覆盖丢失。
 */
let saveQueue: Promise<void> = Promise.resolve();

async function save(patch: Partial<SettingsFile>): Promise<void> {
  const run = saveQueue.then(async () => {
    const current = await load();
    cache = { ...current, ...patch };
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(settingsPath(), JSON.stringify(cache, null, 2), "utf8");
  });
  // 单次失败不阻塞后续保存
  saveQueue = run.catch(() => undefined);
  await run;
}

export function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONCURRENCY;
  return Math.min(
    MAX_CONCURRENCY,
    Math.max(MIN_CONCURRENCY, Math.round(value)),
  );
}

export async function getSettingsView(): Promise<SettingsView> {
  const file = await load();
  return {
    hasKey: Boolean(file.keyCipher),
    concurrency: clampConcurrency(file.concurrency ?? DEFAULT_CONCURRENCY),
    includeContent: file.includeContent ?? false,
    hasAiKey: Boolean(file.aiKeyCipher),
    aiBaseUrl: file.aiBaseUrl || DEFAULT_AI_BASE_URL,
    aiModel: file.aiModel || DEFAULT_AI_MODEL,
    autoLabel: file.autoLabel ?? false,
    labelCategories:
      file.labelCategories && file.labelCategories.length > 0
        ? file.labelCategories
        : DEFAULT_LABEL_CATEGORIES,
  };
}

/** 仅主进程使用：解密后的 Key 明文，绝不发送给渲染进程 */
export async function getApiKey(): Promise<string | undefined> {
  const file = await load();
  if (!file.keyCipher || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    const plain = safeStorage.decryptString(
      Buffer.from(file.keyCipher, "base64"),
    );
    return plain || undefined;
  } catch {
    return undefined;
  }
}

export async function saveApiKey(plainKey: string): Promise<void> {
  const trimmed = plainKey.trim();
  if (!trimmed) throw new Error("API Key 不能为空");
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不支持安全存储，无法保存 Key");
  }
  const cipher = safeStorage.encryptString(trimmed).toString("base64");
  await save({ keyCipher: cipher });
}

export async function saveConcurrency(value: number): Promise<void> {
  await save({ concurrency: clampConcurrency(value) });
}

export async function saveIncludeContent(value: boolean): Promise<void> {
  await save({ includeContent: Boolean(value) });
}

/** 保存打标 AI Key；传空字符串表示清除 */
export async function saveAiApiKey(plainKey: string): Promise<void> {
  const trimmed = plainKey.trim();
  if (!trimmed) {
    await save({ aiKeyCipher: undefined });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("当前系统不支持安全存储，无法保存 Key");
  }
  const cipher = safeStorage.encryptString(trimmed).toString("base64");
  await save({ aiKeyCipher: cipher });
}

/** 仅主进程使用：解密后的打标 AI Key 明文 */
export async function getAiApiKey(): Promise<string | undefined> {
  const file = await load();
  if (!file.aiKeyCipher || !safeStorage.isEncryptionAvailable())
    return undefined;
  try {
    const plain = safeStorage.decryptString(
      Buffer.from(file.aiKeyCipher, "base64"),
    );
    return plain || undefined;
  } catch {
    return undefined;
  }
}

/** 打标相关非密配置统一保存入口 */
export async function saveAiSettings(patch: {
  aiBaseUrl?: string;
  aiModel?: string;
  autoLabel?: boolean;
  labelCategories?: string[];
}): Promise<void> {
  const next: Partial<SettingsFile> = {};
  if (patch.aiBaseUrl !== undefined) {
    const url = patch.aiBaseUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      throw new Error("Base URL 必须以 http:// 或 https:// 开头");
    }
    next.aiBaseUrl = url || undefined;
  }
  if (patch.aiModel !== undefined) {
    next.aiModel = patch.aiModel.trim() || undefined;
  }
  if (patch.autoLabel !== undefined) {
    next.autoLabel = Boolean(patch.autoLabel);
  }
  if (patch.labelCategories !== undefined) {
    const categories = Array.from(
      new Set(
        patch.labelCategories
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    );
    if (categories.length === 0) {
      throw new Error("分类列表不能为空");
    }
    next.labelCategories = categories;
  }
  await save(next);
}
