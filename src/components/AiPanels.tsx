import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Loader2, PenLine, RefreshCw, Settings2, Sparkles, Square, SquarePen } from "lucide-react";
import { api, errorText, rawErrorText, type ChatMessage, type Episode } from "../lib/api";
import { askEpisode, summaryPrompt, transcriptForModel, writeArticle } from "../lib/ai";
import { t, tk } from "../lib/i18n";
import { quickPrompts } from "../lib/settings";
import { ChatPrefsDialog, ModelPicker, promptIcon, shortModel } from "./ChatTools";
import { llmReady, useJobs } from "../lib/jobs";
import { warmAgent } from "../lib/agents";
import { selectionFeedback } from "../lib/feedback";
import { providerFor, useStore } from "../store";
import { Markdown } from "./Markdown";
import { ReadAloud } from "./ReadAloud";
import { ReadPrefsButton } from "./ReadPrefs";
import { AnswerActions, HistoryMenu, QuestionActions, type ArchivedChat } from "./ChatActions";
import { AskArt, PageArt, PlugArt } from "./Illustrations";
import { MobileSheet } from "./MobileSheet";
import type { QuickPrompt } from "../lib/settings";

/** Whether a model is connected for Q&A; re-checked whenever settings change or the settings window closes. */
function useConnected() {
  const settings = useStore((s) => s.settings);
  const open = useStore((s) => s.settingsOpen);
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { if (!open) void llmReady("chat").then(setOk); }, [settings, open]);
  return ok;
}

function ConnectCard({ what }: { what: string }) {

  return (
    <div className="connect-card">
      <PlugArt className="cc-art" />
      <p className="es-title">{t("{what}还差一个模型", { what: t(what) })}</p>
      <div className="row-actions center">
        <button className="btn primary" onClick={() => { const s = useStore.getState(); void s.saveSettings({ chatProvider: s.settings.chatProvider || "deepseek" }); s.openSettings("model"); }}>{t("连接模型")}</button>
      </div>
    </div>
  );
}

function useReady(ep: Episode) {
  const transcript = useJobs((s) => s.transcripts[ep.id]);
  const translation = useJobs((s) => s.translations[ep.id]);
  const settings = useStore((s) => s.settings);
  const provider = providerFor(settings, "chat");
  const context = () => transcriptForModel(transcript!.segments, translation?.items);
  // Errors that the settings window fixes carry `setup`, so the panel can offer a way there whatever the language.
  const setupError = (message: string) => Object.assign(new Error(message), { setup: true });
  const check = async () => {
    if (!transcript) throw new Error(t("需要先有字幕才能提问"));
    if (!provider?.model) throw setupError(t("请先在设置里选择模型"));
    if (provider.needsKey && !(await api.hasApiKey(provider.id))) throw setupError(t("请先在设置里填写「{name}」的 API Key", { name: t(provider.name) }));
  };
  return { transcript, provider, context, check };
}

function useSeek(ep: Episode) {
  const { current, player, load } = useStore(useShallow((s) => ({ current: s.current, player: s.player, load: s.load })));
  return (t: number) => {
    if (current?.id === ep.id) player?.seek(t);
    else { load({ ...ep, progress: t }); setTimeout(() => useStore.getState().player?.seek(t), 600); }
  };
}


// How often each quick question was used, on this computer; the most used come first.
const USE_KEY = "subcast-prompt-use";
function readUse(): Record<string, number> { try { return JSON.parse(localStorage.getItem(USE_KEY) || "{}"); } catch { return {}; } }
function countUse(id: string) { try { const u = readUse(); u[id] = (u[id] ?? 0) + 1; localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch { /* storage off */ } }
/** Stable: unused prompts keep their configured order behind the used ones. */
function byUse<T extends { id: string }>(list: T[]): T[] {
  const u = readUse();
  return list.map((p, i) => ({ p, i })).sort((a, b) => (u[b.p.id] ?? 0) - (u[a.p.id] ?? 0) || a.i - b.i).map((x) => x.p);
}

/** Each episode's conversation and the answer being written, kept outside the panel: switching tabs or episodes
 *  mid-answer neither drops the streamed text nor shows a stale copy when the panel comes back. */
interface ChatState { messages: ChatMessage[]; streaming: string | null; loaded: boolean }
const useChats = create<Record<string, ChatState>>(() => ({}));
const chatAborts = new Map<string, AbortController>();
const putChat = (id: string, p: Partial<ChatState>) => useChats.setState((s) => ({ [id]: { ...(s[id] ?? { messages: [], streaming: null, loaded: false }), ...p } }));
const NO_MESSAGES: ChatMessage[] = [];

const THINK_STEPS = [tk("正在通读文字稿…"), tk("正在定位相关原话…"), tk("正在整理回答…")];

function ThinkingState() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStep((n) => (n + 1) % THINK_STEPS.length), 2400);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="chat-thinking" role="status">
      <div className="chat-thinking-head">
        <span className="chat-thinking-dot" aria-hidden><Sparkles size={13} /></span>
        <span>{t(THINK_STEPS[step])}</span>
      </div>
      <div className="chat-thinking-bars" aria-hidden>
        <i style={{ width: "86%" }} />
        <i style={{ width: "68%" }} />
        <i style={{ width: "48%" }} />
      </div>
    </div>
  );
}

export function ChatPanel({ ep, onSubtitles, input, setInput }: { ep: Episode; onSubtitles: () => void; input: string; setInput: (text: string) => void }) {
  const { transcript, provider, context, check } = useReady(ep);
  const connected = useConnected();
  // A local agent (Claude Code…) is started in the background as the panel opens, so the first answer is quicker.
  const chatProvider = useStore((x) => x.settings.chatProvider);
  useEffect(() => { warmAgent(providerFor(useStore.getState().settings, "chat")); }, [chatProvider]);
  const settings = useStore((s) => s.settings);
  const seek = useSeek(ep);
  const messages = useChats((s) => s[ep.id]?.messages ?? NO_MESSAGES);
  const streaming = useChats((s) => s[ep.id]?.streaming ?? null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [archive, setArchive] = useState<ArchivedChat[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const box = useRef<HTMLTextAreaElement>(null);
  // Quick questions, most used first. Featured 4 show on empty state; contextual follow-ups appear below the latest answer.
  const [promptSheet, setPromptSheet] = useState(false);
  const prompts = byUse(quickPrompts(settings).filter((p) => p.enabled));
  const askPrompt = (p: QuickPrompt) => { selectionFeedback(); countUse(p.id); setPromptSheet(false); send(p.body); };

  useEffect(() => {
    setArchive([]);
    if (!useChats.getState()[ep.id]?.loaded) {
      api.getBlob(ep.id, "chat").then((raw) => {
        if (useChats.getState()[ep.id]?.loaded) return;
        let list: ChatMessage[] = [];
        try { list = raw ? JSON.parse(raw) : []; } catch { /* ignore */ }
        putChat(ep.id, { messages: list, loaded: true });
      });
    }
    api.getBlob(ep.id, "chat-archive").then((raw) => { if (raw) try { setArchive(JSON.parse(raw)); } catch { /* ignore */ } });
  }, [ep.id]);
  // Follow new text only while the reader is at the bottom; scrolling up to reread is never interrupted.
  useEffect(() => { const pane = scroller.current; if (pane && atBottom) pane.scrollTop = pane.scrollHeight; }, [messages.length, streaming]);
  const onScroll = () => { const el = scroller.current; if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 60); };
  const toBottom = () => { const pane = scroller.current; if (pane) pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" }); setAtBottom(true); };

  // Every change is written to the episode's record in the library database right away.
  const save = (next: ChatMessage[]) => { putChat(ep.id, { messages: next, loaded: true }); void api.setBlob(ep.id, "chat", JSON.stringify(next)); };
  const saveArchive = (next: ArchivedChat[]) => { setArchive(next); void api.setBlob(ep.id, "chat-archive", JSON.stringify(next)); };

  const ask = async (history: ChatMessage[]) => {
    try { await check(); } catch (e) { setSetupError(errorText(e)); return; }
    setSetupError(null);
    const model = `${t(provider!.name)} · ${shortModel(provider!.model)}`;
    save(history);
    putChat(ep.id, { streaming: "" });
    setAtBottom(true);
    const ctl = new AbortController();
    chatAborts.set(ep.id, ctl);
    let partial = "";
    try {
      const answer = await askEpisode({ provider: provider!, title: ep.title, show: ep.showTitle ?? "", transcript: context(), history, instruction: settings.chatPromptOn ? settings.chatPrompt : "", onDelta: (d) => { partial = d; putChat(ep.id, { streaming: d }); }, signal: ctl.signal });
      // Some agents only stream and return an empty final answer: keep what was shown.
      const content = answer.trim() ? answer : partial;
      save([...history, { role: "assistant", content: content.trim() ? content : t("出错了：{error}", { error: t("模型没有返回内容，请重试或换一个模型") }), model }]);
      selectionFeedback();
    } catch (e) {
      const note = ctl.signal.aborted ? t("（已停止）") : t("出错了：{error}", { error: errorText(e) });
      save([...history, { role: "assistant", content: partial ? `${partial}\n\n${note}` : note, model }]);
    } finally {
      putChat(ep.id, { streaming: null });
      chatAborts.delete(ep.id);
    }
  };
  const send = (text: string) => {
    const q = text.trim();
    if (!q || streaming != null) return;
    setInput("");
    void ask([...messages, { role: "user", content: q }]);
  };
  /** Index of the question an answer belongs to (the user message right before it). */
  const pairStart = (i: number) => (messages[i]?.role === "assistant" && messages[i - 1]?.role === "user" ? i - 1 : i);
  const removePair = (i: number) => { const a = pairStart(i); const b = messages[a + 1]?.role === "assistant" ? a + 2 : a + 1; save([...messages.slice(0, a), ...messages.slice(b)]); };
  const retry = () => { const i = messages.length - 1; if (messages[i]?.role === "assistant" && streaming == null) void ask(messages.slice(0, i)); };
  const edit = (i: number) => { setInput(messages[i].content); save(messages.slice(0, i)); window.setTimeout(() => box.current?.focus(), 0); };
  const newChat = () => {
    if (!messages.length) return;
    selectionFeedback();
    saveArchive([{ id: `${Date.now()}`, at: Date.now(), messages }, ...archive].slice(0, 30));
    save([]); setInput(""); box.current?.focus();
  };
  const restore = (id: string) => {
    const c = archive.find((x) => x.id === id);
    if (!c) return;
    const rest = archive.filter((x) => x.id !== id);
    saveArchive(messages.length ? [{ id: `${Date.now()}`, at: Date.now(), messages }, ...rest] : rest);
    save(c.messages);
  };
  const blocked = !transcript || connected === false;
  const empty = !messages.length && streaming == null;
  const askedBodies = new Set(messages.filter((m) => m.role === "user").map((m) => m.content.trim()));
  const followUps = prompts.filter((p) => !askedBodies.has(p.body.trim())).slice(0, 3);
  const activeModelLabel = provider ? `${t(provider.name)} · ${shortModel(provider.model)}` : "";

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {empty && !transcript && <div className="panel-empty"><AskArt /><p className="es-title">{t("先准备本集字幕")}</p><button className="btn primary" onClick={onSubtitles}>{t("查看字幕")}</button></div>}
        {empty && transcript && connected === false && <ConnectCard what={tk("问答")} />}
        {empty && transcript && connected !== false && (
          <div className="chat-intro chat-hero-empty">
            <div className="chat-hero-head">
              <span className="chat-hero-mark" aria-hidden><Sparkles size={18} /></span>
              <h2 className="chat-hero-title">{t("问问这期节目")}</h2>
              <p className="chat-hero-sub">{t("基于本期完整文字稿 · 点击时间戳直达原话")}</p>
            </div>
            <div className="prompt-grid">
              {prompts.slice(0, 4).map((p) => {
                const Icon = promptIcon(p.id);
                return (
                  <button key={p.id} type="button" className="prompt-card" disabled={blocked} onClick={() => askPrompt(p)}>
                    <span className="pc-badge" aria-hidden><Icon size={16} /></span>
                    <span className="pc-copy">
                      <span className="pc-title">{p.title}</span>
                      <span className="pc-desc">{p.body}</span>
                    </span>
                    <ChevronRight size={15} className="pc-arrow" aria-hidden />
                  </button>
                );
              })}
            </div>
            <div className="chat-hero-foot">
              {prompts.length > 4 && (
                <button type="button" className="chat-more-pill" onClick={() => setPromptSheet(true)}>
                  {t("全部 {n} 个提问灵感", { n: prompts.length })}<ChevronRight size={14} aria-hidden />
                </button>
              )}
              <button type="button" className="chat-pref-btn" onClick={() => setPrefsOpen(true)}>
                <Settings2 size={14} aria-hidden /><span>{t("偏好")}</span>
              </button>
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="msg-wrap user">
            <div className="msg user"><p>{m.content}</p></div>
            {streaming == null && <QuestionActions text={m.content} onEdit={() => edit(i)} onDelete={() => removePair(i)} />}
          </div>
        ) : (
          <div key={i} className={`msg-wrap assistant ${i === messages.length - 1 ? "last" : ""}`}>
            <div className="ai-turn-head">
              <span className="ai-turn-badge" aria-hidden><Sparkles size={12} /></span>
              <span className="ai-turn-model">{m.model || activeModelLabel || "AI"}</span>
            </div>
            <div className="msg assistant"><Markdown text={m.content} onSeek={seek} /></div>
            {streaming == null && <AnswerActions text={m.content} ep={ep} model={m.model} onRetry={i === messages.length - 1 && !blocked ? retry : undefined} onDelete={() => removePair(i)} />}
            {streaming == null && i === messages.length - 1 && followUps.length > 0 && (
              <div className="chat-followups" role="group" aria-label={t("继续追问")}>
                {followUps.map((p) => {
                  const Icon = promptIcon(p.id);
                  return (
                    <button key={p.id} type="button" className="followup-pill" disabled={blocked} onClick={() => askPrompt(p)}>
                      <Icon size={13} aria-hidden /><span>{p.title}</span>
                    </button>
                  );
                })}
                {prompts.length > 3 && (
                  <button type="button" className="followup-pill more" onClick={() => setPromptSheet(true)}>
                    <span>{t("更多灵感")}</span><ChevronRight size={13} aria-hidden />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {streaming != null && (
          <div className="msg-wrap assistant last">
            <div className="ai-turn-head">
              <span className="ai-turn-badge is-live" aria-hidden><Sparkles size={12} /></span>
              <span className="ai-turn-model">{activeModelLabel || "AI"}</span>
            </div>
            <div className={`msg assistant ${streaming ? "is-streaming" : ""}`}>
              {streaming ? <Markdown text={streaming} onSeek={seek} /> : <ThinkingState />}
            </div>
          </div>
        )}
        {setupError && (
          <div className="setup-note"><span>{setupError}</span><button className="btn primary sm" onClick={() => useStore.getState().openSettings("model")}>{t("去设置")}</button></div>
        )}
      </div>
      {!atBottom && (messages.length > 0 || streaming != null) && <button type="button" className="to-bottom" title={t("回到底部")} aria-label={t("回到底部")} onClick={toBottom}><ArrowDown size={16} /></button>}
      {(!blocked || streaming != null) && (
        <div className="chat-dock-wrap">
          <form className="composer chat-capsule" onSubmit={(e) => { e.preventDefault(); void send(input); }} onClick={(e) => { if (e.target === e.currentTarget) box.current?.focus(); }}>
            <textarea ref={box} value={input} rows={1} placeholder={messages.length ? t("继续追问这期节目…") : t("向这期节目提问…")} disabled={blocked} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }} />
            <div className="chat-capsule-bar">
              <div className="chat-capsule-tools">
                <ModelPicker disabled={connected === false} />
                <button type="button" className="capsule-icon-btn" aria-label={t("快捷提问")} disabled={blocked || streaming != null} onClick={() => setPromptSheet(true)}><Sparkles size={16} /></button>
                <HistoryMenu archive={archive} ep={ep} current={messages} onRestore={restore} onDelete={(id) => saveArchive(archive.filter((x) => x.id !== id))} />
                {messages.length > 0 && streaming == null && (
                  <button type="button" className="capsule-icon-btn" aria-label={t("新对话")} title={t("开始新对话，当前对话存进历史")} onClick={newChat}><SquarePen size={16} /></button>
                )}
              </div>
              {streaming != null
                ? <button type="button" className="capsule-send stop" aria-label={t("停止")} onClick={() => chatAborts.get(ep.id)?.abort()}><Square size={12} fill="currentColor" /></button>
                : <button type="submit" className="capsule-send" aria-label={t("发送")} disabled={!input.trim() || blocked}><ArrowUp size={17} strokeWidth={2.4} /></button>}
            </div>
          </form>
        </div>
      )}
      {prefsOpen && <ChatPrefsDialog onClose={() => setPrefsOpen(false)} />}
      {promptSheet && <MobileSheet title={t("快捷提问")} onClose={() => setPromptSheet(false)} className="prompt-sheet">
        <div className="ps-list">
          {prompts.map((p) => {
            const Icon = promptIcon(p.id);
            return <button key={p.id} type="button" className="ps-row" disabled={blocked} onClick={() => askPrompt(p)}>
              <Icon size={18} className="ps-icon" aria-hidden />
              <span className="ps-text"><span className="ps-title">{p.title}</span><span className="ps-body">{p.body}</span></span>
            </button>;
          })}
        </div>
        <button type="button" className="ps-manage" onClick={() => { setPromptSheet(false); setPrefsOpen(true); }}><Settings2 size={15} /> {t("管理提示词")}</button>
      </MobileSheet>}
    </div>
  );
}
/** 导读 runs per episode outside the panel, so switching tabs or episodes mid-run neither loses the result
 *  nor offers to start (and pay for) the same run again. */
interface GuideJob { summary?: string | null; streaming: string | null; error: string | null; needsSetup: boolean; shared?: boolean; checking?: boolean }
const useGuides = create<Record<string, GuideJob>>(() => ({}));
const guideAborts = new Map<string, AbortController>();
const putGuide = (id: string, p: Partial<GuideJob>) => useGuides.setState((s) => ({ [id]: { ...(s[id] ?? { streaming: null, error: null, needsSetup: false }), ...p } }));

export function SummaryPanel({ ep, onSubtitles }: { ep: Episode; onSubtitles: () => void }) {
  const { transcript, provider, context, check } = useReady(ep);
  const connected = useConnected();
  const seek = useSeek(ep);
  const job = useGuides((s) => s[ep.id]);
  const summary = job?.summary ?? null;
  const streaming = job?.streaming ?? null;
  const error = job?.error ?? null;
  const needsSetup = !!job?.needsSetup;
  const checking = !!job?.checking;

  useEffect(() => {
    if (useGuides.getState()[ep.id]?.streaming != null) return;
    void (async () => {
      const [v, from] = await Promise.all([api.getBlob(ep.id, "summary"), api.getBlob(ep.id, "summary-from")]);
      if (useGuides.getState()[ep.id]?.streaming != null) return;
      if (v) { putGuide(ep.id, { summary: v, shared: from === "shared" }); return; }
      // Someone may have shared one: checked before offering to generate (and pay for) it.
      putGuide(ep.id, { summary: null, checking: true });
      const hit = await api.sharedGuide(ep.id).catch(() => null);
      if (useGuides.getState()[ep.id]?.streaming != null) return;
      putGuide(ep.id, { checking: false, ...(hit ? { summary: hit, shared: true } : {}) });
    })();
  }, [ep.id, transcript]);

  const run = async () => {
    if (useGuides.getState()[ep.id]?.streaming != null) return;
    putGuide(ep.id, { error: null, needsSetup: false });
    const ctl = new AbortController();
    try {
      await check();
      guideAborts.set(ep.id, ctl);
      putGuide(ep.id, { streaming: "" });
      const text = await askEpisode({ provider: provider!, title: ep.title, show: ep.showTitle ?? "", transcript: context(), history: [{ role: "user", content: summaryPrompt(transcript?.segments[transcript.segments.length - 1]?.end ?? ep.duration) }], onDelta: (d) => putGuide(ep.id, { streaming: d }), signal: ctl.signal });
      // Some agents only stream: keep what arrived if the final answer comes back empty.
      const out = text.trim() ? text : (useGuides.getState()[ep.id]?.streaming ?? "");
      if (!out.trim()) throw new Error(t("模型没有返回内容，请重试或换一个模型"));
      putGuide(ep.id, { summary: out, shared: false });
      await api.setBlob(ep.id, "summary", out);
      void api.shareGuide(ep.id, out, `${provider!.name} · ${provider!.model}`).catch(() => {});
    } catch (e) {
      if (ctl.signal.aborted) {
        const partial = useGuides.getState()[ep.id]?.streaming?.trim();
        if (partial) putGuide(ep.id, { summary: `${partial}\n\n${t("（已停止）")}`, shared: false });
      } else {
        putGuide(ep.id, { error: errorText(e), needsSetup: Boolean((e as { setup?: boolean })?.setup) || /设置|API Key/.test(rawErrorText(e)) });
      }
    } finally {
      guideAborts.delete(ep.id);
      putGuide(ep.id, { streaming: null });
    }
  };
  const stop = () => guideAborts.get(ep.id)?.abort();

  const text = streaming ?? summary;
  if (!text && !checking && !transcript) return <div className="panel-empty"><PageArt /><p className="es-title">{t("先准备本集字幕")}</p><button className="btn primary" onClick={onSubtitles}>{t("查看字幕")}</button></div>;
  if (!text && connected === false) return <div className="panel-empty"><ConnectCard what={tk("导读")} /></div>;
  if (!text && streaming != null) {
    return (
      <div className="panel-empty guide-wait" role="status">
        <PageArt writing />
        <p className="es-title">{t("正在通读整期文字稿")}</p>
        <button className="btn sm" onClick={stop}><Square size={12} fill="currentColor" /> {t("停止生成")}</button>
        <span className="sr-only">{t("正在生成…")}</span>
      </div>
    );
  }
  if (!text && checking) return <div className="panel-empty" role="status"><PageArt /><p className="muted"><Loader2 size={14} className="spin" /> {t("正在查找别人分享的导读…")}</p></div>;
  if (!text) {
    return (
      <div className="panel-empty">
        <PageArt />
        <p className="es-title">{t("一键中文导读")}</p>
        {error && <p className="error-text">{error}</p>}
        {error && needsSetup && <button className="btn" onClick={() => useStore.getState().openSettings("model")}>{t("去设置")}</button>}
        <button className="btn primary" onClick={run} disabled={!transcript || streaming != null}>{streaming != null ? t("正在生成…") : t("生成导读")}</button>
        {!transcript && <p className="muted small">{t("字幕准备好后可以生成。")}</p>}
      </div>
    );
  }
  return (
    <div className={`summary ${streaming != null ? "is-streaming" : ""}`}>
      <Markdown text={text} onSeek={seek} />
      {streaming != null ? (
        <div className="stream-stop-row">
          <span className="muted small"><Loader2 size={13} className="spin" /> {t("正在生成…")}</span>
          <button className="btn sm" onClick={stop}><Square size={11} fill="currentColor" /> {t("停止生成")}</button>
        </div>
      ) : (
        <div className="summary-foot">
          <span className="muted small">{job?.shared ? t("来自共享导读，没有花你的额度") : `${provider ? t(provider.name) : ""} · ${provider?.model ?? ""}`}</span>
          <ReadAloud text={() => plainText(text)} />
          <button className="btn ghost sm" onClick={run}><RefreshCw size={13} /> {t("重新生成")}</button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** AI 精读 runs per episode outside the panel, like 导读. */
const useArticles = create<Record<string, GuideJob>>(() => ({}));
const articleAborts = new Map<string, AbortController>();
const putArticle = (id: string, p: Partial<GuideJob>) => useArticles.setState((s) => ({ [id]: { ...(s[id] ?? { streaming: null, error: null, needsSetup: false }), ...p } }));

/** For an episode without a 乔木精读 article: a readable Chinese article written from the full subtitles in the
 *  乔木写作 style, kept with the episode. Section headings carry the time they start, so they play from there. */
export function ArticlePanel({ ep, onSubtitles }: { ep: Episode; onSubtitles: () => void }) {
  const { transcript, provider, context, check } = useReady(ep);
  const connected = useConnected();
  const seek = useSeek(ep);
  const job = useArticles((s) => s[ep.id]);
  const article = job?.summary ?? null;
  const streaming = job?.streaming ?? null;
  const error = job?.error ?? null;
  useEffect(() => {
    if (useArticles.getState()[ep.id]?.streaming != null) return;
    void api.getBlob(ep.id, "article").then((v) => { if (v && useArticles.getState()[ep.id]?.streaming == null) putArticle(ep.id, { summary: v }); });
  }, [ep.id]);
  const run = async () => {
    if (useArticles.getState()[ep.id]?.streaming != null) return;
    putArticle(ep.id, { error: null, needsSetup: false });
    const ctl = new AbortController();
    try {
      await check();
      articleAborts.set(ep.id, ctl);
      putArticle(ep.id, { streaming: "" });
      const text = await writeArticle({ provider: provider!, title: ep.title, show: ep.showTitle ?? "", transcript: context(), onDelta: (d) => putArticle(ep.id, { streaming: d }), signal: ctl.signal });
      const out = text.trim() ? text : (useArticles.getState()[ep.id]?.streaming ?? "");
      if (!out.trim()) throw new Error(t("模型没有返回内容，请重试或换一个模型"));
      putArticle(ep.id, { summary: out });
      await api.setBlob(ep.id, "article", out);
    } catch (e) {
      if (ctl.signal.aborted) {
        const partial = useArticles.getState()[ep.id]?.streaming?.trim();
        if (partial) putArticle(ep.id, { summary: `${partial}\n\n${t("（已停止）")}` });
      } else {
        putArticle(ep.id, { error: errorText(e), needsSetup: Boolean((e as { setup?: boolean })?.setup) || /设置|API Key/.test(rawErrorText(e)) });
      }
    } finally {
      articleAborts.delete(ep.id);
      putArticle(ep.id, { streaming: null });
    }
  };
  const stop = () => articleAborts.get(ep.id)?.abort();
  const text = streaming ?? article;
  if (!text && !transcript) return <div className="panel-empty"><PageArt /><p className="es-title">{t("这一集还没有精读")}</p><p className="muted small">{t("有了字幕，就能用 AI 写一篇精读。")}</p><button className="btn primary" onClick={onSubtitles}>{t("查看字幕")}</button></div>;
  if (!text && connected === false) return <div className="panel-empty"><ConnectCard what={tk("精读")} /></div>;
  if (!text && streaming != null) return (
    <div className="panel-empty guide-wait" role="status">
      <PageArt writing />
      <p className="es-title">{t("正在读完整期，写成一篇文章")}</p>
      <p className="muted small">{t("长节目要一两分钟")}</p>
      <button className="btn sm" onClick={stop}><Square size={12} fill="currentColor" /> {t("停止生成")}</button>
    </div>
  );
  if (!text) return (
    <div className="panel-empty article-offer">
      <PageArt />
      <p className="es-title">{t("这一集还没有精读")}</p>
      <p className="muted small">{t("用全文字幕写一篇好读的中文文章：有钩子、有小标题、每节能点回原处播放。")}</p>
      {error && <p className="error-text">{error}</p>}
      {error && job?.needsSetup && <button className="btn" onClick={() => useStore.getState().openSettings("model")}>{t("去设置")}</button>}
      <button className="btn primary" onClick={run}><Sparkles size={16} /> {t("用 AI 写一篇精读")}</button>
    </div>
  );
  const [first, ...rest] = text.split("\n");
  const title = /^#\s+/.test(first) ? first.replace(/^#\s+/, "") : null;
  return (
    <div className={`summary ai-article ${streaming != null ? "is-streaming" : ""}`}>
      <div className="article-head"><span className="deep-badge ai"><PenLine size={13} /> {t("AI 精读")}</span><ReadPrefsButton /></div>
      {title && <h1 className="article-title">{title}</h1>}
      <Markdown text={title ? rest.join("\n") : text} onSeek={seek} />
      {streaming != null ? (
        <div className="stream-stop-row">
          <span className="muted small"><Loader2 size={13} className="spin" /> {t("正在写作…")}</span>
          <button className="btn sm" onClick={stop}><Square size={11} fill="currentColor" /> {t("停止生成")}</button>
        </div>
      ) : (
        <div className="summary-foot">
          <span className="muted small">{t("按乔木写作风格，由 {model} 根据全文字幕写成", { model: provider?.model ?? "AI" })}</span>
          <ReadAloud text={() => plainText(text)} />
          <button className="btn ghost sm" onClick={run}><RefreshCw size={13} /> {t("重写")}</button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

// Markdown → what a voice should say: no links, timestamps, headings or emphasis marks.
function plainText(md: string) {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[?\b\d{1,2}(:\d{2}){1,2}\]?/g, "")
    .replace(/^#+\s*|[*_`>]+/gm, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
