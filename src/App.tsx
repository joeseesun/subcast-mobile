import { ConfirmHost } from "./components/ConfirmHost";
import { useShallow } from "zustand/react/shallow";
import { SelectionTools } from "./components/SelectionTools";
import { useLayout } from "./lib/layout";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./lib/api";
import { selectionFeedback } from "./lib/feedback";
import { useReadingSettings } from "./lib/reading";
import { useRevealOnExpand } from "./lib/reveal";
import { startJobListeners } from "./lib/jobs";
import { useStore } from "./store";
import { AddDialog, Toast, TopBar } from "./components/Chrome";
import { MobileBack } from "./components/MobileBack";
import { LibraryView } from "./components/MobileNav";
import { DiscoverView, DownloadsView, LatestView, RecentView, ShowView, ChannelView, firstRunSetup } from "./components/Lists";
import { startOffline } from "./lib/offline";
import { startNowPlaying } from "./lib/nowplaying";
import { loadFavorites } from "./lib/library";
import { EpisodeView } from "./components/EpisodeView";
import { StatsView } from "./components/StatsView";
import { NotesView } from "./components/NotesView";
import { loadNotes } from "./lib/notes";
import { VideoDock } from "./components/VideoDock";
import { AudioEngine, cycleMode, noteListening, stepRate, toggleTheater } from "./components/Players";
import { actionFor, comboOf, isPlain, useKeysHelp, type ActionId } from "./lib/shortcuts";
import { useJobs } from "./lib/jobs";
import { activeIndex } from "./components/TranscriptPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { t, useLang } from "./lib/i18n";
import { MobileDock } from "./components/MobileDock";
import logo from "../assets/logo.png";

export default function App() {
  useReadingSettings();
  useRevealOnExpand();
  const { ready, view, settingsOpen, addOpen, init } = useStore(useShallow((s) => ({ ready: s.ready, view: s.view, settingsOpen: s.settingsOpen, addOpen: s.addOpen, init: s.init })));

  useEffect(() => {
    startJobListeners();
    const stopNowPlaying = startNowPlaying();
    void startOffline();
    void loadFavorites();
    void loadNotes();
    // Listening time is flushed when playback stops, not only every 20 s.
    const offPlaying = useStore.subscribe((s, prev) => { if (prev.playing && !s.playing && s.current) noteListening(s.current, false); });
    window.addEventListener("beforeunload", () => { const c = useStore.getState().current; if (c) noteListening(c, false); });
    // A fresh page owns no native player: one left from before a reload (iOS killed the web content process)
    // would keep playing, or keep its video layer over the page. Android has no such command.
    void invoke("plugin:mobile|podcast_audio", { command: { session: "", action: "reset" } }).catch(() => {});
    // Ready only once the library has loaded: a launch stuck on the boot screen is then reloaded by the app
    // (uiserver.rs watch_launch / resumed) instead of counting as rendered.
    void init().then(() => {
      void firstRunSetup();
      void api.uiReady().then((info) => useStore.setState({ uiBuild: info.build })).catch(() => {});
    });
    // Shortcuts come from one registry (lib/shortcuts.ts), so Settings › 快捷键 can change them.
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      if (!combo) return;
      const { settings } = useStore.getState();
      const action = actionFor(combo, settings.shortcuts);
      if (!action) return;
      const typing = (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable], [role=separator], .shortcut-recorder");
      if (typing && isPlain(combo)) return;
      if (document.querySelector(".shortcut-recorder.recording")) return;
      const { player, time, current } = useStore.getState();
      const segs = current ? useJobs.getState().transcripts[current.id]?.segments : undefined;
      const lineSeek = (dir: -1 | 1) => {
        if (!segs?.length) return false;
        const i = activeIndex(segs, time);
        const j = Math.min(segs.length - 1, Math.max(0, dir < 0 ? (time - (segs[i]?.start ?? 0) > 2 ? i : i - 1) : i + 1));
        player?.seek(segs[j].start);
        return true;
      };
      const run: Record<ActionId, () => boolean | void> = {
        playPause: () => player?.toggle(),
        back: () => player?.seek(Math.max(0, time - (settings.skipBack ?? 15))),
        forward: () => player?.seek(time + (settings.skipForward ?? 30)),
        backShort: () => player?.seek(Math.max(0, time - 5)),
        forwardShort: () => player?.seek(time + 5),
        prevLine: () => lineSeek(-1),
        nextLine: () => lineSeek(1),
        speedUp: () => stepRate(1),
        speedDown: () => stepRate(-1),
        mute: () => { const m = player?.toggleMute?.(); if (m != null) useStore.getState().notify(m ? t("已静音") : t("已取消静音")); },
        fullscreen: () => toggleTheater(),
        subtitleMode: () => cycleMode(),
        toggleSidebar: () => { const l = useLayout.getState(); l.put({ sideOpen: !l.sideOpen }); },
        togglePanel: () => { const l = useLayout.getState(); l.put({ panelOpen: !l.panelOpen }); },
        search: () => { const box = document.querySelector<HTMLInputElement>(".top-search input"); if (!box) return false; box.focus(); box.select(); },
        settings: () => useStore.getState().openSettings(),
        keysHelp: () => useKeysHelp.setState((s) => ({ open: !s.open })),
      };
      if (run[action]() !== false) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    const offMenu = listen("open-settings", () => useStore.getState().openSettings());
    // The first time our subtitles help someone else, say so once (and where to turn it off).
    const offShared = listen("shared-upload", () => {
      if (localStorage.getItem("sharedNoticeShown")) return;
      localStorage.setItem("sharedNoticeShown", "1");
      useStore.getState().notify(t("你的字幕已匿名分享给其他听友（设置 › 通用 可关闭）"));
    });
    return () => { stopNowPlaying(); offPlaying(); window.removeEventListener("keydown", onKey); void offMenu.then((f) => f()); void offShared.then((f) => f()); };
  }, []);

  useLang(); // re-render the tree when the interface language changes
  const historyLen = useStore((s) => s.history.length);
  const canSwipeBack = historyLen > 0 || !["latest", "discover", "library"].includes(view.kind);
  const [edgePull, setEdgePull] = useState(0);
  const swipeRef = useRef<{ x: number; y: number; active: boolean; armed: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (!canSwipeBack || e.touches.length !== 1) return;
    if (document.querySelector('[aria-modal="true"], .mobile-sheet[open]')) return;
    const touch = e.touches[0];
    if (touch.clientX <= 28) swipeRef.current = { x: touch.clientX, y: touch.clientY, active: false, armed: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = swipeRef.current;
    if (!g || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - g.x;
    const dy = Math.abs(e.touches[0].clientY - g.y);
    if (!g.active) {
      if (dy > 18 && dy > dx) { swipeRef.current = null; return; }
      if (dx > 14 && dx > dy * 1.3) g.active = true;
      else return;
    }
    const pull = Math.max(0, Math.min(110, dx));
    if (pull >= 72 && !g.armed) { g.armed = true; selectionFeedback(); }
    else if (pull < 72 && g.armed) g.armed = false;
    setEdgePull(pull);
  };
  const onTouchEnd = () => {
    const g = swipeRef.current;
    swipeRef.current = null;
    if (g?.active && edgePull >= 72) useStore.getState().back();
    setEdgePull(0);
  };

  if (!ready) return (
    <div className="boot" role="status" aria-label={t("正在启动")}>
      <img className="boot-logo" src={logo} width={64} height={64} alt="" />
      <span className="boot-name">{t("声渡")}</span>
    </div>
  );
  const viewKey = view.kind === "episode" ? `ep:${view.id}` : view.kind === "show" ? `show:${view.id}` : view.kind === "channel" ? `ch:${view.input}` : view.kind === "recent" ? `recent:${view.saved ? 1 : 0}` : view.kind;
  return (
    <div className={`app m-app ${view.kind === "episode" ? "m-full" : ""}`}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <main className="main">
        <div key={viewKey} className="m-view-stage">
          {view.kind === "discover" ? <TopBar /> : !["latest", "episode", "library", "show"].includes(view.kind) && <MobileBack />}
          {view.kind === "latest" && <LatestView />}
          {view.kind === "recent" && <RecentView savedFirst={view.saved} />}
          {view.kind === "stats" && <StatsView />}
          {view.kind === "discover" && <DiscoverView />}
          {view.kind === "downloads" && <DownloadsView />}
          {view.kind === "notes" && <NotesView />}
          {view.kind === "library" && <LibraryView />}
          {view.kind === "show" && <ShowView key={view.id} id={view.id} finder={view.finder} />}
          {view.kind === "channel" && <ChannelView key={view.input} input={view.input} />}
          {view.kind === "episode" && <EpisodeView key={view.id} id={view.id} />}
        </div>
      </main>
      {edgePull > 4 && (
        <div className={`edge-back-pill ${edgePull >= 72 ? "armed" : ""}`} aria-hidden
          style={{ transform: `translate3d(${Math.round(edgePull * 0.42) - 42}px, -50%, 0)`, opacity: Math.min(1, edgePull / 56) }}>
          <ChevronLeft size={20} />
        </div>
      )}
      <MobileDock />
      <AudioEngine />
      <VideoDock />
      {settingsOpen && <SettingsDialog />}
      {addOpen && <AddDialog />}
      <SelectionTools />
      <ConfirmHost />
      <Toast />
    </div>
  );
}
