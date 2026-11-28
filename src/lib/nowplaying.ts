// Mirrors the player into the phone's lock screen / Control Center (iOS) and media notification (Android, which
// also keeps playback alive in the background), and takes their buttons back. Native side: plugins/mobile.
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store";
import { showName } from "./picks";

declare global {
  interface Window {
    __subcastBack?: () => boolean;
  }
}

const ROOT_VIEWS = new Set(["latest", "discover", "library"]);

/** Android system back / edge-swipe handler: closes the topmost dialog, exits full screen, or pops view history.
 *  Returns false at a root tab so MainActivity moves the app to the background without stopping audio. */
function handleAndroidBack(): boolean {
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  if (dialogs.length) {
    const top = dialogs[dialogs.length - 1];
    top.dispatchEvent(new Event("cancel", { cancelable: true }));
    return true;
  }
  const s = useStore.getState();
  if (s.settingsOpen) { s.set({ settingsOpen: false }); return true; }
  if (s.addOpen) { s.set({ addOpen: false }); return true; }
  if (s.theater) {
    s.set({ theater: false });
    (window as unknown as { SubcastAndroid?: { setFullscreen?: (v: boolean) => void } }).SubcastAndroid?.setFullscreen?.(false);
    void getCurrentWindow().setFullscreen(false).catch(() => {});
    return true;
  }
  if (s.history.length > 0 || !ROOT_VIEWS.has(s.view.kind)) {
    s.back();
    return true;
  }
  return false;
}

const send = (info: unknown) => invoke("plugin:mobile|now_playing", { info }).catch(() => {});

export function startNowPlaying() {
  window.__subcastBack = handleAndroidBack;
  // Android draws edge to edge without env(safe-area-inset-*): take the bar heights from the native side.
  void invoke<{ top: number; bottom: number } | null>("plugin:mobile|insets").then((r) => {
    if (!r || (!r.top && !r.bottom)) return;
    document.documentElement.style.setProperty("--safe-top", `${r.top}px`);
    document.documentElement.style.setProperty("--safe-bottom", `${r.bottom}px`);
  }).catch(() => {});
  let lastKey = "";
  let lastPush = 0;
  const push = (force = false) => {
    const s = useStore.getState();
    const ep = s.current;
    if (!ep) { if (lastKey) { lastKey = ""; void invoke("plugin:mobile|clear_now_playing").catch(() => {}); } return; }
    const key = `${ep.id}|${s.playing}|${s.settings.playbackRate}`;
    // Position only needs refreshing now and then: the system extrapolates it from the rate.
    if (!force && key === lastKey && Date.now() - lastPush < 15_000) return;
    lastKey = key;
    lastPush = Date.now();
    void send({
      title: ep.title,
      artist: ep.showTitle && ep.showId !== "single" ? showName(ep.showTitle) : "SubCast",
      artwork: ep.cover,
      duration: s.length || ep.duration || 0,
      position: s.time,
      rate: s.settings.playbackRate ?? 1,
      playing: s.playing,
    });
  };
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.current?.id !== prev.current?.id || s.playing !== prev.playing || s.length !== prev.length) push(true);
    else if (Math.abs(s.time - prev.time) > 3) push(true); // a seek
    else push();
  });

  const listener = addPluginListener<{ action: string; position?: number }>("mobile", "remote", ({ action, position }) => {
    const s = useStore.getState();
    const p = s.player;
    if (!p) return;
    if (action === "play") p.play();
    else if (action === "pause") { if (p.pause) p.pause(); else if (s.playing) p.toggle(); }
    else if (action === "interruption") p.pause?.();
    else if (action === "toggle") p.toggle();
    else if (action === "forward") p.seek(s.time + (s.settings.skipForward ?? 30));
    else if (action === "back") p.seek(Math.max(0, s.time - (s.settings.skipBack ?? 15)));
    else if (action === "seek" && position != null) p.seek(position);
  }).catch(() => null);
  return () => {
    delete window.__subcastBack;
    unsubscribe();
    void listener.then((handle) => handle?.unregister()).catch(() => {});
  };
}
