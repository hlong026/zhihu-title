/**
 * 任务编排：导入 → 采集 → 人工处理 → 导出。
 * 每个 Excel 文件以绝对路径哈希作为 jobId，进度文件为 userData/jobs/{jobId}.jsonl；
 * pending 行不落盘（内存中由"无记录"推导），仅已处理记录写入 JSONL。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fetchCandidateContent, runEngine } from "./collector/engine.js";
import { appendRecords, loadRecords } from "./collector/task-store.js";
import { countWords, htmlToExportText } from "./collector/text.js";
import { exportExcel } from "./excel/exporter.js";
import { readTitlesFromExcel } from "./excel/reader.js";
import { runLabeler, type LabelTask } from "./labeler.js";
import {
  STATUS_LABELS,
  type CollectRecord,
  type CollectStatus,
  type ExportOptions,
  type ExportResult,
  type ImportedRow,
  type ImportPreview,
  type ImportResult,
  type JobSnapshot,
  type JobUpdateEvent,
  type PublicRecord,
  type RecordsPage,
} from "./shared/types.js";

interface JobMeta {
  jobId: string;
  sourcePath: string;
  fileName: string;
  total: number;
  updatedAt: string;
}

interface ActiveJob {
  meta: JobMeta;
  rows: ImportedRow[];
  records: Map<number, CollectRecord>;
  running: boolean;
  labeling: boolean;
  message?: string;
  abortController?: AbortController;
  labelAbortController?: AbortController;
}

/** 打标运行参数（由 IPC 层从设置中组装） */
export interface LabelOptions {
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  categories: string[];
  concurrency: number;
}

/** 参与打标的状态：仅已采纳且有正文的行 */
const LABELABLE_STATUSES: ReadonlySet<CollectStatus> = new Set([
  "exact",
  "auto",
  "confirmed",
]);

const PUSH_INTERVAL_MS = 500;

export class JobManager {
  private jobsDir: string;
  private job: ActiveJob | undefined;
  private onUpdate: (event: JobUpdateEvent) => void;
  private pendingPush: CollectRecord[] = [];
  private pushTimer: NodeJS.Timeout | undefined;
  /** 进度写入串行队列：保证 JSONL 追加顺序与"后写覆盖先写"语义 */
  private writeQueue: Promise<void> = Promise.resolve();
  /** 导入预览缓存：避免确认导入时重复解析同一个 Excel */
  private previewCache: { path: string; rows: ImportedRow[] } | undefined;

  constructor(jobsDir: string, onUpdate: (event: JobUpdateEvent) => void) {
    this.jobsDir = jobsDir;
    this.onUpdate = onUpdate;
  }

  private jobFile(jobId: string): string {
    return join(this.jobsDir, `${jobId}.jsonl`);
  }

  private metaFile(jobId: string): string {
    return join(this.jobsDir, `${jobId}.meta.json`);
  }

  /** 选择文件后的预览：解析标题行并返回总数，不建立任务 */
  async previewImport(filePath: string): Promise<ImportPreview> {
    if (this.job?.running || this.job?.labeling)
      throw new Error("当前任务正在运行，请先停止后再导入");
    const absolutePath = resolve(filePath);
    const { rows } = await readTitlesFromExcel(absolutePath);
    this.previewCache = { path: absolutePath, rows };
    return {
      sourcePath: absolutePath,
      fileName: basename(absolutePath),
      total: rows.length,
    };
  }

  /** 导入 Excel 并建立/恢复任务；rowCount 限制导入行数（缺省为全部） */
  async importExcel(
    filePath: string,
    rowCount?: number,
  ): Promise<ImportResult> {
    if (this.job?.running || this.job?.labeling)
      throw new Error("当前任务正在运行，请先停止后再导入");
    const absolutePath = resolve(filePath);
    let rows =
      this.previewCache?.path === absolutePath
        ? this.previewCache.rows
        : (await readTitlesFromExcel(absolutePath)).rows;
    this.previewCache = undefined;
    if (rowCount !== undefined && rowCount > 0 && rowCount < rows.length) {
      rows = rows.slice(0, rowCount);
    }

    const jobId = createHash("sha1")
      .update(absolutePath)
      .digest("hex")
      .slice(0, 12);
    const records = await loadRecords(this.jobFile(jobId));
    const meta: JobMeta = {
      jobId,
      sourcePath: absolutePath,
      fileName: basename(absolutePath),
      total: rows.length,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(this.jobsDir, { recursive: true });
    await writeFile(
      this.metaFile(jobId),
      JSON.stringify(meta, null, 2),
      "utf8",
    );

    this.job = { meta, rows, records, running: false, labeling: false };
    this.broadcast([]);
    return {
      jobId,
      sourcePath: absolutePath,
      fileName: meta.fileName,
      total: rows.length,
      resumed: records.size,
    };
  }

  /** 启动后尝试恢复上次任务（找不到则返回 undefined，异常会记录日志） */
  async restoreLast(): Promise<ImportResult | undefined> {
    let files: string[];
    try {
      files = await readdir(this.jobsDir);
    } catch (error) {
      // 目录不存在属正常（首次启动），其余异常需要可见
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[title2link] 读取任务目录失败：", error);
      }
      return undefined;
    }
    const metaFiles = files.filter((name) => name.endsWith(".meta.json"));
    if (metaFiles.length === 0) return undefined;

    let latest: JobMeta | undefined;
    for (const name of metaFiles) {
      try {
        const meta = JSON.parse(
          await readFile(join(this.jobsDir, name), "utf8"),
        ) as JobMeta;
        if (!latest || meta.updatedAt > latest.updatedAt) latest = meta;
      } catch (error) {
        console.warn(`[title2link] 跳过损坏的任务元信息 ${name}：`, error);
      }
    }
    if (!latest || !isAbsolute(latest.sourcePath)) return undefined;

    try {
      return await this.importExcel(latest.sourcePath);
    } catch (error) {
      console.warn(
        "[title2link] 恢复上次任务失败（源文件可能被移动或删除）：",
        error,
      );
      return undefined;
    }
  }

  /** 开始/继续采集：只处理 pending 与 failed 行；autoLabelOptions 存在且采集正常结束时自动衔接打标 */
  async start(
    apiKey: string,
    concurrency: number,
    autoLabelOptions?: LabelOptions,
  ): Promise<JobSnapshot> {
    const job = this.requireJob();
    if (job.running) throw new Error("任务已在运行中");
    if (!apiKey) throw new Error("请先在设置中填写 API Key");

    const tasks = job.rows
      .filter((row) => {
        const record = job.records.get(row.row);
        return (
          !record || record.status === "pending" || record.status === "failed"
        );
      })
      .map((row) => ({ row: row.row, title: row.title }));
    if (tasks.length === 0)
      throw new Error("没有待采集的行（全部已完成或已跳过）");

    const abortController = new AbortController();
    job.running = true;
    job.abortController = abortController;
    job.message = `采集中：剩余 ${tasks.length} 行`;
    this.broadcast([]);

    void (async () => {
      try {
        await runEngine({
          tasks,
          apiKey,
          concurrency,
          signal: abortController.signal,
          onRecord: (record) => {
            job.records.set(record.row, record);
            this.enqueuePush(record);
            this.enqueueWrite(record);
          },
          onFatal: (message) => {
            job.message = `已中止：${message}`;
            abortController.abort();
          },
        });
        if (abortController.signal.aborted) {
          job.message = job.message ?? "已停止";
        } else {
          job.message = "采集完成";
          // 勾选了自动打标：采集正常结束后立即执行
          if (autoLabelOptions) {
            const labelTasks = this.collectLabelTasks();
            if (labelTasks.length > 0) {
              await this.runLabeling(autoLabelOptions, labelTasks);
            }
          }
        }
      } catch (error) {
        job.message = `采集异常：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        this.flushPush();
        // 排空尾部进度写入，避免应用退出时丢记录
        await this.writeQueue;
        job.running = false;
        job.abortController = undefined;
        this.broadcast([]);
      }
    })();

    return this.getSnapshot();
  }

  /** 停止采集/打标（已发出的请求会陆续中断） */
  stop(): void {
    const job = this.requireJob();
    if (!job.running && !job.labeling) return;
    job.message = "已手动停止";
    job.abortController?.abort();
    job.labelAbortController?.abort();
  }

  /** 手动触发内容打标：只处理已采纳且有正文且尚未打标成功的行 */
  async startLabeling(options: LabelOptions): Promise<JobSnapshot> {
    const job = this.requireJob();
    if (job.running) throw new Error("采集任务正在运行，请停止后再打标");
    if (job.labeling) throw new Error("打标已在进行中");
    if (!options.aiApiKey) throw new Error("请先在设置中填写 AI Key");
    if (options.categories.length === 0) {
      throw new Error("请先在设置中配置打标分类");
    }
    const tasks = this.collectLabelTasks();
    if (tasks.length === 0) {
      throw new Error(
        "没有需要打标的行（仅已采纳且有正文且未打标成功的行参与）",
      );
    }
    void this.runLabeling(options, tasks);
    return this.getSnapshot();
  }

  /** 收集待打标任务：已采纳 + 有正文 + 未打标成功（失败的可重跑） */
  private collectLabelTasks(): LabelTask[] {
    const job = this.requireJob();
    const tasks: LabelTask[] = [];
    for (const row of job.rows) {
      const record = job.records.get(row.row);
      if (!record || !LABELABLE_STATUSES.has(record.status)) continue;
      if (!record.content) continue;
      if (record.label && !record.labelError) continue;
      tasks.push({ row: record.row, content: record.content });
    }
    return tasks;
  }

  /** 执行打标（采集后自动衔接与手动触发共用） */
  private async runLabeling(
    options: LabelOptions,
    tasks: LabelTask[],
  ): Promise<void> {
    const job = this.requireJob();
    const abortController = new AbortController();
    job.labeling = true;
    job.labelAbortController = abortController;
    job.message = `打标中：剩余 ${tasks.length} 行`;
    this.broadcast([]);

    try {
      await runLabeler({
        tasks,
        aiApiKey: options.aiApiKey,
        aiBaseUrl: options.aiBaseUrl,
        aiModel: options.aiModel,
        categories: options.categories,
        concurrency: options.concurrency,
        signal: abortController.signal,
        onResult: (row, label, labelError) => {
          const record = job.records.get(row);
          if (!record) return;
          const updated: CollectRecord = {
            ...record,
            label,
            labelError,
            updatedAt: new Date().toISOString(),
          };
          job.records.set(row, updated);
          this.enqueuePush(updated);
          this.enqueueWrite(updated);
        },
        onFatal: (message) => {
          job.message = `打标已中止：${message}`;
          abortController.abort();
        },
      });
      if (!abortController.signal.aborted) {
        job.message = "打标完成";
      }
    } catch (error) {
      job.message = `打标异常：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.flushPush();
      await this.writeQueue;
      job.labeling = false;
      job.labelAbortController = undefined;
      this.broadcast([]);
    }
  }

  /** 人工确认候选：重新搜索一次取回正文（取不到则仅确认链接） */
  async confirmCandidate(
    row: number,
    url: string,
    apiKey?: string,
  ): Promise<CollectRecord> {
    const job = this.requireJob();
    const record = job.records.get(row);
    if (!record) throw new Error(`第 ${row} 行没有采集记录`);
    const candidateMeta = record.candidates?.find(
      (candidate) => candidate.url === url,
    );

    let content: string | undefined;
    let wordCount = candidateMeta?.wordCount;
    if (apiKey) {
      try {
        const fresh = await fetchCandidateContent(apiKey, record.title, url);
        if (fresh) {
          content = htmlToExportText(fresh.contentHtml);
          wordCount = countWords(fresh.contentHtml);
        }
      } catch {
        // 重新搜索失败不阻塞确认，链接仍然有效
      }
    }

    const updated: CollectRecord = {
      ...record,
      status: "confirmed",
      url,
      matchedTitle: candidateMeta?.title ?? record.matchedTitle,
      score: candidateMeta?.score ?? record.score,
      voteup: candidateMeta?.voteup ?? record.voteup,
      wordCount,
      content,
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    job.records.set(row, updated);
    await this.enqueueWrite(updated);
    this.broadcast([updated]);
    return updated;
  }

  /** 人工跳过某行（导出不回填链接） */
  async skipRow(row: number): Promise<CollectRecord> {
    const job = this.requireJob();
    const record = job.records.get(row);
    if (!record) throw new Error(`第 ${row} 行没有采集记录`);
    const updated: CollectRecord = {
      ...record,
      status: "skipped",
      url: undefined,
      updatedAt: new Date().toISOString(),
    };
    job.records.set(row, updated);
    await this.enqueueWrite(updated);
    this.broadcast([updated]);
    return updated;
  }

  /** 导出结果表格 */
  async export(
    outputPath: string,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const job = this.requireJob();
    if (job.running || job.labeling)
      throw new Error("任务正在运行，请停止后再导出");
    if (resolve(outputPath) === resolve(job.meta.sourcePath)) {
      throw new Error("导出文件不能覆盖源表格，请换一个文件名");
    }
    return exportExcel(job.meta.sourcePath, outputPath, job.records, options);
  }

  getSnapshot(): JobSnapshot {
    const job = this.requireJob();
    const counts: Record<CollectStatus, number> = {
      pending: 0,
      exact: 0,
      auto: 0,
      confirmed: 0,
      review: 0,
      not_found: 0,
      failed: 0,
      skipped: 0,
    };
    let labeled = 0;
    let labelFailed = 0;
    for (const row of job.rows) {
      const record = job.records.get(row.row);
      counts[record?.status ?? "pending"] += 1;
      if (record?.label) labeled += 1;
      if (record?.labelError) labelFailed += 1;
    }
    return {
      jobId: job.meta.jobId,
      sourcePath: job.meta.sourcePath,
      fileName: job.meta.fileName,
      total: job.rows.length,
      pending: counts.pending,
      exact: counts.exact,
      auto: counts.auto,
      confirmed: counts.confirmed,
      review: counts.review,
      notFound: counts.not_found,
      failed: counts.failed,
      skipped: counts.skipped,
      labeled,
      labelFailed,
      running: job.running,
      labeling: job.labeling,
      message: job.message,
    };
  }

  /**
   * 获取记录列表（去掉正文以控制 IPC 负载）。
   * status 为空时返回全部；limit 限制返回条数，total 始终为匹配总数。
   * 未导入表格时返回空结果而非报错（渲染进程各页面会在启动时无条件拉取）。
   */
  getRecords(status?: CollectStatus, limit?: number): RecordsPage {
    const job = this.job;
    if (!job) return { records: [], total: 0 };
    const records: PublicRecord[] = [];
    let total = 0;
    for (const row of job.rows) {
      const record = job.records.get(row.row);
      const effectiveStatus: CollectStatus = record?.status ?? "pending";
      if (status && effectiveStatus !== status) continue;
      total += 1;
      if (limit !== undefined && records.length >= limit) continue;
      if (!record) {
        records.push({
          row: row.row,
          title: row.title,
          status: "pending",
          updatedAt: "",
        });
        continue;
      }
      const { content: _content, ...slim } = record;
      records.push(slim);
    }
    return { records, total };
  }

  /** 供状态栏展示的状态标签 */
  static statusLabel(status: CollectStatus): string {
    return STATUS_LABELS[status];
  }

  private requireJob(): ActiveJob {
    if (!this.job) throw new Error("尚未导入表格");
    return this.job;
  }

  /** 变更批量推送：500ms 内的记录合并一次 IPC */
  private enqueuePush(record: CollectRecord): void {
    this.pendingPush.push(record);
    if (!this.pushTimer) {
      this.pushTimer = setTimeout(() => this.flushPush(), PUSH_INTERVAL_MS);
    }
  }

  private flushPush(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = undefined;
    }
    if (this.pendingPush.length === 0) return;
    const records = this.pendingPush;
    this.pendingPush = [];
    this.broadcast(records);
  }

  /**
   * 进度写入串行化：同一时刻只有一次 appendFile，保证顺序；
   * 失败记入任务消息但不打断队列。返回的 Promise 可供调用方感知结果。
   */
  private enqueueWrite(record: CollectRecord): Promise<void> {
    const job = this.requireJob();
    const file = this.jobFile(job.meta.jobId);
    const write = this.writeQueue.then(() => appendRecords(file, [record]));
    this.writeQueue = write.catch((error: unknown) => {
      job.message = `进度写入失败：${error instanceof Error ? error.message : String(error)}`;
    });
    return write;
  }

  private broadcast(records: CollectRecord[]): void {
    if (!this.job) return;
    const slimRecords: PublicRecord[] = records.map((record) => {
      const { content: _content, ...slim } = record;
      return slim;
    });
    this.onUpdate({
      jobId: this.job.meta.jobId,
      snapshot: this.getSnapshot(),
      records: slimRecords,
    });
  }
}
