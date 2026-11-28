import { useRef, useState } from "react";
import { selectionFeedback } from "./feedback";

const THRESHOLD = 64;
const MAX_PULL = 96;

/** Touch pull-to-refresh for a scrollable `.page` container (triggers when pulled past 64px at scrollTop <= 0). */
export function usePullRefresh(
  scrollRef: React.RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ y: number; x: number; active: boolean; armed: boolean } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (refreshing || e.touches.length !== 1) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 2) return;
    if ((e.target as HTMLElement).closest(".sub-strip, .card-strip, .heatmap-wrap, input, select, textarea")) return;
    start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, active: false, armed: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = start.current;
    if (!g || refreshing || e.touches.length !== 1) return;
    const el = scrollRef.current;
    if (el && el.scrollTop > 2) { start.current = null; setPull(0); return; }
    const dy = e.touches[0].clientY - g.y;
    const dx = Math.abs(e.touches[0].clientX - g.x);
    if (!g.active) {
      if (dy < 8 || dx > dy) { if (dy < -6 || dx > 16) start.current = null; return; }
      g.active = true;
    }
    const damped = Math.min(MAX_PULL, Math.round(dy * 0.48));
    if (damped >= THRESHOLD && !g.armed) { g.armed = true; selectionFeedback(); }
    else if (damped < THRESHOLD && g.armed) g.armed = false;
    setPull(damped);
  };

  const onTouchEnd = () => {
    const g = start.current;
    start.current = null;
    if (!g?.active) { setPull(0); return; }
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(0);
      void onRefresh().finally(() => setRefreshing(false));
    } else {
      setPull(0);
    }
  };

  return {
    pull,
    armed: pull >= THRESHOLD,
    refreshing,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  };
}
