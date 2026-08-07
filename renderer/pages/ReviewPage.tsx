import { useCallback, useEffect, useState } from "react";
import { title2link, type SlimRecord } from "../bridge";
import type {
  CollectStatus,
  JobSnapshot,
  SettingsView,
} from "../../src/shared/types";

const RENDER_LIMIT = 100;

interface ReviewPageProps {
  settings: SettingsView | null;
  snapshot: JobSnapshot | null;
  recordsVersion: number;
  onChanged: () => void;
  notify: (kind: "info" | "error", text: string) => void;
}

const SECTIONS: Array<{ id: CollectStatus; label: string; hint: string }> = [
  {
    id: "review",
    label: "待人工确认",
    hint: "标题相似但不完全一致，请核对后确认或跳过",
  },
  { id: "not_found", label: "未找到", hint: "可从候选中手动挑选，或直接跳过" },
  {
    id: "failed",
    label: "采集失败",
    hint: "网络或服务异常，重新运行采集会自动重试",
  },
];

export default function ReviewPage({
  settings,
  snapshot,
  recordsVersion,
  onChanged,
  notify,
}: ReviewPageProps) {
  const [sections, setSections] = useState<Record<string, SlimRecord[]>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [busyRow, setBusyRow] = useState<number | null>(null);

  const jobId = snapshot?.jobId;

  const load = useCallback(async () => {
    if (!jobId) {
      setSections({});
      setTotals({});
      return;
    }
    try {
      const [review, notFound, failed] = await Promise.all([
        title2link.getRecords("review", RENDER_LIMIT),
        title2link.getRecords("not_found", RENDER_LIMIT),
        title2link.getRecords("failed", RENDER_LIMIT),
      ]);
      setSections({
        review: review.records,
        not_found: notFound.records,
        failed: failed.records,
      });
      setTotals({
        review: review.total,
        not_found: notFound.total,
        failed: failed.total,
      });
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  }, [jobId, notify]);

  useEffect(() => {
    void load();
  }, [load, recordsVersion]);

  const handleConfirm = async (record: SlimRecord, url: string) => {
    setBusyRow(record.row);
    try {
      await title2link.confirm(record.row, url);
      onChanged();
      notify("info", `第 ${record.row} 行已确认`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyRow(null);
    }
  };

  const handleSkip = async (record: SlimRecord) => {
    setBusyRow(record.row);
    try {
      await title2link.skip(record.row);
      onChanged();
      notify("info", `第 ${record.row} 行已跳过`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyRow(null);
    }
  };

  if (!settings) return null;

  if (!jobId) {
    return (
      <div className="page">
        <section className="card">
          <p className="hint">尚未导入表格，请先在“采集任务”页导入。</p>
        </section>
      </div>
    );
  }

  const total = SECTIONS.reduce(
    (sum, section) => sum + (totals[section.id] ?? 0),
    0,
  );

  return (
    <div className="page">
      {total === 0 ? (
        <section className="card">
          <p className="hint">没有需要人工处理的记录。</p>
        </section>
      ) : null}
      {SECTIONS.map((section) => {
        const records = sections[section.id] ?? [];
        const sectionTotal = totals[section.id] ?? 0;
        if (sectionTotal === 0) return null;
        return (
          <section className="card" key={section.id}>
            <h2>
              {section.label}（{sectionTotal}）
            </h2>
            <p className="hint">{section.hint}</p>
            {records.slice(0, RENDER_LIMIT).map((record) => (
              <div className="review-item" key={record.row}>
                <div className="review-head">
                  <span className="row-tag">行 {record.row}</span>
                  <span className="review-title" title={record.title}>
                    {record.title}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={busyRow === record.row}
                    onClick={() => handleSkip(record)}
                  >
                    跳过
                  </button>
                </div>
                {record.error ? (
                  <div className="error-text">{record.error}</div>
                ) : null}
                {(record.candidates ?? []).length > 0 ? (
                  <ul className="candidate-list">
                    {(record.candidates ?? []).map((candidate) => (
                      <li key={candidate.url}>
                        <div className="candidate-info">
                          <span className="candidate-type">
                            {candidate.type === "answer" ? "回答" : "专栏"}
                          </span>
                          <a
                            href={candidate.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {candidate.title || "（无标题）"}
                          </a>
                          <span className="candidate-meta">
                            相似度 {Math.round(candidate.score * 100)}% · 赞同{" "}
                            {candidate.voteup} · {candidate.wordCount} 字
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={busyRow === record.row}
                          onClick={() => handleConfirm(record, candidate.url)}
                        >
                          确认这条
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">没有候选结果。</p>
                )}
              </div>
            ))}
            {sectionTotal > RENDER_LIMIT ? (
              <p className="hint">
                仅显示前 {RENDER_LIMIT} 条，处理后会露出后续记录。
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
