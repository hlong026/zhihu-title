/** 打标引擎：并发池调度，逐行调用 AI 客户端并回调结果。 */

import { AiAuthError, classifyContent } from "./ai-client.js";

export interface LabelTask {
  row: number;
  /** 正文纯文本（ai-client 内部会截断） */
  content: string;
}

export interface RunLabelerOptions {
  tasks: LabelTask[];
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  /** 候选分类列表 */
  categories: string[];
  concurrency: number;
  signal: AbortSignal;
  /** 单行打标结束（成功给出 label，失败给出 labelError）后回调，调用方负责持久化 */
  onResult: (
    row: number,
    label: string | undefined,
    labelError: string | undefined,
  ) => void;
  /** 鉴权失败等致命错误：整个打标任务应立即中止 */
  onFatal: (message: string) => void;
}

/** 运行打标，全部任务完成或致命错误时返回 */
export async function runLabeler(options: RunLabelerOptions): Promise<void> {
  const {
    tasks,
    aiApiKey,
    aiBaseUrl,
    aiModel,
    categories,
    concurrency,
    signal,
    onResult,
    onFatal,
  } = options;
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
        const label = await classifyContent({
          apiKey: aiApiKey,
          baseUrl: aiBaseUrl,
          model: aiModel,
          content: task.content,
          categories,
          signal,
        });
        onResult(task.row, label, undefined);
      } catch (error) {
        if (error instanceof AiAuthError) {
          fatalMessage = error.message;
          onFatal(error.message);
          return;
        }
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        onResult(
          task.row,
          undefined,
          message === "aborted" ? "打标已中止" : message,
        );
      }
    }
  });
  await Promise.all(workers);
}
