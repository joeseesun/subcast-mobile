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
import { ArrowDownToLine, BookOpen, Captions, ChevronLeft, ChevronDown, ScrollText, ExternalLink, MessageCircle, Info, Play, Trash2, Youtube, Bookmark, Pause } from "lucide-react";
import { BookArt, DoneCheck, EmptyState } from "./Illustrations";
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
import { showLinks } from "../lib/showLinks";
import { toggleFavorite, useLibrary } from "../lib/library";
import { YtVideoStrip } from "./YtPromo";
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
  return <div className="asub" aria-live="off">{line(nowLine, "now", `${i}-${k}`)}{nextLine && line(nextLine, "next", `${i}-${k}-n`)}</div>;
}

function SubtitleOverlay({ ep }: { ep: Episode }) {
  const transcript = useJobs((s) => s.transcripts[ep.id]);
  const items = useJobs((s) => s.translations[ep.id]?.items);
  const time = useStore((s) => s.time);
  const mode = useStore((s) => s.settings.subtitleMode);
  if (!transcript) return null;
  const i = activeIndex(transcript.segments, time);
  const seg = transcript.segments[i];
  if (!seg || time > seg.end + 1.5) return null;
  const zh = items?.[i];
  const progress = Math.min(1, Math.max(0, (time - seg.start) / Math.max(0.5, seg.end - seg.start)));
  const cjk = /[\u4e00-\u9fff]/.test(seg.text);
  return (
    <div className="subtitle-overlay">
      <div className="sub-box">
        {zh && mode !== "original" && <p className="sub-zh">{pieceAt(zh, true, progress)}</p>}
        {(mode !== "translation" || !zh) && <p className="sub-orig">{pieceAt(seg.text, cjk, progress)}</p>}
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
      if (!e) return;
      // 乔木精读 episodes learn their audio address from their page the first time they are opened.
      if (e.transcriptType === "qiaomu" && !e.audioUrl) {
        try { await api.qiaomuDetail(e.id); e = (await api.getEpisode(id)) ?? e; } catch { /* plays video, or shows the error later */ }
      }
      // Offline with the audio saved: a YouTube episode starts in audio mode instead of a player that cannot load.
      const offline = !!e.videoId && !navigator.onLine && isSaved(e.id);
      if (!active) return;
      setStartAudio(offline);
      setEp(e);
      if (e.deep) setTab((t) => (t === "transcript" ? "deep" : t));
      void loadTranscript(e);
      // Opening an episode loads it into the player, unless something else is playing.
      const s = useStore.getState();
      if (s.current?.id !== e.id && (!s.playing || s.playWhenReady === e.id)) load(offline ? { ...e, videoId: undefined } : e);
      else if (s.current?.id === e.id && !s.current.audioUrl && e.audioUrl) {
        s.set({ current: { ...s.current, audioUrl: e.audioUrl } });
      }
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
function DownloadButton({ ep }: { ep: Episode }) {
  const [menu, setMenu] = useState(false);
  const go = useStore((s) => s.go);
  const saved = useOffline((s) => s.saved[ep.id]);
  const progress = useOffline((s) => s.active[ep.id]);
  if (!ep.audioUrl && !ep.videoId) return null;
  if (progress !== undefined) {
    const r = 7, c = 2 * Math.PI * r;
    return (
      <button className="round-btn dl-busy" title={progress == null ? t("正在下载，点一下取消") : t("已下载 {pct}%，点一下取消", { pct: Math.round(progress * 100) })} onClick={() => cancelDownload(ep.id)}>
        <svg viewBox="0 0 20 20" width="18" height="18" className={progress == null ? "dl-ring spin" : "dl-ring"} aria-hidden>
          <circle cx="10" cy="10" r={r} className="dl-track" />
          <circle cx="10" cy="10" r={r} className="dl-fill" strokeDasharray={c} strokeDashoffset={c * (1 - (progress ?? 0.25))} />
        </svg>
      </button>
    );
  }
  if (saved) {
    // A download that just finished draws its tick once; older saves show it already drawn.
    const fresh = Date.now() - saved.savedAt < 5000;
    const close = () => setMenu(false);
    return (
      <div className="menu-wrap">
        <button className="round-btn dl-done" title={t("已下载 · {size}", { size: bytes(saved.bytes) })} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><DoneCheck fresh={fresh} /></button>
        {menu && (
          <div className="menu right" role="menu" onMouseLeave={close}>
            <p className="menu-note">{t("已下载 · {size}", { size: bytes(saved.bytes) })}</p>
            <button role="menuitem" onClick={() => { close(); go({ kind: "downloads" }); }}><ArrowDownToLine size={14} /> {t("管理全部下载")}</button>
            <button role="menuitem" className="danger" onClick={() => { close(); void ask({ title: t("删除这一集已下载的音频？"), message: t("之后在线播放，字幕和进度都会保留。"), ok: t("删除"), danger: true }).then((yes) => { if (yes) void removeDownload(ep.id); }); }}><Trash2 size={14} /> {t("删除下载")}</button>
          </div>
        )}
      </div>
    );
  }
  return <button className="round-btn" title={ep.audioUrl ? t("下载，离线也能听") : t("下载音频，离线也能听")} onClick={() => void downloadEpisode(ep)}><ArrowDownToLine size={15} /></button>;
}

function EpisodeBody({ ep, tab, setTab, startAudio }: { ep: Episode; tab: Tab; setTab: (t: Tab) => void; startAudio: boolean }) {
  // Feeds sometimes mark a deep-read that isn't there: then the tab goes away.
  const [noDeep, setNoDeep] = useState<string | null>(null);
  const { current, load } = useStore(useShallow((s) => ({ current: s.current, load: s.load })));
  const titleZh = useZh(ep.title);
  const isCurrent = current?.id === ep.id;
  const playing = useStore((s) => s.playing);
  const fav = useLibrary((s) => s.favorites.some((f) => f.id === ep.id));
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
  const ytPromo = useStore((s) => s.settings.youtubePromo);
  const epShow = useStore((s) => s.shows.find((x) => x.id === ep.showId));
  const ytChannel = showLinks(epShow?.feedUrl).youtube;
  const startPlayback = () => {
    if (!isCurrent) load(audioMode ? { ...ep, videoId: undefined } : ep);
    playSoon(ep.id);
  };
  const coverToggle = () => {
    const player = useStore.getState().player;
    if (isCurrent && player?.episodeId === ep.id) player.toggle();
    else startPlayback();
  };
  const switchTo = (audio: boolean) => {
    const s = useStore.getState();
    const time = isCurrent ? s.time : ep.progress;
    const resume = isCurrent && (s.playing || !!s.loadingSince || s.playWhenReady === ep.id);
    s.set({ current: { ...ep, videoId: audio ? undefined : ep.videoId, progress: time }, time,
      length: isCurrent ? s.length : ep.duration || 0, player: null, playing: false,
      playWhenReady: resume ? ep.id : null, loadingSince: resume ? Date.now() : null });
  };

  const videoOverlay = useMemo(() => <SubtitleOverlay ep={ep} />, [ep.id]);
  const switchRef = useRef(switchTo);
  switchRef.current = switchTo;
  const onUnplayable = useMemo(() => () => { switchRef.current(true); playSoon(ep.id); }, [ep.id]);

  const tabBtn = (k: Tab, icon: ReactNode, label: string) => (
    <button role="tab" title={t(TAB_NAMES[k])} aria-label={t(TAB_NAMES[k])} aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{icon}<span className="tab-label">{label}</span></button>
  );

  // Phone layout: the player stays on top (title, picture or cover, controls); the tabs fill the rest.
  return (
    <div className="episode m-episode">
      <header className="m-episode-nav">
        <button className="m-back" onClick={() => useStore.getState().back()} aria-label={t("返回")}><ChevronLeft size={24} /></button>
        <span className="clamp1">{ep.showTitle && ep.showId !== "single" ? showName(ep.showTitle) : "SubCast"}</span>
      </header>
      <section className="m-ep-top">
        <div className="ep-title-block">
          <div className="ep-title">
            <p className="meta-line">{[date(ep.published), duration(ep.duration)].filter(Boolean).map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</p>
            <h1>{titleZh ?? ep.title}</h1>
            {titleZh && titleZh !== ep.title && <p className="orig-line clamp1">{ep.title}</p>}
          </div>
          <div className="m-ep-actions">
            <button className={`round-btn fav-btn ${fav ? "on" : ""}`} aria-pressed={fav} aria-label={fav ? t("取消收藏") : t("收藏这一集")} onClick={() => toggleFavorite(ep)}><Bookmark size={16} fill={fav ? "currentColor" : "none"} /></button>
            <DownloadButton ep={ep} />
            {ep.videoId
              ? <button className="round-btn yt-open" aria-label={t("在 YouTube 打开（从当前位置继续）")} onClick={() => { const s = Math.floor(isCurrent ? useStore.getState().time : ep.progress ?? 0); void openUrl(`https://www.youtube.com/watch?v=${ep.videoId}${s > 5 ? `&t=${s}s` : ""}`); }}><Youtube size={17} /></button>
              : ep.link && <button className="round-btn" aria-label={t("节目网页")} onClick={() => openUrl(ep.link!)}><ExternalLink size={16} /></button>}
            {both && (
              <div className="media-switch seg-control" role="radiogroup" aria-label={t("播放方式")}>
                <button role="radio" aria-checked={!audioMode} className={!audioMode ? "on" : ""} onClick={() => audioMode && switchTo(false)}>{t("视频")}</button>
                <button role="radio" aria-checked={audioMode} className={audioMode ? "on" : ""} onClick={() => !audioMode && switchTo(true)}>{t("仅音频")}</button>
              </div>
            )}
          </div>
        </div>
        {showVideo ? (
          isCurrent ? <VideoSlot ep={ep} overlay={videoOverlay} onUnplayable={both ? onUnplayable : undefined} /> :
          <button className="video-slot video-preview" onClick={startPlayback} aria-label={t("播放这一集")}>
            <img src={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} alt="" /><Play fill="currentColor" />
          </button>
        ) : (
          <div className="audio-stage m-audio-stage">
            <button type="button" className="cover-play" disabled={!ep.audioUrl && !saved} onClick={coverToggle} aria-label={isCurrent && playing ? t("暂停") : t("播放")}>
              {ep.cover ? <img src={ep.cover} alt="" /> : <span className="cover-fallback" />}
              <span className={`cover-play-btn ${isCurrent && playing ? "playing" : ""}`}>{isCurrent && playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</span>
            </button>
            <div className="audio-sub"><AudioSubtitles ep={ep} /></div>
          </div>
        )}
        {!ep.audioUrl && !ep.videoId && !saved ? <p className="muted small">{t("这集没有音频地址")}</p> : isCurrent ? <div className="controls-slot"><Controls /></div> : (
          <button className="btn primary m-play" onClick={startPlayback}><Play size={14} /> {t("播放这一集")}</button>
        )}
      </section>
      <section className="ep-right m-ep-tabs">
        <div className="tabs" role="tablist">
          {tabBtn("transcript", <Captions size={15} />, t("字幕"))}
          {ep.deep && noDeep !== ep.id && tabBtn("deep", <BookOpen size={15} />, t("精读"))}
          {tabBtn("summary", <ScrollText size={15} />, t("导读"))}
          {tabBtn("chat", <MessageCircle size={15} />, t("问答"))}
          {notes && tabBtn("notes", <Info size={15} />, t("简介"))}
        </div>
        <div className="tab-body">
          <PanelBoundary key={tab}>
            {tab === "transcript" && <TranscriptPanel ep={ep} />}
            {tab === "chat" && <ChatPanel ep={ep} />}
            {tab === "summary" && <SummaryPanel ep={ep} />}
            {tab === "deep" && <DeepRead ep={ep} onMissing={() => { setNoDeep(ep.id); setTab("transcript"); }}><EmptyState art={<BookArt />} title={t("这一集还没有精读")} note={t("这期没有精读长文，字幕和 AI 导读依然可以帮你")} /></DeepRead>}
            {tab === "notes" && notes && (
              <div className="m-notes">
                {ytPromo && ytChannel && <YtVideoStrip channel={ytChannel} name={showName(epShow?.title ?? "")} cover={epShow?.cover} />}
                <Notes ep={ep} text={notes} defaultOpen />
              </div>
            )}
          </PanelBoundary>
        </div>
      </section>
    </div>
  );
}
