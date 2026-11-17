import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, Minimize2, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Episode } from "../lib/api";
import { clock } from "../lib/format";
import { loadYouTube } from "../lib/youtube";
import { useStore, type PlayerHandle } from "../store";
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

function syncBuffer(el: HTMLMediaElement, id: string) {
  const s = useStore.getState();
  if (s.player?.episodeId !== id || s.current?.id !== id) return;
  let end = 0;
  for (let i = 0; i < el.buffered.length; i++) {
    if (el.buffered.start(i) <= el.currentTime + 0.1 && el.buffered.end(i) >= el.currentTime) {
      end = el.buffered.end(i);
      break;
    }
  }
  if (s.bufferedUntil !== end) s.set({ bufferedUntil: end });
}

function mediaHandle(el: HTMLMediaElement, episodeId: string) {
  const play = () => {
    if (el.error) el.load();
    if (el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) waiting(true);
    void el.play().catch((error: Error) => {
      if (error.name === "AbortError" || useStore.getState().player?.episodeId !== episodeId) return;
      useStore.setState({ playing: false, loadingSince: null });
      if (!el.error) useStore.getState().notify(t("播放失败，请再点一次播放"));
    });
  };
  return {
    episodeId, play,
    seek: (time: number) => {
      const target = Math.max(0, Number.isFinite(el.duration) ? Math.min(time, el.duration) : time);
      el.currentTime = target;
      if (useStore.getState().current?.id === episodeId) useStore.setState({ time: target });
      play();
    },
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
  const saved = useOffline((s) => s.saved[audio.id]?.path);
  const playing = useStore((s) => s.playing);
  const [fallback, setFallback] = useState(false);
  const [local, setLocal] = useState(!!saved);
  useEffect(() => { if (!playing || !saved) setLocal(!!saved); }, [saved, playing]);
  if (IS_MAC && !local && !fallback && /^https?:\/\//i.test(audio.audioUrl ?? "")) {
    return <SystemAudio ep={audio} src={audio.audioUrl!} onFallback={() => setFallback(true)} />;
  }
  return <WebAudio audio={audio} />;
}

type AudioStatus = {
  session: string; event: string; playing: boolean; waiting: boolean;
  time: number; duration: number; buffer: number;
};

function SystemAudio({ ep, src, onFallback }: { ep: Episode; src: string; onFallback: () => void }) {
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  useEffect(() => {
    const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let active = true, failed = false, muted = false, requested = false;
    let pending = Promise.resolve();
    const fallback = () => {
      if (!active || failed) return;
      failed = true;
      if (requested) useStore.setState({ playWhenReady: ep.id });
      fallbackRef.current();
    };
    const send = (action: string, values: object = {}) => {
      pending = pending.then(async () => {
        if (active || action === "dispose") await invoke("plugin:mobile|podcast_audio", { command: { session, action, ...values } });
      }).catch(fallback);
      return pending;
    };
    const handle: PlayerHandle = {
      episodeId: ep.id,
      play: () => { requested = true; waiting(true); void send("play"); },
      toggle: () => { requested = !requested; waiting(requested); void send("toggle"); },
      seek: (value) => { requested = true; useStore.setState({ time: value }); waiting(true); void send("seek", { value }); },
      setRate: (value) => { void send("rate", { value }); },
      toggleMute: () => { muted = !muted; void send("mute", { value: muted ? 1 : 0 }); return muted; },
    };
    const listener = addPluginListener<AudioStatus>("mobile", "podcast", (status) => {
      const s = useStore.getState();
      if (!active || status.session !== session || s.current?.id !== ep.id || s.current.videoId) return;
      if (status.event === "failed") { fallback(); return; }
      if (s.playing && !status.playing) void api.setProgress(ep.id, status.time);
      s.set({ playing: status.playing, bufferedUntil: status.buffer });
      requested = status.playing || status.waiting;
      waiting(status.waiting);
      track(ep, status.time, status.duration);
      if (status.event === "ended") { void api.setProgress(ep.id, status.duration || status.time); void playNext(); }
    });
    void listener.then(async () => {
      if (!active) return;
      const s = useStore.getState();
      await send("prepare", { url: src, value: s.time, rate: s.settings.playbackRate });
      if (active && !failed) useStore.setState({ player: handle });
    }).catch(fallback);
    return () => {
      active = false;
      if (useStore.getState().player === handle) useStore.setState({ player: null, bufferedUntil: 0, playing: false });
      void send("dispose");
      void listener.then((l) => l.unregister()).catch(() => {});
    };
  }, [ep.id, src]);
  return null;
}

function WebAudio({ audio }: { audio: Episode }) {
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
      preload="auto"
      onLoadedMetadata={(e) => {
        const el = e.currentTarget;
        el.playbackRate = rate;
        const s = useStore.getState();
        const start = s.current?.id === audio.id ? s.time : audio.progress;
        if (start > 0 && (!Number.isFinite(el.duration) || start < el.duration)) el.currentTime = start;
        track(audio, el.currentTime, el.duration);
      }}
      onProgress={(e) => syncBuffer(e.currentTarget, audio.id)}
      onSeeked={(e) => syncBuffer(e.currentTarget, audio.id)}
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
  const routes = IS_MAC ? ["native-hls", "relay-hls", "relay-mp4", "embed"] as const : ["embed", "proxy-hls", "mp4"] as const;
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
    useStore.setState({ bufferedUntil: 0 });
    if (!route) { useStore.setState({ playing: false, loadingSince: null, playWhenReady: null }); return; }
    if (route === "embed") return;
    let active = true;
    void api.youtubeStream(ep.videoId!, route, route !== "native-hls").then((result) => {
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
    let stalledAt = 0;
    let previousTime = -1;
    const start = useStore.getState().current?.id === ep.id ? useStore.getState().time : ep.progress;
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
        playerVars: { controls: 1, fs: 1, playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, iv_load_policy: 3, start: Math.floor(Math.max(0, start)), origin: window.location.origin },
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
                seek: (t: number) => { player.seekTo(t, true); useStore.setState({ time: t }); player.playVideo(); },
                toggle: () => (player.getPlayerState() === 1 ? player.pauseVideo() : (waiting(true), player.playVideo())),
                play: () => { waiting(true); player.playVideo(); },
                setRate: (r: number) => player.setPlaybackRate(r),
                toggleMute: () => { if (player.isMuted?.()) { player.unMute(); return false; } player.mute(); return true; },
              },
            });
            timer = window.setInterval(() => {
              const time = player.getCurrentTime?.();
              if (typeof time !== "number") return;
              track(ep, time, player.getDuration?.());
              const status = player.getPlayerState();
              const loading = useStore.getState().loadingSince;
              if ((status === 3 || ((status === -1 || status === 5) && loading)) && Math.abs(time - previousTime) < 0.1) {
                if (!stalledAt) stalledAt = performance.now();
                if (performance.now() - stalledAt > 12_000) {
                  window.clearInterval(timer);
                  onError(t("视频缓冲超时"));
                }
              } else stalledAt = 0;
              previousTime = time;
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
  const [preparing, setPreparing] = useState(false);
  const priming = useRef(false);
  const quietPause = useRef(false);
  const stalled = useRef<number | undefined>(undefined);
  const failure = useRef(onFail);
  failure.current = onFail;

  const clearStall = () => {
    window.clearTimeout(stalled.current);
    stalled.current = undefined;
  };
  const onStall = (el: HTMLVideoElement) => {
    if (priming.current || el.paused) return;
    waiting(true);
    if (stalled.current !== undefined) return;
    const position = el.currentTime;
    stalled.current = window.setTimeout(() => {
      stalled.current = undefined;
      if (!el.paused && el.currentTime <= position + 0.1 && ref.current === el) {
        failure.current?.();
      }
    }, 10_000);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mayPrime = IS_MAC && document.visibilityState === "visible"
      && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    priming.current = mayPrime;
    quietPause.current = false;
    el.muted = mayPrime;
    setPreparing(mayPrime);
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
    const ordinary = mediaHandle(el, ep.id);
    const takeControl = () => {
      if (priming.current) {
        priming.current = false;
        el.muted = false;
        setPreparing(false);
      }
      quietPause.current = false;
    };
    const handle = { ...ordinary,
      play: () => { takeControl(); ordinary.play(); },
      toggle: () => { if (priming.current) { takeControl(); ordinary.play(); } else ordinary.toggle(); },
      seek: (time: number) => { takeControl(); ordinary.seek(time); },
    };
    useStore.getState().set({ player: handle });
    // WebKit may ignore preload=auto on iPhone. Decode the first frame silently in the
    // selected element, then park it. A transport tap always takes over immediately.
    const park = () => {
      if (!active || !priming.current) return;
      priming.current = false;
      quietPause.current = true;
      el.pause();
      el.muted = false;
      setPreparing(false);
      syncBuffer(el, ep.id);
    };
    const whenPlaying = () => { if (!el.seeking) park(); };
    el.addEventListener("playing", whenPlaying);
    const timer = window.setTimeout(park, 8000);
    if (priming.current) void el.play().catch(park);
    return () => {
      active = false;
      window.clearTimeout(timer);
      clearStall();
      el.removeEventListener("playing", whenPlaying);
      el.pause();
      hls?.destroy?.();
      if (el.currentTime > 0) void api.setProgress(ep.id, el.currentTime);
      const s = useStore.getState();
      if (s.player === handle) s.set({ player: null, playing: false });
    };
  }, [src, ep.id]);
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate]);
  return (
    <>
      <video ref={ref} className="video-native" playsInline controls={!preparing} poster={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} preload="auto"
        onError={onFail}
        onLoadedMetadata={(e) => { const el = e.currentTarget; el.playbackRate = rate; const start = useStore.getState().time; if (start > 0 && (!Number.isFinite(el.duration) || start < el.duration)) el.currentTime = start; track(ep, el.currentTime, el.duration); }}
        onProgress={(e) => syncBuffer(e.currentTarget, ep.id)}
        onSeeked={(e) => { syncBuffer(e.currentTarget, ep.id); if (!priming.current) track(ep, e.currentTarget.currentTime); }}
        onTimeUpdate={(e) => { if (!priming.current && !quietPause.current) track(ep, e.currentTarget.currentTime); }}
        onPlay={(e) => { if (priming.current) return; quietPause.current = false; useStore.getState().set({ playing: true }); if (e.currentTarget.readyState < 3) onStall(e.currentTarget); }}
        onWaiting={(e) => onStall(e.currentTarget)}
        onPlaying={() => { clearStall(); if (!priming.current && !quietPause.current && !ref.current?.paused) { useStore.setState({ playing: true }); waiting(false); } }}
        onPause={(e) => { clearStall(); if (priming.current || quietPause.current) return; waiting(false); useStore.getState().set({ playing: false }); void api.setProgress(ep.id, e.currentTarget.currentTime); }}
        onEnded={(e) => { clearStall(); void api.setProgress(ep.id, e.currentTarget.duration); playNext(); }} />
      {preparing && <button className="video-preroll" aria-label={t("播放")} onClick={() => playSoon(ep.id)}><Play size={28} fill="currentColor" /></button>}
    </>
  );
}

export function Controls({ compact = false, leading }: { compact?: boolean; leading?: React.ReactNode }) {
  const current = useStore((s) => s.current);
  const { time, length, bufferedUntil, playing, player, settings, loadingSince } = useStore(useShallow((s) => ({ time: s.time, length: s.length, bufferedUntil: s.bufferedUntil, playing: s.playing, player: s.player, settings: s.settings, loadingSince: s.loadingSince })));
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? time;
  const commitSeek = (input: HTMLInputElement) => {
    player?.seek(input.valueAsNumber);
    setDrag(null);
  };
  return (
    <div className={`controls ${compact ? "compact" : ""}`}>
      {leading}
      <button className="icon-btn" title={t("后退 {n} 秒（←）", { n: settings.skipBack ?? 15 })} onClick={() => player?.seek(Math.max(0, time - (settings.skipBack ?? 15)))} disabled={!player}><RotateCcw size={18} /></button>
      <button className={`play-btn ${loadingSince ? "loading" : ""}`} title={loadingSince ? t("正在加载…") : playing ? t("暂停（空格）") : t("播放（空格）")} aria-label={playing ? t("暂停") : t("播放")} onClick={() => { if (player) player.toggle(); else if (current) playSoon(current.id); }} disabled={!player && !current} aria-busy={!!loadingSince}>
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
        onPointerUp={(e) => commitSeek(e.currentTarget)}
        onPointerCancel={() => setDrag(null)}
        onKeyUp={(e) => { if (drag !== null) commitSeek(e.currentTarget); }}
        style={{ "--buffer": `${length ? Math.min(100, bufferedUntil / length * 100) : 0}%`, "--fill": `${length ? (shown / length) * 100 : 0}%` } as React.CSSProperties}
        aria-label={t("播放进度")}
      />
      <span className="time">{length ? clock(length) : "--:--"}</span>
      <select className="rate-btn" value={settings.playbackRate} aria-label={t("播放速度")} onChange={(event) => {
        const rate = Number(event.currentTarget.value);
        player?.setRate(rate);
        void useStore.getState().saveSettings({ playbackRate: rate });
      }}>{Array.from(new Set([...RATES, settings.playbackRate])).sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r}×</option>)}</select>
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
