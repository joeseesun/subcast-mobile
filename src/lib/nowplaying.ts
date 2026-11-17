// Mirrors the player into the phone's lock screen / Control Center (iOS) and media notification (Android, which
// also keeps playback alive in the background), and takes their buttons back. Native side: plugins/mobile.
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { showName } from "./picks";

const send = (info: unknown) => invoke("plugin:mobile|now_playing", { info }).catch(() => {});

export function startNowPlaying() {
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
  useStore.subscribe((s, prev) => {
    if (s.current?.id !== prev.current?.id || s.playing !== prev.playing || s.length !== prev.length) push(true);
    else if (Math.abs(s.time - prev.time) > 3) push(true); // a seek
    else push();
  });

  void addPluginListener<{ action: string; position?: number }>("mobile", "remote", ({ action, position }) => {
    const s = useStore.getState();
    const p = s.player;
    if (!p) return;
    if (action === "play") { if (!s.playing) p.toggle(); }
    else if (action === "pause") { if (s.playing) p.toggle(); }
    else if (action === "toggle") p.toggle();
    else if (action === "forward") p.seek(s.time + (s.settings.skipForward ?? 30));
    else if (action === "back") p.seek(Math.max(0, s.time - (s.settings.skipBack ?? 15)));
    else if (action === "seek" && position != null) p.seek(position);
  }).catch(() => {});
}
