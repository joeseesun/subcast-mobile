import { agentProviderId, useAgents } from "../lib/agents";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronsUpDown, Clock, Languages, Lightbulb, MessageCircleQuestion, MessageSquareText, Pencil, Plus, Scale, Search, Settings2, Share2, Trash2, TrendingUp, User, Wrench } from "lucide-react";
import { api, type Provider } from "../lib/api";
import { PROMPT_HINTS, quickPrompts, type QuickPrompt } from "../lib/settings";
import { providerFor, useStore } from "../store";
import { Modal } from "./Chrome";
import { t } from "../lib/i18n";

const MAX_PROMPTS = 30;

export const PROMPT_ICONS: Record<string, typeof Clock> = {
  "builtin-brief": Clock, "builtin-insights": Lightbulb, "builtin-guest": User, "builtin-debate": Scale, "builtin-numbers": TrendingUp,
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

/** The model switcher in the chat box: a searchable list grouped by service. The choice applies from the next question. */
export function ModelPicker({ disabled }: { disabled?: boolean }) {
  const groups = useChatModels();
  const settings = useStore((s) => s.settings);
  const { saveSettings, openSettings } = useStore.getState();
  const cur = providerFor(settings, "chat");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (groups ?? []).map((g) => ({ ...g, models: g.models.filter((m) => words.every((w) => `${m} ${g.provider.name} ${t(g.provider.name)}`.toLowerCase().includes(w))) })).filter((g) => g.models.length);
  const flat = shown.flatMap((g) => g.models.map((model) => ({ provider: g.provider, model })));
  const isCur = (o: { provider: Provider; model: string }) => o.provider.id === cur?.id && o.model === cur?.model;

  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  useEffect(() => { setActive(q ? 0 : Math.max(0, flat.findIndex(isCur))); }, [q, open]);
  useEffect(() => { list.current?.querySelector(".mp-row.is-active")?.scrollIntoView({ block: "nearest" }); }, [active, open]);

  if (groups && !groups.length) {
    return <button type="button" className="mp-trigger" onClick={() => openSettings("model")} disabled={disabled}><span className="mp-name">{t("连接模型")}</span></button>;
  }
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (o: { provider: Provider; model: string }) => {
    void saveSettings({ chatProvider: o.provider.id, chatModel: o.model === o.provider.model ? "" : o.model, modelChosen: true });
    close();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) choose(flat[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };

  let n = -1;
  return (
    <div className="mp" ref={wrap}>
      <button ref={trigger} type="button" className="mp-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !groups}
        title={cur ? t("{name} · {model}（切换后从下一个问题开始生效）", { name: t(cur.name), model: cur.model || t("默认模型") }) : ""}
        onClick={() => { if (open) { setOpen(false); return; } setQ(""); setOpen(true); requestAnimationFrame(() => search.current?.focus()); }}>
        <span className="mp-name">{cur ? (cur.model ? shortModel(cur.model) : t(cur.name)) : t("选择模型")}</span>
        <ChevronsUpDown size={12} />
      </button>
      {open && (
        <div className="mp-pop" onKeyDown={onKey}>
          <div className="mp-search">
            <Search size={14} />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索模型")} role="combobox" aria-expanded aria-controls="mp-list" aria-autocomplete="list" spellCheck={false} />
          </div>
          <div className="mp-list" id="mp-list" role="listbox" ref={list}>
            {!flat.length && <p className="mp-empty">{t("没有匹配的模型")}</p>}
            {shown.map((g) => (
              <div key={g.provider.id} role="group" aria-label={t(g.provider.name)}>
                <p className="mp-group">{t(g.provider.name)}</p>
                {g.models.map((m) => {
                  const i = ++n;
                  const o = { provider: g.provider, model: m };
                  return (
                    <div key={m || "default"} role="option" aria-selected={isCur(o)} title={m} className={`mp-row ${isCur(o) ? "is-current" : ""} ${i === active ? "is-active" : ""}`}
                      onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
                      <span className="mp-check">{isCur(o) && <Check size={14} />}</span>
                      <span className="mp-model">{m ? shortModel(m) : t("默认模型")}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <button type="button" className="mp-foot" onClick={() => { setOpen(false); openSettings("model"); }}><Plus size={14} /> {t("添加或管理模型")}</button>
        </div>
      )}
    </div>
  );
}

/** Quick prompts reachable at any point in a conversation, not only when it is empty. */
export function PromptMenu({ onPick, onManage, disabled }: { onPick: (body: string) => void; onManage: () => void; disabled?: boolean }) {
  const settings = useStore((s) => s.settings);
  const items = quickPrompts(settings).filter((p) => p.enabled);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", h);
    window.addEventListener("keydown", k, true);
    return () => { document.removeEventListener("pointerdown", h); window.removeEventListener("keydown", k, true); };
  }, [open]);
  return (
    <div className="mp" ref={wrap}>
      <button type="button" className="icon-btn sm" title={t("快捷提示词")} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}><MessageSquareText size={16} /></button>
      {open && (
        <div className="mp-pop prompts" role="menu">
          <div className="mp-list">
            {!items.length && <p className="mp-empty">{t("还没有快捷提示词")}</p>}
            {items.map((p) => {
              const Icon = promptIcon(p.id);
              return <button key={p.id} type="button" role="menuitem" className="pm-row" title={p.body} onClick={() => { setOpen(false); onPick(p.body); }}><Icon size={14} /><span>{p.title}</span></button>;
            })}
          </div>
          <button type="button" className="mp-foot" onClick={() => { setOpen(false); onManage(); }}><Settings2 size={14} /> {t("管理提示词")}</button>
        </div>
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
