import { ConfirmHost } from "./components/ConfirmHost";
import { useShallow } from "zustand/react/shallow";
import { SelectionTools } from "./components/SelectionTools";
import { useLayout } from "./lib/layout";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
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
    // Listening time is flushed when playback stops, not only every 20 s.
    const offPlaying = useStore.subscribe((s, prev) => { if (prev.playing && !s.playing && s.current) noteListening(s.current, false); });
    window.addEventListener("beforeunload", () => { const c = useStore.getState().current; if (c) noteListening(c, false); });
    void init().then(() => { void firstRunSetup(); });
    // Rendered: tells the app a hot-updated interface works (otherwise it falls back on its own; see ota.rs).
    void api.uiReady().then((info) => useStore.setState({ uiBuild: info.build })).catch(() => {});
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
  if (!ready) return <div className="boot" role="status" aria-label={t("正在启动")}><img src={logo} width={58} height={58} alt="" /></div>;
  return (
    <div className={`app m-app ${view.kind === "episode" ? "m-full" : ""}`}>
      <main className="main">
        {view.kind === "discover" ? <TopBar /> : !["latest", "episode", "library", "show"].includes(view.kind) && <MobileBack />}
        {view.kind === "latest" && <LatestView />}
        {view.kind === "recent" && <RecentView savedFirst={view.saved} />}
        {view.kind === "stats" && <StatsView />}
        {view.kind === "discover" && <DiscoverView />}
        {view.kind === "downloads" && <DownloadsView />}
        {view.kind === "library" && <LibraryView />}
        {view.kind === "show" && <ShowView key={view.id} id={view.id} />}
        {view.kind === "channel" && <ChannelView key={view.input} input={view.input} />}
        {view.kind === "episode" && <EpisodeView key={view.id} id={view.id} />}
      </main>
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
