import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import { useStore } from "../store";
import { SUB_SCALE } from "./reading";

const modalSelector = '[aria-modal="true"], .mobile-sheet[open]';

type Layout = {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  clipTop: number;
  clipBottom: number;
  rounded: boolean;
  theater: boolean;
  translated: string | null;
  original: string | null;
  scale: number;
  font: string;
  boxed: boolean;
};

/** Places the native layer over the actual, clipped WebView picture. Only changed values cross the bridge. */
export function useNativeVideoLayout(stage: RefObject<HTMLDivElement | null>, send: ((layout: Layout) => Promise<unknown>) | null) {
  useLayoutEffect(() => {
    const picture = stage.current;
    const dock = picture?.closest<HTMLElement>(".video-dock");
    const scene = picture?.closest(".video");
    if (!picture || !send || !dock || !scene) return;
    let request = 0;
    let last = "";
    let pending = false;
    let next: Layout | null = null;
    const viewport = window.visualViewport;
    const flush = () => {
      if (pending || !next) return;
      pending = true;
      const value = next;
      next = null;
      void send(value).catch(() => {}).finally(() => { pending = false; flush(); });
    };
    const measure = () => {
      request = 0;
      const rect = picture.getBoundingClientRect();
      const zoom = viewport?.scale || 1;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const settings = useStore.getState().settings;
      const keyboard = !!viewport && viewport.height < window.innerHeight - 120 && zoom < 1.1;
      const theater = scene.classList.contains("theater");
      const layout: Layout = {
        visible: !document.hidden && !keyboard && !dock.classList.contains("floating") && !document.querySelector(modalSelector),
        x: (rect.left - left) * zoom,
        y: (rect.top - top) * zoom,
        width: rect.width * zoom,
        height: rect.height * zoom,
        clipTop: theater ? 0 : Number(dock.dataset.clipTop ?? 0) * zoom,
        clipBottom: theater ? 0 : Number(dock.dataset.clipBottom ?? 0) * zoom,
        rounded: dock.hasAttribute("data-compact"),
        theater,
        translated: scene.querySelector(".subtitle-overlay .sub-zh")?.textContent ?? null,
        original: scene.querySelector(".subtitle-overlay .sub-orig")?.textContent ?? null,
        scale: SUB_SCALE[settings.subtitleSize ?? "m"],
        font: settings.subtitleFont ?? "sans",
        boxed: settings.subtitleLook === "box",
      };
      const fingerprint = JSON.stringify(layout);
      if (fingerprint === last) return;
      last = fingerprint;
      next = layout;
      flush();
    };
    const schedule = () => { if (!request) request = requestAnimationFrame(measure); };
    const size = new ResizeObserver(schedule);
    size.observe(picture);
    const changes = new MutationObserver(schedule);
    changes.observe(dock, { attributes: true, attributeFilter: ["style", "class", "data-compact"] });
    changes.observe(scene, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true, characterData: true });
    const modals = new MutationObserver((records) => {
      const modal = (node: Node) => node instanceof Element && (node.matches(modalSelector) || Boolean(node.querySelector(modalSelector)));
      if (records.some((record) => record.type === "attributes" || Array.from(record.addedNodes).some(modal) || Array.from(record.removedNodes).some(modal))) schedule();
    });
    modals.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-modal"] });
    const unsubscribe = useStore.subscribe(({ settings }, previous) => {
      if (settings !== previous.settings) schedule();
    });
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    measure();
    return () => {
      next = null;
      size.disconnect(); changes.disconnect(); modals.disconnect();
      unsubscribe();
      cancelAnimationFrame(request);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [stage, send]);
}
