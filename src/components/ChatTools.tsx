import { agentProviderId, useAgents } from "../lib/agents";
import { useEffect, useState } from "react";
import { BookOpen, Check, ChevronsUpDown, Clock, GraduationCap, Languages, Lightbulb, ListOrdered, MessageCircleQuestion, MessageSquareText, Pencil, Plus, Quote, Scale, Search, Settings2, Share2, Trash2, TrendingUp, Wrench, Zap } from "lucide-react";
import { api, type Provider } from "../lib/api";
import { PROMPT_HINTS, quickPrompts, type QuickPrompt } from "../lib/settings";
import { providerFor, useStore } from "../store";
import { selectionFeedback } from "../lib/feedback";
import { Modal } from "./Chrome";
import { MobileSheet } from "./MobileSheet";
import { t } from "../lib/i18n";

const MAX_PROMPTS = 30;

export const PROMPT_ICONS: Record<string, typeof Clock> = {
  "builtin-oneline": Zap, "builtin-brief": Clock, "builtin-insights": Lightbulb, "builtin-timeline": ListOrdered, "builtin-explain": GraduationCap, "builtin-quotes": Quote, "builtin-debate": Scale, "builtin-numbers": TrendingUp,
  "builtin-resources": BookOpen, "builtin-action": Wrench, "builtin-terms": Languages, "builtin-followup": MessageCircleQuestion, "builtin-share": Share2,
};
export const promptIcon = (id: string) => PROMPT_ICONS[id] ?? MessageSquareText;

/** "deepseek-ai/deepseek-v4-flash" → "deepseek-v4-flash". */
export const shortModel = (m: string) => m.split("/").pop() || m;

interface Group { provider: Provider; models: string[] }

/** Every model the chat can use right now: providers with a key saved (or local ones already in use), each with
 *  its chosen model and the catalogue's suggestions. Re-read when settings change or the settings window closes. */
export function useChatModels(): Group[] | null {
  const settings = useStore((s) => s.settings);
  const open = useStore((s) => s.settingsOpen);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const agents = useAgents((s) => s.found);
  useEffect(() => {
    if (open) return;
    let live = true;
    // Local agents (Claude Code and the like) have no model of their own set: "" means the agent's default.
    const found = new Set((agents ?? []).filter((f) => f.login !== "needsLogin").map((f) => agentProviderId(f.kind)));
    const ps = Object.values(settings.providers).filter((p) => p.protocol === "cli" ? found.has(p.id) : p.baseUrl && p.model);
    const inUse = (p: Provider) => p.id === settings.chatProvider || p.id === settings.translateProvider;
    void Promise.all(ps.map((p) => (p.protocol === "cli" ? Promise.resolve(true) : p.needsKey ? api.hasApiKey(p.id) : Promise.resolve(inUse(p))))).then((ok) => {
      if (!live) return;
      const usable = ps.filter((_, i) => ok[i]).sort((a, b) => Number(b.id === settings.chatProvider) - Number(a.id === settings.chatProvider));
      setGroups(usable.map((p) => ({
        provider: p,
        models: p.protocol === "cli"
          ? ["", ...new Set([...(p.id === settings.chatProvider && settings.chatModel ? [settings.chatModel] : []), ...(p.models ?? [])])].filter((m, i) => i === 0 || m)
          : [...new Set([p.model, ...(p.id === settings.chatProvider && settings.chatModel ? [settings.chatModel] : []), ...(p.models ?? [])])].filter(Boolean),
      })));
    });
    return () => { live = false; };
  }, [settings.providers, settings.chatProvider, settings.translateProvider, settings.chatModel, open, agents]);
  return groups;
}

/** The model switcher in the chat box: opens a mobile bottom sheet grouped by service. */
export function ModelPicker({ disabled }: { disabled?: boolean }) {
  const groups = useChatModels();
  const settings = useStore((s) => s.settings);
  const { saveSettings, openSettings } = useStore.getState();
  const cur = providerFor(settings, "chat");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (groups ?? []).map((g) => ({ ...g, models: g.models.filter((m) => words.every((w) => `${m} ${g.provider.name} ${t(g.provider.name)}`.toLowerCase().includes(w))) })).filter((g) => g.models.length);
  const flat = shown.flatMap((g) => g.models.map((model) => ({ provider: g.provider, model })));
  const isCur = (o: { provider: Provider; model: string }) => o.provider.id === cur?.id && o.model === cur?.model;

  if (groups && !groups.length) {
    return <button type="button" className="mp-trigger" onClick={() => openSettings("model")} disabled={disabled}><span className="mp-name">{t("连接模型")}</span></button>;
  }
  const choose = (o: { provider: Provider; model: string }) => {
    selectionFeedback();
    void saveSettings({ chatProvider: o.provider.id, chatModel: o.model === o.provider.model ? "" : o.model, modelChosen: true });
    setOpen(false);
  };

  return (
    <div className="mp">
      <button type="button" className="mp-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={disabled || !groups}
        title={cur ? t("{name} · {model}（切换后从下一个问题开始生效）", { name: t(cur.name), model: cur.model || t("默认模型") }) : ""}
        onClick={() => { setQ(""); setOpen(true); }}>
        <span className="mp-name">{cur ? (cur.model ? shortModel(cur.model) : t(cur.name)) : t("选择模型")}</span>
        <ChevronsUpDown size={13} />
      </button>
      {open && (
        <MobileSheet title={t("选择模型")} onClose={() => setOpen(false)} className="model-sheet">
          {(groups?.reduce((n, g) => n + g.models.length, 0) ?? 0) > 6 && (
            <div className="mp-sheet-search">
              <Search size={16} aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索模型")} spellCheck={false} />
            </div>
          )}
          {!flat.length && <p className="sheet-status">{t("没有匹配的模型")}</p>}
          {shown.map((g) => (
            <div key={g.provider.id} className="mp-sheet-group">
              <p className="mp-sheet-group-h">{t(g.provider.name)}</p>
              {g.models.map((m) => {
                const o = { provider: g.provider, model: m };
                const selected = isCur(o);
                return (
                  <button key={m || "default"} type="button" className="mp-sheet-row" aria-pressed={selected} onClick={() => choose(o)}>
                    <span className="clamp1">{m ? shortModel(m) : t("默认模型")}</span>
                    {selected && <Check className="row-check" size={18} />}
                  </button>
                );
              })}
            </div>
          ))}
          <button type="button" className="ps-manage" onClick={() => { setOpen(false); openSettings("model"); }}><Plus size={15} /> {t("添加或管理模型")}</button>
        </MobileSheet>
      )}
    </div>
  );
}

/** Quick prompts reachable at any point in a conversation via a mobile bottom sheet. */
export function PromptMenu({ onPick, onManage, disabled }: { onPick: (body: string) => void; onManage: () => void; disabled?: boolean }) {
  const settings = useStore((s) => s.settings);
  const items = quickPrompts(settings).filter((p) => p.enabled);
  const [open, setOpen] = useState(false);
  return (
    <div className="mp">
      <button type="button" className="icon-btn sm" title={t("快捷提示词")} aria-label={t("快捷提示词")} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}><MessageSquareText size={18} /></button>
      {open && (
        <MobileSheet title={t("快捷提问")} onClose={() => setOpen(false)} className="prompt-sheet">
          <div className="ps-list">
            {!items.length && <p className="sheet-status">{t("还没有快捷提示词")}</p>}
            {items.map((p) => {
              const Icon = promptIcon(p.id);
              return <button key={p.id} type="button" className="ps-row" onClick={() => { setOpen(false); selectionFeedback(); onPick(p.body); }}>
                <Icon size={18} className="ps-icon" aria-hidden />
                <span className="ps-text"><span className="ps-title">{p.title}</span><span className="ps-body">{p.body}</span></span>
              </button>;
            })}
          </div>
          <button type="button" className="ps-manage" onClick={() => { setOpen(false); onManage(); }}><Settings2 size={15} /> {t("管理提示词")}</button>
        </MobileSheet>
      )}
    </div>
  );
}

/** The chat's own settings: a standing instruction and the quick prompt list. Changes apply from the next question. */
export function ChatPrefsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const list = quickPrompts(settings);
  const [editing, setEditing] = useState<QuickPrompt | null>(null);
  const [error, setError] = useState("");
  const save = (next: QuickPrompt[]) => void saveSettings({ quickPrompts: next });
  const addHint = (h: string) => {
    const cur = settings.chatPrompt.trim();
    if (cur.split("\n").some((l) => l.trim() === h)) return;
    void saveSettings({ chatPrompt: cur ? `${cur}\n${h}` : h, chatPromptOn: true });
  };
  const finish = () => {
    if (!editing) return;
    const p = { ...editing, title: editing.title.trim(), body: editing.body.trim() };
    if (!p.title || !p.body) { setError(t("请填写名称和内容。")); return; }
    save(list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p]);
    setEditing(null); setError("");
  };
  const editorKeys = (e: React.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); setError(""); } };

  return (
    <Modal title={t("问答设置")} onClose={onClose}>
      <div className="chat-prefs">
        <section>
          <div className="cp-head">
            <p className="cp-title">{t("全局指令")}</p>
            <label className="check"><input type="checkbox" checked={settings.chatPromptOn} onChange={(e) => void saveSettings({ chatPromptOn: e.target.checked })} /> {t("启用")}</label>
          </div>
          <textarea className="cp-instr" rows={3} value={settings.chatPrompt} disabled={!settings.chatPromptOn} maxLength={4000}
            placeholder={t("例如：先给结论再展开；简洁，不说套话；术语保留英文原文。")} aria-label={t("全局指令")}
            onChange={(e) => void saveSettings({ chatPrompt: e.target.value })} />
          <div className="cp-hints"><span className="muted small">{t("试试：")}</span>{PROMPT_HINTS.map((h) => <button key={h} type="button" className="chip sm" onClick={() => addHint(t(h))}>{t(h)}</button>)}</div>
          <p className="muted small">{t("每次提问都会带上这段话，从下一个问题开始生效，已有回答不变。")}</p>
        </section>

        <section>
          <div className="cp-head">
            <p className="cp-title">{t("快捷提示词")}</p>
            <span className="muted small">{t("显示在问答里，点一下就发送")}</span>
          </div>
          {editing ? (
            <div className="cp-editor" onKeyDown={editorKeys}>
              <label><span>{t("名称")}</span><input value={editing.title} maxLength={40} autoFocus placeholder={t("例如：嘉宾的成长经历")}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget.closest(".cp-editor")?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(); } }} /></label>
              <label><span>{t("点击后发送的内容")}</span><textarea rows={4} maxLength={2000} value={editing.body} placeholder={t("写下你想问的问题，越具体，回答越有用。")}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></label>
              {error && <p className="error-text small">{error}</p>}
              <div className="row-actions">
                <button type="button" className="btn sm primary" onClick={finish}>{t("完成")}</button>
                <button type="button" className="btn sm ghost" onClick={() => { setEditing(null); setError(""); }}>{t("取消")}</button>
              </div>
            </div>
          ) : (
            <>
              <ul className="cp-list">
                {!list.length && <li className="muted small">{t("还没有快捷提示词。")}</li>}
                {list.map((p) => {
                  const Icon = promptIcon(p.id);
                  return (
                    <li key={p.id} className={`cp-row ${p.enabled ? "" : "is-off"}`}>
                      <input type="checkbox" checked={p.enabled} title={p.enabled ? t("在问答里显示") : t("已隐藏")} aria-label={t("显示「{title}」", { title: p.title })}
                        onChange={(e) => save(list.map((x) => (x.id === p.id ? { ...x, enabled: e.target.checked } : x)))} />
                      <Icon size={15} className="cp-icon" />
                      <button type="button" className="cp-text" onClick={() => setEditing(p)}>
                        <span className="cp-name">{p.title}</span>
                        <span className="cp-sub">{p.body}</span>
                      </button>
                      <button type="button" className="icon-btn sm" title={t("编辑")} onClick={() => setEditing(p)}><Pencil size={14} /></button>
                      <button type="button" className="icon-btn sm" title={t("删除")} onClick={() => save(list.filter((x) => x.id !== p.id))}><Trash2 size={14} /></button>
                    </li>
                  );
                })}
              </ul>
              <div className="row-actions">
                <button type="button" className="btn sm" disabled={list.length >= MAX_PROMPTS} title={list.length >= MAX_PROMPTS ? t("最多保留 {n} 条快捷提示词", { n: MAX_PROMPTS }) : ""}
                  onClick={() => setEditing({ id: `custom-${Date.now().toString(36)}`, title: "", body: "", enabled: true })}><Plus size={13} /> {t("新建")}</button>
                {settings.quickPrompts && <button type="button" className="btn sm ghost" onClick={() => void saveSettings({ quickPrompts: null })}>{t("恢复内置提示词")}</button>}
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
