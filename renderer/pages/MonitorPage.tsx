import { useEffect, useState } from "react";
import { title2link, type SlimRecord } from "../bridge";
import {
  STATUS_LABELS,
  type CollectStatus,
  type JobSnapshot,
} from "../../src/shared/types";

/** 列表最多渲染条数，避免万级行卡顿 */
const RENDER_LIMIT = 300;

interface MonitorPageProps {
  snapshot: JobSnapshot | null;
  recordsVersion: number;
  notify: (kind: "info" | "error", text: string) => void;
}

const FILTERS: Array<{ id: CollectStatus | "all"; label: string }> = [
  { id: "all", label: "全部" },
  { id: "exact", label: "精确匹配" },
  { id: "auto", label: "高相似采纳" },
  { id: "confirmed", label: "已确认" },
  { id: "review", label: "待人工" },
  { id: "not_found", label: "未找到" },
  { id: "failed", label: "采集失败" },
  { id: "skipped", label: "已跳过" },
  { id: "pending", label: "待采集" },
];

export default function MonitorPage({
  snapshot,
  recordsVersion,
  notify,
}: MonitorPageProps) {
  const [filter, setFilter] = useState<CollectStatus | "all">("all");
  const [records, setRecords] = useState<SlimRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const jobId = snapshot?.jobId;

  useEffect(() => {
    if (!jobId) {
      setRecords([]);
      return;
    }
    let disposed = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await title2link.getRecords(
          filter === "all" ? undefined : filter,
          RENDER_LIMIT,
        );
        if (!disposed) {
          setRecords(result.records);
          setTotal(result.total);
        }
      } catch (error) {
        if (!disposed) {
          notify(
            "error",
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [jobId, recordsVersion, filter, notify]);

  if (!snapshot) {
    return (
      <div className="page">
        <section className="card">
          <p className="hint">尚未导入表格，请先在“采集任务”页导入。</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="card">
        <div className="filter-bar">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "chip active" : "chip"}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {loading ? <p className="hint">加载中…</p> : null}
        {total > RENDER_LIMIT ? (
          <p className="hint">
            共 {total} 条，仅显示前 {RENDER_LIMIT} 条（导出表格包含全部结果）。
          </p>
        ) : null}
        <table className="record-table">
          <thead>
            <tr>
              <th>行号</th>
              <th>标题</th>
              <th>状态</th>
              <th>标签</th>
              <th>匹配标题</th>
              <th>赞</th>
              <th>字数</th>
              <th>链接</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.row} className={`status-${record.status}`}>
                <td className="num">{record.row}</td>
                <td className="ellipsis" title={record.title}>
                  {record.title}
                </td>
                <td>{STATUS_LABELS[record.status]}</td>
                <td>
                  {record.label ?? "—"}
                  {record.labelError ? (
                    <span className="error-text" title={record.labelError}>
                      {" "}
                      打标失败
                    </span>
                  ) : null}
                </td>
                <td className="ellipsis" title={record.matchedTitle ?? ""}>
                  {record.matchedTitle ?? "—"}
                  {typeof record.score === "number" && record.score < 1
                    ? `（${Math.round(record.score * 100)}%）`
                    : ""}
                </td>
                <td className="num">{record.voteup ?? "—"}</td>
                <td className="num">{record.wordCount ?? "—"}</td>
                <td className="ellipsis">
                  {record.url ? (
                    <a href={record.url} target="_blank" rel="noreferrer">
                      打开
                    </a>
                  ) : (
                    "—"
                  )}
                  {record.error ? (
                    <span className="error-text"> {record.error}</span>
                  ) : null}
                </td>
              </tr>
            ))}
            {records.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="empty-cell">
                  暂无记录
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
