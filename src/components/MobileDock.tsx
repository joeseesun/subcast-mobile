import { useEffect, useRef, useState } from "react";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { IS_MAC, t, useLang } from "../lib/i18n";
import { useZh } from "../lib/zh";
import { showName } from "../lib/picks";
import { MiniPlayer } from "./Chrome";
import { MobileNav, mobileTabs, selectedRoot, switchRoot, type Root } from "./MobileNav";

const modalSelector = '[aria-modal="true"], .mobile-sheet[open]';

type DockAction = { action: "tab" | "open" | "play"; id: string };

function useDockCovered() {
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (!IS_MAC) return;
    const viewport = window.visualViewport;
    const check = () => {
      const keyboard = !!viewport && viewport.height < window.innerHeight - 120;
      const modal = !!document.querySelector(modalSelector);
      setCovered(document.hidden || keyboard || modal);
    };
    // The native surface sits above the web view, including web dialogs.
    // Track dialog presence so it never takes taps or accessibility focus from a sheet.
    const watch = new MutationObserver((changes) => {
      const includesModal = (node: Node) =>
        node instanceof Element && (node.matches('[aria-modal], dialog') || !!node.querySelector('[aria-modal], dialog'));
      if (changes.some((change) => change.type === "attributes" ||
          Array.from(change.addedNodes).some(includesModal) || Array.from(change.removedNodes).some(includesModal))) {
        check();
      }
    });
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-modal"] });
    viewport?.addEventListener("resize", check);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      watch.disconnect();
      viewport?.removeEventListener("resize", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return covered;
}

export function MobileDock() {
  const { view, history, current, playing, loading, canPlay, progress, systemVideo } = useStore(useShallow((s) => ({
    view: s.view,
    history: s.history,
    current: s.current,
    playing: s.playing,
    loading: !!s.loadingSince,
    canPlay: !!s.player,
    systemVideo: !!s.player?.systemVideo,
    progress: s.length > 0 ? Math.round((s.time / s.length) * 100) / 100 : 0,
  })));
  useLang((s) => s.lang);
  const covered = useDockCovered();
  const [ready, setReady] = useState(false);
  const [native, setNative] = useState(false);
  const queue = useRef(Promise.resolve());
  const mini = current && (!current.videoId || systemVideo) && !(view.kind === "episode" && view.id === current.id) ? current : null;
  const translated = useZh(mini?.title);

  useEffect(() => {
    if (!IS_MAC) return;
    let active = true;
    const listener = addPluginListener<DockAction>("mobile", "glass-dock-action", ({ action, id }) => {
      if (!active || document.querySelector(modalSelector)) return;
      const state = useStore.getState();
      if (action === "tab" && mobileTabs.some((tab) => tab.id === id) && state.view.kind !== "episode") {
        switchRoot(id as Root);
      }
      if (state.current?.id !== id) return;
      if (action === "play") state.player?.toggle();
      if (action === "open") state.openEpisode(state.current);
    });
    void listener.then(() => { if (active) setReady(true); }).catch(() => {});
    return () => {
      active = false;
      void listener.then((subscription) => subscription.unregister()).catch(() => {});
    };
  }, []);

  const state = JSON.stringify({
    visible: !covered,
    tabs: view.kind === "episode" ? [] : mobileTabs.map(({ id, label }) => ({ id, title: t(label) })),
    selected: selectedRoot(view, history),
    player: mini ? {
      id: mini.id,
      title: translated ?? mini.title,
      show: mini.showTitle && mini.showId !== "single" ? showName(mini.showTitle) : null,
      artwork: mini.cover?.startsWith("http") ? mini.cover : null,
      playLabel: playing || loading ? t("暂停") : t("播放"),
      isPlaying: playing,
      isLoading: loading,
      canPlay,
      progress,
    } : null,
  });
  useEffect(() => {
    if (!ready) return;
    let active = true;
    queue.current = queue.current.then(async () => {
      if (!active) return;
      const supported = await invoke<boolean>("plugin:mobile|update_glass_dock", { state: JSON.parse(state) });
      if (active) setNative(supported);
    }).catch(() => { if (active) setNative(false); });
    return () => { active = false; };
  }, [ready, state]);

  if (native) return <span hidden data-native-dock={mini ? "player" : view.kind === "episode" ? "none" : "tabs"} />;
  return <><MiniPlayer /><MobileNav /></>;
}
