import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { t } from "../lib/i18n";

export function MobileSheet({ title, doneLabel, onClose, children }: { title: string; doneLabel?: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    titleRef.current?.focus({ preventScroll: true });
    return () => { dialog.close?.(); trigger?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <dialog ref={ref} className="mobile-sheet" aria-labelledby={heading} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current && e.clientY < ref.current.getBoundingClientRect().top) onClose(); }}>
      <header><h2 id={heading} ref={titleRef} tabIndex={-1}>{title}</h2>{doneLabel
        ? <button className="sheet-done" onClick={onClose}>{doneLabel}</button>
        : <button className="sheet-close" aria-label={t("关闭")} onClick={onClose}><X aria-hidden size={14} /></button>}</header>
      <div className="sheet-rows">{children}</div>
    </dialog>, document.body);
}
