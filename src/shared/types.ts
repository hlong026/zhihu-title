/**
 * 主进程与渲染进程共享的类型定义。
 * 注意：本文件及全部代码中不得出现搜索服务商的品牌名称，
 * 服务端点仅在 collector/search-client.ts 中以常量形式存在。
 */

/** 采集状态机 */
export type CollectStatus =
  | "pending" // 未开始
  | "exact" // 归一化标题完全相等，自动采纳
  | "auto" // 相似度达到高置信阈值，自动采纳最高赞候选
  | "confirmed" // 人工确认后采纳
  | "review" // 模糊匹配（相似度未达高置信阈值），待人工确认
  | "not_found" // 未达到模糊匹配阈值
  | "failed" // 请求失败（网络/服务端错误）
  | "skipped"; // 人工标记跳过

export const STATUS_LABELS: Record<CollectStatus, string> = {
  pending: "待采集",
  exact: "精确匹配",
  auto: "高相似采纳",
  confirmed: "已确认",
  review: "待人工",
  not_found: "未找到",
  failed: "采集失败",
  skipped: "已跳过",
};

/** 候选条目元信息（不含正文，正文仅在采纳时保存） */
export interface CandidateMeta {
  /** answer=问答回答，article=专栏文章 */
  type: "answer" | "article";
  title: string;
  url: string;
  voteup: number;
  wordCount: number;
  /** 与目标标题的相似度 0~1 */
  score: number;
}

/** 单行采集记录（JSONL 持久化单元） */
export interface CollectRecord {
  /** Excel 行号（1-based，表头为第 1 行，数据从第 2 行开始） */
  row: number;
  title: string;
  status: CollectStatus;
  url?: string;
  matchedTitle?: string;
  score?: number;
  voteup?: number;
  /** 正文纯文本字数（去 HTML 标签、去所有空白） */
  wordCount?: number;
  /** 正文纯文本（仅在导出正文需要时保留） */
  content?: string;
  /** 内容标签（AI 打标结果，如 故事/职场/历史科普/其他） */
  label?: string;
  /** 打标失败原因（成功后清空） */
  labelError?: string;
  /** 候选列表（最多 5 条，不含正文），供人工换候选 */
  candidates?: CandidateMeta[];
  error?: string;
  updatedAt: string;
}

/** 推送给渲染进程的记录（剥离正文，控制 IPC 负载） */
export type PublicRecord = Omit<CollectRecord, "content">;

/** 记录查询结果：records 为截断后的前 limit 条，total 为匹配总数 */
export interface RecordsPage {
  records: PublicRecord[];
  total: number;
}

/** 导入的 Excel 行 */
export interface ImportedRow {
  row: number;
  title: string;
}

/** 导入结果 */
export interface ImportResult {
  jobId: string;
  sourcePath: string;
  fileName: string;
  total: number;
  /** 已存在进度的行数（断点续跑） */
  resumed: number;
}

/** 导入预览：文件已解析成功，等待用户确认导入行数后才建立任务 */
export interface ImportPreview {
  sourcePath: string;
  fileName: string;
  /** 表格中的有效标题行总数 */
  total: number;
}

/** 任务进度快照 */
export interface JobSnapshot {
  jobId: string;
  sourcePath: string;
  fileName: string;
  total: number;
  pending: number;
  exact: number;
  auto: number;
  confirmed: number;
  review: number;
  notFound: number;
  failed: number;
  skipped: number;
  /** 已完成内容打标的行数 */
  labeled: number;
  /** 打标失败的行数 */
  labelFailed: number;
  running: boolean;
  /** 是否正在执行内容打标 */
  labeling: boolean;
  /** 运行中/结束时的一行说明 */
  message?: string;
}

/** 导出选项 */
export interface ExportOptions {
  /** 是否在导出表格中包含正文列 */
  includeContent: boolean;
}

export interface ExportResult {
  outputPath: string;
  total: number;
  linked: number;
  review: number;
  notFound: number;
  failed: number;
  skipped: number;
}

/** 设置（不含 Key 明文，Key 只以 hasKey/hasAiKey 形式暴露） */
export interface SettingsView {
  hasKey: boolean;
  concurrency: number;
  includeContent: boolean;
  /** 是否已配置打标用 AI Key */
  hasAiKey: boolean;
  aiBaseUrl: string;
  aiModel: string;
  /** 采集完成后是否自动执行内容打标 */
  autoLabel: boolean;
  /** 打标分类列表（不匹配任何分类时打 fallbackLabel） */
  labelCategories: string[];
}

/** 主进程 → 渲染进程推送事件 */
export interface JobUpdateEvent {
  jobId: string;
  snapshot: JobSnapshot;
  /** 本次有变化的记录 */
  records: PublicRecord[];
}

export const DEFAULT_CONCURRENCY = 10;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 20;

/** 默认打标分类；不属于任何分类的正文统一打 fallbackLabel */
export const DEFAULT_LABEL_CATEGORIES = ["故事", "职场", "历史科普"];
export const FALLBACK_LABEL = "其他";
/** AI 打标默认端点与模型（OpenAI 兼容接口） */
export const DEFAULT_AI_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_AI_MODEL = "deepseek-chat";
