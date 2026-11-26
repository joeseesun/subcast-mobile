// Press and hold on an element matching `selector` inside a container. Delegated from the document, so long lists
// stay cheap and a container that mounts later (a transcript that is still loading) works too.
// Fires after HOLD ms without the finger moving; the click that follows the release is swallowed, so a held line
// doesn't also seek. The system text-selection callout is turned off for those elements in CSS.
import { useEffect, useRef, type RefObject } from "react";

const HOLD = 450;
const SLOP = 8;

export function useLongPress(container: RefObject<HTMLElement | null>, selector: string, onLong: (el: HTMLElement) => void) {
  const latest = useRef(onLong);
  latest.current = onLong;
  useEffect(() => {
    const root = document;
    const inside = (el: HTMLElement | null) => !!el && !!container.current?.contains(el);
    let timer = 0, x = 0, y = 0, target: HTMLElement | null = null, fired = 0;
    const clear = () => { window.clearTimeout(timer); timer = 0; target?.classList.remove("pressing"); target = null; };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>(selector);
      if (!inside(el)) return;
      if (!el) return;
      clear();
      target = el; x = e.clientX; y = e.clientY;
      el.classList.add("pressing");
      timer = window.setTimeout(() => {
        const hit = target;
        clear();
        if (!hit) return;
        fired = performance.now();
        latest.current(hit);
      }, HOLD);
    };
    const move = (e: PointerEvent) => { if (target && Math.hypot(e.clientX - x, e.clientY - y) > SLOP) clear(); };
    const click = (e: MouseEvent) => {
      if (fired && performance.now() - fired < 800 && inside(e.target as HTMLElement)) { e.stopPropagation(); e.preventDefault(); fired = 0; }
    };
    const menu = (e: Event) => { if (inside((e.target as HTMLElement).closest<HTMLElement>(selector))) e.preventDefault(); };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerup", clear);
    root.addEventListener("pointercancel", clear);
    root.addEventListener("scroll", clear, { passive: true, capture: true });
    root.addEventListener("click", click, true);
    root.addEventListener("contextmenu", menu);
    return () => {
      clear();
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", clear);
      root.removeEventListener("pointercancel", clear);
      root.removeEventListener("scroll", clear, { capture: true });
      root.removeEventListener("click", click, true);
      root.removeEventListener("contextmenu", menu);
    };
  }, [container, selector]);
}
