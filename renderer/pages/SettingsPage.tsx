import { useEffect, useState } from "react";
import { title2link } from "../bridge";
import {
  DEFAULT_CONCURRENCY,
  FALLBACK_LABEL,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  type SettingsView,
} from "../../src/shared/types";

interface SettingsPageProps {
  settings: SettingsView | null;
  onSaved: () => Promise<void>;
  notify: (kind: "info" | "error", text: string) => void;
}

export default function SettingsPage({
  settings,
  onSaved,
  notify,
}: SettingsPageProps) {
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [savingAiKey, setSavingAiKey] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");

  useEffect(() => {
    if (settings) setCategories(settings.labelCategories);
  }, [settings]);

  if (!settings) return null;

  const reportError = (error: unknown) =>
    notify("error", error instanceof Error ? error.message : String(error));

  const handleSaveKey = async () => {
    if (!keyInput.trim()) {
      notify("error", "请填写 API Key");
      return;
    }
    setSavingKey(true);
    try {
      await title2link.saveKey(keyInput.trim());
      setKeyInput("");
      await onSaved();
      notify("info", "API Key 已加密保存");
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    } finally {
      setSavingKey(false);
    }
  };

  const handleConcurrency = async (value: number) => {
    try {
      await title2link.saveConcurrency(value);
      await onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleIncludeContent = async (checked: boolean) => {
    try {
      await title2link.saveIncludeContent(checked);
      await onSaved();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveAiKey = async () => {
    if (!aiKeyInput.trim()) {
      notify("error", "请填写 AI Key");
      return;
    }
    setSavingAiKey(true);
    try {
      await title2link.saveAiKey(aiKeyInput.trim());
      setAiKeyInput("");
      await onSaved();
      notify("info", "AI Key 已加密保存");
    } catch (error) {
      reportError(error);
    } finally {
      setSavingAiKey(false);
    }
  };

  const handleSaveAiField = async (patch: {
    aiBaseUrl?: string;
    aiModel?: string;
  }) => {
    try {
      await title2link.saveAiSettings(patch);
      await onSaved();
    } catch (error) {
      reportError(error);
    }
  };

  const handleSaveCategories = async (next: string[]) => {
    if (next.length === 0) {
      notify("error", "至少保留一个分类");
      return;
    }
    try {
      await title2link.saveAiSettings({ labelCategories: next });
      setCategories(next);
      await onSaved();
    } catch (error) {
      reportError(error);
    }
  };

  const handleAddCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    if (name === FALLBACK_LABEL) {
      notify("error", `「${FALLBACK_LABEL}」是内置兑底分类，无需添加`);
      return;
    }
    if (categories.includes(name)) {
      notify("error", "该分类已存在");
      return;
    }
    void handleSaveCategories([...categories, name]);
    setNewCategory("");
  };

  return (
    <div className="page">
      <section className="card">
        <h2>API Key</h2>
        <p className="hint">
          {settings.hasKey
            ? "已保存（加密存储在本机，不会上传或回显）。如需更换，直接填写新的即可。"
            : "请填写用于标题搜索服务的 API Key。"}
        </p>
        <div className="key-row">
          <input
            type="password"
            className="input"
            value={keyInput}
            placeholder={
              settings.hasKey ? "已保存，如需更换请粘贴新 Key" : "粘贴 API Key"
            }
            onChange={(event) => setKeyInput(event.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="btn primary"
            onClick={handleSaveKey}
            disabled={savingKey || !keyInput.trim()}
          >
            {savingKey ? "保存中…" : "保存"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>采集并发数</h2>
        <p className="hint">
          同时发起的搜索请求数（{MIN_CONCURRENCY}～{MAX_CONCURRENCY}），默认{" "}
          {DEFAULT_CONCURRENCY}
          。数值越大越快，但更容易触发服务端限流，建议保持默认。
        </p>
        <input
          type="number"
          className="input narrow"
          min={MIN_CONCURRENCY}
          max={MAX_CONCURRENCY}
          defaultValue={settings.concurrency}
          onBlur={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value) && value !== settings.concurrency) {
              void handleConcurrency(value);
            }
          }}
        />
      </section>

      <section className="card">
        <h2>导出选项</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.includeContent}
            onChange={(event) =>
              void handleIncludeContent(event.target.checked)
            }
          />
          导出表格时包含「正文」列（纯文本，字数口径：去标签、去空白后的字符数）
        </label>
      </section>

      <section className="card">
        <h2>内容打标 · AI 设置</h2>
        <p className="hint">
          {settings.hasAiKey
            ? "AI Key 已保存（加密存储在本机）。如需更换，直接填写新的即可。"
            : "打标用于对采集到的正文自动分类，需要一个 OpenAI 兼容接口的 API Key。"}
        </p>
        <div className="key-row">
          <input
            type="password"
            className="input"
            value={aiKeyInput}
            placeholder={
              settings.hasAiKey ? "已保存，如需更换请粘贴新 Key" : "粘贴 AI Key"
            }
            onChange={(event) => setAiKeyInput(event.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="btn primary"
            onClick={handleSaveAiKey}
            disabled={savingAiKey || !aiKeyInput.trim()}
          >
            {savingAiKey ? "保存中…" : "保存"}
          </button>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Base URL</span>
            <input
              type="text"
              className="input"
              defaultValue={settings.aiBaseUrl}
              placeholder="https://api.deepseek.com/v1"
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== settings.aiBaseUrl) {
                  void handleSaveAiField({ aiBaseUrl: value });
                }
              }}
            />
          </label>
          <label className="field">
            <span>模型</span>
            <input
              type="text"
              className="input"
              defaultValue={settings.aiModel}
              placeholder="deepseek-chat"
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== settings.aiModel) {
                  void handleSaveAiField({ aiModel: value });
                }
              }}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>打标分类</h2>
        <p className="hint">
          不属于以下任何分类的正文将统一打上「{FALLBACK_LABEL}」。
        </p>
        <div className="category-list">
          {categories.map((name) => (
            <span key={name} className="category-chip">
              {name}
              <button
                type="button"
                title="删除该分类"
                onClick={() =>
                  void handleSaveCategories(
                    categories.filter((item) => item !== name),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="category-add">
          <input
            type="text"
            className="input narrow"
            value={newCategory}
            placeholder="新分类名称"
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleAddCategory();
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={handleAddCategory}
            disabled={!newCategory.trim()}
          >
            添加分类
          </button>
        </div>
      </section>
    </div>
  );
}
