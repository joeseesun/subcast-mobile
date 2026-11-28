import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { IS_MAC, t } from "../lib/i18n";

type Choice = { id: string; title: string; selected: boolean; symbol?: string };
let presentingChoice = false;

/** Returns null for the web fallback, or an empty string if the user dismisses the native sheet. */
export async function presentNativeChoices(title: string, rows: Choice[], trigger: HTMLButtonElement, moreRows: Choice[] = []) {
  if (!IS_MAC) return null;
  if (presentingChoice) return "";
  presentingChoice = true;
  try {
    const choice = await invoke<string | null>("plugin:mobile|present_settings_index", {
      state: { title, done: t("取消"), choiceSheet: true, groups: moreRows.length ? [rows, moreRows] : [rows] },
    });
    if (choice !== null) trigger.focus({ preventScroll: true });
    return choice;
  } catch {
    return null;
  } finally {
    presentingChoice = false;
  }
}

export function MobileSheet({ title, doneLabel, onClose, children, className }: { title: string; doneLabel?: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ y: number; at: number; active: boolean } | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const dismiss = useCallback(() => {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, 180);
  }, [closing, onClose]);

  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(closeTimer.current);
      dialog.close?.();
      trigger?.focus({ preventScroll: true });
    };
  }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    if (closing || e.touches.length !== 1) return;
    const dialog = ref.current;
    if (!dialog) return;
    const inHeader = !!(e.target as HTMLElement).closest("header, .sheet-grabber");
    if (!inHeader && dialog.scrollTop > 2) return;
    dragRef.current = { y: e.touches[0].clientY, at: performance.now(), active: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = dragRef.current;
    if (!g || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - g.y;
    if (!g.active) {
      if (dy < -8) { dragRef.current = null; return; }
      if (dy > 8) g.active = true;
      else return;
    }
    if (dy > 0) setDragY(dy);
  };
  const onTouchEnd = () => {
    const g = dragRef.current;
    dragRef.current = null;
    if (!g?.active) { setDragY(0); return; }
    const dt = Math.max(1, performance.now() - g.at);
    const velocity = dragY / dt;
    if (dragY > 84 || (dragY > 36 && velocity > 0.45)) dismiss();
    else setDragY(0);
  };

  return createPortal(
    <dialog ref={ref}
      className={`mobile-sheet ${className ?? ""} ${closing ? "is-closing" : ""} ${dragY > 0 ? "is-dragging" : ""}`}
      style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      aria-labelledby={heading}
      onCancel={(e) => { e.preventDefault(); dismiss(); }}
      onClick={(e) => { if (e.target === ref.current && e.clientY < ref.current.getBoundingClientRect().top) dismiss(); }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <div className="sheet-grabber" aria-hidden />
      <header><h2 id={heading} ref={titleRef} tabIndex={-1}>{title}</h2>{doneLabel
        ? <button className="sheet-done" onClick={dismiss}>{doneLabel}</button>
        : <button className="sheet-close" aria-label={t("关闭")} onClick={dismiss}><X aria-hidden size={14} /></button>}</header>
      <div className="sheet-rows">{children}</div>
    </dialog>, document.body);
}
