/** 采集引擎：并发池调度 + 单标题处理（搜索 → 匹配 → 生成记录）。 */

import type { CandidateMeta, CollectRecord } from "../shared/types.js";
import { classifyMatch, pickBestCandidate } from "./matcher.js";
import {
  SearchAuthError,
  searchByTitle,
  type SearchCandidate,
} from "./search-client.js";
import { countWords, htmlToExportText, htmlToPlainText } from "./text.js";

/** UI 候选列表最多保留条数 */
const MAX_CANDIDATES_KEPT = 5;

export interface EngineTask {
  row: number;
  title: string;
}

export interface RunEngineOptions {
  tasks: EngineTask[];
  apiKey: string;
  concurrency: number;
  signal: AbortSignal;
  /** 每条记录处理完毕（成功或失败）后回调，调用方负责持久化 */
  onRecord: (record: CollectRecord) => void;
  /** 鉴权失败等致命错误：整个任务应立即中止 */
  onFatal: (message: string) => void;
}

/** 运行采集，全部任务完成或致命错误时返回 */
export async function runEngine(options: RunEngineOptions): Promise<void> {
  const { tasks, apiKey, concurrency, signal, onRecord, onFatal } = options;
  if (tasks.length === 0) return;

  let cursor = 0;
  let fatalMessage: string | undefined;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (!signal.aborted && !fatalMessage) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      const task = tasks[index];
      try {
        const record = await processTask(task, apiKey, signal);
        onRecord(record);
      } catch (error) {
        if (error instanceof SearchAuthError) {
          fatalMessage = error.message;
          onFatal(error.message);
          return;
        }
        if (signal.aborted) return;
        onRecord(buildFailedRecord(task, error));
      }
    }
  });
  await Promise.all(workers);
}

/** 单标题处理：搜索 → 候选打分 → 四档分流 */
async function processTask(
  task: EngineTask,
  apiKey: string,
  signal: AbortSignal,
): Promise<CollectRecord> {
  const searched = await searchByTitle(apiKey, task.title, signal);
  const now = new Date().toISOString();

  const metas: CandidateMeta[] = searched.map((candidate) => ({
    type: candidate.type,
    title: htmlToPlainText(candidate.title),
    url: candidate.url,
    voteup: candidate.voteup,
    wordCount: countWords(candidate.contentHtml),
    score: classifyMatch(task.title, candidate.title).score,
  }));
  // 候选列表按相似度、赞同数排序，供人工挑选
  const sortedMetas = metas
    .slice()
    .sort((a, b) => b.score - a.score || b.voteup - a.voteup)
    .slice(0, MAX_CANDIDATES_KEPT);

  const best = pickBestCandidate(task.title, searched);
  if (!best) {
    return {
      row: task.row,
      title: task.title,
      status: "not_found",
      candidates: sortedMetas,
      updatedAt: now,
    };
  }

  const base = {
    row: task.row,
    title: task.title,
    matchedTitle: htmlToPlainText(best.candidate.title),
    score: round3(best.score),
    voteup: best.candidate.voteup,
    wordCount: countWords(best.candidate.contentHtml),
    candidates: sortedMetas,
    updatedAt: now,
  };

  if (best.tier === "exact" || best.tier === "auto") {
    // 精确匹配或高相似度（已取点赞最高候选）：自动采纳，保存正文纯文本
    return {
      ...base,
      status: best.tier,
      url: best.candidate.url,
      content: htmlToExportText(best.candidate.contentHtml),
    };
  }

  // 相似度未达高置信阈值：进入待人工，绝不自动回填链接
  return { ...base, status: "review" };
}

function buildFailedRecord(task: EngineTask, error: unknown): CollectRecord {
  const message = error instanceof Error ? error.message : String(error);
  return {
    row: task.row,
    title: task.title,
    status: "failed",
    error: message === "aborted" ? "任务已中止" : message,
    updatedAt: new Date().toISOString(),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 人工确认某候选后，重新搜索一次取回该候选正文（候选正文不持久化） */
export async function fetchCandidateContent(
  apiKey: string,
  taskTitle: string,
  targetUrl: string,
  signal?: AbortSignal,
): Promise<SearchCandidate | undefined> {
  const searched = await searchByTitle(apiKey, taskTitle, signal);
  return searched.find((candidate) => candidate.url === targetUrl);
}
