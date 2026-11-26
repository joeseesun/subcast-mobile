import { create } from "zustand";
import { api, type Episode, type Show } from "./lib/api";
import { DEFAULTS, loadSettings, type Settings } from "./lib/settings";
import { setLang, t } from "./lib/i18n";

export interface ShowFinder {
  searchOpen: boolean;
  query: string;
  filter: "all" | "unplayed" | "subs";
  month: string | null;
}

export type View =
  | { kind: "latest" }
  | { kind: "recent"; saved?: boolean }
  | { kind: "stats" }
  | { kind: "discover" }
  | { kind: "downloads" }
  | { kind: "notes" }
  | { kind: "library" }
  | { kind: "show"; id: string; finder?: ShowFinder }
  | { kind: "channel"; input: string }
  | { kind: "episode"; id: string };

export interface PlayerHandle {
  seek(seconds: number): void;
  toggle(): void;
  play(): void;
  pause?(): void;
  setRate(rate: number): void;
  /** Mutes or unmutes; returns whether it is muted now. */
  toggleMute?(): boolean;
  /** The episode this player plays. A video's player can be ready before the episode becomes current. */
  episodeId?: string;
  systemVideo?: boolean;
}

interface State {
  speaking: boolean;
  ready: boolean;
  /** The hot update of the interface in use (ota.rs), null when it is the one built into the app. */
  uiBuild?: number | null;
  settings: Settings;
  shows: Show[];
  view: View;
  history: View[];
  /** The episode loaded in the player (may differ from the one being viewed). */
  current: Episode | null;
  time: number;
  bufferedUntil: number;
  length: number;
  playing: boolean;
  player: PlayerHandle | null;
  /** Since when playback has been asked for but no sound has come yet (connecting, buffering); null when not waiting. */
  loadingSince?: number | null;
  /** Play as soon as the player for `current` is ready (it may take a few seconds to appear). */
  playWhenReady?: string | null;
  /** Starter shows are being subscribed in the background. */
  settingUp?: boolean;
  /** The video fills the window (and the window the screen), subtitles on it. */
  theater?: boolean;
  /** Which tab the add dialog opens on. */
  addTab?: "search" | "link" | "import";
  toast: string | null;
  toastKind?: "cache";
  settingsOpen: boolean;
  settingsSection?: "model" | "asr" | "reading" | "tts" | "shortcuts" | "general" | "storage" | "about";
  addOpen: boolean;
  init(): Promise<void>;
  go(view: View): void;
  back(): void;
  reloadShows(): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  openEpisode(ep: Episode): void;
  /** Loads an episode into the player without navigating. */
  load(ep: Episode): void;
  notify(text: string, kind?: "cache"): void;
  openSettings(section?: "model" | "asr" | "tts" | "general" | "storage" | "about"): void;
  /** Checks every subscription for new episodes; tells the user when there are some. */
  checkUpdates(): Promise<void>;
  lastChecked: number;
  set(patch: Partial<State>): void;
}

const CHECK_EVERY = 30 * 60_000;

let toastTimer: number | undefined;

export const useStore = create<State>((set, get) => ({
  ready: false,
  speaking: false,
  settings: DEFAULTS,
  shows: [],
  view: { kind: "latest" },
  history: [],
  current: null,
  time: 0,
  bufferedUntil: 0,
  length: 0,
  playing: false,
  player: null,
  toast: null,
  settingsOpen: false,
  addOpen: false,
  async init() {
    const [settings, shows] = await Promise.all([loadSettings(), api.listShows()]);
    setLang(settings.uiLang);
    set({ settings, shows, ready: true });
    void get().checkUpdates();
    // Periodically, and when the window comes back after a while (the app may sit in the background for hours).
    window.setInterval(() => void get().checkUpdates(), CHECK_EVERY);
    window.addEventListener("focus", () => { if (Date.now() - get().lastChecked > 10 * 60_000) void get().checkUpdates(); });
  },
  lastChecked: 0,
  async checkUpdates() {
    if (!get().shows.some((s) => s.kind !== "single")) return;
    set({ lastChecked: Date.now() });
    try {
      const r = await api.refreshAll();
      if (r.skipped) return;
      await get().reloadShows();
      if (r.newEpisodes > 0) get().notify(t("订阅有 {n} 期新节目", { n: r.newEpisodes }));
    } catch { /* offline: try again next time */ }
  },
  go(view) {
    set((s) => ({ view, history: [...s.history.slice(-30), s.view] }));
  },
  back() {
    const h = get().history;
    if (h.length) set({ view: h[h.length - 1], history: h.slice(0, -1) });
    else set({ view: { kind: "latest" } });
  },
  async reloadShows() {
    set({ shows: await api.listShows() });
  },
  async saveSettings(patch) {
    const settings = { ...get().settings, ...patch };
    if (patch.uiLang) setLang(patch.uiLang);
    set({ settings });
    await api.setSettings(settings);
  },
  openEpisode(ep) {
    // The episode page decides whether to load it into the player (it leaves a playing episode alone).
    get().go({ kind: "episode", id: ep.id });
  },
  load(ep) {
    const s = get();
    if (s.current?.id === ep.id) return;
    const requested = s.playWhenReady === ep.id;
    set({
      current: ep, bufferedUntil: 0, time: ep.progress || 0, length: ep.duration || 0, playing: false,
      player: s.player?.episodeId === ep.id ? s.player : null,
      playWhenReady: requested ? ep.id : null, loadingSince: requested ? s.loadingSince : null,
    });
    // Each show keeps the speed last chosen for it.
    const rate = ep.showId !== "single" ? s.settings.showRates?.[ep.showId] : undefined;
    if (rate && rate !== s.settings.playbackRate) {
      void get().saveSettings({ playbackRate: rate });
      if (requested) get().notify(t("本节目按 {rate}× 播放", { rate }));
    }
  },
  notify(text, kind) {
    set({ toast: text, toastKind: kind });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: null }), 4200);
  },
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section }),
  set: (patch) => set(patch),
}));

export function providerFor(settings: Settings, use: "chat" | "translate") {
  if (use === "translate") return settings.providers[settings.translateProvider];
  const p = settings.providers[settings.chatProvider];
  return p && settings.chatModel ? { ...p, model: settings.chatModel } : p;
}
