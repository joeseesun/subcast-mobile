import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, Maximize2, Minimize2, Play } from "lucide-react";
import { BrandGlyph } from "./BrandGlyph";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type Episode } from "../lib/api";
import { selectionFeedback } from "../lib/feedback";
import { clock } from "../lib/format";
import { loadYouTube } from "../lib/youtube";
import { useStore, type PlayerHandle } from "../store";
import { IS_MAC, t, tr } from "../lib/i18n";
import { audioSrc, useOffline } from "../lib/offline";
import { playNext } from "../lib/library";
import { useNativeVideoLayout } from "../lib/nativeVideoLayout";

const SAVE_EVERY = 10;
/** Starts an episode as soon as its player exists: right away when it does, or when it appears (a YouTube
 *  player takes a moment to load). Replaces "wait 400 ms and hope". */
export function playSoon(id: string) {
  const s = useStore.getState();
  waiting(true);
  if (s.current?.id === id && s.player?.episodeId === id) { s.player.play(); return; }
  s.set({ playWhenReady: id });
}
function togglePendingPlayback(id: string) {
  const state = useStore.getState();
  if (state.playWhenReady === id) state.set({ playWhenReady: null, loadingSince: null });
  else playSoon(id);
}
/** Jump into normal playback even if the selected player is still opening. */
export function seekEpisode(ep: Episode, time: number) {
  const state = useStore.getState();
  if (state.current?.id === ep.id && state.player?.episodeId === ep.id) {
    state.player.seek(time);
    return;
  }
  if (state.current?.id !== ep.id) state.load({ ...ep, progress: time });
  useStore.setState({ time, playWhenReady: ep.id });
  playSoon(ep.id);
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
    pause: () => el.pause(),
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

type MediaStatus = {
  session: string; event: string; playing: boolean; waiting: boolean; revision: number;
  time: number; duration: number; buffer: number;
};
type SystemFailure = "bridge" | "source";
type NativeCommand = (action: string, values?: object) => Promise<void>;

/** Audio and direct video share one AVPlayer session, timeline and transport. */
function useSystemPlayback(ep: Episode, src: string, video: boolean, onFallback: (failure: SystemFailure) => void) {
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const [command, setCommand] = useState<NativeCommand | null>(null);
  useEffect(() => {
    const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let active = true, failed = false, muted = false, requested = false, played = false;
    let lastPosition = 0;
    let revision = 0;
    let pending = Promise.resolve<unknown>(undefined);
    const fallback = (reason: SystemFailure) => {
      if (!active || failed) return;
      failed = true;
      if (requested) useStore.setState({ playWhenReady: ep.id });
      fallbackRef.current(reason);
    };
    const send: NativeCommand = (action, values = {}) => {
      const run = pending.catch(() => {}).then(async () => {
        if (active || action === "dispose") await invoke("plugin:mobile|podcast_audio", { command: { session, action, ...values } });
      });
      pending = run.catch(() => {});
      return run;
    };
    const transport = (action: string, values?: object) => { void send(action, values).catch(() => fallback("bridge")); };
    const setIntent = (action: "play" | "pause" | "seek", value?: number) => {
      requested = action !== "pause";
      waiting(requested);
      transport(action, { value, revision: ++revision });
    };
    const pause = () => setIntent("pause");
    const play = () => setIntent("play");
    const handle: PlayerHandle = {
      episodeId: ep.id, systemVideo: video,
      play, pause,
      toggle: () => requested ? pause() : play(),
      seek: (value) => { useStore.setState({ time: value }); setIntent("seek", value); },
      setRate: (value) => transport("rate", { value }),
      toggleMute: () => { muted = !muted; transport("mute", { value: muted ? 1 : 0 }); return muted; },
    };
    const listener = addPluginListener<MediaStatus>("mobile", "podcast", (status) => {
      const s = useStore.getState();
      if (!active || failed || status.session !== session || s.current?.id !== ep.id || !!s.current.videoId !== video) return;
      if (status.event === "failed") { fallback("source"); return; }
      if (status.revision < revision) return;
      if (s.playing && !status.playing) void api.setProgress(ep.id, status.time);
      lastPosition = status.time;
      played ||= status.playing;
      s.set({ playing: status.playing, bufferedUntil: status.buffer });
      requested = status.playing || status.waiting;
      waiting(status.waiting);
      track(ep, status.time, status.duration);
      if (status.event === "ended") { void api.setProgress(ep.id, status.duration || status.time); void playNext(); }
    });
    void listener.then(async () => {
      if (!active) return;
      const s = useStore.getState();
      await send("prepare", { url: src, value: s.time, rate: s.settings.playbackRate, video });
      if (active && !failed) {
        useStore.setState({ player: handle });
        setCommand(() => send);
      }
    }).catch(() => fallback("bridge"));
    return () => {
      active = false;
      if (useStore.getState().player === handle) useStore.setState({ player: null, bufferedUntil: 0, playing: false });
      if (played && lastPosition > 0) void api.setProgress(ep.id, lastPosition);
      void send("dispose").catch(() => {});
      void listener.then((l) => l.unregister()).catch(() => {});
    };
  }, [ep.id, src, video]);
  return command;
}

function SystemAudio({ ep, src, onFallback }: { ep: Episode; src: string; onFallback: () => void }) {
  useSystemPlayback(ep, src, false, onFallback);
  return null;
}

function SystemVideo({ ep, src, onFallback }: { ep: Episode; src: string; onFallback: (failure: SystemFailure) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const { playing, loading } = useStore(useShallow((s) => ({ playing: s.playing, loading: !!s.loadingSince })));
  const command = useSystemPlayback(ep, src, true, onFallback);
  const layout = useMemo(() => command ? (value: object) => command("video-layout", { layout: value }) : null, [command]);
  useNativeVideoLayout(stage, layout);
  return <div className="system-video-frame" ref={stage} data-system-video>
    <img src={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} alt="" />
    <button className="inline-video-toggle" aria-label={playing || loading ? t("暂停") : t("播放")} onClick={() => {
      const { player } = useStore.getState();
      selectionFeedback();
      if (player?.episodeId === ep.id) player.toggle(); else togglePendingPlayback(ep.id);
    }}>
      {!playing && <span>{loading ? <Loader2 size={24} className="spin" /> : <BrandGlyph name="play" size={29} />}</span>}
    </button>
    <button className="inline-fullscreen" aria-label={t("全屏播放")} onClick={() => {
      if (command) void command("video-fullscreen").catch(() => toggleTheater(true));
      else toggleTheater(true);
    }}><Maximize2 size={19} /></button>
  </div>;
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

/** On iOS, direct video uses AVPlayer with the system full-screen controls.
 * Android tries the embed first. Each failed source advances at most once. */
export function YouTubePlayer({ ep, overlay, onUnplayable }: { ep: Episode; overlay?: React.ReactNode; onUnplayable?: () => void }) {
  const routes = IS_MAC ? ["native-hls", "relay-hls", "relay-mp4", "embed"] as const : ["embed", "proxy-hls", "mp4"] as const;
  const [attempt, setAttempt] = useState(0);
  const [webAttempt, setWebAttempt] = useState(-1);
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
        <p title={reason}>{t("暂时无法播放视频")}</p><div className="row-actions">
          <button className="btn sm" onClick={() => { playSoon(ep.id); setMedia(null); setWebAttempt(-1); setAttempt(0); }}>{t("重试")}</button>
          {onUnplayable && <button className="btn sm" onClick={onUnplayable}>{t("仅音频")}</button>}
          {!onUnplayable && <button className="btn sm" onClick={openVideo}>{t("在 YouTube 打开")}</button>}
        </div>
      </div> : route === "embed" ? <EmbedVideo ep={ep} onBlocked={fail} onError={fail} /> :
        media?.attempt === attempt ? (
          IS_MAC && webAttempt !== attempt
            ? <SystemVideo key={attempt} ep={ep} src={media.url} onFallback={(failure) => {
                if (failure === "bridge") setWebAttempt(attempt);
                else fail(t("视频地址失效，请稍后再试"));
              }} />
            : <NativeVideo key={attempt} ep={ep} src={media.url} kind={media.kind} onFail={() => fail(t("视频地址失效，请稍后再试"))} />
        ) :
        <button className="video-loading" onClick={() => { selectionFeedback(); togglePendingPlayback(ep.id); }} aria-label={pending ? t("暂停") : t("播放")}>
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

type IOSVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/** `onFail`: the stream can't be played (stale address, or HLS unsupported here); the caller gets another. */
function NativeVideo({ ep, src, kind, onFail }: { ep: Episode; src: string; kind: "hls" | "mp4"; onFail?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const rate = useStore((s) => s.settings.playbackRate);
  const priming = useRef(false);
  const quietPause = useRef(false);
  const shouldPlay = useRef(false);
  const recoveredAt = useRef(0);
  const recovering = useRef<number | undefined>(undefined);
  const recentWaits = useRef<number[]>([]);
  const stalled = useRef<number | undefined>(undefined);
  const failure = useRef(onFail);
  const playing = useStore((s) => s.playing);
  failure.current = onFail;

  const clearRecovery = () => {
    window.clearTimeout(recovering.current);
    recovering.current = undefined;
  };

  const clearStall = () => {
    window.clearTimeout(stalled.current);
    stalled.current = undefined;
  };
  const onStall = (el: HTMLVideoElement) => {
    if (priming.current || el.paused) return;
    waiting(true);
    if (stalled.current !== undefined) return;
    const now = performance.now();
    recentWaits.current = recentWaits.current.filter((time) => now - time < 20_000);
    recentWaits.current.push(now);
    if (recentWaits.current.length >= 3 && !el.seeking && shouldPlay.current) {
      failure.current?.();
      return;
    }
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
    shouldPlay.current = false;
    recoveredAt.current = 0;
    recentWaits.current = [];
    el.muted = mayPrime;
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
      }
      quietPause.current = false;
    };
    const play = () => {
      takeControl();
      shouldPlay.current = true;
      window.clearTimeout(recovering.current);
      ordinary.play();
    };
    const pause = () => {
      shouldPlay.current = false;
      clearRecovery();
      clearStall();
      waiting(false);
      if (useStore.getState().player === handle) useStore.setState({ playing: false });
      ordinary.pause();
    };
    const handle = {
      ...ordinary,
      play, pause,
      toggle: () => shouldPlay.current ? pause() : play(),
      seek: (time: number) => {
        takeControl();
        clearRecovery();
        recentWaits.current = [];
        shouldPlay.current = true;
        ordinary.seek(time);
      },
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
      clearRecovery();
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
      <video ref={ref} className="video-native" playsInline controls={!IS_MAC} poster={`https://i.ytimg.com/vi/${ep.videoId}/hqdefault.jpg`} preload="auto"
        onError={onFail}
        onLoadedMetadata={(e) => { const el = e.currentTarget; el.playbackRate = rate; const start = useStore.getState().time; if (start > 0 && (!Number.isFinite(el.duration) || start < el.duration)) el.currentTime = start; track(ep, el.currentTime, el.duration); }}
        onProgress={(e) => syncBuffer(e.currentTarget, ep.id)}
        onSeeked={(e) => { syncBuffer(e.currentTarget, ep.id); if (!priming.current) track(ep, e.currentTarget.currentTime); }}
        onTimeUpdate={(e) => { if (!priming.current && !quietPause.current) track(ep, e.currentTarget.currentTime); }}
        onPlay={(e) => {
          if (priming.current) return;
          if ((e.currentTarget as IOSVideo).webkitDisplayingFullscreen) shouldPlay.current = true;
          quietPause.current = false;
          useStore.getState().set({ playing: true });
          if (e.currentTarget.readyState < 3) onStall(e.currentTarget);
        }}
        onPlaying={() => { clearStall(); if (!priming.current && !quietPause.current && !ref.current?.paused) { useStore.setState({ playing: true }); waiting(false); } }}
        onWaiting={(e) => onStall(e.currentTarget)}
        onPause={(e) => {
          clearStall();
          const el = e.currentTarget as IOSVideo;
          if (priming.current || quietPause.current || !el.paused) return;
          const stillCurrent = useStore.getState().current?.id === ep.id && ref.current === el;
          if (IS_MAC && shouldPlay.current && stillCurrent && !el.ended && !document.hidden && !el.webkitDisplayingFullscreen) {
            const now = performance.now();
            if (recoveredAt.current && now - recoveredAt.current < 12_000) {
              failure.current?.();
              return;
            }
            recoveredAt.current = now;
            waiting(true);
            recovering.current = window.setTimeout(() => {
              recovering.current = undefined;
              if (!shouldPlay.current || ref.current !== el) return;
              if (document.hidden) {
                shouldPlay.current = false;
                waiting(false);
                useStore.setState({ playing: false });
                return;
              }
              void el.play().catch(() => { if (shouldPlay.current && ref.current === el) failure.current?.(); });
            }, 220);
            return;
          }
          shouldPlay.current = false;
          if (stillCurrent) {
            waiting(false);
            useStore.setState({ playing: false });
            void api.setProgress(ep.id, el.currentTime);
          }
        }}
        onEnded={(e) => { shouldPlay.current = false; clearStall(); clearRecovery(); void api.setProgress(ep.id, e.currentTarget.duration); playNext(); }} />
      {IS_MAC && <>
        <button className="inline-video-toggle" aria-label={playing ? t("暂停") : t("播放")} onClick={() => {
          const player = useStore.getState().player;
          if (player?.episodeId === ep.id) player.toggle();
          else playSoon(ep.id);
        }}>
          {!playing && <span><BrandGlyph name="play" size={29} /></span>}
        </button>
        <button className="inline-fullscreen" aria-label={t("全屏播放")} onClick={() => {
          const video = ref.current as IOSVideo | null;
          if (video?.webkitEnterFullscreen && video.readyState >= 2) {
            try { video.webkitEnterFullscreen(); return; } catch { /* Use the app's expanded view. */ }
          }
          toggleTheater(true);
        }}><Maximize2 size={19} /></button>
      </>}
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
      <button className="icon-btn" title={t("后退 {n} 秒（←）", { n: settings.skipBack ?? 15 })} onClick={() => player?.seek(Math.max(0, time - (settings.skipBack ?? 15)))} disabled={!player}><BrandGlyph name="back" interval={settings.skipBack ?? 15} /></button>
      <button className={`play-btn ${loadingSince ? "loading" : ""}`} title={loadingSince ? t("正在加载…") : playing ? t("暂停（空格）") : t("播放（空格）")} aria-label={playing || loadingSince ? t("暂停") : t("播放")} onClick={() => { selectionFeedback(); if (player) player.toggle(); else if (current) togglePendingPlayback(current.id); }} disabled={!player && !current} aria-busy={!!loadingSince}>
        {loadingSince ? <Loader2 size={20} className="spin" /> : playing ? <BrandGlyph name="pause" size={25} /> : <BrandGlyph name="play" size={25} />}
      </button>
      <button className="icon-btn" title={t("前进 {n} 秒（→）", { n: settings.skipForward ?? 30 })} onClick={() => player?.seek(time + (settings.skipForward ?? 30))} disabled={!player}><BrandGlyph name="next" interval={settings.skipForward ?? 30} /></button>
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
