// Expanding a section (any button with aria-expanded) scrolls just enough to show what opened, while
// keeping the button itself in view: the content appears below the fold otherwise, and the listener can't
// tell anything happened. One listener for the whole app, so every disclosure behaves the same.
// Menus (aria-haspopup) are skipped: they float and position themselves.
import { useEffect } from "react";

const PAD = 16;

function scroller(el: Element): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/** The elements after the button (or after its wrapper, when the button stands alone in one). */
function following(btn: Element): Element[] {
  const start = btn.nextElementSibling ? btn : btn.parentElement;
  const out: Element[] = [];
  for (let el = start?.nextElementSibling ?? null; el; el = el.nextElementSibling) out.push(el);
  return out;
}

/** The bottom of what the click added: new elements after the button, up to the next disclosure button. */
function revealedBottom(btn: Element, before: Set<Element>): number | null {
  let bottom: number | null = null;
  for (const el of following(btn)) {
    if (el.matches("[aria-expanded]")) break;
    if (before.has(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height) bottom = Math.max(bottom ?? 0, r.bottom);
  }
  return bottom;
}

function reveal(btn: Element, before: Set<Element>) {
  const bottom = revealedBottom(btn, before);
  if (bottom == null) return;
  const box = scroller(btn);
  const isPage = box === document.scrollingElement || box === document.documentElement;
  const view = isPage ? { top: 0, bottom: window.innerHeight } : box.getBoundingClientRect();
  const overflow = bottom + PAD - view.bottom;
  if (overflow <= 0) return;
  // Never past the point where the button itself would leave the top.
  const room = btn.getBoundingClientRect().top - view.top - PAD;
  const by = Math.min(overflow, room);
  if (by <= 0) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  box.scrollBy({ top: by, behavior: reduce ? "auto" : "smooth" });
}

export function useRevealOnExpand() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as Element | null)?.closest?.("[aria-expanded]");
      if (!btn || btn.hasAttribute("aria-haspopup")) return;
      const before = new Set(following(btn));
      // After React has rendered the opened content.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (btn.getAttribute("aria-expanded") === "true") reveal(btn, before); }));
    };
    // Capture: note what was there before React renders the opened content.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
