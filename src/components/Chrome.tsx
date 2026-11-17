import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Compass, Download, Inbox, Link2, Loader2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Search, Settings as Cog, X, Import, ChartColumn } from "lucide-react";
import { api, errorText, type SearchResult } from "../lib/api";
import { ImportPanel } from "./ImportPanel";
import { useStore, type View } from "../store";
import { PICKS, deepPickFor, isSubscribed, pickName, showName } from "../lib/picks";
import { isChineseUi, kbd, t, tk, tr, tx, useLang } from "../lib/i18n";
import { useShowName } from "../lib/zh";
import { useJobs } from "../lib/jobs";
import { BiTitle, ZhText } from "./Bi";
import { useLayout } from "../lib/layout";
import { useOffline } from "../lib/offline";
import logoUrl from "../assets/logo.png";
import { showIcon } from "./Lists";
import { EqBars, SearchArt, useKonami, useTaps } from "./Illustrations";

export function Sidebar() {
  const { shows, view, go, set } = useStore(useShallow((s) => ({ shows: s.shows, view: s.view, go: s.go, set: s.set })));
  useLang((s) => s.lang);
  // Eggs: five quick clicks on the logo make it dance; the Konami code switches the seek bar to tape.
  const [dance, setDance] = useState(false);
  const tapLogo = useTaps(5, () => { setDance(true); window.setTimeout(() => setDance(false), 3600); });
  useKonami(() => { const on = document.body.classList.toggle("tape-seek"); useStore.getState().notify(on ? t("磁带模式已开启") : t("磁带模式已关闭")); });
  const is = (v: View) => view.kind === v.kind && (v.kind !== "show" || (view.kind === "show" && view.id === v.id)) && (v.kind !== "channel" || (view.kind === "channel" && view.input === v.input));
  // A 精读 channel is listed once: hidden here when its show is already followed (either version).
  const curated = PICKS.filter((p) => p.deep && !isSubscribed(p, shows) && !shows.some((s) => deepPickFor(s.title)?.id === p.id));
  const { sideOpen, put: putLayout } = useLayout();
  const updateWaiting = false;
  const rail = !sideOpen;
  const hasDownloads = useOffline((s) => Object.keys(s.saved).length + Object.keys(s.active).length > 0);
  // A render function, not a component: defined inside Sidebar, a component would remount its button on
  // every render and swallow clicks that land mid-render.
  const nav = (v: View, icon: React.ReactNode, label: string) => (
    <button key={v.kind} className={`nav ${is(v) ? "on" : ""}`} onClick={() => go(v)} title={rail ? label : undefined} aria-label={label}>{icon}<span className="label">{label}</span></button>
  );
  return (
    <aside className={`sidebar ${rail ? "rail" : ""}`}>
      <div className="traffic-space" data-tauri-drag-region />
      <div className={`brand${dance ? " dance" : ""}`} data-tauri-drag-region onClick={tapLogo}>
        <img className="logo-img" src={logoUrl} alt="" />
        <p className="brand-name">SubCast</p>
        {dance && <EqBars className="brand-eq" />}
      </div>
      <nav>
        {nav({ kind: "latest" }, <Inbox size={16} />, t("首页"))}
        {nav({ kind: "discover" }, <Compass size={16} />, t("发现"))}
        {nav({ kind: "stats" }, <ChartColumn size={16} />, t("收听统计"))}
        {(hasDownloads || view.kind === "downloads") && nav({ kind: "downloads" }, <Download size={16} />, t("已下载"))}
      </nav>
      <div className="side-sep" />
      <div className="side-head"><span className="label">{tx("sidebar", "订阅")}</span><button className="icon-btn sm" title={t("添加节目")} onClick={() => set({ addOpen: true, addTab: "search" })}><Plus size={14} /></button></div>
      <div className="show-list">
        {shows.map((s) => (
          <button key={s.id} className={`show-item ${is({ kind: "show", id: s.id }) ? "on" : ""}`} onClick={() => go({ kind: "show", id: s.id })} title={rail ? showName(s.title) : s.title}>
            <span className="show-cover">{showIcon(s)}{rail && s.unplayed > 0 && <span className="rail-dot" />}</span>
            <SideName title={s.title} />
            {s.unplayed > 0 && <span className="unplayed">{s.unplayed > 99 ? "99+" : s.unplayed}</span>}
          </button>
        ))}
        {!shows.length && <p className="muted small side-empty">{t("还没有订阅")}</p>}
        {curated.length > 0 && <>
          <div className="side-head second"><span className="label">{t("乔木精读")}</span></div>
          {curated.map((p) => (
            <button key={p.id} className={`show-item curated ${is({ kind: "channel", input: p.input }) ? "on" : ""}`} onClick={() => go({ kind: "channel", input: p.input })} title={t("{name} · 点击查看，决定是否订阅", { name: pickName(p) })}>
              <span className="show-cover"><img src={p.cover} alt="" loading="lazy" /></span>
              <span className="show-names"><span className="show-title">{pickName(p)}</span>{isChineseUi() && p.zh !== p.title && <span className="show-orig">{p.title}</span>}</span>
            </button>
          ))}
        </>}
      </div>
      <TaskChip />
      <div className="side-foot">
        <button className="nav settings-btn" onClick={() => useStore.getState().openSettings(updateWaiting ? "about" : undefined)} title={updateWaiting ? t("有新版本，点击更新") : rail ? t("设置") : undefined} aria-label={updateWaiting ? t("设置，有新版本") : t("设置")}><span className="cog-wrap"><Cog size={16} />{updateWaiting && <span className="update-dot" />}</span><span className="label">{t("设置")}</span>{updateWaiting && !rail && <span className="update-pill">{t("更新")}</span>}</button>
        <button className="icon-btn side-toggle" onClick={() => putLayout({ sideOpen: rail })} title={rail ? t("展开侧栏（⌘B）") : t("收起为图标（⌘B）")} aria-label={rail ? t("展开侧栏") : t("收起侧栏")}>{rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
      </div>
    </aside>
  );
}

const PLACEHOLDERS = [tk("粘贴 YouTube / 小宇宙 / 播客链接，或搜索节目名"), tk("试试搜 Lex Fridman"), tk("粘贴一个 YouTube 视频链接，直接看双语字幕")];
const placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
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
  const submit = () => { if (link) void subscribe(q.trim()); else if (results?.[0]) void subscribe(results[0].feedUrl); };
  return (
    <div className="topbar" data-tauri-drag-region>
      <button className="round-btn" onClick={back} disabled={!history.length} aria-label={t("返回")}><ChevronLeft size={18} /></button>
      <div className="search-wrap">
        <div className={`top-search ${open ? "focus" : ""}`}>
          {link ? <Link2 size={16} /> : <Search size={16} />}
          <input value={q} placeholder={t(placeholder)} spellCheck={false} autoCapitalize="off" autoCorrect="off"
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }} />
          {busy || adding ? <Loader2 size={14} className="spin" /> : link ? <span className="kbd-hint">{t("回车订阅")}</span> : !open && !q && <kbd className="kbd-hint" title={t("按 ⌘L 搜索")}>{kbd("⌘L")}</kbd>}
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
      <div className="spacer" data-tauri-drag-region />
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
  const { panel, panelOpen } = useLayout();
  if (!current || current.videoId || (view.kind === "episode" && view.id === current.id)) return null;
  // Left-aligned with the page content; on an episode page it stays within the middle column.
  const right = view.kind === "episode" && panelOpen ? panel + 24 : 24;
  return (
    <div className="mini" style={{ "--mini-right": `${right}px` } as React.CSSProperties}>
      <button className="play-btn sm" onClick={() => player?.toggle()} disabled={!player} aria-busy={!!loading}>{loading ? <Loader2 size={16} className="spin" /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
      {current.cover && <img className="mini-cover" src={current.cover} alt="" />}
      <div className="mini-meta" role="button" tabIndex={0} onClick={() => openEpisode(current)}>
        <p className="ep-name"><ZhText text={current.title} /></p>
        {current.showTitle && current.showId !== "single" && <p className="meta-line">{showName(current.showTitle)}</p>}
        <div className="bar"><div style={{ width: `${length ? (time / length) * 100 : 0}%` }} /></div>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, head }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; head?: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">{head ?? <h3>{title}</h3>}<button className="icon-btn" onClick={onClose} aria-label={t("关闭")}><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function AddDialog() {
  const { set, reloadShows, go, openEpisode, notify, shows } = useStore(useShallow((s) => ({ set: s.set, reloadShows: s.reloadShows, go: s.go, openEpisode: s.openEpisode, notify: s.notify, shows: s.shows })));
  const [tab, setTab] = useState<"search" | "link" | "import">(useStore.getState().addTab ?? "search");
  const [q, setQ] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const close = () => set({ addOpen: false });
  // Split around the placeholder so "RSS" can stay bold wherever the translation puts it.
  const rss = t("任意播客 {rss} 地址", { rss: "\u0000" }).split("\u0000");
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
      <button role="tab" aria-selected={tab === "link"} className={tab === "link" ? "on" : ""} onClick={() => { setTab("link"); setError(null); }}><Link2 size={15} /> {t("链接或 RSS")}</button>
      <button role="tab" aria-selected={tab === "import"} className={tab === "import" ? "on" : ""} onClick={() => { setTab("import"); setError(null); }}><Import size={15} /> {t("导入订阅")}</button>
    </div>
  );
  return (
    <Modal title={t("添加节目")} onClose={close} head={head}>
      {tab === "import" ? <ImportPanel onDone={close} /> : tab === "search" ? (
        <form className="add-form" onSubmit={(e) => { e.preventDefault(); if (pastedLink) void add(q.trim()); else if (results?.[0] && !shows.some((s) => s.feedUrl === results[0].feedUrl)) void add(results[0].feedUrl); }}>
          <div className="add-search">
            {pastedLink ? <Link2 size={16} /> : <Search size={16} />}
            <input autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("输入节目名，比如 Lex Fridman、张小珺")} />
            {(searching || busy) && <Loader2 size={14} className="spin muted" />}
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="add-results">
            {pastedLink ? (
              <div className="add-empty"><p className="muted small">{t("这是一个链接，回车直接添加")}</p><button type="submit" className="btn primary sm" disabled={busy}>{t("添加")}</button></div>
            ) : !q.trim() ? (
              <div className="add-empty"><p className="muted small">{t("搜索 Apple Podcasts 上的节目，中英文名都可以。YouTube 频道或小宇宙请用「链接或 RSS」。")}</p></div>
            ) : results && !results.length ? (
              <div className="add-empty"><SearchArt /><p className="muted small">{t("没有找到，换个关键词，或者用「链接或 RSS」添加")}</p></div>
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
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) void add(input.trim()); }} className="add-form">
          <input autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("粘贴 YouTube / Apple Podcasts / 小宇宙 / RSS 链接")} />
          {error && <p className="error-text">{error}</p>}
          <ul className="hints muted small">
            <li><b>YouTube</b> {t("频道（@名字 / 频道链接 / 播放列表），或单个视频链接")}</li>
            <li><b>Apple Podcasts</b> {t("节目链接")}</li>
            <li><b>{t("小宇宙")}</b> {t("节目或单集链接")}</li>
            <li>{rss[0]}<b>RSS</b>{rss[1]}</li>
          </ul>
          <div className="modal-foot">
            <div className="spacer" />
            <button type="button" className="btn ghost" onClick={close}>{t("取消")}</button>
            <button type="submit" className="btn primary" disabled={busy || !input.trim()}>{busy ? <><Loader2 size={14} className="spin" /> {t("正在读取…")}</> : t("添加")}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  return toast ? <div className="toast" role="status">{toast}</div> : null;
}
