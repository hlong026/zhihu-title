/**
 * 任务状态存储：JSONL append-only 文件。
 * 每条记录一行 JSON，后写入的行覆盖先前的同 row 记录，
 * 天然支持断点续跑与人工确认后的状态更新。
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CollectRecord } from "../shared/types.js";

/** 读取 JSONL，返回按 row 索引的最新记录（后写覆盖先写） */
export async function loadRecords(
  filePath: string,
): Promise<Map<number, CollectRecord>> {
  const map = new Map<number, CollectRecord>();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return map;
    throw error;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as CollectRecord;
      if (typeof record.row === "number") map.set(record.row, record);
    } catch {
      // 跳过损坏行（如进程中断写了一半），不阻塞恢复
    }
  }
  return map;
}

/** 追加写入记录；调用方串行调用以避免交错 */
export async function appendRecords(
  filePath: string,
  records: readonly CollectRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await mkdir(dirname(filePath), { recursive: true });
  const appended =
    records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await appendFile(filePath, appended, "utf8");
}
