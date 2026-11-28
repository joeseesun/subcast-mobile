import { MobileBack } from "./MobileBack";
import { MobileSheet, presentNativeChoices } from "./MobileSheet";
import { selectionFeedback } from "../lib/feedback";
import { usePullRefresh } from "../lib/usePullRefresh";
import { playSoon, seekEpisode } from "./Players";
import { ask } from "../lib/confirm";
import { create } from "zustand";
import { flushSync } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, BookOpen, Check, ChevronDown, ChevronRight, Loader2, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { bytes, clearDownloads, useOffline } from "../lib/offline";
import { api, errorText, type Episode, type Show, type ShowHit } from "../lib/api";
import { date, duration, monthLabel } from "../lib/format";
import { PICKS, TOPICS, deepPickFor, isSubscribed, pickName, pickSub, sameFeed, showArt, showName, unboxYoutube, ytFallback, type Pick, type Topic } from "../lib/picks";
import { isChineseUi, t } from "../lib/i18n";
import { useShowName, useZh } from "../lib/zh";
import { useStore, type ShowFinder } from "../store";
import { SkeletonFeed } from "./Skeleton";
import { BookmarkArt, EmptyState, QuietArt, SearchArt, TrayArt } from "./Illustrations";
import { availableEpisodeMonths, episodeMonth, episodeMonthLabel, MonthFilter, useMonthFilter } from "./MonthFilter";
import { clearQueue, playAll, useLibrary } from "../lib/library";
import { recommend, type Recommendation } from "../lib/recommend";
import { BrandGlyph } from "./BrandGlyph";
import { PageHeading } from "./PageHeading";
import grooves from "../assets/editorial/continue-grooves.webp";
import listeningShell from "../assets/editorial/listening-shell.webp";

// ---- episode rows -------------------------------------------------------------------------------

function ShowName({ title }: { title?: string }) {
  if (!title) return null;
  const { zh, orig } = useShowName(title);
  return <span className="show-name">{zh ?? orig}</span>;
}

/** The query's words marked in a piece of text. */
function Marked({ text, query }: { text: string; query: string }) {
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.join("|")})`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** Opens an episode and plays it from a subtitle match. */
function openAt(ep: Episode, time: number) {
  useStore.getState().openEpisode(ep);
  seekEpisode(ep, Math.max(0, time - 1));
}

/** A round play button whose ring fills as the episode is heard; it pauses the episode that is playing. */
export function PlayRing({ ep }: { ep: Episode }) {
  const { isCurrent, playing, loading, player } = useStore(useShallow((s) => ({
    isCurrent: s.current?.id === ep.id, playing: s.current?.id === ep.id && s.playing,
    loading: s.current?.id === ep.id && !!s.loadingSince, player: s.player,
  })));
  const live = useStore((s) => (s.current?.id === ep.id && s.length > 0 ? s.time / s.length : null));
  const done = live ?? (ep.duration && ep.progress > 5 ? Math.min(1, ep.progress / ep.duration) : 0);
  const r = 15.5, c = 2 * Math.PI * r;
  const busy = playing || loading;
  const press = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectionFeedback();
    if (isCurrent && player) player.toggle();
    else playAll([ep]);
  };
  return <button type="button" className={`play-ring ${busy ? "on" : ""}`} aria-label={busy ? t("暂停") : t("播放")} onClick={press}>
    <svg className="ring" viewBox="0 0 36 36" aria-hidden>
      <circle className="track" cx="18" cy="18" r={r} />
      {done > 0 && <circle className="fill" cx="18" cy="18" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - done)} />}
    </svg>
    {loading ? <Loader2 size={15} className="spin" /> : playing ? <BrandGlyph name="pause" size={15} /> : <BrandGlyph name="play" size={15} />}
  </button>;
}

/** One episode, the way a podcast app lists it: artwork, a two-line title, a line of what it is about, then
 *  length and date, with a play button at the end of the row. */
function EpisodeRow({ ep, showShow, hit, query }: { ep: Episode; showShow: boolean; hit?: ShowHit; query?: string }) {
  const openEpisode = useStore((s) => s.openEpisode);
  const open = () => (hit?.time != null ? openAt(ep, hit.time) : openEpisode(ep));
  const isCurrent = useStore((s) => s.current?.id === ep.id);
  const zh = useZh(ep.title);
  const pct = ep.duration && ep.progress > 5 ? Math.min(100, (ep.progress / ep.duration) * 100) : 0;
  const saved = useOffline((s) => s.saved[ep.id]);
  const loading = useOffline((s) => s.active[ep.id]);
  const shared = useSharedHits((s) => !!s.ids[ep.id]);
  const translated = !!zh && zh !== ep.title;
  const left = pct > 0 && pct < 97 ? Math.max(1, Math.round(((ep.duration ?? 0) - ep.progress) / 60)) : 0;
  return (
    <div className={`feed-row ${isCurrent ? "playing" : ""} ${pct >= 97 ? "played" : ""}`} role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
      <div className="feed-art">
        {ep.cover ? <img src={unboxYoutube(ep.cover)} alt="" loading="lazy" onError={(e) => {
          const i = e.currentTarget;
          if (ep.videoId && !i.dataset.f) { i.dataset.f = "1"; i.src = `https://i.ytimg.com/vi/${ep.videoId}/mqdefault.jpg`; } else i.style.visibility = "hidden";
        }} /> : <div className="cover-fallback" />}
        {ep.videoId && <span className="feed-art-badge"><BrandGlyph name="film" size={11} /></span>}
      </div>
      <div className="feed-body">
        {showShow && ep.showId !== "single" && ep.showTitle && <p className="feed-show"><ShowName title={ep.showTitle} /></p>}
        <p className="feed-title">{query ? <Marked text={zh ?? ep.title} query={query} /> : zh ?? ep.title}</p>
        {translated && !hit && <p className="feed-desc one">{query ? <Marked text={ep.title} query={query} /> : ep.title}</p>}
        {hit && hit.field !== "title" && (
          <p className="ep-hit">
            <span className="ep-hit-where">{hit.field === "transcript" ? <><Play size={10} /> {t("字幕")} {clockShort(hit.time ?? 0)}</> : t("简介")}</span>
            <span className="ep-hit-text"><Marked text={hit.snippet} query={query ?? ""} /></span>
          </p>
        )}
        <p className="feed-meta">
          {left ? <span className="feed-left">{t("剩 {n} 分钟", { n: left })}</span> : pct >= 97 ? <span>{t("已听完")}</span> : ep.duration ? <span>{duration(ep.duration)}</span> : null}
          {ep.published ? <span>{date(ep.published)}</span> : null}
          {ep.deep && <span className="feed-flag deep">{t("精读")}</span>}
          {!ep.deep && (ownSubs(ep) || shared) && <span className="feed-flag">{t("字幕")}</span>}
          {saved && <span className="feed-flag"><ArrowDownToLine size={10} />{saved.cached ? t("已缓存") : t("已下载")}</span>}
          {loading !== undefined && <span className="feed-flag">{loading == null ? t("缓存中") : t("缓存中 {pct}%", { pct: Math.round(loading * 100) })}</span>}
        </p>
      </div>
      {(ep.audioUrl || ep.videoId || saved) && <PlayRing ep={ep} />}
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
  if (!episodes.length) return <EmptyState art={<QuietArt />} title={t("暂无单集")} />;
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

function PullIndicator({ pull, armed, refreshing }: { pull: number; armed: boolean; refreshing: boolean }) {
  if (!refreshing && pull <= 6) return null;
  const height = refreshing ? 42 : Math.min(54, Math.round(pull * 0.72));
  return (
    <div className={`pull-indicator ${refreshing ? "busy" : ""} ${armed ? "armed" : ""}`} style={{ height }} role="status" aria-live="polite">
      <span className="pull-pill">
        {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} style={{ transform: `rotate(${Math.min(180, pull * 2.8)}deg)` }} />}
        <span>{refreshing ? t("正在更新…") : armed ? t("松手刷新") : t("下拉刷新")}</span>
      </span>
    </div>
  );
}

/** 继续收听: tapping anywhere on the card resumes playing (the page opens with it); 最新单集 just opens it. */
function ContinueHero({ ep, continuing }: { ep: Episode; continuing: boolean }) {
  const openEpisode = useStore((s) => s.openEpisode);
  const recentTime = useStore((s) => s.current?.id === ep.id ? Math.floor(s.time / 5) * 5 : null);
  const zh = useZh(ep.title);
  const time = recentTime ?? ep.progress;
  const progress = ep.duration ? Math.max(0, Math.min(1, time / ep.duration)) : null;
  const left = continuing && ep.duration ? Math.max(1, Math.ceil((ep.duration - time) / 60)) : null;
  const action = continuing ? t("继续播放") : t("播放这一集");
  const label = continuing ? t("继续收听") : t("最新单集");
  return <section className="resume-card" aria-label={label} style={{ "--record-art": `url("${grooves}")`, ...(ep.cover ? { "--cover": `url("${ep.cover}")` } : {}) } as React.CSSProperties}>
    <div className="resume-kicker"><BrandGlyph name="sound" size={17} />{label}</div>
    <button className="resume-detail" onClick={() => { openEpisode(ep); if (continuing) playSoon(ep.id); }}>
      <span className="resume-meta">
        {ep.showId !== "single" && <ShowName title={ep.showTitle} />}
        <span className="resume-title">{zh ?? ep.title}</span>
      </span>
      {ep.cover && <img className="resume-cover" src={ep.cover} alt="" />}
    </button>
    <div className="resume-action">
      <button className="resume-play" aria-label={action} onClick={() => { openEpisode(ep); playSoon(ep.id); }}><BrandGlyph name="play" size={25} /></button>
      <div className="resume-play-meta">
        {continuing && progress != null && <div className="resume-progress" aria-hidden><span style={{ width: `${progress * 100}%` }} /></div>}
        <span>{left ? t("还剩 {left} 分钟", { left }) : action}</span>
      </div>
    </div>
  </section>;
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

/** One recommended show on Home: matches Discover's touch-friendly row design. */
function RecRow({ r, onAdd, adding, done }: { r: Recommendation; onAdd: () => void; adding: boolean; done: boolean }) {
  const go = useStore((s) => s.go);
  return (
    <div className="discover-row home-rec-row">
      <button className="pick-open" onClick={() => go({ kind: "channel", input: r.pick.input })}>
        <img src={r.pick.cover} alt="" loading="lazy" />
        <span>
          <strong>{pickName(r.pick)}</strong>
          <small>{r.because ? t("因为你在听「{name}」", { name: showName(r.because) }) : t(r.pick.intro)}</small>
        </span>
      </button>
      {done ? <span className="tile-done" aria-label={t("已订阅")}><Check size={18} /></span>
        : <button className="tile-add" title={t("订阅")} aria-label={t("订阅")} disabled={adding} onClick={(e) => { e.stopPropagation(); selectionFeedback(); onAdd(); }}>{adding ? <Loader2 size={16} className="spin" /> : <Plus size={18} />}</button>}
    </div>
  );
}

/** The shows you follow, as a row of artwork to swipe through; a dot marks new episodes. */
function SubscribedStrip() {
  const { shows, go } = useStore(useShallow((s) => ({ shows: s.shows, go: s.go })));
  if (!shows.length) return null;
  const ordered = [...shows].sort((a, b) => Number(b.unplayed > 0) - Number(a.unplayed > 0));
  return <section className="sub-strip-wrap">
    <div className="module-head">
      <h2 className="module-title">{t("我的订阅")}</h2>
      <button className="link-btn" onClick={() => useStore.setState({ view: { kind: "library" }, history: [] })}>{t("全部")} <ChevronRight size={13} /></button>
    </div>
    <div className="sub-strip">
      {ordered.slice(0, 20).map((s) => <button key={s.id} className="sub-tile" onClick={() => go({ kind: "show", id: s.id })}
        aria-label={s.unplayed > 0 ? `${showName(s.title)} · ${t("{n} 集新单集", { n: s.unplayed })}` : showName(s.title)}>
        <span className="sub-cover">{showIcon(s)}{s.unplayed > 0 && <i className="sub-dot" aria-hidden />}</span>
        <span className="sub-name"><ShowName title={s.title} /></span>
      </button>)}
    </div>
  </section>;
}

export function LatestView() {
  const { shows, go, reloadShows, notify } = useStore(useShallow((s) => ({ shows: s.shows, go: s.go, reloadShows: s.reloadShows, notify: s.notify })));
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
  const featured = hero ?? fresh[0] ?? null;
  const queued = upNext.slice(0, 2);
  const latest = fresh.filter((episode) => episode.id !== featured?.id && !queued.some(({ id }) => episode.id === id));
  const recs = useMemo(() => recommend({ shows, recent, favorites: favEps, downloads: dlEps }, 6), [shows, recent, favEps, dlEps]);
  const subscribe = async (input: string, name: string) => {
    setAdding(input);
    try { const r = await api.addSubscription(input); await reloadShows(); if (r.show) notify(t("已订阅「{name}」", { name })); }
    catch (err) { notify(errorText(err)); } finally { setAdding(null); }
  };
  const settingUp = useStore((s) => s.settingUp);
  const pageRef = useRef<HTMLDivElement>(null);
  const pullRefresh = usePullRefresh(pageRef, async () => {
    try {
      const r = await api.refreshAll();
      await reloadShows();
      const [nextEps, nextRecent] = await Promise.all([api.listEpisodes(undefined, 200), api.recentEpisodes()]);
      setEps(nextEps); setRecent(nextRecent);
      notify(r.newEpisodes > 0 ? t("订阅有 {n} 期新节目", { n: r.newEpisodes }) : t("已是最新"));
    } catch (e) { notify(errorText(e)); }
  });
  return (
    <div className="page home" ref={pageRef} {...pullRefresh.handlers}>
      <PullIndicator pull={pullRefresh.pull} armed={pullRefresh.armed} refreshing={pullRefresh.refreshing} />
      <PageHeading wordmark>
        <button className="heading-tool" onClick={() => {
          flushSync(() => useStore.setState({ view: { kind: "discover" }, history: [] }));
          document.querySelector<HTMLInputElement>(".top-search input")?.focus();
        }} aria-label={t("搜索节目")}><BrandGlyph name="search" /></button>
      </PageHeading>
      <SubscribedStrip />
      {featured && <ContinueHero ep={featured} continuing={!!hero} />}
      {upNext.length > 0 && (
        <section>
          <div className="module-head">
            <h2 className="module-title">{t("接下来听")}</h2>
            <button className="link-btn" onClick={() => go({ kind: "recent" })}>{t("全部")} <ChevronRight size={13} /></button>
          </div>
          <div className="ep-feed">{queued.map((e) => <EpisodeRow key={e.id} ep={e} showShow />)}</div>
        </section>
      )}
      <div className="home-grid">
        <section className="home-main">
          {(latest.length > 0 || all || eps == null) && <div className="module-head">
            <h2 className="module-title">{t("最新单集")}</h2>
            {(all || latest.length > 9) && <button className="link-btn" onClick={() => setAll(!all)}>{all ? t("收起") : <>{t("全部")} <ChevronRight size={13} /></>}</button>}
          </div>}
          {!shows.length && settingUp ? <SkeletonFeed /> : !shows.length ? <EmptyState art={<img className="listening-shell" src={listeningShell} alt="" />} title={t("还没有订阅节目")}><button className="btn primary" onClick={() => go({ kind: "discover" })}>{t("去发现节目")}</button></EmptyState>
            : eps == null ? <SkeletonFeed />
            : all ? <>
                <EpisodeList episodes={eps.slice(0, limit)} showShow />
                {eps.length > limit && <div className="center"><button className="btn" onClick={() => setLimit(limit + 40)}>{t("加载更多")}</button></div>}
              </>
            : <div className="ep-feed">{latest.slice(0, 9).map((e) => <EpisodeRow key={e.id} ep={e} showShow />)}</div>}
        </section>
        <aside className="home-side">
          {recs.length > 0 && (
            <section>
              <div className="module-head">
                <h2 className="module-title">{t("为你推荐")}</h2>
                <button className="link-btn" onClick={() => useStore.setState({ view: { kind: "discover" }, history: [] })}>{t("全部")} <ChevronRight size={13} /></button>
              </div>
              <div className="rec-list">{recs.map((r) => <RecRow key={r.pick.id} r={r} adding={adding === r.pick.input} done={isSubscribed(r.pick, shows)} onAdd={() => void subscribe(r.pick.input, pickName(r.pick))} />)}</div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

export function RecentView({ savedFirst = false }: { savedFirst?: boolean }) {
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
    <div className="page collection-page">
      <PageHeading title={savedFirst ? t("收藏") : t("最近播放")} />
      {savedFirst && (playable.length > 0 || queued > 0) && <div className="collection-actions">
        {playable.length > 0 && <button className="btn primary" onClick={() => playAll(playable)}>
          <BrandGlyph name="play" size={20} />{t("全部播放（{n} 集）", { n: playable.length })}
        </button>}
        {queued > 0 && <button className="link-btn" onClick={clearQueue}>{t("清空待播（{n}）", { n: queued })}</button>}
      </div>}
      {!savedFirst
        ? eps?.length === 0
          ? <EmptyState art={<QuietArt />} title={t("还没有收听记录")} />
          : <EpisodeList episodes={eps} showShow grouped={false} />
        : saved?.length === 0
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
    if (!(await ask({ title: t("清理全部离线音频？"), message: t("字幕、精读和收听进度都会保留。"), ok: t("全部删除"), danger: true }))) return;
    await clearDownloads();
  };
  return (
    <div className="page collection-page">
      <PageHeading title={t("离线音频")}>
        {n > 0 && <button className="link-btn" onClick={clear}>{t("全部删除")}</button>}
      </PageHeading>
      {n > 0 && <p className="muted page-sub">{t("{n} 集 · 占用 {size} · 没有网络也能听", { n, size: bytes(total) })}</p>}
      {ids.length > 0 && <p className="muted small">{t("新缓存连续 30 天未使用，会在下次启动时清理")}</p>}
      {!ids.length ? <EmptyState art={<TrayArt />} title={t("还没有离线音频")} note={t("单集「更多」里可以缓存音频")} /> : <EpisodeList episodes={eps} showShow grouped={false} />}
    </div>
  );
}

// ---- show page ----------------------------------------------------------------------------------

type Filter = ShowFinder["filter"];
const SHOW_FILTERS = ["all", "unplayed", "subs"] as const;
const showFilterLabel = (value: Filter) => value === "all" ? t("全部") : value === "unplayed" ? t("未听") : t("有字幕");
type ShowSearch = { term: string; hits: ShowHit[] | null };

export function ShowView({ id, finder }: { id: string; finder?: ShowFinder }) {
  const { shows, reloadShows, notify, go } = useStore(useShallow((s) => ({ shows: s.shows, reloadShows: s.reloadShows, notify: s.notify, go: s.go })));
  const show = shows.find((s) => s.id === id);
  const [eps, setEps] = useState<Episode[] | null>(null);
  // Opening a show clears its red dot.
  const hadNew = (show?.unplayed ?? 0) > 0;
  useEffect(() => { if (hadNew) void api.markShowSeen(id).then(reloadShows).catch(() => {}); }, [id, hadNew]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>(finder?.filter ?? "all");
  const [expanded, setExpanded] = useState(false);
  const [showOrig, setShowOrig] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(finder?.searchOpen ?? false);
  const names = useShowName(show?.title ?? "");
  const desc = (show?.description ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 1500);
  const descZh = useZh(desc);
  useEffect(() => {
    let active = true;
    void api.listEpisodes(id).then((episodes) => { if (active) setEps(episodes); })
      .catch((error) => { if (active) { setEps([]); notify(errorText(error)); } });
    return () => { active = false; };
  }, [id, notify]);
  // Search inside this show: titles (with their Chinese), show notes and subtitles, done by the backend.
  const [query, setQuery] = useState(finder?.query ?? "");
  const [search, setSearch] = useState<ShowSearch | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const term = query.trim();
  const searchBox = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const beginSearch = () => {
    flushSync(() => setSearchOpen(true));
    searchBox.current?.focus();
  };
  const closeSearch = () => {
    flushSync(() => { setQuery(""); setSearch(null); setSearchOpen(false); });
    searchButton.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!term) return;
    let active = true;
    const timer = window.setTimeout(() => void api.searchShow(id, term)
      .then((hits) => { if (active) setSearch({ term, hits }); })
      .catch(() => { if (active) setSearch({ term, hits: null }); }), 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [term, id, searchAttempt]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        beginSearch();
        searchBox.current?.select();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const [month, setMonth] = useState<string | null>(finder?.month ?? null);
  useLayoutEffect(() => {
    const { view } = useStore.getState();
    if (view.kind !== "show" || view.id !== id) return;
    const finding = searchOpen || filter !== "all" || month ? { searchOpen, query, filter, month } : undefined;
    if (!finding && !view.finder) return;
    useStore.setState({ view: { ...view, finder: finding } });
  }, [id, searchOpen, query, filter, month]);
  const matchesFilters = (e: Episode) =>
    (filter === "all" || (filter === "unplayed" ? e.progress < 5 : e.hasTranscript || e.transcriptUrl)) &&
    (!month || (!!e.published && episodeMonth(e.published) === month));
  const shown = eps?.filter(matchesFilters) ?? null;
  const result = search?.term === term ? search : null;
  const hits = result?.hits?.filter(({ episode }) => matchesFilters(episode));
  const clearFilters = () => { setFilter("all"); setMonth(null); };
  const openFilters = async (trigger: HTMLButtonElement) => {
    // Leave keyboard focus before presenting a native sheet.
    searchBox.current?.blur();
    const status = SHOW_FILTERS.map((id) => ({ id, title: showFilterLabel(id), selected: filter === id }));
    const months = availableEpisodeMonths(eps);
    const dateChoices = months.length < 2 && !month ? [] : [
      { id: "any-month", title: t("全部月份"), selected: !month, symbol: "calendar" },
      ...months.map(([id, n]) => ({ id, title: t("{month} · {n} 期", { month: episodeMonthLabel(id), n }), selected: month === id })),
    ];
    const choice = await presentNativeChoices(t("筛选单集"), status, trigger, dateChoices);
    if (choice === null) setFilterOpen(true);
    else if (choice === "any-month") setMonth(null);
    else {
      const selectedStatus = SHOW_FILTERS.find((id) => id === choice);
      if (selectedStatus) setFilter(selectedStatus);
      else if (choice && months.some(([id]) => id === choice)) setMonth(choice);
    }
  };
  // "Play all" follows the list as filtered, newest first, skipping finished and unplayable episodes.
  const playable = (shown ?? []).filter((e) => (e.audioUrl || e.videoId) && !(e.duration && e.progress >= e.duration * 0.97));
  if (!show) return <><MobileBack /><div className="page" /></>;
  const art = showArt(show);
  const pageRef = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    setBusy(true);
    try {
      const before = eps?.length ?? 0;
      await api.refreshShow(id);
      const next = await api.listEpisodes(id);
      setEps(next);
      await reloadShows();
      const added = Math.max(0, next.length - before);
      notify(added > 0 ? t("更新了 {n} 期新单集", { n: added }) : t("已是最新"));
    } catch (e) { notify(errorText(e)); } finally { setBusy(false); }
  };
  const pullRefresh = usePullRefresh(pageRef, refresh);
  const remove = async () => {
    setMenu(false);
    if (!(await ask({ title: t("取消订阅「{name}」？", { name: show.title }), message: t("已生成的字幕、精读和收听进度会保留。"), ok: t("取消订阅"), danger: true }))) return;
    await api.removeShow(id); await reloadShows(); go({ kind: "latest" });
  };
  const descText = showOrig || !descZh ? desc : descZh;
  const activeFilter = filter !== "all" || !!month;
  const companion = show.kind !== "qiaomu" ? deepPickFor(show.title) : null;
  return (<>
    <MobileBack trailing={<button onClick={() => setMenu(true)} aria-haspopup="dialog" aria-label={t("更多")}><BrandGlyph name="more" /></button>} />
    <div className="page show-page" ref={pageRef} {...pullRefresh.handlers}>
      <PullIndicator pull={pullRefresh.pull} armed={pullRefresh.armed} refreshing={pullRefresh.refreshing || busy} />
      <div className={`show-head ${art.video ? "video-art" : ""}`} style={art.src ? { "--cover": `url("${art.src}")` } as React.CSSProperties : undefined}>
        {art.src ? <img src={art.src} alt="" onError={ytFallback} /> : <div className="cover-fallback" />}
        <div className="show-info">
          <p className="meta-line">{show.kind === "youtube" ? t("YouTube 频道") : show.kind === "xiaoyuzhou" ? t("小宇宙") : t("播客")}{show.author && show.author !== show.title ? ` · ${show.author}` : ""}</p>
          <h1 className="show-title-h">{names.zh ?? names.orig}</h1>
          {(names.zh || names.orig !== show.title) && <span className="orig-line clamp1">{show.title}</span>}
          {desc && <button className="show-desc desc-disclosure" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className={expanded ? undefined : "clamp2"}>{descText}</span></button>}
          {expanded && descZh && <button className="link-btn" onClick={() => setShowOrig(!showOrig)}>{showOrig ? t("看中文") : t("查看原文")}</button>}
            {menu && <MobileSheet title={names.zh ?? names.orig} onClose={() => setMenu(false)}>
              <button disabled={busy} onClick={() => { setMenu(false); void refresh(); }}><RefreshCw />{t("检查更新")}</button>
              <button className="destructive" onClick={() => void remove()}><Trash2 />{t("取消订阅")}</button>
            </MobileSheet>}
        </div>
      </div>
      {companion && <button className="show-companion" onClick={() => go({ kind: "channel", input: companion.input })}>
        <BookOpen size={19} aria-hidden /> <span>{t("乔木精读")}</span><ChevronRight size={16} aria-hidden />
      </button>}
      <div className="episode-list-tools">
        <h2>{term ? t("搜索结果") : t("全部单集")}</h2>
        {!searchOpen && playable.length > 0 && <button className="queue-play" onClick={() => playAll(playable)}><Play size={16} fill="currentColor" />{t("播放全部")}</button>}
        {!searchOpen && <button ref={searchButton} className="icon-btn" aria-label={t("搜索本节目")} onClick={beginSearch}><BrandGlyph name="search" /></button>}
        <button className={`icon-btn ${activeFilter ? "filter-active" : ""}`} aria-label={t("筛选单集")} aria-haspopup="dialog" onClick={(event) => void openFilters(event.currentTarget)}><BrandGlyph name="filter" /></button>
      </div>
      {searchOpen && <form className="show-query" role="search" onSubmit={(event) => { event.preventDefault(); searchBox.current?.blur(); }}>
        <label><BrandGlyph name="search" size={18} /><input type="search" ref={searchBox} enterKeyHint="search"
          aria-label={t("搜索本节目")} value={query} placeholder={t("搜索本节目")}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }} /></label>
        <button type="button" className="link-btn" onClick={closeSearch}>{t("取消")}</button>
      </form>}
      {activeFilter && <button className="filter-summary" aria-label={t("清除筛选")} onClick={clearFilters}>
        {[filter === "all" ? "" : showFilterLabel(filter), month ? episodeMonthLabel(month) : ""].filter(Boolean).join(" · ")}<X size={16} aria-hidden />
      </button>}
      {filterOpen && <MobileSheet title={t("筛选单集")} doneLabel={t("完成")} onClose={() => setFilterOpen(false)}>
        {SHOW_FILTERS.map((key) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); selectionFeedback(); }}>{showFilterLabel(key)}{filter === key && <Check className="row-check" />}</button>)}
        <MonthFilter episodes={eps} month={month} onChange={setMonth} />
      </MobileSheet>}
      {term ? (
        !result ? <p className="muted small search-count" role="status">{t("正在加载…")}</p> :
        !hits ? <EmptyState art={<SearchArt />} title={t("搜索失败")}>
          <button className="btn" onClick={() => { setSearch(null); setSearchAttempt((n) => n + 1); }}>{t("重试")}</button>
        </EmptyState> :
        hits.length ? (
          <>
            <p className="muted small search-count" role="status">{t("找到 {n} 集", { n: hits.length })}</p>
            <div className="ep-feed">{hits.map((h) => <EpisodeRow key={h.episode.id} ep={h.episode} showShow={false} hit={h} query={term} />)}</div>
          </>
        ) : <EmptyState art={<SearchArt />} title={t("没有找到「{q}」", { q: term })} />
      ) : <EpisodeList episodes={shown} showShow={false} />}
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

function CreatorRow({ pick, subscribed, busy, onOpen, onSubscribe, onHide }: {
  pick: Pick; subscribed: boolean; busy: boolean; onOpen: () => void; onSubscribe: () => void; onHide: () => void;
}) {
  return <div className="creator-row">
    <button className="creator-open" onClick={onOpen}>
      <img src={pick.cover} alt="" /><span><small>{t("主创的播客")}</small><strong>{pickName(pick)}</strong></span>
    </button>
    {subscribed ? <span className="creator-state">{t("已订阅")}</span>
      : <button className="round-btn" onClick={onSubscribe} aria-label={t("订阅")} disabled={busy}>
        {busy ? <Loader2 className="spin" /> : <BrandGlyph name="plus" />}
      </button>}
    <button className="icon-btn" aria-label={t("不再显示")} onClick={onHide}><X size={18} /></button>
  </div>;
}

function TopicChips({ topics, setTopics }: { topics: Topic[]; setTopics: (t: Topic[]) => void }) {
  const [open, setOpen] = useState(false);
  return <><button className="topic-filter" onClick={() => setOpen(true)} aria-haspopup="dialog">
    <BrandGlyph name="filter" size={20} />{topics.length ? topics.map((x) => t(x)).join(" · ") : t("全部话题")}<ChevronDown size={16} />
  </button>{open && <MobileSheet title={t("筛选话题")} doneLabel={t("完成")} onClose={() => setOpen(false)}>
    <button aria-pressed={!topics.length} onClick={() => setTopics([])}>{t("全部")}{!topics.length && <Check className="row-check" />}</button>
    {TOPICS.map((x) => <button key={x} aria-pressed={topics.includes(x)} onClick={() => {
      selectionFeedback(); setTopics(topics.includes(x) ? topics.filter((y) => y !== x) : [...topics, x]);
    }}>{t(x)}{topics.includes(x) && <Check className="row-check" />}</button>)}
  </MobileSheet>}</>;
}

const visible = (topics: Topic[]) => PICKS.filter((p) => !topics.length || p.topics.some((x) => topics.includes(x)));

/** Subscribe to a few curated shows on first launch so Home fills in with playable episodes. */
const STARTER = ["nexttoken", "no-priors", "lex", "zhang", "latetalk"];
export async function firstRunSetup() {
  const { settings, shows, saveSettings, reloadShows } = useStore.getState();
  if (settings.onboarded || shows.length) return;
  await saveSettings({ onboarded: true });
  useStore.setState({ settingUp: true });
  const queue = PICKS.filter((p) => STARTER.includes(p.id));
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try { await api.addSubscription(p.input); await reloadShows(); } catch { /* the rest still come */ }
    }
  }));
  useStore.setState({ settingUp: false });
}

export function DiscoverView() {
  const { shows, reloadShows, notify, go } = useStore(useShallow((s) => ({ shows: s.shows, reloadShows: s.reloadShows, notify: s.notify, go: s.go })));
  const [adding, setAdding] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const bannerHidden = useStore((s) => s.settings.homeBannerHidden);
  const showBanner = !bannerHidden;
  const subscribed = (p: Pick) => isSubscribed(p, shows);
  const home = PICKS.find((p) => p.id === "nexttoken");
  const add = async (input: string, title: string) => {
    setAdding(input);
    try {
      const r = await api.addSubscription(input);
      await reloadShows();
      if (r.show) { notify(t("已订阅「{name}」", { name: title })); go({ kind: "show", id: r.show.id }); }
    } catch (err) { notify(errorText(err)); } finally { setAdding(null); }
  };
  const subBtn = (input: string, title: string, done: boolean) => done
    ? <span className="tile-done" title={t("已订阅")} aria-label={t("已订阅")}><Check size={18} /></span>
    : <button className="tile-add" title={t("订阅")} aria-label={t("订阅")} onClick={(e) => { e.stopPropagation(); void add(input, title); }} disabled={adding != null}>{adding === input ? <Loader2 size={16} className="spin" /> : <Plus size={18} />}</button>;
  return (
    <div className="page discover-page">
      {showBanner && home && !topics.length && <CreatorRow pick={home} subscribed={subscribed(home)} busy={adding === home.input}
        onOpen={() => go({ kind: "channel", input: home.input })} onSubscribe={() => void add(home.input, pickName(home))}
        onHide={() => { selectionFeedback(); void useStore.getState().saveSettings({ homeBannerHidden: true }); }} />}
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
  const [error, setError] = useState<"trust" | "network" | null>(null);
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
      api.previewShow(input).then((d) => live && setData(d)).catch((e) => live && !cached && setError(/连接证书无法验证|unknownissuer/i.test(String(e)) ? "trust" : "network")).finally(() => live && setRefreshing(false));
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
  const art = pick?.cover ? { src: pick.cover, video: false } : data ? showArt(data.show) : { src: undefined, video: false };
  const cover = art.src;

  const desc = pick ? t(pick.intro) : (data?.show.description ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 300);
  return (
    <div className="page show-page">
      <div className={`show-head ${art.video ? "video-art" : ""}`} style={cover ? { "--cover": `url("${cover}")` } as React.CSSProperties : undefined}>
        {cover ? <img src={cover} alt="" onError={ytFallback} /> : <div className="cover-fallback" />}
        <div className="show-info">
          <p className="meta-line">{pick?.deep ? t("乔木精读 · 中文标题、精读长文与原文文稿") : pick?.by ?? data?.show.author ?? t("频道")}</p>
          <h1 className="show-title-h">{pick ? pickName(pick) : names.zh ?? names.orig}</h1>
          {(pick ? isChineseUi() && pick.zh !== pick.title : names.zh) && <span className="orig-line clamp1">{pick?.title ?? data?.show.title}</span>}
          {desc && <p className="show-desc clamp3">{desc}</p>}
          <div className="row-actions">
            {sub
              ? <button className="btn sm" onClick={() => go({ kind: "show", id: sub.id })}><Check size={13} /> {t("已订阅 · 查看")}</button>
              : <button className="btn primary" onClick={subscribe} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Plus size={15} />} {t("订阅")}</button>}
            {data && <span className="muted small">{t("{n} 期节目", { n: data.episodes.length })}{refreshing ? ` · ${t("正在更新…")}` : ""}</span>}
          </div>
        </div>
      </div>
      {error ? <div className="channel-unavailable" role="status">
        <EmptyState art={<QuietArt />} title={t("暂时无法加载单集")}
          note={error === "trust" ? t("连接证书无法验证，可检查代理设置") : t("请稍后重试")} />
        <div className="row-actions">
          <button className="btn" onClick={() => setAttempt((n) => n + 1)}><RefreshCw size={16} />{t("重试")}</button>
          {error === "trust" && <button className="link-btn" onClick={() => useStore.getState().openSettings("general")}>{t("网络设置")}</button>}
        </div>
      </div> : <>
        <MonthFilter episodes={data?.episodes ?? null} month={month} onChange={setMonth} />
        <EpisodeList episodes={shownCh} showShow={false} />
      </>}
    </div>
  );
}

export function showIcon(show: Show) {
  const art = showArt(show);
  return art.src ? <img src={art.src} alt="" loading="lazy" onError={ytFallback} /> : <div className="cover-fallback">{show.title.slice(0, 1)}</div>;
}
