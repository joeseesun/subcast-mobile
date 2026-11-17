import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, Minimize2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Episode } from "../lib/api";
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
  if (s.current?.id === id && s.player?.episodeId === id) { s.player.play(); return; }
  s.set({ playWhenReady: id });
}
useStore.subscribe((s, prev) => {
  if (s.player && s.player !== prev.player && s.playWhenReady === s.player.episodeId && s.current?.id === s.playWhenReady) {
    const p = s.player;
    useStore.setState({ playWhenReady: null });
    if (useStore.getState().player === p) p.play();
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

function mediaHandle(el: HTMLMediaElement, episodeId: string) {
  const play = () => {
    if (el.error) el.load();
    void el.play().catch((error: Error) => {
      if (error.name === "AbortError" || useStore.getState().player?.episodeId !== episodeId) return;
      useStore.setState({ playing: false, loadingSince: null });
      if (!el.error) useStore.getState().notify(t("播放失败，请再点一次播放"));
    });
  };
  return {
    episodeId, play,
    seek: (time: number) => { el.currentTime = time; play(); },
    toggle: () => el.paused ? play() : el.pause(),
    setRate: (rate: number) => { el.playbackRate = rate; },
    toggleMute: () => { el.muted = !el.muted; return el.muted; },
  };
}

/** The audio element lives at the app root so playback continues while browsing. */
export function AudioEngine() {
  const current = useStore((s) => s.current);
  return current && !current.videoId ? <EpisodeAudio key={current.id} audio={current} /> : null;
}

function EpisodeAudio({ audio }: { audio: Episode }) {
  const rate = useStore((s) => s.settings.playbackRate);
  const ref = useRef<HTMLAudioElement>(null);
  const saved = useOffline((s) => s.saved[audio.id]?.path);
  // A completed download takes over at the next pause. Also notice audio URLs hydrated after a queue starts.
  const [src, setSrc] = useState(() => audioSrc(audio));
  useEffect(() => {
    if (!ref.current || ref.current.paused) setSrc(audioSrc(audio));
  }, [audio.audioUrl, saved]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = mediaHandle(el, audio.id);
    useStore.getState().set({ player: handle });
    return () => { if (useStore.getState().player === handle) useStore.getState().set({ player: null }); };
  }, [audio.id, !!src]);

  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate, src]);

  if (!src) return null;
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
        setSrc(audioSrc(audio));
      }}
      onEnded={(e) => { void api.setProgress(audio.id, e.currentTarget.duration || e.currentTarget.currentTime); playNext(); }}
      onError={() => { useStore.setState({ playing: false, loadingSince: null }); useStore.getState().notify(t("音频加载失败，可能是网络问题或地址已失效")); }}
    />
  );
}

/** Our subtitles replace YouTube's: turning the caption module off alone is not enough when the viewer has captions on. */
function hideYouTubeCaptions(player: any) {
  try { player.setOption?.("captions", "track", {}); } catch { /* module not loaded yet */ }
  try { player.unloadModule?.("captions"); player.unloadModule?.("cc"); } catch { /* not loaded */ }
}

export const RATES = [0.8, 1, 1.15, 1.25, 1.5, 1.75, 2];

/** On iOS let WebKit play HLS or MP4 inline, with the system full-screen controls.
 * Android tries the embed first. Each failed source advances at most once. */
export function YouTubePlayer({ ep, overlay, onUnplayable }: { ep: Episode; overlay?: React.ReactNode; onUnplayable?: () => void }) {
  const routes = IS_MAC ? ["direct", "mp4", "embed"] : ["embed", "direct", "mp4"];
  const [attempt, setAttempt] = useState(0);
  const [media, setMedia] = useState<{ url: string; kind: "hls" | "mp4"; attempt: number } | null>(null);
  const [reason, setReason] = useState("");
  const route = routes[attempt];
  const theater = useStore((s) => s.theater);
  const pending = useStore((s) => s.playWhenReady === ep.id);
  const fail = (message: string) => {
    const s = useStore.getState();
    if (s.current?.id !== ep.id || !s.current.videoId) return;
    if (s.playing || s.loadingSince) s.set({ playWhenReady: ep.id });
    setReason(message);
    setAttempt((n) => n === attempt ? n + 1 : n);
  };
  useEffect(() => {
    if (!route) { useStore.setState({ playing: false, loadingSince: null, playWhenReady: null }); return; }
    if (route === "embed") return;
    let active = true;
    const mode = route === "mp4" ? "mp4" : IS_MAC ? "native-hls" : "proxy-hls";
    void api.youtubeStream(ep.videoId!, mode, route === "mp4").then((result) => {
      if (active) setMedia({ ...result, attempt });
    }).catch((err) => { if (active) fail(tr(String(err?.message ?? err))); });
    return () => { active = false; };
  }, [ep.id, attempt]);
  useEffect(() => () => { if (useStore.getState().theater) toggleTheater(false); }, []);
  const openVideo = () => {
    const time = Math.floor(useStore.getState().time);
    void openUrl(`https://www.youtube.com/watch?v=${ep.videoId}&t=${time}s`);
  };
  return (
    <div className={`video ${theater ? "theater" : ""}`}>
      {!route ? <div className="video-error" role="status">
        <p>{reason}</p><div className="row-actions">
          <button className="btn sm" onClick={() => { playSoon(ep.id); setMedia(null); setAttempt(0); }}>{t("重试")}</button>
          {onUnplayable && <button className="btn sm" onClick={onUnplayable}>{t("仅音频")}</button>}
          <button className="btn sm" onClick={openVideo}>{t("在 YouTube 打开")}</button>
        </div>
      </div> : route === "embed" ? <EmbedVideo ep={ep} onBlocked={fail} onError={fail} /> :
        media?.attempt === attempt ? <NativeVideo key={attempt} ep={ep} src={media.url} kind={media.kind} onFail={() => fail(t("视频地址失效，请稍后再试"))} /> :
        <button className="video-loading" onClick={() => playSoon(ep.id)} aria-label={t("播放")}>
          <img src={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} alt="" />
          <span className="big-play">{pending ? <Loader2 className="spin" /> : <Play fill="currentColor" />}</span>
        </button>}
      {overlay}
      {theater && <button className="icon-btn theater-exit" aria-label={t("退出全屏")} onClick={() => toggleTheater(false)}><Minimize2 /></button>}
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

function EmbedVideo({ ep, onBlocked, onError }: { ep: Episode; onBlocked: (why: string) => void; onError: (m: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const rate = useStore((s) => s.settings.playbackRate);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    let player: any, timer: number | undefined, disposed = false;
    const timeout = window.setTimeout(() => onBlocked(t("无法加载 YouTube 播放器，请检查网络或代理")), 15000);
    loadYouTube().then((YT) => {
      if (disposed || !host.current) return;
      const mount = document.createElement("div");
      host.current.appendChild(mount);
      player = new YT.Player(mount, {
        videoId: ep.videoId,
        width: "100%",
        height: "100%",
        host: "https://www.youtube.com",
        playerVars: { controls: 1, fs: 1, playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3, start: Math.floor(ep.progress > 5 ? ep.progress : 0), origin: window.location.origin },
        events: {
          onReady: () => {
            if (disposed) return;
            window.clearTimeout(timeout);
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
            if (disposed) return;
            // 3 = buffering; -1/5 after a play request = still starting. 1 = playing.
            if (e.data === 3) waiting(true); else if (e.data === 1 || e.data === 2 || e.data === 0) waiting(false);
            useStore.getState().set({ playing: e.data === 1 });
            if (e.data === 1) hideYouTubeCaptions(player);
            if (e.data === 2) void api.setProgress(ep.id, player.getCurrentTime());
            if (e.data === 0) { void api.setProgress(ep.id, player.getDuration?.() ?? player.getCurrentTime()); playNext(); }
          },
          onError: (e: any) => {
            // 101/150: the owner disallows embedding. 152/153 are player/referrer problems on this side, not the owner's choice.
            if (disposed) return;
            console.warn("YouTube player error", e.data, ep.videoId);
            if ([100, 101, 150, 152, 153].includes(e.data)) onBlocked(e.data === 100 ? t("视频不存在或已设为私享")
              : e.data === 101 || e.data === 150 ? t("作者限制了嵌入播放")
              : t("YouTube 播放器加载失败（错误 {code}）", { code: e.data }));
            else onError(t("视频无法播放（错误 {code}）", { code: e.data }));
          },
        },
      });
    }).catch((e) => { if (!disposed) onError(tr(String(e.message ?? e))); });
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      window.clearInterval(timer);
      try { if (player?.getCurrentTime?.() > 0) void api.setProgress(ep.id, player.getCurrentTime()); player?.destroy?.(); } catch { /* already gone */ }
      const s = useStore.getState();
      if (s.current?.id === ep.id && s.current.videoId && s.player?.episodeId === ep.id) s.set({ player: null, playing: false });
    };
  }, [ep.id]);

  useEffect(() => { playerRef.current?.setPlaybackRate?.(rate); }, [rate]);
  return <div className="video-host" ref={host} />;
}

/** `onFail`: the stream can't be played (stale address, or HLS unsupported here); the caller gets another. */
function NativeVideo({ ep, src, kind, onFail }: { ep: Episode; src: string; kind: "hls" | "mp4"; onFail?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const rate = useStore((s) => s.settings.playbackRate);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hls: any;
    let active = true;
    if (kind === "mp4" || el.canPlayType("application/vnd.apple.mpegurl")) el.src = src;
    else void import("hls.js").then(({ default: Hls }) => {
      if (!active) return;
      if (!Hls.isSupported()) { onFail?.(); return; }
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_: unknown, d: { fatal?: boolean }) => { if (d.fatal) { hls.destroy(); hls = null; onFail?.(); } });
      hls.loadSource(src);
      hls.attachMedia(el);
    }).catch(() => { if (active) onFail?.(); });
    const handle = mediaHandle(el, ep.id);
    useStore.getState().set({ player: handle });
    return () => {
      active = false;
      hls?.destroy?.();
      if (el.currentTime > 0) void api.setProgress(ep.id, el.currentTime);
      const s = useStore.getState();
      if (s.player === handle) s.set({ player: null, playing: false });
    };
  }, [src, ep.id]);
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate]);
  return (
    <>
      <video ref={ref} className="video-native" playsInline controls poster={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} preload="metadata"
        onError={onFail}
        onLoadedMetadata={(e) => { const el = e.currentTarget; el.playbackRate = rate; const start = useStore.getState().time; if (start > 5 && start < el.duration - 10) el.currentTime = start; track(ep, el.currentTime, el.duration); }}
        onTimeUpdate={(e) => track(ep, e.currentTarget.currentTime)}
        onPlay={(e) => { useStore.getState().set({ playing: true }); if (e.currentTarget.readyState < 3) waiting(true); }}
        onWaiting={() => waiting(true)}
        onPlaying={() => waiting(false)}
        onPause={(e) => { waiting(false); useStore.getState().set({ playing: false }); void api.setProgress(ep.id, e.currentTarget.currentTime); }}
        onEnded={(e) => { void api.setProgress(ep.id, e.currentTarget.duration); playNext(); }} />
    </>
  );
}

export function Controls({ compact = false }: { compact?: boolean }) {
  const current = useStore((s) => s.current);
  const { time, length, playing, player, settings, loadingSince } = useStore(useShallow((s) => ({ time: s.time, length: s.length, playing: s.playing, player: s.player, settings: s.settings, loadingSince: s.loadingSince })));
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? time;
  const nextRate = cycleRate;
  return (
    <div className={`controls ${compact ? "compact" : ""}`}>
      <button className="icon-btn" title={t("后退 {n} 秒（←）", { n: settings.skipBack ?? 15 })} onClick={() => player?.seek(Math.max(0, time - (settings.skipBack ?? 15)))} disabled={!player}><RotateCcw size={18} /></button>
      <button className={`play-btn ${loadingSince ? "loading" : ""}`} title={loadingSince ? t("正在加载…") : playing ? t("暂停（空格）") : t("播放（空格）")} aria-label={playing ? t("暂停") : t("播放")} onClick={() => { if (player) player.toggle(); else if (current) playSoon(current.id); }} disabled={!player && !current?.videoId} aria-busy={!!loadingSince}>
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
