import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Loader2, Minimize2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isBotCheck, type Episode } from "../lib/api";
import { clock } from "../lib/format";
import { loadYouTube } from "../lib/youtube";
import { useStore } from "../store";
import { IS_MAC, t, tr } from "../lib/i18n";
import { audioSrc, useOffline } from "../lib/offline";
import { playNext } from "../lib/library";

const SAVE_EVERY = 10;
/** Starts an episode as soon as its player exists: right away when it does, or when it appears (a YouTube
 *  player takes a moment to load). Replaces "wait 400 ms and hope". */
export function playSoon(id: string) {
  const s = useStore.getState();
  waiting(true);
  if (s.current?.id === id && s.player) { s.player.play(); return; }
  s.set({ playWhenReady: id });
}
useStore.subscribe((s, prev) => {
  if (s.player && s.player !== prev.player && s.playWhenReady && s.current?.id === s.playWhenReady) {
    const p = s.player;
    useStore.setState({ playWhenReady: null });
    window.setTimeout(() => p.play(), 0);
  }
});

/** Playback asked for, sound not there yet: the controls show it, and say more if it takes long. */
export const waiting = (on: boolean) => { const s = useStore.getState(); if (on ? !s.loadingSince : s.loadingSince) s.set({ loadingSince: on ? Date.now() : null }); };
let lastSaved = 0;
// Listening time: wall-clock time while playing, at most 2 s per tick (a seek or a sleeping laptop adds
// nothing), flushed every 20 s and on pause.
let heard = { id: "", show: "", secs: 0, at: 0, translated: false };
function flushHeard() {
  if (heard.secs >= 1) void api.logListen(heard.id, heard.show, heard.secs, heard.translated).catch(() => {});
  heard.secs = 0;
}
export function noteListening(ep: Episode, playing: boolean) {
  const now = performance.now();
  if (heard.id !== ep.id) { flushHeard(); heard = { id: ep.id, show: ep.showId, secs: 0, at: now, translated: false }; }
  if (playing && heard.at) heard.secs += Math.min(2, (now - heard.at) / 1000);
  heard.at = playing ? now : 0;
  heard.translated ||= useStore.getState().settings.subtitleMode !== "original";
  if (heard.secs >= 20 || (!playing && heard.secs > 0)) flushHeard();
}

function track(ep: Episode, time: number, length?: number) {
  const s = useStore.getState();
  if (s.current?.id !== ep.id) return;
  noteListening(ep, s.playing);
  s.set({ time, ...(length ? { length } : {}) });
  if (Math.abs(time - lastSaved) > SAVE_EVERY) { lastSaved = time; void api.setProgress(ep.id, time); }
}

/** The audio element lives at the app root so playback continues while browsing. */
export function AudioEngine() {
  const current = useStore((s) => s.current);
  const rate = useStore((s) => s.settings.playbackRate);
  const ref = useRef<HTMLAudioElement>(null);
  const audio = current && !current.videoId ? current : null;
  const saved = useOffline((s) => (audio ? s.saved[audio.id]?.path : undefined));
  // The address is fixed per episode so a download finishing mid-episode does not cut in; it takes over at the next pause.
  const [chosen, setChosen] = useState<{ id: string; src?: string } | null>(null);
  const src = audio ? (chosen?.id === audio.id ? chosen.src : audioSrc(audio)) : undefined;
  const setSrc = (s?: string) => audio && setChosen({ id: audio.id, src: s });
  useEffect(() => { if (audio && chosen?.id !== audio.id) setSrc(src); }, [audio?.id]);
  useEffect(() => { if (audio && saved && ref.current?.paused !== false) setSrc(audioSrc(audio)); }, [saved]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !audio) return;
    const handle = {
      seek: (t: number) => { el.currentTime = t; el.play().catch(() => {}); },
      toggle: () => (el.paused ? void el.play().catch(() => {}) : el.pause()),
      play: () => void el.play().catch(() => {}),
      setRate: (r: number) => { el.playbackRate = r; },
      toggleMute: () => { el.muted = !el.muted; return el.muted; },
      episodeId: audio.id,
    };
    useStore.getState().set({ player: handle });
    return () => { if (useStore.getState().player === handle) useStore.getState().set({ player: null }); };
  }, [audio?.id]);

  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate, audio?.id]);

  if (!audio || !src) return null;
  return (
    <audio
      ref={ref}
      src={src}
      preload="metadata"
      onLoadedMetadata={(e) => {
        const el = e.currentTarget;
        el.playbackRate = rate;
        const s = useStore.getState();
        const start = s.current?.id === audio.id ? s.time : audio.progress;
        if (start > 5 && start < el.duration - 10) el.currentTime = start;
        track(audio, el.currentTime, el.duration);
      }}
      onTimeUpdate={(e) => track(audio, e.currentTarget.currentTime)}
      onPlay={() => { useStore.getState().set({ playing: true }); if (ref.current && ref.current.readyState < 3) waiting(true); }}
      onWaiting={() => waiting(true)}
      onPlaying={() => waiting(false)}
      onPause={(e) => {
        waiting(false);
        useStore.getState().set({ playing: false });
        void api.setProgress(audio.id, e.currentTarget.currentTime);
        if (saved && src !== audioSrc(audio)) setSrc(audioSrc(audio));
      }}
      onEnded={(e) => { void api.setProgress(audio.id, e.currentTarget.duration || e.currentTarget.currentTime); playNext(); }}
      onError={() => { waiting(false); useStore.getState().notify(t("音频加载失败，可能是网络问题或地址已失效")); }}
    />
  );
}

/** Our subtitles replace YouTube's: turning the caption module off alone is not enough when the viewer has captions on. */
function hideYouTubeCaptions(player: any) {
  try { player.setOption?.("captions", "track", {}); } catch { /* module not loaded yet */ }
  try { player.unloadModule?.("captions"); player.unloadModule?.("cc"); } catch { /* not loaded */ }
}

export const RATES = [0.8, 1, 1.15, 1.25, 1.5, 1.75, 2];

/** YouTube without YouTube's chrome: the embed runs with its controls off, cropped so the title bar and logo fall
 *  outside the frame, under a shield that keeps hover UI from appearing. Our own controls and subtitles drive it.
 *  Videos whose owners forbid embedding fall back to the HLS stream yt-dlp finds, played in a plain <video>. */
export function YouTubePlayer({ ep, overlay, onUnplayable }: { ep: Episode; overlay?: React.ReactNode; onUnplayable?: () => void }) {
  const [native, setNative] = useState<{ url: string; kind: "hls" | "mp4" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the switch to the direct stream is waiting for; null when not switching. */
  const [fallingBack, setFallingBack] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fallback = async (why: string) => {
    setFallingBack(t("{reason}，正在改用直连播放…", { reason: why }));
    const off = listen<{ videoId: string; stage: string; progress: number }>("yt-stream", ({ payload: p }) => {
      if (p.videoId !== ep.videoId) return;
      setFallingBack(p.stage === "tool"
        ? t("首次使用，正在下载 YouTube 播放组件 {pct}%", { pct: Math.round(p.progress * 100) })
        : t("{reason}，正在获取视频地址…", { reason: why }));
    });
    // HLS where the WebView plays it (macOS); elsewhere HLS through the app's loopback proxy (hls.js), for HD.
    const nativeHls = document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "";
    try { setNative(await api.youtubeStream(ep.videoId!, nativeHls ? "native-hls" : "proxy-hls")); setError(null); }
    catch (e) {
      const msg = typeof e === "string" ? e : String((e as any)?.message ?? e);
      // YouTube wants a signed-in browser: ask once, here, instead of failing or silently falling back to audio.
      if (isBotCheck(msg)) { setBotCheck(why); return; }
      if (onUnplayable) onUnplayable(); else setError(t("{reason}。{detail}", { reason: why, detail: tr(msg) }));
    }
    finally { setFallingBack(null); void off.then((f) => f()); }
  };
  // A saved address can go stale (network changed, YouTube expired it early): ask for a new one once, then try the MP4.
  const retried = useRef(false);
  const failed = () => {
    const mode = native?.kind === "hls" && !retried.current ? (document.createElement("video").canPlayType("application/vnd.apple.mpegurl") !== "" ? "native-hls" : "proxy-hls") : "mp4";
    if (retried.current && native?.kind === "mp4") return setError(t("视频地址失效，请稍后再试"));
    retried.current = true;
    void api.youtubeStream(ep.videoId!, mode, true).then(setNative).catch((e) => setError(tr(String(e?.message ?? e))));
  };
  const [botCheck, setBotCheck] = useState<string | null>(null);
  const [browser, setBrowser] = useState(useStore.getState().settings.ytCookiesBrowser || "chrome");
  const retryWithBrowser = async () => {
    const why = botCheck ?? "";
    setBotCheck(null);
    await useStore.getState().saveSettings({ ytCookiesBrowser: browser });
    void fallback(why);
  };
  useEffect(() => { setNative(null); setError(null); retried.current = false; }, [ep.id]);
  // Have yt-dlp ready before it is needed: a first fallback would otherwise start with a 35 MB download.
  useEffect(() => { void api.prepareYoutube().catch(() => {}); }, []);
  const watchOnYouTube = () => {
    const s = Math.floor(useStore.getState().current?.id === ep.id ? useStore.getState().time : ep.progress ?? 0);
    void openUrl(`https://www.youtube.com/watch?v=${ep.videoId}${s > 5 ? `&t=${s}s` : ""}`);
  };
  const openBtn = <button className="link-btn video-open" onClick={watchOnYouTube}><ExternalLink size={13} /> {t("在 YouTube 打开")}</button>;
  const fullscreen = () => toggleTheater();
  const theater = useStore((s) => s.theater);
  // Leaving the episode leaves full screen too.
  useEffect(() => () => { if (useStore.getState().theater) toggleTheater(false); }, []);
  // In full screen the controls show while the mouse moves and fade after 2.5 s of stillness.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!theater) return;
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => { setIdle(false); window.clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 2500); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); toggleTheater(false); } };
    window.addEventListener("mousemove", wake);
    window.addEventListener("keydown", esc);
    return () => { window.clearTimeout(timer); window.removeEventListener("mousemove", wake); window.removeEventListener("keydown", esc); };
  }, [theater]);
  return (
    <div className={`video ${theater ? "theater" : ""} ${theater && idle ? "idle" : ""}`} ref={box}>
      {native ? <NativeVideo ep={ep} src={native.url} kind={native.kind} onFullscreen={fullscreen} onFail={failed} /> : <EmbedVideo ep={ep} onFullscreen={fullscreen} onBlocked={fallback} onError={setError} />}
      {fallingBack && <div className="video-note"><span className="spin-dot" /> {fallingBack} {openBtn}</div>}
      {botCheck && (
        <div className="video-error bot-check">
          <p>{t("YouTube 要求验证「不是机器人」才能播放这个视频。")}</p>
          <p className="small">{t("选一个已经登录 YouTube 的浏览器，SubCast 借用它的登录再试一次（只在本机读取，不保存）。")}</p>
          <div className="row-actions">
            <select value={browser} onChange={(e) => setBrowser(e.target.value)} aria-label={t("浏览器")}>
              {(IS_MAC ? ["chrome", "safari", "edge", "firefox", "brave"] : ["chrome", "edge", "firefox", "brave"]).map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
            </select>
            <button className="btn primary sm" onClick={() => void retryWithBrowser()}>{t("借用登录再试")}</button>
            {openBtn}
          </div>
        </div>
      )}
      {error && <div className="video-error">{error} {openBtn}</div>}
      {overlay}
      {theater && (
        <div className="theater-bar" onClick={(e) => e.stopPropagation()}>
          <p className="theater-title clamp1">{ep.title}</p>
          <Controls compact />
          <button className="icon-btn theater-exit" title={t("退出全屏（Esc）")} aria-label={t("退出全屏")} onClick={() => toggleTheater(false)}><Minimize2 size={16} /></button>
        </div>
      )}
    </div>
  );
}

/** Full screen for the video: the window goes full screen and the video fills it, with its subtitles. A layout
 *  mode rather than the element Fullscreen API, which the macOS WebView doesn't enable. */
export function toggleTheater(on?: boolean) {
  const s = useStore.getState();
  const next = on ?? !s.theater;
  if (next && !document.querySelector(".video")) return false;
  s.set({ theater: next });
  void getCurrentWindow().setFullscreen(next).catch(() => {});
}

function PlayHint({ ep, show, onClick }: { ep: Episode; show: boolean; onClick: () => void }) {
  return (
    <div className={`video-poster ${show ? "on" : ""}`} onClick={onClick}>
      <img src={`https://i.ytimg.com/vi/${ep.videoId}/maxresdefault.jpg`} onError={(e) => { const i = e.currentTarget; if (!i.dataset.f) { i.dataset.f = "1"; i.src = `https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`; } }} alt="" />
      <span className="big-play"><Play size={28} fill="currentColor" /></span>
    </div>
  );
}

function EmbedVideo({ ep, onFullscreen, onBlocked, onError }: { ep: Episode; onFullscreen: () => void; onBlocked: (why: string) => void; onError: (m: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const rate = useStore((s) => s.settings.playbackRate);
  const playerRef = useRef<any>(null);
  const [state, setState] = useState(-1);

  useEffect(() => {
    let player: any, timer: number | undefined, disposed = false;
    loadYouTube().then((YT) => {
      if (disposed || !host.current) return;
      const mount = document.createElement("div");
      host.current.appendChild(mount);
      player = new YT.Player(mount, {
        videoId: ep.videoId,
        width: "100%",
        height: "100%",
        host: "https://www.youtube.com",
        playerVars: { controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3, start: Math.floor(ep.progress > 5 ? ep.progress : 0), origin: window.location.origin },
        events: {
          onReady: () => {
            playerRef.current = player;
            hideYouTubeCaptions(player);
            player.setPlaybackRate?.(useStore.getState().settings.playbackRate);
            useStore.getState().set({
              length: player.getDuration?.() || ep.duration || 0,
              player: {
                episodeId: ep.id,
                seek: (t: number) => { player.seekTo(t, true); player.playVideo(); },
                toggle: () => (player.getPlayerState() === 1 ? player.pauseVideo() : (waiting(true), player.playVideo())),
                play: () => { waiting(true); player.playVideo(); },
                setRate: (r: number) => player.setPlaybackRate(r),
                toggleMute: () => { if (player.isMuted?.()) { player.unMute(); return false; } player.mute(); return true; },
              },
            });
            timer = window.setInterval(() => {
              const t = player.getCurrentTime?.();
              if (typeof t === "number") track(ep, t, player.getDuration?.());
            }, 250);
          },
          onStateChange: (e: any) => {
            setState(e.data);
            // 3 = buffering; -1/5 after a play request = still starting. 1 = playing.
            if (e.data === 3) waiting(true); else if (e.data === 1 || e.data === 2 || e.data === 0) waiting(false);
            useStore.getState().set({ playing: e.data === 1 });
            if (e.data === 1) hideYouTubeCaptions(player);
            if (e.data === 2) void api.setProgress(ep.id, player.getCurrentTime());
            if (e.data === 0) { void api.setProgress(ep.id, player.getDuration?.() ?? player.getCurrentTime()); playNext(); }
          },
          onError: (e: any) => {
            // 101/150: the owner disallows embedding. 152/153 are player/referrer problems on this side, not the owner's choice.
            console.warn("YouTube player error", e.data, ep.videoId);
            if ([100, 101, 150, 152, 153].includes(e.data)) onBlocked(e.data === 100 ? t("视频不存在或已设为私享")
              : e.data === 101 || e.data === 150 ? t("作者限制了嵌入播放")
              : t("YouTube 播放器加载失败（错误 {code}）", { code: e.data }));
            else onError(t("视频无法播放（错误 {code}）", { code: e.data }));
          },
        },
      });
    }).catch((e) => onError(tr(String(e.message ?? e))));
    return () => {
      disposed = true;
      window.clearInterval(timer);
      try { void api.setProgress(ep.id, player?.getCurrentTime?.() ?? 0); player?.destroy?.(); } catch { /* already gone */ }
      const s = useStore.getState();
      if (s.current?.id === ep.id) s.set({ player: null, playing: false });
    };
  }, [ep.id]);

  useEffect(() => { playerRef.current?.setPlaybackRate?.(rate); }, [rate]);
  const toggle = () => useStore.getState().player?.toggle();
  return (
    <>
      <div className="video-host crop" ref={host} />
      <div className="video-shield" onClick={toggle} onDoubleClick={onFullscreen} />
      <PlayHint ep={ep} show={state === -1 || state === 5 || state === 0} onClick={toggle} />
      {state === 2 && <span className="paused-mark" onClick={toggle}><Play size={22} fill="currentColor" /></span>}
    </>
  );
}

/** `onFail`: the stream can't be played (stale address, or HLS unsupported here); the caller gets another. */
function NativeVideo({ ep, src, kind, onFullscreen, onFail }: { ep: Episode; src: string; kind: "hls" | "mp4"; onFullscreen: () => void; onFail?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const rate = useStore((s) => s.settings.playbackRate);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hls: any;
    if (kind === "mp4" || el.canPlayType("application/vnd.apple.mpegurl")) el.src = src;
    else void import("hls.js").then(({ default: Hls }) => {
      if (!Hls.isSupported()) { onFail?.(); return; }
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_: unknown, d: { fatal?: boolean }) => { if (d.fatal) { hls.destroy(); hls = null; onFail?.(); } });
      hls.loadSource(src);
      hls.attachMedia(el);
    });
    const handle = {
      seek: (t: number) => { el.currentTime = t; void el.play().catch(() => {}); },
      toggle: () => (el.paused ? void el.play().catch(() => {}) : el.pause()),
      play: () => void el.play().catch(() => {}),
      setRate: (r: number) => { el.playbackRate = r; },
      toggleMute: () => { el.muted = !el.muted; return el.muted; },
      episodeId: ep.id,
    };
    useStore.getState().set({ player: handle });
    return () => {
      hls?.destroy?.();
      void api.setProgress(ep.id, el.currentTime);
      const s = useStore.getState();
      if (s.player === handle) s.set({ player: null, playing: false });
    };
  }, [src, ep.id]);
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate]);
  return (
    <>
      <video ref={ref} className="video-native" playsInline preload="auto"
        onError={() => { if (!started) onFail?.(); }}
        onLoadedMetadata={(e) => { const el = e.currentTarget; el.playbackRate = rate; if (ep.progress > 5 && ep.progress < el.duration - 10) el.currentTime = ep.progress; track(ep, el.currentTime, el.duration); }}
        onTimeUpdate={(e) => track(ep, e.currentTarget.currentTime)}
        onPlay={(e) => { setStarted(true); useStore.getState().set({ playing: true }); if (e.currentTarget.readyState < 3) waiting(true); }}
        onWaiting={() => waiting(true)}
        onPlaying={() => waiting(false)}
        onPause={(e) => { waiting(false); useStore.getState().set({ playing: false }); void api.setProgress(ep.id, e.currentTarget.currentTime); }}
        onEnded={(e) => { void api.setProgress(ep.id, e.currentTarget.duration); playNext(); }} />
      <div className="video-shield" onClick={() => useStore.getState().player?.toggle()} onDoubleClick={onFullscreen} />
      <PlayHint ep={ep} show={!started} onClick={() => useStore.getState().player?.toggle()} />
    </>
  );
}

export function Controls({ compact = false }: { compact?: boolean }) {
  const { time, length, playing, player, settings, loadingSince } = useStore(useShallow((s) => ({ time: s.time, length: s.length, playing: s.playing, player: s.player, settings: s.settings, loadingSince: s.loadingSince })));
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? time;
  const nextRate = cycleRate;
  return (
    <div className={`controls ${compact ? "compact" : ""}`}>
      <button className="icon-btn" title={t("后退 {n} 秒（←）", { n: settings.skipBack ?? 15 })} onClick={() => player?.seek(Math.max(0, time - (settings.skipBack ?? 15)))} disabled={!player}><RotateCcw size={18} /></button>
      <button className={`play-btn ${loadingSince ? "loading" : ""}`} title={loadingSince ? t("正在加载…") : playing ? t("暂停（空格）") : t("播放（空格）")} onClick={() => player?.toggle()} disabled={!player} aria-busy={!!loadingSince}>
        {loadingSince ? <Loader2 size={20} className="spin" /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <button className="icon-btn" title={t("前进 {n} 秒（→）", { n: settings.skipForward ?? 30 })} onClick={() => player?.seek(time + (settings.skipForward ?? 30))} disabled={!player}><RotateCw size={18} /></button>
      <span className="time">{clock(shown)}</span>
      <input
        className="seek"
        type="range"
        min={0}
        max={Math.max(length, 1)}
        step={1}
        value={Math.min(shown, length || shown)}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => { if (drag != null) { player?.seek(drag); setDrag(null); } }}
        onKeyUp={() => { if (drag != null) { player?.seek(drag); setDrag(null); } }}
        style={{ "--fill": `${length ? (shown / length) * 100 : 0}%` } as React.CSSProperties}
        aria-label={t("播放进度")}
      />
      <span className="time">{length ? clock(length) : "--:--"}</span>
      <button className={`rate-btn${settings.playbackRate >= 2 ? " fast" : ""}`} onClick={nextRate} title={t("播放速度（S）")}>{settings.playbackRate >= 2 && <span className="rate-bars" aria-hidden><i /><i /><i /></span>}{settings.playbackRate}×</button>
    </div>
  );
}

export function cycleMode() {
  const { settings, saveSettings } = useStore.getState();
  const order = ["bilingual", "translation", "original"] as const;
  void saveSettings({ subtitleMode: order[(order.indexOf(settings.subtitleMode) + 1) % 3] });
}

/** Steps the speed up or down one notch (for shortcuts). */
export function stepRate(dir: 1 | -1) {
  const { settings, saveSettings, player, notify } = useStore.getState();
  const i = RATES.indexOf(settings.playbackRate);
  const r = RATES[Math.min(RATES.length - 1, Math.max(0, (i < 0 ? RATES.indexOf(1) : i) + dir))];
  player?.setRate(r);
  void saveSettings({ playbackRate: r });
  notify(`${r}×`);
}

export function cycleRate() {
  const { settings, saveSettings, player } = useStore.getState();
  const r = RATES[(RATES.indexOf(settings.playbackRate) + 1) % RATES.length];
  player?.setRate(r);
  void saveSettings({ playbackRate: r });
}
