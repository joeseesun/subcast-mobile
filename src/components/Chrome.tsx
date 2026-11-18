import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Link2, Loader2, Plus, Search, X, Import } from "lucide-react";
import { api, errorText, type SearchResult } from "../lib/api";
import { ImportPanel } from "./ImportPanel";
import { useStore } from "../store";
import { PICKS, deepPickFor, isSubscribed, pickName, showName } from "../lib/picks";
import { isChineseUi, t, tr, useLang } from "../lib/i18n";
import { useShowName } from "../lib/zh";
import { useJobs } from "../lib/jobs";
import { BiTitle, ZhText } from "./Bi";
import { showIcon } from "./Lists";
import { EmptyState, SearchArt } from "./Illustrations";
import { BrandGlyph } from "./BrandGlyph";
import { PageHeading } from "./PageHeading";
import listeningShell from "../assets/editorial/listening-shell.webp";

export function LibraryShows() {
  const { shows, go } = useStore(useShallow((s) => ({ shows: s.shows, go: s.go })));
  useLang((s) => s.lang);
  const curated = PICKS.filter((p) => p.deep && !isSubscribed(p, shows) && !shows.some((s) => deepPickFor(s.title)?.id === p.id));
  return (
    <>
      <div className="library-group">
        {shows.map((s) => (
          <button key={s.id} className="show-item" onClick={() => go({ kind: "show", id: s.id })}>
            <span className="show-cover">{showIcon(s)}</span><SideName title={s.title} />
            {s.unplayed > 0 && s.unplayed <= 99 && <span className="unplayed" aria-label={t("{n} 集未听", { n: s.unplayed })}>{s.unplayed}</span>}
            <ChevronRight size={18} aria-hidden />
          </button>
        ))}

      </div>
      {!shows.length && <EmptyState art={<img className="listening-shell" src={listeningShell} alt="" />} title={t("还没有订阅")}>
        <button className="btn primary" onClick={() => go({ kind: "discover" })}>{t("去发现节目")}</button>
      </EmptyState>}
      {curated.length > 0 && <>
        <h2 className="module-title">{t("乔木精读")}</h2>
        <div className="library-group">{curated.map((p) => (
          <button key={p.id} className="show-item" onClick={() => go({ kind: "channel", input: p.input })}>
            <span className="show-cover"><img src={p.cover} alt="" loading="lazy" /></span>
            <span className="show-names"><span className="show-title">{pickName(p)}</span>{isChineseUi() && p.zh !== p.title && <span className="show-orig">{p.title}</span>}</span>
            <ChevronRight size={18} aria-hidden />
          </button>
        ))}</div>
      </>}
      <TaskChip />
    </>
  );
}

const looksLikeLink = (t: string) => /^(https?:\/\/|@)|youtube\.com|youtu\.be|xiaoyuzhoufm\.com|feed\.xyzfm\.space|podcasts\.apple\.com|\.(xml|rss)\b/i.test(t.trim());

/** The bar above every page: back, one search box that subscribes to pasted links or searches by name, settings. */
export function TopBar() {
  const { history, back, reloadShows, go, openEpisode, notify, shows } = useStore(useShallow((s) => ({ history: s.history, back: s.back, reloadShows: s.reloadShows, go: s.go, openEpisode: s.openEpisode, notify: s.notify, shows: s.shows })));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const link = looksLikeLink(q);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q.trim() || link) { setResults(null); return; }
    timer.current = window.setTimeout(async () => {
      setBusy(true);
      try { setResults((await api.searchPodcasts(q.trim(), /[\u4e00-\u9fff]/.test(q) ? "CN" : "US")).slice(0, 8)); } catch { setResults([]); } finally { setBusy(false); }
    }, 300);
  }, [q]);
  const subscribe = async (input: string) => {
    setAdding(input);
    try {
      const r = await api.addSubscription(input);
      setQ(""); setOpen(false); setResults(null);
      if (r.show) { await reloadShows(); notify(t("已订阅「{name}」", { name: r.show.title })); go({ kind: "show", id: r.show.id }); }
      else if (r.episode) openEpisode(r.episode);
    } catch (e) { notify(errorText(e)); } finally { setAdding(null); }
  };
  const submit = () => { if (link) void subscribe(q.trim()); else setOpen(true); };
  return (
    <div className="discover-top">
      <PageHeading title={t("发现")} />
      <div className="topbar">
      {history.length > 0 && <button className="heading-tool" onClick={back} aria-label={t("返回")}><ChevronLeft size={22} /></button>}
      <div className="search-wrap">
        <div className={`top-search ${open ? "focus" : ""}`}>
          {link ? <Link2 size={20} /> : <BrandGlyph name="search" size={21} />}
          <input value={q} type="search" enterKeyHint={link ? "go" : "search"} placeholder={t("搜节目或粘贴链接")} spellCheck={false} autoCapitalize="off" autoCorrect="off"
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }} />
          {busy || adding ? <Loader2 size={14} className="spin" /> : link ? <button className="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={submit}>{t("添加")}</button> : null}
        </div>
        {open && results && (
          <div className="search-drop">
            {results.length === 0 ? <div className="drop-empty"><SearchArt /><p className="muted small">{t("没有找到，换个关键词试试")}</p></div> : results.map((r) => {
              const done = shows.some((s) => s.feedUrl === r.feedUrl);
              return (
                <div key={r.feedUrl} className="drop-row" onMouseDown={(e) => e.preventDefault()}>
                  {r.cover ? <img src={r.cover} alt="" /> : <div className="cover-fallback">{r.title.slice(0, 1)}</div>}
                  <div className="drop-meta"><BiTitle text={r.title} className="ep-name" subClassName="clamp1" /><p className="meta-line clamp1">{r.author}</p></div>
                  {done ? <span className="sub-done">{t("已订阅")}</span> : <button className="btn sm" onClick={() => subscribe(r.feedUrl)} disabled={adding != null}>{adding === r.feedUrl ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} {t("订阅")}</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function SideName({ title }: { title: string }) {
  const { zh, orig } = useShowName(title);
  return (
    <span className="show-names">
      <span className="show-title">{zh ?? orig}</span>
      {zh && <span className="show-orig">{orig}</span>}
    </span>
  );
}

/** A running transcription anywhere in the app, with a way back to its episode. */
function TaskChip() {
  const asr = useJobs((s) => s.asr);
  const go = useStore((s) => s.go);
  const running = Object.entries(asr).find(([, j]) => j.stage === "download" || j.stage === "transcribe");
  if (!running) return null;
  const [id, job] = running;
  return (
    <button className="task-chip" onClick={() => go({ kind: "episode", id })}>
      <Loader2 size={13} className="spin" /> {job.stage === "download" ? (job.message ? tr(job.message) : t("正在准备")) : t("正在生成字幕")} · {Math.round(job.progress * 100)}%
    </button>
  );
}

export function MiniPlayer() {
  const loading = useStore((s) => s.loadingSince);
  const { current, view, playing, player, time, length, openEpisode } = useStore(useShallow((s) => ({ current: s.current, view: s.view, playing: s.playing, player: s.player, time: s.time, length: s.length, openEpisode: s.openEpisode })));
  if (!current || (current.videoId && !player?.systemVideo) || (view.kind === "episode" && view.id === current.id)) return null;
  return (
    <div className="mini">
      <button className="play-btn sm" aria-label={playing || loading ? t("暂停") : t("播放")} onClick={() => player?.toggle()} disabled={!player} aria-busy={!!loading}>{loading ? <Loader2 size={16} className="spin" /> : playing ? <BrandGlyph name="pause" size={19} /> : <BrandGlyph name="play" size={19} />}</button>
      <button className="mini-open" onClick={() => openEpisode(current)}>
        {current.cover && <img className="mini-cover" src={current.cover} alt="" />}
        <span className="mini-meta">
        <span className="ep-name"><ZhText text={current.title} /></span>
        {current.showTitle && current.showId !== "single" && <span className="meta-line">{showName(current.showTitle)}</span>}
        <span className="mini-progress"><i style={{ width: `${length ? (time / length) * 100 : 0}%` }} /></span>
        </span>
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, head, className, done }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; head?: React.ReactNode; className?: string; done?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""} ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">{head ?? <h3>{title}</h3>}{done ? <button className="sheet-done" onClick={onClose}>{t("完成")}</button> : <button className="sheet-close" onClick={onClose} aria-label={t("关闭")}><X aria-hidden size={14} /></button>}</div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function AddDialog() {
  const { set, reloadShows, go, openEpisode, notify, shows } = useStore(useShallow((s) => ({ set: s.set, reloadShows: s.reloadShows, go: s.go, openEpisode: s.openEpisode, notify: s.notify, shows: s.shows })));
  const [tab, setTab] = useState<"search" | "import">(useStore.getState().addTab === "import" ? "import" : "search");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const close = () => set({ addOpen: false });
  const add = async (value: string) => {
    setError(null); setAdding(value); setBusy(true);
    try {
      const r = await api.addSubscription(value);
      close();
      if (r.show) { await reloadShows(); notify(t("已订阅「{name}」", { name: r.show.title })); go({ kind: "show", id: r.show.id }); }
      else if (r.episode) openEpisode(r.episode);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); setAdding(null); }
  };
  // A link pasted into the search box is simply added.
  const pastedLink = looksLikeLink(q);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q.trim() || pastedLink) { setResults(null); return; }
    timer.current = window.setTimeout(async () => {
      setSearching(true);
      try { setResults((await api.searchPodcasts(q.trim(), /[\u4e00-\u9fff]/.test(q) ? "CN" : "US")).slice(0, 12)); } catch { setResults([]); } finally { setSearching(false); }
    }, 300);
  }, [q]);
  const head = (
    <div className="add-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "on" : ""} onClick={() => { setTab("search"); setError(null); }}><Search size={15} /> {t("搜索节目")}</button>
      <button role="tab" aria-selected={tab === "import"} className={tab === "import" ? "on" : ""} onClick={() => { setTab("import"); setError(null); }}><Import size={15} /> {t("导入订阅")}</button>
    </div>
  );
  return (
    <Modal title={t("添加节目")} onClose={close} head={head}>
      {tab === "import" ? <ImportPanel onDone={close} /> : (
        <form className="add-form" onSubmit={(e) => { e.preventDefault(); if (pastedLink) void add(q.trim()); else (document.activeElement as HTMLElement)?.blur(); }}>
          <div className="add-search">
            {pastedLink ? <Link2 size={16} /> : <Search size={16} />}
            <input autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint={pastedLink ? "go" : "search"} placeholder={t("搜节目或粘贴链接")} />
            {(searching || busy) && <Loader2 size={14} className="spin muted" />}
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="add-results">
            {pastedLink ? (
              <div className="add-empty"><button type="submit" className="btn primary sm" disabled={busy}>{t("添加")}</button></div>
            ) : !q.trim() ? (
              null
            ) : results && !results.length ? (
              <div className="add-empty"><SearchArt /><p className="muted small">{t("未找到节目")}</p></div>
            ) : results?.map((r) => {
              const done = shows.some((s) => s.feedUrl === r.feedUrl);
              return (
                <div key={r.feedUrl} className="drop-row">
                  {r.cover ? <img src={r.cover} alt="" /> : <div className="cover-fallback">{r.title.slice(0, 1)}</div>}
                  <div className="drop-meta"><BiTitle text={r.title} className="ep-name" subClassName="clamp1" /><p className="meta-line clamp1">{r.author}</p></div>
                  {done ? <span className="sub-done">{t("已订阅")}</span> : <button type="button" className="btn sm" onClick={() => void add(r.feedUrl)} disabled={adding != null}>{adding === r.feedUrl ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} {t("订阅")}</button>}
                </div>
              );
            })}
          </div>
        </form>
      )}
    </Modal>
  );
}

export function Toast() {
  const { toast, kind } = useStore(useShallow((s) => ({ toast: s.toast, kind: s.toastKind })));
  return toast ? <div className="toast" data-kind={kind} role="status">
    {kind === "cache" && <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" aria-hidden="true">
      <path d="M3 14.6v4.6A1.8 1.8 0 0 0 4.8 21h14.4a1.8 1.8 0 0 0 1.8-1.8v-4.6M3 15h4.7l2.1 2.3h4.4l2.1-2.3H21"/>
      <path className="cache-arrival" d="m8.8 10 2.3 2.4 4.4-5.5"/>
    </svg>}
    {toast}
  </div> : null;
}
