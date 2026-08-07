import { useCallback, useEffect, useRef, useState } from "react";
import { title2link } from "./bridge";
import MonitorPage from "./pages/MonitorPage";
import ReviewPage from "./pages/ReviewPage";
import SettingsPage from "./pages/SettingsPage";
import TaskPage from "./pages/TaskPage";
import type { JobSnapshot, SettingsView } from "../src/shared/types";

type Tab = "task" | "monitor" | "review" | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "task", label: "采集任务" },
  { id: "monitor", label: "进度明细" },
  { id: "review", label: "待人工处理" },
  { id: "settings", label: "设置" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("task");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null);
  const [notice, setNotice] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  /** 记录版本号：每次有记录变化 +1，页面据此重新拉取列表 */
  const [recordsVersion, setRecordsVersion] = useState(0);
  const noticeTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((kind: "info" | "error", text: string) => {
    setNotice({ kind, text });
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(
      () => setNotice(null),
      kind === "error" ? 8000 : 4000,
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [settingsView, state] = await Promise.all([
        title2link.getSettings(),
        title2link.getState(),
      ]);
      if (disposed) return;
      setSettings(settingsView);
      if (state) {
        setSnapshot(state);
      } else {
        // 首次启动：尝试恢复上次任务
        const restored = await title2link.restoreLast();
        if (!disposed && restored) {
          setSnapshot((await title2link.getState()) ?? null);
        }
      }
    })();
    const unsubscribe = title2link.onUpdate((event) => {
      setSnapshot(event.snapshot);
      if (event.records.length > 0) setRecordsVersion((version) => version + 1);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettings(await title2link.getSettings());
  }, []);

  const reviewCount = snapshot?.review ?? 0;
  const running = snapshot?.running ?? false;
  const labeling = snapshot?.labeling ?? false;

  return (
    <div className="app">
      <header className="app-header">
        <h1>标题链接采集工具</h1>
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "tab active" : "tab"}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === "review" && reviewCount > 0 ? (
                <span className="badge">{reviewCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="header-status">
          {snapshot ? (
            <span
              className={running || labeling ? "pill running" : "pill idle"}
            >
              {running ? "采集中…" : labeling ? "打标中…" : "空闲"}
            </span>
          ) : (
            <span className="pill idle">未导入</span>
          )}
        </div>
      </header>

      {notice ? (
        <div className={`notice ${notice.kind}`}>{notice.text}</div>
      ) : null}

      <main className="app-main">
        {tab === "task" ? (
          <TaskPage
            snapshot={snapshot}
            settings={settings}
            onSnapshotChange={setSnapshot}
            refreshSettings={refreshSettings}
            notify={notify}
          />
        ) : null}
        {tab === "monitor" ? (
          <MonitorPage
            snapshot={snapshot}
            recordsVersion={recordsVersion}
            notify={notify}
          />
        ) : null}
        {tab === "review" ? (
          <ReviewPage
            settings={settings}
            snapshot={snapshot}
            recordsVersion={recordsVersion}
            onChanged={() => setRecordsVersion((version) => version + 1)}
            notify={notify}
          />
        ) : null}
        {tab === "settings" ? (
          <SettingsPage
            settings={settings}
            onSaved={refreshSettings}
            notify={notify}
          />
        ) : null}
      </main>
    </div>
  );
}
