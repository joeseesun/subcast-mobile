import { BrandGlyph } from "./BrandGlyph";
import { MobileSheet, presentNativeChoices } from "./MobileSheet";
import { selectionFeedback } from "../lib/feedback";
import { ask } from "../lib/confirm";
import { useShallow } from "zustand/react/shallow";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t, tk } from "../lib/i18n";

class PanelBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    return this.state.error ? (
      <div className="panel-empty"><p className="lead">{t("这里出了点问题")}</p><p className="muted small">{this.state.error}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>{t("重试")}</button></div>
    ) : this.props.children;
  }
}
import { ChevronLeft, ChevronDown, Trash2, Check } from "lucide-react";
import { BookArt, EmptyState } from "./Illustrations";
import { DeepRead } from "./DeepRead";
import { SkeletonEpisode } from "./Skeleton";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type Episode } from "../lib/api";
import { date, duration, notesText } from "../lib/format";
import { showName } from "../lib/picks";
import { isZh, useZh, useZhParagraphs } from "../lib/zh";
import { autoTranslate, loadTranscript, useJobs } from "../lib/jobs";
import { useStore } from "../store";
import { ChatPanel, SummaryPanel } from "./AiPanels";
import { Controls, playSoon } from "./Players";
import { VideoSlot } from "./VideoDock";
import { bytes, cancelDownload, downloadEpisode, isSaved, removeDownload, useOffline } from "../lib/offline";
import { toggleFavorite, useLibrary } from "../lib/library";
import { activeIndex, TranscriptPanel } from "./TranscriptPanel";

type Tab = "transcript" | "deep" | "chat" | "summary" | "notes";
const TAB_NAMES: Record<Tab, string> = { transcript: tk("字幕"), deep: tk("乔木精读"), chat: tk("AI 问答"), summary: tk("AI 导读"), notes: tk("本集简介") };

/** Splits a subtitle block into reading-sized pieces: at the end of each sentence, at a comma once a piece is
 *  long enough, and between words only when a sentence runs on too long. */
export function pieces(text: string, cjk: boolean): string[] {
  const soft = cjk ? 14 : 38, hard = cjk ? 30 : 80;
  // A "." inside a number ("1.5") doesn't end anything.
  const units = cjk ? text.split(/(?<=[，。！？；：、,!?;]|\.(?!\d))/) : text.split(/(?<=\s)/);
  const out: string[] = [];
  let cur = "";
  for (let n = 0; n < units.length; n++) {
    const u = units[n];
    // A sentence only ends at "." when what follows starts a new one (a capital, a digit-free quote, CJK), so
    // "raised to 1. point five" or "e.g. this" stay together.
    const nextStart = (units[n + 1] ?? "").trimStart()[0] ?? "";
    const continues = !cjk && /\.$/.test(u.trim()) && /[a-z0-9]/.test(nextStart);
    if (cur && (cur + u).trim().length > hard) { out.push(cur.trim()); cur = ""; }
    cur += u;
    const t = cur.trim();
    // Initials and titles end in a full stop without ending the sentence ("J.P.", "Mr.", "U.S.").
    const last = u.trim();
    const abbrev = !cjk && /^(?:[A-Z]\.)+(?:[A-Z]\.?)?$|^(?:Mr|Mrs|Ms|Dr|St|vs|etc|Inc|Co|Jr|Sr|No|Vol)\.$/.test(last);
    if ((!abbrev && !continues && /[。！？.!?]["”')）]*$/.test(t)) || (t.length >= soft && /[，；：,;:]$/.test(t))) { out.push(t); cur = ""; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [text];
}

/** The piece being spoken now, assuming speech is spread evenly over the block. */
function pieceAt(text: string, cjk: boolean, progress: number): string {
  const ps = pieces(text, cjk);
  const total = ps.reduce((n, p) => n + p.length, 0);
  let acc = 0;
  for (const p of ps) { acc += p.length; if (acc / total >= progress) return p; }
  return ps[ps.length - 1];
}

/** Which piece (sentence-sized) of a block is being spoken, assuming speech is spread evenly over it. */
function pieceIndex(ps: string[], progress: number): number {
  const total = ps.reduce((n, p) => n + p.length, 0) || 1;
  let acc = 0;
  for (let k = 0; k < ps.length; k++) { acc += ps[k].length; if (acc / total >= progress) return k; }
  return ps.length - 1;
}

/** Audio episodes: the sentence being spoken, and the next one already there, faded, so reading runs ahead of
 *  the voice. Both are sentence pieces, not whole blocks, so it stays two short lines (four when bilingual). */
function AudioSubtitles({ ep }: { ep: Episode }) {
  const transcript = useJobs((s) => s.transcripts[ep.id]);
  const items = useJobs((s) => s.translations[ep.id]?.items);
  const time = useStore((s) => s.time);
  const mode = useStore((s) => s.settings.subtitleMode);
  const showNext = useStore((s) => s.settings.audioNextLine === true);
  if (!transcript) return null;
  const segs = transcript.segments;
  const i = Math.max(0, activeIndex(segs, time));
  const seg = segs[i];
  if (!seg) return null;
  const progress = Math.min(1, Math.max(0, (time - seg.start) / Math.max(0.5, seg.end - seg.start)));
  const cjk = (x: string) => /[\u4e00-\u9fff]/.test(x);
  const origPs = pieces(seg.text, cjk(seg.text));
  const zh = items?.[i];
  const zhPs = zh ? pieces(zh, true) : [];
  const k = pieceIndex(origPs, progress);
  // The translation has its own pieces; the matching one is at the same share of the block.
  const kz = zhPs.length ? Math.min(zhPs.length - 1, Math.floor((k / origPs.length) * zhPs.length + 1e-9)) : 0;
  const nextSeg = segs[i + 1];
  const nextZh = items?.[i + 1];
  const nowLine = { orig: origPs[k], zh: zhPs.length ? (zhPs.length === origPs.length ? zhPs[k] : zhPs[kz]) : undefined };
  const nextLine = k + 1 < origPs.length
    ? { orig: origPs[k + 1], zh: zhPs.length ? (zhPs.length === origPs.length ? zhPs[k + 1] : kz + 1 < zhPs.length ? zhPs[kz + 1] : undefined) : undefined }
    : nextSeg ? { orig: pieces(nextSeg.text, cjk(nextSeg.text))[0], zh: nextZh ? pieces(nextZh, true)[0] : undefined } : null;
  const line = (l: { orig: string; zh?: string }, role: "now" | "next", key: string) => (
    <div key={key} className={`asub-line ${role}`} aria-hidden={role === "next"}>
      {l.zh && mode !== "original" && <p className="sub-zh">{l.zh}</p>}
      {(mode !== "translation" || !l.zh) && <p className="sub-orig">{l.orig}</p>}
    </div>
  );
  return <div className="asub" aria-live="off">{line(nowLine, "now", `${i}-${k}`)}{showNext && nextLine && line(nextLine, "next", `${i}-${k}-n`)}</div>;
}

function SubtitleOverlay({ ep }: { ep: Episode }) {
  const transcript = useJobs((s) => s.transcripts[ep.id]);
  const items = useJobs((s) => s.translations[ep.id]?.items);
  const mode = useStore((s) => s.settings.subtitleMode);
  // Render only when the words change. The video clock also updates while a cue is on screen.
  const cue = useStore(useShallow(({ time }) => {
    if (!transcript) return null;
    const i = activeIndex(transcript.segments, time);
    const segment = transcript.segments[i];
    if (!segment || time > segment.end + 1.5) return null;
    const progress = Math.min(1, Math.max(0, (time - segment.start) / Math.max(0.5, segment.end - segment.start)));
    const zh = items?.[i];
    return {
      original: mode !== "translation" || !zh ? pieceAt(segment.text, /[\u4e00-\u9fff]/.test(segment.text), progress) : null,
      translated: zh && mode !== "original" ? pieceAt(zh, true, progress) : null,
    };
  }));
  if (!cue) return null;
  return (
    <div className="subtitle-overlay">
      <div className="sub-box">
        {cue.translated && <p className="sub-zh">{cue.translated}</p>}
        {cue.original && <p className="sub-orig">{cue.original}</p>}
      </div>
    </div>
  );
}

export function EpisodeView({ id }: { id: string }) {
  const { load } = useStore(useShallow((s) => ({ load: s.load })));
  const [ep, setEp] = useState<Episode | null>(null);
  const [tab, setTab] = useState<Tab>("transcript");
  const [startAudio, setStartAudio] = useState(false);

  useEffect(() => {
    let active = true;
    api.getEpisode(id).then(async (e) => {
      if (!active || !e) return;
      const offline = !!e.videoId && !navigator.onLine && isSaved(e.id);
      setStartAudio(offline);
      setEp(e);
      if (e.deep) setTab((t) => (t === "transcript" ? "deep" : t));
      const s = useStore.getState();
      if (s.current?.id !== e.id && ((!s.playing && !s.loadingSince) || s.playWhenReady === e.id)) load(offline ? { ...e, videoId: undefined } : e);
      // A known video can start buffering immediately while the publisher's detail page supplies its audio.
      if (e.transcriptType === "qiaomu" && !e.audioUrl) {
        try {
          await api.qiaomuDetail(e.id);
          e = (await api.getEpisode(id)) ?? e;
          if (!active) return;
          setEp(e);
        } catch { /* keep the episode supplied by the feed */ }
      }
      if (!active) return;
      const current = useStore.getState().current;
      if (current?.id === e.id && !current.audioUrl && e.audioUrl) {
        useStore.setState({ current: { ...current, audioUrl: e.audioUrl } });
      }
      void loadTranscript(e);
    });
    return () => { active = false; };
  }, [id]);

  if (!ep) return <SkeletonEpisode />;
  return <EpisodeBody ep={ep} tab={tab} setTab={setTab} startAudio={startAudio} />;
}

/** Chapter times in show notes ("00:00 开场", "1:02:30") become buttons that seek; links open in the browser. */
function withStamps(text: string, seek: (s: number) => void): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"'）)】]+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g).map((part, i) => {
    if (i % 2 === 0) return part;
    if (/^https?:/.test(part)) return <a key={i} href={part} className="notes-link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openUrl(part); }}>{part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>;
    const sec = part.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
    return <button key={i} type="button" className="stamp" title={t("跳到这里播放")} onClick={(e) => { e.stopPropagation(); seek(sec); }}>{part}</button>;
  });
}

function Notes({ ep, text, defaultOpen = false }: { ep: Episode; text: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [orig, setOrig] = useState(false);
  const zhAlready = isZh(text);
  // Translated with Google in the background as soon as the page opens, so it is ready before the card is.
  const google = useZhParagraphs(text, !zhAlready);
  const [model, setModel] = useState<{ paras: string[]; by: string; src?: string } | null>(null);
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const srcKey = `${text.length}:${text.slice(0, 40)}`;
  const seek = (sec: number) => {
    const s = useStore.getState();
    if (s.current?.id === ep.id) s.player?.seek(sec);
    else { s.load({ ...ep, progress: sec }); window.setTimeout(() => useStore.getState().player?.seek(sec), 600); }
  };

  useEffect(() => {
    setModel(null);
    api.getBlob(ep.id, "notes-zh").then((raw) => { if (raw) try { const m = JSON.parse(raw); if (!m.src || m.src === srcKey) setModel(m); } catch { /* ignore */ } });
  }, [ep.id, srcKey]);

  const zh = model?.paras.length ? model.paras : google;
  const shown = zhAlready || orig || !zh ? paras : zh;
  return (
    <div className={`notes ${open ? "open" : ""}`}>
      <div className="notes-head" role="button" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={(e) => e.key === "Enter" && setOpen(!open)}>
        <span>{t("本集简介")}</span>
        {open && zh && !zhAlready && <span className="notes-by">{model?.paras.length ? t("{name} 翻译", { name: t(model.by) }) : t("谷歌翻译")}</span>}
        {open && zh && !zhAlready && <button className="link-btn" onClick={(e) => { e.stopPropagation(); setOrig(!orig); }}>{orig ? t("看中文") : t("原文")}</button>}
        <ChevronDown size={14} className={open ? "flip" : ""} />
      </div>
      {open && (
        <div className="notes-body">
          {!zh && !orig && !zhAlready && <p className="muted small">{t("正在翻译…")}</p>}
          {shown.map((p, i) => <p key={i}>{withStamps(p, seek)}</p>)}
        </div>
      )}
    </div>
  );
}
/** Save for offline listening; shows progress while saving and the saved state after. */
function EpisodeActions({ ep, close }: { ep: Episode; close: () => void }) {
  const fav = useLibrary((s) => s.favorites.some((f) => f.id === ep.id));
  const saved = useOffline((s) => s.saved[ep.id]);
  const progress = useOffline((s) => s.active[ep.id]);
  const [bookmarkMotion, setBookmarkMotion] = useState(0);
  return <MobileSheet title={t("本集操作")} onClose={close}>
    <button className="favorite-row" aria-pressed={fav} onClick={() => {
      toggleFavorite(ep, false);
      setBookmarkMotion((n) => n + 1);
      selectionFeedback();
    }}><span key={bookmarkMotion} className={bookmarkMotion && fav ? "bookmark-placed" : undefined}><BrandGlyph name="saved" /></span>{fav ? t("取消收藏") : t("收藏这一集")}{fav && <Check className="row-check" />}</button>
    {saved ? <>
      <button onClick={() => { close(); useStore.getState().go({ kind: "downloads" }); }}><BrandGlyph name="cache" />{t("管理离线音频")}<small>{bytes(saved.bytes)}</small></button>
      <button className="destructive" onClick={async () => { close(); if (await ask({ title: t("清理这一集的离线音频？"), ok: t("清理"), danger: true })) void removeDownload(ep.id); }}><Trash2 />{saved.cached ? t("清理缓存") : t("删除下载")}</button>
    </> : (ep.audioUrl || ep.videoId) && <button onClick={() => { if (progress !== undefined) cancelDownload(ep.id); else void downloadEpisode(ep); close(); }}>
      <BrandGlyph name="cache" />{progress !== undefined ? t("取消缓存") : t("缓存音频")}{typeof progress === "number" && <small>{Math.round(progress * 100)}%</small>}
    </button>}
  </MobileSheet>;
}

function EpisodeBody({ ep, tab, setTab, startAudio }: { ep: Episode; tab: Tab; setTab: (t: Tab) => void; startAudio: boolean }) {
  // Feeds sometimes mark a deep-read that isn't there: then the tab goes away.
  const [noDeep, setNoDeep] = useState<string | null>(null);
  const { current, load } = useStore(useShallow((s) => ({ current: s.current, load: s.load })));
  const titleZh = useZh(ep.title);
  const isCurrent = current?.id === ep.id;
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [videoRecovery, setVideoRecovery] = useState(false);
  const reading = tab === "summary" || tab === "chat";
  const showingRecovery = isCurrent && !!current.videoId && videoRecovery;
  const compact = reading && !expanded && isCurrent && !showingRecovery;
  useEffect(() => {
    const askSelection = (event: Event) => {
      const quote = (event as CustomEvent<string>).detail;
      setDraft((previous) => previous ? previous + "\n\n“" + quote + "”" : "“" + quote + "”\n");
      setExpanded(false); setTab("chat");
    };
    window.addEventListener("subcast-ask-selection", askSelection);
    return () => window.removeEventListener("subcast-ask-selection", askSelection);
  }, [ep.id, setTab]);
  const [sheet, setSheet] = useState<"actions" | "media" | null>(null);
  // Translate foreign-language subtitles whichever tab is open: the video's subtitles need the Chinese too.
  const transcript = useJobs((s) => s.transcripts[ep.id]);
  const mode = useStore((s) => s.settings.subtitleMode);
  useEffect(() => { if (transcript) autoTranslate(ep); }, [transcript, mode]);
  // rss.qiaomu.ai channels only carry a ~300-character summary; fetch the full notes once (YouTube or 小宇宙).
  const [fullNotes, setFullNotes] = useState<string | null>(null);
  useEffect(() => {
    setFullNotes(null);
    const short = notesText(ep.notes).length < 800;
    if (short && (ep.videoId || ep.link?.includes("xiaoyuzhoufm.com/episode/"))) void api.fullNotes(ep.id).then((n) => n && setFullNotes(n)).catch(() => {});
  }, [ep.id]);
  const notes = notesText(fullNotes ?? ep.notes);
  // Video first; the audio file is the fallback (and a choice, for listening without the picture).
  const audioMode = isCurrent ? !current.videoId : startAudio;
  const saved = useOffline((s) => !!s.saved[ep.id]);
  const both = !!ep.videoId && (!!ep.audioUrl || saved);
  const showVideo = !!ep.videoId && !audioMode;
  const startPlayback = () => {
    if (!isCurrent) load(audioMode ? { ...ep, videoId: undefined } : ep);
    playSoon(ep.id);
  };
  const switchTo = (audio: boolean) => {
    const s = useStore.getState();
    const time = isCurrent ? s.time : ep.progress;
    const resume = isCurrent && (s.playing || !!s.loadingSince || s.playWhenReady === ep.id);
    s.set({ current: { ...ep, videoId: audio ? undefined : ep.videoId, progress: time }, time,
      bufferedUntil: 0, length: isCurrent ? s.length : ep.duration || 0, player: null, playing: false,
      playWhenReady: resume ? ep.id : null, loadingSince: resume ? Date.now() : null });
  };

  const videoOverlay = useMemo(() => <SubtitleOverlay ep={ep} />, [ep.id]);
  const switchRef = useRef(switchTo);
  switchRef.current = switchTo;
  const onUnplayable = useMemo(() => () => { switchRef.current(true); playSoon(ep.id); }, [ep.id]);

  const tabs: [Tab, string][] = [["transcript", t("字幕")]];
  if (ep.deep && noDeep !== ep.id) tabs.push(["deep", t("精读")]);
  tabs.push(["summary", t("导读")], ["chat", t("问答")]);
  if (notes) tabs.push(["notes", t("简介")]);
  const mediaOptions = [
    { id: "video", title: t("视频"), glyph: "film", symbol: "film", selected: !audioMode },
    { id: "audio", title: t("仅音频"), glyph: "sound", symbol: "waveform", selected: audioMode },
  ] as const;
  const chooseMedia = async (trigger: HTMLButtonElement) => {
    const choice = await presentNativeChoices(t("播放方式"), [...mediaOptions], trigger);
    if (choice === null) { setSheet("media"); return; }
    const mode = mediaOptions.find((option) => option.id === choice);
    if (mode && !mode.selected) switchTo(mode.id === "audio");
  };
  const modeButton = both && <button className="media-mode" aria-label={t("切换播放方式")} aria-haspopup="dialog" onClick={(e) => void chooseMedia(e.currentTarget)}>
    {audioMode ? <BrandGlyph name="sound" size={21} /> : <BrandGlyph name="film" size={21} />}<span>{audioMode ? t("音频") : t("视频")}</span><ChevronDown size={12} />
  </button>;
  // Phone layout: the player stays on top (title, picture or cover, controls); the tabs fill the rest.
  return (
    <div className="episode m-episode">
      <header className="m-episode-nav">
        <button className="m-back" onClick={() => useStore.getState().back()} aria-label={t("返回")}><ChevronLeft size={24} /></button>
        <span className="clamp1">{ep.showTitle && ep.showId !== "single" ? showName(ep.showTitle) : "SubCast"}</span>
        <button className="m-back" aria-label={t("本集操作")} aria-haspopup="dialog" onClick={() => setSheet("actions")}><BrandGlyph name="more" /></button>
      </header>
      {sheet === "actions" && <EpisodeActions ep={ep} close={() => setSheet(null)} />}
      {sheet === "media" && <MobileSheet title={t("播放方式")} onClose={() => setSheet(null)}>
        {mediaOptions.map(({ id, title, glyph, selected }) => <button key={id} aria-pressed={selected} onClick={() => {
          setSheet(null); if (!selected) { selectionFeedback(); switchTo(id === "audio"); }
        }}><BrandGlyph name={glyph} />{title}{selected && <Check className="row-check" />}</button>)}
      </MobileSheet>}
      <section className={`m-ep-top ${compact ? "reader-player" : ""} ${showVideo ? "with-video" : ""}`}>
        <div className={`ep-title-block ${showVideo ? "" : "audio-heading"}`}>
          {!showVideo && ep.cover && <img className="episode-artwork" src={ep.cover} alt="" />}
          <div className="ep-title">
            <p className="meta-line">{[date(ep.published), duration(ep.duration)].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</p>
            <h1>{titleZh ?? ep.title}</h1>
            {titleZh && titleZh !== ep.title && <p className="orig-line clamp1">{ep.title}</p>}
          </div>
        </div>
        {showVideo ? (
          isCurrent ? <VideoSlot ep={ep} overlay={videoOverlay} onUnplayable={both ? onUnplayable : undefined} onRecoveryChange={setVideoRecovery} /> :
          <button className="video-slot video-preview" onClick={startPlayback} aria-label={t("播放这一集")}>
            <img src={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} alt="" /><BrandGlyph name="play" size={28} />
          </button>
        ) : (
          <div className="audio-sub mobile-caption"><AudioSubtitles ep={ep} /></div>
        )}
        {!ep.audioUrl && !ep.videoId && !saved ? <p className="muted small">{t("这集没有音频地址")}</p> : isCurrent ? <div className="controls-slot"><Controls leading={modeButton} /></div> : (
          <div className="m-start-row">{modeButton}<button className="btn primary m-play" onClick={startPlayback}><BrandGlyph name="play" size={22} /> {t("播放这一集")}</button></div>
        )}
        {reading && isCurrent && !showingRecovery && <button className="reader-toggle" aria-label={compact ? t("展开播放器") : t("收起播放器")} aria-expanded={!compact} onClick={() => setExpanded(!expanded)}><ChevronDown size={20} className={compact ? "" : "flip"} /></button>}
      </section>
      <section className="ep-right m-ep-tabs">
        <div className="reading-segments" role="tablist" style={{ "--count": tabs.length, "--index": Math.max(0, tabs.findIndex(([k]) => k === tab)) } as React.CSSProperties}>
          <i aria-hidden />
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-label={t(TAB_NAMES[k])} aria-selected={tab === k} onClick={() => {
            if (tab !== k) { selectionFeedback(); setExpanded(false); setTab(k); }
          }}>{label}</button>)}
        </div>
        <div className="tab-body">
          <PanelBoundary key={tab}>
            {tab === "transcript" && <TranscriptPanel ep={ep} />}
            {tab === "chat" && <ChatPanel ep={ep} input={draft} setInput={setDraft} onSubtitles={() => setTab("transcript")} />}
            {tab === "summary" && <SummaryPanel ep={ep} onSubtitles={() => setTab("transcript")} />}
            {tab === "deep" && <DeepRead ep={ep} onMissing={() => { setNoDeep(ep.id); setTab("transcript"); }}><EmptyState art={<BookArt />} title={t("这一集还没有精读")} /></DeepRead>}
            {tab === "notes" && notes && (
              <div className="m-notes">
                <Notes ep={ep} text={notes} defaultOpen />
              </div>
            )}
          </PanelBoundary>
        </div>
      </section>
    </div>
  );
}
