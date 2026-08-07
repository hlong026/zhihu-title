/**
 * 内容打标 AI 客户端（OpenAI 兼容 Chat Completions 接口）。
 * 仅主进程使用；Key 明文绝不发送给渲染进程。
 */

import { FALLBACK_LABEL } from "./shared/types.js";

const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 60_000;
/** 送入模型的正文最大字符数，控制成本与上下文长度 */
const LABEL_CONTENT_CHARS = 2_000;

/** 鉴权失败（401/403）：打标任务应立即中止，重试无意义 */
export class AiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiAuthError";
  }
}

export interface ClassifyOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 正文纯文本（内部会截断） */
  content: string;
  /** 候选分类列表 */
  categories: string[];
  signal?: AbortSignal;
}

/** 调用模型对正文分类，返回候选分类之一或 fallback 标签 */
export async function classifyContent(
  options: ClassifyOptions,
): Promise<string> {
  const { apiKey, baseUrl, model, content, categories, signal } = options;
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const allowed = [...categories, FALLBACK_LABEL];

  const prompt =
    `你是一个内容分类助手。请阅读下面的正文内容，判断它最符合哪个分类。\n` +
    `候选分类：${categories.join("、")}\n` +
    `规则：\n` +
    `1. 只能输出候选分类中的一个名称，或输出「${FALLBACK_LABEL}」表示不属于任何候选分类。\n` +
    `2. 只输出分类名称本身，不要输出任何解释、标点或多余文字。\n\n` +
    `正文内容（可能经过截断）：\n${content.slice(0, LABEL_CONTENT_CHARS)}`;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const response = await postWithTimeout(
        url,
        apiKey,
        model,
        prompt,
        signal,
      );
      if (response.status === 401 || response.status === 403) {
        throw new AiAuthError(
          `AI 鉴权失败（HTTP ${response.status}），请检查 AI Key`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`AI 服务暂时不可用（HTTP ${response.status}）`);
      }
      if (!response.ok) {
        throw new Error(`AI 请求失败（HTTP ${response.status}）`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      return normalizeLabel(text, allowed);
    } catch (error) {
      if (error instanceof AiAuthError) throw error;
      if (signal?.aborted) throw new Error("aborted");
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1_500);
      }
    }
  }
  throw lastError ?? new Error("AI 请求失败");
}

/** 校验模型输出：精确命中分类或 fallback，否则一律 fallback（不臆造标签） */
function normalizeLabel(text: string, allowed: string[]): string {
  const cleaned = text.trim().replace(/[。.，,！!？?"'《》【】]/g, "");
  for (const candidate of allowed) {
    if (cleaned === candidate) return candidate;
  }
  // 兼容"分类：故事"之类的包裹式输出
  for (const candidate of allowed) {
    if (cleaned.includes(candidate)) return candidate;
  }
  return FALLBACK_LABEL;
}

async function postWithTimeout(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
