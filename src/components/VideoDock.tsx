// Keeps a playing video alive across pages. The YouTube player lives once, at the app's root, and is only moved
// with CSS: over the episode page's video slot when that page is open, or into a small floating window when
// the listener goes elsewhere. Moving a node holding an iframe would reload it; this never moves it.
import { useEffect, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import { ExternalLink, X } from "lucide-react";
import type { Episode } from "../lib/api";
import { YouTubePlayer } from "./Players";
import { useStore } from "../store";
import { t } from "../lib/i18n";

interface Slot { ep: Episode; el: HTMLElement; overlay?: React.ReactNode; onUnplayable?: () => void; onRecoveryChange?: (showing: boolean) => void }
interface Dock { slot: Slot | null; /** The episode playing in the floating window after its page closed. */ floating: { ep: Episode; overlay?: React.ReactNode } | null }
export const useVideoDock = create<Dock>(() => ({ slot: null, floating: null }));

/** The episode page's place for its video. Leaving the page while it plays keeps it playing, floating. */
export function VideoSlot({ ep, overlay, onUnplayable, onRecoveryChange }: Omit<Slot, "el">) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    useVideoDock.setState({ slot: { ep, el, overlay, onUnplayable, onRecoveryChange }, floating: null });
    return () => {
      const s = useStore.getState();
      const keep = s.current?.id === ep.id && (s.playing || s.playWhenReady === ep.id || s.player?.systemVideo);
      useVideoDock.setState((d) => (d.slot?.el === el ? { slot: null, floating: keep ? { ep, overlay } : null } : d));
    };
  }, [ep.id]);
  useEffect(() => { useVideoDock.setState((d) => (d.slot?.el === ref.current ? { slot: { ...d.slot!, overlay, onUnplayable, onRecoveryChange } } : d)); }, [overlay, onUnplayable, onRecoveryChange]);
  return <div className="video-slot" ref={ref} />;
}

export function VideoDock() {
  const { slot, floating } = useVideoDock();
  const box = useRef<HTMLDivElement>(null);
  const ep = slot?.ep ?? floating?.ep;
  const theater = useStore((s) => s.theater);

  const slotElement = slot?.el;
  useLayoutEffect(() => {
    const dock = box.current;
    if (!dock) return;
    if (!slotElement) { dock.removeAttribute("style"); dock.removeAttribute("data-compact"); delete dock.dataset.clipTop; delete dock.dataset.clipBottom; return; }
    let frame = 0;
    const column = slotElement.closest(".ep-left") ?? document.body;
    const measure = () => {
      frame = 0;
      const r = slotElement.getBoundingClientRect();
      const bounds = column.getBoundingClientRect();
      dock.toggleAttribute("data-compact", r.height < 80);
      const top = Math.max(0, bounds.top - r.top), bottom = Math.max(0, r.bottom - bounds.bottom);
      dock.dataset.clipTop = String(top);
      dock.dataset.clipBottom = String(bottom);
      Object.assign(dock.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
        clipPath: top || bottom ? `inset(${top}px 0 ${bottom}px 0 round 12px)` : "" });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onScroll = (e: Event) => { if (e.target instanceof Node && e.target.contains(slotElement)) schedule(); };
    const observer = new ResizeObserver(schedule);
    for (let node: Element | null = slotElement; node; node = node.parentElement) {
      observer.observe(node);
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling === node) break;
        observer.observe(sibling);
      }
    }
    measure();
    document.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [slotElement, theater]);

  // A floating video that is paused for good (ended, or another episode took over) goes away.
  const current = useStore((s) => s.current);
  useEffect(() => { if (floating && (current?.id !== floating.ep.id || !current.videoId)) useVideoDock.setState({ floating: null }); }, [current?.id, current?.videoId, floating]);

  if (!ep) return null;
  const close = () => { if (useStore.getState().playing) useStore.getState().player?.toggle(); useVideoDock.setState({ floating: null }); };
  return (
    <div ref={box} className={`video-dock ${slot ? "docked" : "floating"} ${theater ? "theater-host" : ""}`}>
      <YouTubePlayer key={ep.id} ep={ep} overlay={slot?.overlay ?? floating?.overlay} onUnplayable={slot?.onUnplayable} onRecoveryChange={slot?.onRecoveryChange} />
      {!slot && (
        <div className="video-float-bar">
          <button className="icon-btn sm" title={t("回到这一集")} aria-label={t("回到这一集")} onClick={() => useStore.getState().openEpisode(ep)}><ExternalLink size={14} /></button>
          <button className="icon-btn sm" title={t("停止播放并关闭")} aria-label={t("停止播放并关闭")} onClick={close}><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
