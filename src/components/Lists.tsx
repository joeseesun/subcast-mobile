import { MobileBack } from "./MobileBack";
import { MobileSheet } from "./MobileSheet";
import { selectionFeedback } from "../lib/feedback";
import { playSoon } from "./Players";
import { ask } from "../lib/confirm";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BookOpen, Check, ChevronDown, ChevronRight, ListFilter, Loader2, MoreHorizontal, Play, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { bytes, clearDownloads, useOffline } from "../lib/offline";
import { api, errorText, type Episode, type Show, type ShowHit } from "../lib/api";
import { date, duration, monthLabel } from "../lib/format";
import { PICKS, TOPICS, deepPickFor, isSubscribed, pickName, pickSub, sameFeed, showName, type Pick, type Topic } from "../lib/picks";
import { isChineseUi, t } from "../lib/i18n";
import { HOME_SHOW_FEED, showLinks } from "../lib/showLinks";
import { AlsoOn, HomeShowBanner, YtButton, usePromo } from "./YtPromo";
import { useShowName, useZh } from "../lib/zh";
import { useStore } from "../store";
import { SkeletonFeed } from "./Skeleton";
import { BookmarkArt, EmptyState, FlatLineArt, HeadphonesArt, TrayArt } from "./Illustrations";
import { MonthFilter, useMonthFilter } from "./MonthFilter";
import { clearQueue, playAll, useLibrary } from "../lib/library";
import { recommend, type Recommendation } from "../lib/recommend";

// ---- episode rows -------------------------------------------------------------------------------

function ShowName({ title }: { title?: string }) {
  if (!title) return null;
  const { zh, orig } = useShowName(title);
  return <span className="show-name">{zh ?? orig}</span>;
}

/** One episode, built for scanning: who and when on a small first line, the title in full (up to two lines),
 *  the original title muted underneath, and status only when it means something. */
/** The query's words marked in a piece of text. */
function Marked({ text, query }: { text: string; query: string }) {
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** Opens an episode and plays it from a subtitle match. */
function openAt(ep: Episode, time: number) {
  const s = useStore.getState();
  const at = { ...ep, progress: Math.max(0, time - 1) };
  void api.setProgress(ep.id, at.progress);
  s.load(at);
  s.openEpisode(at);
  playSoon(ep.id);
}

function EpisodeRow({ ep, showShow, hit, query }: { ep: Episode; showShow: boolean; hit?: ShowHit; query?: string }) {
  const openEpisode = useStore((s) => s.openEpisode);
  const open = () => (hit?.time != null ? openAt(ep, hit.time) : openEpisode(ep));
  const current = useStore((s) => s.current);
  const zh = useZh(ep.title);
  const pct = ep.duration && ep.progress > 5 ? Math.min(100, (ep.progress / ep.duration) * 100) : 0;
  const deep = !!ep.deep;
  const saved = useOffline((s) => !!s.saved[ep.id]);
  const loading = useOffline((s) => s.active[ep.id]);
  return (
    <div className={`ep-item ${current?.id === ep.id ? "playing" : ""} ${pct >= 97 ? "played" : ""}`} role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <div className={`ep-thumb ${ep.videoId ? "video" : "square"}`}>
        {ep.cover && !ep.videoId && <img className="thumb-bg" src={ep.cover} alt="" aria-hidden loading="lazy" />}
        {ep.cover ? <img className="thumb-img" src={ep.cover} alt="" loading="lazy" onError={(e) => {
          const i = e.currentTarget;
          if (ep.videoId && !i.dataset.f) { i.dataset.f = "1"; i.src = `https://i.ytimg.com/vi/${ep.videoId}/mqdefault.jpg`; } else i.style.visibility = "hidden";
        }} /> : <div className="cover-fallback" />}
        {ep.videoId && ep.duration ? <span className="thumb-dur">{clockShort(ep.duration)}</span> : null}
        {pct > 0 && <span className="thumb-bar"><span style={{ width: `${pct}%` }} /></span>}
      </div>
      <div className="ep-body-col">
        <p className="ep-kicker">
          {showShow && ep.showId !== "single" && <ShowName title={ep.showTitle} />}
          <span>{date(ep.published)}</span>
          {ep.duration ? <span>{duration(ep.duration)}</span> : null}
        </p>
        <p className="ep-title2">{query ? <Marked text={zh ?? ep.title} query={query} /> : zh ?? ep.title}</p>
        {zh && zh !== ep.title && <p className="ep-orig">{query ? <Marked text={ep.title} query={query} /> : ep.title}</p>}
        {hit && hit.field !== "title" && (
          <p className="ep-hit">
            <span className="ep-hit-where">{hit.field === "transcript" ? <><Play size={10} /> {t("字幕")} {clockShort(hit.time ?? 0)}</> : t("简介")}</span>
            <span className="ep-hit-text"><Marked text={hit.snippet} query={query ?? ""} /></span>
          </p>
        )}
        {(deep || ep.hasTranscript || ep.videoId || pct > 0 || saved || loading !== undefined) && (
          <p className="ep-tags">
            {saved && <span className="tag saved"><ArrowDownToLine size={11} />{t("已下载")}</span>}
            {loading !== undefined && <span className="tag saved">{loading == null ? t("下载中") : t("下载中 {pct}%", { pct: Math.round(loading * 100) })}</span>}
            {deep && <span className="tag deep">{t("精读")}</span>}
            {ep.hasTranscript && <span className="tag">{t("字幕")}</span>}
            {ep.videoId && <span className="tag">{t("视频")}</span>}
            {pct > 0 && pct < 97 && <span className="tag progress"><span className="mini-bar"><span style={{ width: `${pct}%` }} /></span>{t("剩 {n} 分钟", { n: Math.max(1, Math.round(((ep.duration ?? 0) - ep.progress) / 60)) })}</span>}
            {pct >= 97 && <span className="tag">{t("已听完")}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

function groupLabel(ms?: number | null): string {
  if (!ms) return t("更早");
  const d = new Date(ms), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return t("今天");
  if (diff === 1) return t("昨天");
  if (diff < 7) return t("本周");
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return t("本月");
  return monthLabel(d.getMonth() + 1, d.getFullYear() === now.getFullYear() ? undefined : d.getFullYear());
}

const clockShort = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

function EpisodeList({ episodes, showShow, grouped = true }: { episodes: Episode[] | null; showShow: boolean; grouped?: boolean }) {
  if (episodes == null) return <SkeletonFeed />;
  if (!episodes.length) return <EmptyState art={<FlatLineArt />} title={t("暂无单集")} />;
  if (!grouped) return <div className="ep-feed">{episodes.map((e) => <EpisodeRow key={e.id} ep={e} showShow={showShow} />)}</div>;
  const groups: { label: string; items: Episode[] }[] = [];
  for (const e of episodes) {
    const label = groupLabel(e.published);
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  return (
    <div className="ep-feed">
      {groups.map((g) => (
        <section key={g.label} className="ep-group">
          <h3 className="ep-group-h">{g.label}</h3>
          {g.items.map((e) => <EpisodeRow key={e.id} ep={e} showShow={showShow} />)}
        </section>
      ))}
    </div>
  );
}

// ---- home ---------------------------------------------------------------------------------------

function ContinueHero({ ep }: { ep: Episode }) {
  const openEpisode = useStore((s) => s.openEpisode);
  const zh = useZh(ep.title);
  const pct = ep.duration ? Math.min(100, (ep.progress / ep.duration) * 100) : 0;
  const left = ep.duration ? Math.max(1, Math.round((ep.duration - ep.progress) / 60)) : 0;
  // The whole card resumes: open the episode and start playing where it stopped.
  const resume = () => { openEpisode(ep); playSoon(ep.id); };
  return (
    <div className="hero" role="button" tabIndex={0} title={t("继续播放")} onClick={resume} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), resume())}>
      <div className={`hero-cover ${ep.videoId ? "wide" : ""}`}>
        {ep.cover ? <img src={ep.cover} alt="" /> : <div className="cover-fallback" />}
        {pct > 0 && <span className="hero-bar" aria-hidden><span style={{ width: `${pct}%` }} /></span>}
      </div>
      <div className="hero-meta">
        <p className="meta-line">{t("继续收听")}{ep.showTitle && ep.showId !== "single" ? <> · <ShowName title={ep.showTitle} /></> : null}</p>
        <p className="hero-title">{zh ?? ep.title}</p>
        {zh && zh !== ep.title && <p className="orig-line clamp1">{ep.title}</p>}
        <div className="hero-foot">
          <span className="btn primary hero-play" aria-hidden><Play size={15} fill="currentColor" /> {t("继续播放")}</span>
          {left > 0 && <span className="hero-left">{t("还剩 {left} 分钟", { left })}</span>}
        </div>
      </div>
    </div>
  );
}

function ShowTile({ show }: { show: Show }) {
  const go = useStore((s) => s.go);
  const { zh, orig } = useShowName(show.title);
  return (
    <div className="show-tile" role="button" tabIndex={0} onClick={() => go({ kind: "show", id: show.id })} onKeyDown={(e) => e.key === "Enter" && go({ kind: "show", id: show.id })}>
      <div className="tile-cover">{show.cover ? <img src={show.cover} alt="" loading="lazy" /> : <div className="cover-fallback">{orig.slice(0, 1)}</div>}</div>
      <p className="tile-name clamp1">{zh ?? orig}</p>
      {zh && <p className="tile-sub clamp1">{orig}</p>}
    </div>
  );
}

/** A compact episode card for the home rows: picture, show and date, title, and a play button on hover. */
/** Subtitles open with the episode, no transcription: already made here, the publisher's (YouTube captions,
 *  a feed transcript), a 精读 transcript, or one someone shared (asked for in one batch, see checkShared). */
const ownSubs = (e: Episode) => !!(e.hasTranscript || e.transcriptUrl || e.deep || e.videoId);
const useSharedHits = create<{ ids: Record<string, true> }>(() => ({ ids: {} }));
const hasSubs = (e: Episode, shared: Record<string, true>) => ownSubs(e) || !!shared[e.id];
/** Episodes already asked about this session (an answer doesn't change often enough to ask again). */
const askedShared = new Set<string>();
function checkShared(eps: Episode[]) {
  const ids = eps.filter((e) => !ownSubs(e) && !askedShared.has(e.id)).map((e) => e.id).slice(0, 100);
  if (!ids.length) return;
  ids.forEach((id) => askedShared.add(id));
  void api.sharedExists(ids).then((hit) => {
    if (hit.length) useSharedHits.setState((s) => ({ ids: { ...s.ids, ...Object.fromEntries(hit.map((id) => [id, true as const])) } }));
  }).catch(() => {});
}

function EpisodeCard({ ep, wide }: { ep: Episode; wide?: boolean }) {
  const openEpisode = useStore((s) => s.openEpisode);
  const zh = useZh(ep.title);
  const pct = ep.duration && ep.progress > 5 ? Math.min(100, (ep.progress / ep.duration) * 100) : 0;
  const shared = useSharedHits((s) => !!s.ids[ep.id]);
  const left = ep.duration && pct > 0 ? Math.max(1, Math.round((ep.duration - ep.progress) / 60)) : 0;
  const play = (e: React.MouseEvent) => { e.stopPropagation(); playAll([ep]); };
  const playButton = <button type="button" className="card-play" title={t("播放")} aria-label={t("播放")} onClick={play}><Play size={16} fill="currentColor" /></button>;
  return (
    <div className={`ep-card ${wide ? "wide" : ""}`} role="button" tabIndex={0} onClick={() => openEpisode(ep)} onKeyDown={(e) => e.key === "Enter" && openEpisode(ep)}>
      <div className={`ep-thumb ${ep.videoId ? "video" : "square"}`}>
        {ep.cover && !ep.videoId && <img className="thumb-bg" src={ep.cover} alt="" aria-hidden loading="lazy" />}
        {ep.cover ? <img className="thumb-img" src={ep.cover} alt="" loading="lazy" /> : <div className="cover-fallback" />}
        {pct > 0 && <span className="thumb-bar"><span style={{ width: `${pct}%` }} /></span>}
        {(ownSubs(ep) || shared) && <span className="thumb-subs">{t("有字幕")}</span>}
        {!wide && playButton}
      </div>
      <p className="ep-kicker">{ep.showId !== "single" && <ShowName title={ep.showTitle} />}<span>{left ? t("剩 {n} 分钟", { n: left }) : date(ep.published)}</span></p>
      <p className="card-title">{zh ?? ep.title}</p>
      {wide && playButton}
    </div>
  );
}

/** One recommended show in the side column. */
function RecRow({ r, onAdd, adding, done }: { r: Recommendation; onAdd: () => void; adding: boolean; done: boolean }) {
  const go = useStore((s) => s.go);
  return (
    <div className="rec-row" role="button" tabIndex={0} onClick={() => go({ kind: "channel", input: r.pick.input })} onKeyDown={(e) => e.key === "Enter" && go({ kind: "channel", input: r.pick.input })}>
      <img src={r.pick.cover} alt="" loading="lazy" />
      <div className="rec-text">
        <p className="rec-name clamp1">{pickName(r.pick)}</p>
        <p className="muted small clamp1">{r.because ? t("因为你在听「{name}」", { name: showName(r.because) }) : t(r.pick.intro)}</p>
      </div>
      {done ? <span className="tile-done"><Check size={14} /></span>
        : <button className="icon-btn sm rec-add" title={t("订阅")} aria-label={t("订阅")} disabled={adding} onClick={(e) => { e.stopPropagation(); onAdd(); }}>{adding ? <Loader2 size={14} className="spin" /> : <Plus size={16} />}</button>}
    </div>
  );
}

export function LatestView() {
  const { shows, set, go, reloadShows, notify } = useStore(useShallow((s) => ({ shows: s.shows, set: s.set, go: s.go, reloadShows: s.reloadShows, notify: s.notify })));
  const favorites = useLibrary((s) => s.favorites);
  const savedIds = useOffline((s) => Object.keys(s.saved).join());
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [recent, setRecent] = useState<Episode[]>([]);
  const [favEps, setFavEps] = useState<Episode[]>([]);
  const [dlEps, setDlEps] = useState<Episode[]>([]);
  const [all, setAll] = useState(false);
  const [limit, setLimit] = useState(40);
  const [adding, setAdding] = useState<string | null>(null);
  useEffect(() => {
    api.listEpisodes(undefined, 200).then(setEps);
    api.recentEpisodes().then(setRecent);
  }, [shows]);
  useEffect(() => { void Promise.all(favorites.slice(0, 30).map((f) => api.getEpisode(f.id).catch(() => null))).then((r) => setFavEps(r.filter((x): x is Episode => !!x))); }, [favorites]);
  useEffect(() => { const ids = savedIds ? savedIds.split(",") : []; void Promise.all(ids.slice(0, 30).map((id) => api.getEpisode(id).catch(() => null))).then((r) => setDlEps(r.filter((x): x is Episode => !!x))); }, [savedIds]);
  const unfinished = (e: Episode) => e.progress > 5 && (!e.duration || e.progress < e.duration * 0.97);
  const hero = recent.find(unfinished) ?? null;
  // Up next: other unfinished episodes, then saved ones not started yet.
  const upNext = [...recent.filter((e) => unfinished(e) && e.id !== hero?.id), ...favEps.filter((e) => !unfinished(e) && !(e.duration && e.progress >= e.duration * 0.97))]
    .filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i).slice(0, 12);
  // Latest first, but in the top grid episodes that open with subtitles come before ones that need transcribing.
  const unheard = (eps ?? []).filter((e) => !(e.duration && e.progress >= e.duration * 0.97));
  const shared = useSharedHits((s) => s.ids);
  useEffect(() => { checkShared(unheard.slice(0, 18)); }, [eps]);
  const fresh = [...unheard.slice(0, 18).filter((e) => hasSubs(e, shared)), ...unheard.slice(0, 18).filter((e) => !hasSubs(e, shared)), ...unheard.slice(18)];
  const recs = useMemo(() => recommend({ shows, recent, favorites: favEps, downloads: dlEps }, 6), [shows, recent, favEps, dlEps]);
  const subscribe = async (input: string, name: string) => {
    setAdding(input);
    try { const r = await api.addSubscription(input); await reloadShows(); if (r.show) notify(t("已订阅「{name}」", { name })); }
    catch (err) { notify(errorText(err)); } finally { setAdding(null); }
  };
  const welcome = useStore((s) => s.welcome);
  const settingUp = useStore((s) => s.settingUp);
  return (
    <div className="page home">
      <h1 className="page-title">{t("首页")}</h1>
      {welcome && <WelcomeCard />}
      {hero && <ContinueHero ep={hero} />}
      {(upNext.length > 0 || hero || favorites.length > 0) && (
        <section>
          <div className="module-head">
            <h2 className="module-title">{t("接下来听")}</h2>
            <button className="link-btn" onClick={() => go({ kind: "recent" })}>{favorites.length ? t("全部 · 收藏 {n}", { n: favorites.length }) : t("全部")} <ChevronRight size={13} /></button>
          </div>
          {upNext.length > 0 && <div className="card-strip">{upNext.map((e) => <EpisodeCard key={e.id} ep={e} />)}</div>}
        </section>
      )}
      <div className="home-grid">
        <section className="home-main">
          <div className="module-head">
            <h2 className="module-title">{t("最新单集")}</h2>
            {fresh.length > 9 && <button className="link-btn" onClick={() => setAll(!all)}>{all ? t("收起") : t("查看全部")}</button>}
          </div>
          {!shows.length && settingUp ? <SkeletonFeed /> : !shows.length ? <EmptyState art={<HeadphonesArt />} title={t("还没有订阅节目")}><button className="btn primary" onClick={() => go({ kind: "discover" })}>{t("去发现节目")}</button></EmptyState>
            : eps == null ? <SkeletonFeed />
            : all ? <>
                <EpisodeList episodes={eps.slice(0, limit)} showShow />
                {eps.length > limit && <div className="center"><button className="btn" onClick={() => setLimit(limit + 40)}>{t("加载更多")}</button></div>}
              </>
            : <div className="card-grid">{fresh.slice(0, 9).map((e) => <EpisodeCard key={e.id} ep={e} wide />)}</div>}
        </section>
        <aside className="home-side">
          {recs.length > 0 && (
            <section>
              <div className="module-head">
                <h2 className="module-title">{t("为你推荐")}</h2>
                <button className="link-btn" onClick={() => go({ kind: "discover" })}>{t("更多")}</button>
              </div>
              <div className="rec-list">{recs.map((r) => <RecRow key={r.pick.id} r={r} adding={adding === r.pick.input} done={isSubscribed(r.pick, shows)} onAdd={() => void subscribe(r.pick.input, pickName(r.pick))} />)}</div>
            </section>
          )}
          <section>
            <div className="module-head">
              <h2 className="module-title">{t("订阅节目")}</h2>
              <button className="link-btn" onClick={() => set({ addOpen: true, addTab: "search" })}><Plus size={13} /> {t("添加")}</button>
            </div>
            <div className="show-grid">{shows.slice(0, 16).map((s) => <ShowTile key={s.id} show={s} />)}</div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function RecentView({ savedFirst = false }: { savedFirst?: boolean }) {
  const [tab, setTab] = useState<"recent" | "saved">(() => (savedFirst || (useLibrary.getState().favorites.length && !useStore.getState().current) ? "saved" : "recent"));
  const favorites = useLibrary((s) => s.favorites);
  const queued = useLibrary((s) => s.queue.length);
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [saved, setSaved] = useState<Episode[] | null>(null);
  useEffect(() => { api.recentEpisodes().then(setEps); }, []);
  useEffect(() => {
    let live = true;
    void Promise.all(favorites.map((f) => api.getEpisode(f.id).catch(() => null))).then((r) => live && setSaved(r.filter((x): x is Episode => !!x)));
    return () => { live = false; };
  }, [favorites]);
  // "Play all" skips what's already finished.
  const playable = (saved ?? []).filter((e) => !e.duration || e.progress < e.duration * 0.97);
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("接下来听")}</h1>
        <div className="seg-control" role="tablist">
          <button role="tab" aria-selected={tab === "recent"} className={tab === "recent" ? "on" : ""} onClick={() => setTab("recent")}>{t("最近播放")}</button>
          <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>{t("收藏")}{favorites.length ? ` ${favorites.length}` : ""}</button>
        </div>
        <span className="spacer" />
        {tab === "saved" && playable.length > 0 && (
          <button className="btn primary sm" onClick={() => playAll(playable)}><Play size={13} fill="currentColor" /> {t("全部播放（{n} 集）", { n: playable.length })}</button>
        )}
        {tab === "saved" && queued > 0 && <button className="btn ghost sm" onClick={clearQueue}>{t("清空待播（{n}）", { n: queued })}</button>}
      </div>
      {tab === "recent"
        ? <EpisodeList episodes={eps} showShow grouped={false} />
        : saved && !saved.length
          ? <EmptyState art={<BookmarkArt />} title={t("还没有收藏")} note={t("在单集的「更多」里收藏。")} />
          : <EpisodeList episodes={saved} showShow grouped={false} />}
    </div>
  );
}

export function DownloadsView() {
  const saved = useOffline((s) => s.saved);
  const active = useOffline((s) => s.active);
  const ids = [...new Set([...Object.keys(active), ...Object.values(saved).sort((a, b) => b.savedAt - a.savedAt).map((x) => x.episodeId)])];
  const [eps, setEps] = useState<Episode[] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(ids.map((id) => api.getEpisode(id).catch(() => null))).then((r) => live && setEps(r.filter((x): x is Episode => !!x)));
    return () => { live = false; };
  }, [ids.join()]);
  const total = Object.values(saved).reduce((n, x) => n + x.bytes, 0);
  const n = Object.keys(saved).length;
  const clear = async () => {
    if (!(await ask({ title: t("删除全部已下载的音频？"), message: t("字幕、精读和收听进度都会保留。"), ok: t("全部删除"), danger: true }))) return;
    await clearDownloads();
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("已下载")}</h1>
        <div className="row-actions">
          {n > 0 && <button className="btn ghost sm" onClick={clear}><Trash2 size={13} /> {t("全部删除")}</button>}
        </div>
      </div>
      <p className="muted page-sub">{n ? t("{n} 集 · 占用 {size} · 没有网络也能听", { n, size: bytes(total) }) : t("在单集页点下载按钮，就能离线收听")}</p>
      {!ids.length ? <EmptyState art={<TrayArt />} title={t("还没有下载")} note={t("在单集的「更多」里下载音频。")} /> : <EpisodeList episodes={eps} showShow grouped={false} />}
    </div>
  );
}

// ---- show page ----------------------------------------------------------------------------------

type Filter = "all" | "unplayed" | "subs";

export function ShowView({ id }: { id: string }) {
  const { shows, reloadShows, notify, go } = useStore(useShallow((s) => ({ shows: s.shows, reloadShows: s.reloadShows, notify: s.notify, go: s.go })));
  const ytPromo = useStore((s) => s.settings.youtubePromo);
  const show = shows.find((s) => s.id === id);
  const [eps, setEps] = useState<Episode[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);
  const [showOrig, setShowOrig] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const names = useShowName(show?.title ?? "");
  const desc = (show?.description ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 1500);
  const descZh = useZh(desc);
  useEffect(() => { setEps(null); api.listEpisodes(id).then(setEps); }, [id]);
  // Search inside this show: titles (with their Chinese), show notes and subtitles, done by the backend.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ShowHit[] | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => { setQuery(""); setHits(null); }, [id]);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    let active = true;
    const timer = window.setTimeout(() => void api.searchShow(id, q).then((rows) => { if (active) setHits(rows); }).catch(() => { if (active) setHits([]); }), 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") { e.preventDefault(); setSearchOpen(true); requestAnimationFrame(() => { searchBox.current?.focus(); searchBox.current?.select(); }); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const byFilter = useMemo(() => eps?.filter((e) => filter === "all" || (filter === "unplayed" ? e.progress < 5 : e.hasTranscript || e.transcriptUrl)) ?? null, [eps, filter]);
  const { month, setMonth, filtered: shown } = useMonthFilter(byFilter);
  // "Play all" follows the list as filtered, newest first, skipping finished and unplayable episodes.
  const playable = (shown ?? []).filter((e) => (e.audioUrl || e.videoId) && !(e.duration && e.progress >= e.duration * 0.97));
  if (!show) return <><MobileBack /><div className="page" /></>;
  const refresh = async () => {
    setBusy(true);
    try { await api.refreshShow(id); setEps(await api.listEpisodes(id)); await reloadShows(); } catch (e) { notify(errorText(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setMenu(false);
    if (!(await ask({ title: t("取消订阅「{name}」？", { name: show.title }), message: t("已生成的字幕、精读和收听进度会保留。"), ok: t("取消订阅"), danger: true }))) return;
    await api.removeShow(id); await reloadShows(); go({ kind: "latest" });
  };
  const descText = showOrig || !descZh ? desc : descZh;
  const links = showLinks(show.feedUrl);
  const activeFilter = filter !== "all" || !!month;
  return (<>
    <MobileBack trailing={<button onClick={() => setMenu(true)} aria-haspopup="dialog" aria-label={t("更多")}><MoreHorizontal /></button>} />
    <div className="page show-page">
      <div className="show-head">
        {show.cover ? <img src={show.cover} alt="" /> : <div className="cover-fallback" />}
        <div className="show-info">
          <p className="meta-line">{show.kind === "youtube" ? t("YouTube 频道") : show.kind === "xiaoyuzhou" ? t("小宇宙") : t("播客")}{show.author && show.author !== show.title ? ` · ${show.author}` : ""}</p>
          <h1 className="show-title-h">{names.zh ?? names.orig}</h1>
          {(names.zh || names.orig !== show.title) && <span className="orig-line clamp1">{show.title}</span>}
          {desc && <button className="show-desc desc-disclosure" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className={expanded ? undefined : "clamp2"}>{descText}</span></button>}
          {expanded && descZh && <button className="link-btn" onClick={() => setShowOrig(!showOrig)}>{showOrig ? t("看中文") : t("查看原文")}</button>}
            {menu && <MobileSheet title={names.zh ?? names.orig} onClose={() => setMenu(false)}>
              <button disabled={busy} onClick={() => { setMenu(false); void refresh(); }}><RefreshCw />{t("检查更新")}</button>
              {ytPromo && links.youtube && <YtButton channel={links.youtube} small />}
              {ytPromo && links.youtube && <AlsoOn feedUrl={show.feedUrl} />}
              <button className="destructive" onClick={() => void remove()}><Trash2 />{t("取消订阅")}</button>
            </MobileSheet>}
        </div>
      </div>
      {show.kind !== "qiaomu" && deepPickFor(show.title) && (
        <div className="deep-hint" role="button" tabIndex={0} onClick={() => go({ kind: "channel", input: deepPickFor(show.title)!.input })}>
          <BookOpen size={16} />
          <div><p className="deep-hint-t">{t("这档节目有乔木精读版")}</p><p className="muted small">{t("中文标题、每期精读长文和原文文稿，点击查看")}</p></div>
          <ChevronRight size={16} className="muted" />
        </div>
      )}
      <div className="episode-list-tools">
        <h2>{hits ? t("搜索结果") : t("全部单集")}</h2>
        {!query && playable.length > 0 && <button className="queue-play" onClick={() => playAll(playable)}><Play size={16} fill="currentColor" />{t("播放全部")}</button>}
        <button className="icon-btn" aria-label={t("搜索本节目")} aria-expanded={searchOpen} onClick={() => {
          if (searchOpen) { setQuery(""); setSearchOpen(false); } else { setSearchOpen(true); requestAnimationFrame(() => searchBox.current?.focus()); }
        }}><Search /></button>
        {!query && <button className={`icon-btn ${activeFilter ? "filter-active" : ""}`} aria-label={t("筛选单集")} aria-haspopup="dialog" onClick={() => setFilterOpen(true)}><ListFilter /></button>}
      </div>
      {searchOpen && <div className="show-query"><input type="search" ref={searchBox} autoFocus enterKeyHint="search" value={query} placeholder={t("搜索本节目的单集、简介和字幕")} onChange={(e) => setQuery(e.target.value)} /></div>}
      {activeFilter && !query && <button className="filter-summary" onClick={() => { setFilter("all"); setMonth(null); }}>{[filter === "unplayed" ? t("未听") : filter === "subs" ? t("有字幕") : "", month].filter(Boolean).join(" · ")}<X size={16} /></button>}
      {filterOpen && <MobileSheet title={t("筛选单集")} doneLabel={t("完成")} onClose={() => setFilterOpen(false)}>
        {([["all", t("全部")], ["unplayed", t("未听")], ["subs", t("有字幕")]] as [Filter, string][]).map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); selectionFeedback(); }}>{label}{filter === key && <Check className="row-check" />}</button>)}
        <MonthFilter episodes={eps} month={month} onChange={setMonth} />
      </MobileSheet>}
      {hits ? (
        hits.length ? (
          <>
            <p className="muted small search-count">{t("找到 {n} 集", { n: hits.length })}{hits.some((h) => h.field === "transcript") ? ` · ${t("点字幕匹配会从那一句开始播放")}` : ""}</p>
            <div className="ep-feed">{hits.map((h) => <EpisodeRow key={h.episode.id} ep={h.episode} showShow={false} hit={h} query={query.trim()} />)}</div>
          </>
        ) : <EmptyState art={<FlatLineArt />} title={t("没有找到「{q}」", { q: query.trim() })} />
      ) : (
        <>
          <EpisodeList episodes={shown} showShow={false} />
        </>
      )}
    </div></>
  );
}

// ---- picks: onboarding and discover --------------------------------------------------------------

function PickCard({ p, onOpen, action }: { p: Pick; onOpen: () => void; action: React.ReactNode }) {
  return <div className="discover-row">
    <button className="pick-open" onClick={onOpen}>
      <img src={p.cover} alt="" loading="lazy" /><span><strong>{pickName(p)}</strong><small>{t(p.intro) || pickSub(p)}</small></span>
    </button>{action}
  </div>;
}

function TopicChips({ topics, setTopics }: { topics: Topic[]; setTopics: (t: Topic[]) => void }) {
  const [open, setOpen] = useState(false);
  return <><button className="topic-filter" onClick={() => setOpen(true)} aria-haspopup="dialog">
    <ListFilter size={20} />{topics.length ? topics.map((x) => t(x)).join(" · ") : t("全部话题")}<ChevronDown size={16} />
  </button>{open && <MobileSheet title={t("筛选话题")} doneLabel={t("完成")} onClose={() => setOpen(false)}>
    <button aria-pressed={!topics.length} onClick={() => setTopics([])}>{t("全部")}{!topics.length && <Check className="row-check" />}</button>
    {TOPICS.map((x) => <button key={x} aria-pressed={topics.includes(x)} onClick={() => {
      selectionFeedback(); setTopics(topics.includes(x) ? topics.filter((y) => y !== x) : [...topics, x]);
    }}>{t(x)}{topics.includes(x) && <Check className="row-check" />}</button>)}
  </MobileSheet>}</>;
}

const visible = (topics: Topic[]) => PICKS.filter((p) => !topics.length || p.topics.some((x) => topics.includes(x)));

/** First run: no picking screen. A few curated shows are subscribed in the background and the home page fills in
 *  as they arrive; a welcome card says what happened and how to bring in your own. */
const STARTER = ["nexttoken", "no-priors", "lex", "zhang", "latetalk"];
export async function firstRunSetup() {
  const { settings, shows, saveSettings, reloadShows } = useStore.getState();
  if (settings.onboarded || shows.length) return;
  await saveSettings({ onboarded: true });
  useStore.setState({ welcome: true, settingUp: true });
  const queue = PICKS.filter((p) => STARTER.includes(p.id));
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try { await api.addSubscription(p.input); await reloadShows(); } catch { /* the rest still come */ }
    }
  }));
  useStore.setState({ settingUp: false });
}

function WelcomeCard() {
  const { set, shows, settingUp } = useStore(useShallow((s) => ({ set: s.set, shows: s.shows, settingUp: s.settingUp })));
  return (
    <div className="welcome-card">
      <div className="welcome-text">
        <p className="welcome-title">{t("欢迎使用 SubCast")}</p>
        <p className="muted small">{settingUp ? t("正在为你准备几档精选节目…") : t("已经为你订阅了 {n} 档精选节目，点任意一集就有双语字幕。", { n: shows.length })}{" "}{t("想听自己的？")}</p>
      </div>
      <div className="row-actions">
        <button className="btn sm primary" onClick={() => set({ addOpen: true, addTab: "import" })}><Plus size={18} /> {t("导入订阅")}</button>
        <button className="btn sm" onClick={() => useStore.getState().go({ kind: "discover" })}>{t("发现更多节目")}</button>
      </div>
      <button className="icon-btn sm welcome-close" aria-label={t("关闭")} onClick={() => set({ welcome: false })}><X size={14} /></button>
    </div>
  );
}

export function DiscoverView() {
  const { shows, reloadShows, notify, go } = useStore(useShallow((s) => ({ shows: s.shows, reloadShows: s.reloadShows, notify: s.notify, go: s.go })));
  const [adding, setAdding] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const promo = usePromo();
  const bannerHidden = useStore((s) => s.settings.homeBannerHidden);
  const showBanner = promo && !bannerHidden;
  const subscribed = (p: Pick) => isSubscribed(p, shows);
  const home = PICKS.find((p) => p.input === HOME_SHOW_FEED);
  const add = async (input: string, title: string) => {
    setAdding(input);
    try {
      const r = await api.addSubscription(input);
      await reloadShows();
      if (r.show) { notify(t("已订阅「{name}」", { name: title })); go({ kind: "show", id: r.show.id }); }
    } catch (err) { notify(errorText(err)); } finally { setAdding(null); }
  };
  const subBtn = (input: string, title: string, done: boolean) => done
    ? <span className="tile-done" title={t("已订阅")}><Check size={16} /></span>
    : <button className="tile-add" title={t("订阅")} onClick={(e) => { e.stopPropagation(); void add(input, title); }} disabled={adding != null}>{adding === input ? <Loader2 size={16} className="spin" /> : <Plus size={18} />}</button>;
  return (
    <div className="page discover-page">
      <h1 className="page-title">{t("发现")}</h1>

      {showBanner && home && !topics.length && <HomeShowBanner onHide={() => { void useStore.getState().saveSettings({ homeBannerHidden: true }); notify(t("好的，不再显示。可以在设置 › 通用里重新打开")); }} subscribed={subscribed(home)} busy={adding === home.input} onSubscribe={() => void add(home.input, pickName(home))} onOpen={() => go({ kind: "channel", input: home.input })} />}
      <TopicChips topics={topics} setTopics={setTopics} />
      <div className="discover-list">
        {visible(topics).filter((p) => !(showBanner && p === home && !topics.length)).map((p) => <PickCard key={p.id} p={p} onOpen={() => go({ kind: "channel", input: p.input })} action={subBtn(p.input, pickName(p), subscribed(p))} />)}
      </div>
    </div>
  );
}

/** A channel before subscribing: what it is, its latest episodes (playable), and one clear subscribe button. */
export function ChannelView({ input }: { input: string }) {
  const { shows, reloadShows, notify, go } = useStore(useShallow((s) => ({ shows: s.shows, reloadShows: s.reloadShows, notify: s.notify, go: s.go })));
  const pick = PICKS.find((p) => sameFeed(p.input, input));
  const sub = shows.find((s) => sameFeed(s.feedUrl, input) || (pick?.deep && sameFeed(s.feedUrl, pick.input)));
  const [data, setData] = useState<{ show: Show; episodes: Episode[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useShowName(data?.show.title ?? pick?.title ?? "");
  const { month, setMonth, filtered: shownCh } = useMonthFilter(data?.episodes ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    // Stale-while-revalidate: show the saved copy at once, refresh from the network if it is older than 30 minutes.
    api.cachedShow(input).then((cached) => {
      if (!live) return;
      if (cached) setData(cached);
      if (cached && Date.now() - cached.fetchedAt < 30 * 60_000) return;
      setRefreshing(true);
      api.previewShow(input).then((d) => live && setData(d)).catch((e) => live && !cached && setError(errorText(e))).finally(() => live && setRefreshing(false));
    });
    return () => { live = false; };
  }, [input, attempt]);
  const subscribe = async () => {
    setBusy(true);
    try {
      const r = await api.addSubscription(input);
      await reloadShows();
      if (r.show) { notify(t("已订阅「{name}」", { name: pick ? pickName(pick) : r.show.title })); go({ kind: "show", id: r.show.id }); }
    } catch (e) { notify(errorText(e)); } finally { setBusy(false); }
  };
  const cover = pick?.cover ?? data?.show.cover;

  const desc = pick ? t(pick.intro) : (data?.show.description ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 300);
  return (
    <div className="page show-page">
      <div className="show-head">
        {cover ? <img src={cover} alt="" /> : <div className="cover-fallback" />}
        <div className="show-info">
          <p className="meta-line">{pick?.deep ? t("乔木精读 · 中文标题、精读长文与原文文稿") : pick?.by ?? data?.show.author ?? t("频道")}</p>
          <h1 className="show-title-h">{pick ? pickName(pick) : names.zh ?? names.orig}</h1>
          {(pick ? isChineseUi() && pick.zh !== pick.title : names.zh) && <span className="orig-line clamp1">{pick?.title ?? data?.show.title}</span>}
          {desc && <p className="show-desc clamp3">{desc}</p>}
          <div className="row-actions">
            {sub
              ? <button className="btn sm" onClick={() => go({ kind: "show", id: sub.id })}><Check size={13} /> {t("已订阅 · 查看")}</button>
              : <button className="btn primary" onClick={subscribe} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={15} />} {t("订阅")}</button>}
            {data && <span className="muted small">{t("{n} 期节目 · 不订阅也可以直接收听", { n: data.episodes.length })}{refreshing ? ` · ${t("正在更新…")}` : ""}</span>}
          </div>
        </div>
      </div>
      {error ? <div className="panel-empty"><p className="error-text">{error}</p><button className="btn sm" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={13} /> {t("重试")}</button></div> : <>
        <MonthFilter episodes={data?.episodes ?? null} month={month} onChange={setMonth} />
        <EpisodeList episodes={shownCh} showShow={false} />
      </>}
    </div>
  );
}

export function showIcon(show: Show) {
  return show.cover ? <img src={show.cover} alt="" loading="lazy" /> : <div className="cover-fallback">{show.title.slice(0, 1)}</div>;
}
