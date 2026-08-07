/**
 * 标题搜索客户端。
 * 品牌中性约束：本文件之外的任何代码、UI、日志、导出文件
 * 不得出现搜索服务商名称；端点仅以常量形式存在于此处。
 */

const SEARCH_SERVICE_BASE_URL = "https://api.tikhub.io";
const SEARCH_PATH = "/api/v1/zhihu/web/fetch_article_search_v3";
const SEARCH_LIMIT = 20;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

/** 鉴权失败（401/403）：整个任务应立即中止，重试无意义 */
export class SearchAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchAuthError";
  }
}

export interface SearchCandidate {
  type: "answer" | "article";
  title: string;
  url: string;
  voteup: number;
  /** 完整正文 HTML（搜索接口直接返回，无截断） */
  contentHtml: string;
}

interface SearchEnvelopeItem {
  type?: string;
  object?: {
    id?: number | string;
    type?: string;
    title?: string;
    voteup_count?: number;
    content?: string;
    question?: { id?: number | string; name?: string; title?: string };
  };
}

/** 单个标题搜索，返回已解析的候选列表（可能为空数组） */
export async function searchByTitle(
  apiKey: string,
  keyword: string,
  externalSignal?: AbortSignal,
): Promise<SearchCandidate[]> {
  const url =
    `${SEARCH_SERVICE_BASE_URL}${SEARCH_PATH}` +
    `?keyword=${encodeURIComponent(keyword)}&limit=${SEARCH_LIMIT}` +
    `&show_all_topics=0&search_source=Normal`;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (externalSignal?.aborted) throw new Error("aborted");
    try {
      const response = await fetchWithTimeout(url, apiKey, externalSignal);
      if (response.status === 401 || response.status === 403) {
        throw new SearchAuthError(
          `鉴权失败（HTTP ${response.status}），请检查 API Key`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`服务端暂时不可用（HTTP ${response.status}）`);
      }
      if (!response.ok) {
        throw new Error(`搜索请求失败（HTTP ${response.status}）`);
      }
      const body = (await response.json()) as {
        code?: number;
        data?: { data?: SearchEnvelopeItem[] };
      };
      if (body.code !== 200 || !body.data?.data) {
        throw new Error("搜索响应结构异常");
      }
      return extractCandidates(body.data.data);
    } catch (error) {
      if (error instanceof SearchAuthError) throw error;
      if (externalSignal?.aborted) throw new Error("aborted");
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1_500 * attempt);
      }
    }
  }
  throw lastError ?? new Error("搜索请求失败");
}

async function fetchWithTimeout(
  url: string,
  apiKey: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

/** 解析 search_v3 透传结构为候选列表 */
function extractCandidates(items: SearchEnvelopeItem[]): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];
  for (const item of items) {
    if (item.type !== "search_result" || !item.object) continue;
    const objectType = item.object.type ?? "answer";
    // ai_zhida 等类型无可用 id，直接跳过
    if (objectType !== "answer" && objectType !== "article") continue;
    const candidate = parseObject(objectType, item.object);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function parseObject(
  type: "answer" | "article",
  obj: NonNullable<SearchEnvelopeItem["object"]>,
): SearchCandidate | undefined {
  const voteup = typeof obj.voteup_count === "number" ? obj.voteup_count : 0;
  const contentHtml = obj.content ?? "";

  if (type === "answer") {
    // 问题标题在 question.name（带 <em> 高亮标签），回答自身也可能带 title
    const title = obj.title ?? obj.question?.name ?? obj.question?.title ?? "";
    const questionId = obj.question?.id;
    const answerId = obj.id;
    if (!answerId) return undefined;
    const url = questionId
      ? `https://www.zhihu.com/question/${questionId}/answer/${answerId}`
      : `https://www.zhihu.com/answer/${answerId}`;
    return { type, title: String(title), url, voteup, contentHtml };
  }

  if (!obj.id) return undefined;
  return {
    type,
    title: String(obj.title ?? ""),
    url: `https://zhuanlan.zhihu.com/p/${obj.id}`,
    voteup,
    contentHtml,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
