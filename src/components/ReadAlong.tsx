// 朗读 for an article whose sentences are marked (see markSentences), after the desktop app: a start button, then a
// small player (previous / play-pause / next, position, stop), the sentence being read tinted, the words already
// spoken coloured, the page following along, and a tap on any sentence reading from there.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { Loader2, LocateFixed, Pause, Play, RotateCcw, Settings2, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { useReadAlong, resumeIndex, seekReading, startReading, stopReading, toggleReading } from "../lib/readAlong";
import { selectionFeedback } from "../lib/feedback";
import { useStore } from "../store";
import { t, tr } from "../lib/i18n";
import { Modal } from "./Chrome";
import { ReadAloudSettings } from "./ReadAloud";

/** The header controls. `owner` names the article; `sentences` are its marked sentences. */
export function ReadAlongControls({ owner, sentences }: { owner: string; sentences: string[] }) {
  const { active, index, state, error } = useReadAlong(useShallow((s) => ({ active: s.owner === owner, index: s.index, state: s.state, error: s.error })));
  const [setup, setSetup] = useState(false);
  // A missing key opens the voice settings, as the old 朗读 button did.
  useEffect(() => {
    if (!active || state !== "error" || !error) return;
    useStore.getState().notify(tr(error));
    if (error.includes("Key")) setSetup(true);
  }, [active, state, error]);
  const resume = active ? 0 : resumeIndex(owner, sentences.length);
  const total = sentences.length;
  const busy = state === "loading";
  const playing = state === "playing" || busy;
  const settingsButton = <button className="ra-icon" aria-label={t("朗读设置")} onClick={() => setSetup(true)}><Settings2 size={18} /></button>;

  return (
    <div className={`read-along ${active ? "on" : ""}`}>
      {!active ? <>
        <button className="ra-start" disabled={!total} onClick={() => { selectionFeedback(); startReading(owner, sentences, resume); }}>
          <Volume2 size={16} aria-hidden /> {resume ? t("继续朗读") : t("朗读")}
        </button>
        {resume > 0 && <button className="ra-icon" aria-label={t("从头读")} onClick={() => startReading(owner, sentences, 0)}><RotateCcw size={17} /></button>}
        {settingsButton}
      </> : (
        <div className="ra-bar" role="group" aria-label={t("朗读控制")}>
          <button className="ra-icon" aria-label={t("上一句")} disabled={index <= 0} onClick={() => seekReading(index - 1)}><SkipBack size={17} /></button>
          <button className={`ra-play ${busy ? "busy" : ""}`} aria-label={state === "ended" ? t("重新朗读") : playing ? t("暂停") : t("继续")} onClick={() => { selectionFeedback(); toggleReading(); }}>
            {busy ? <Loader2 size={17} className="spin" /> : state === "ended" ? <RotateCcw size={16} /> : playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <button className="ra-icon" aria-label={t("下一句")} disabled={index >= total - 1} onClick={() => seekReading(index + 1)}><SkipForward size={17} /></button>
          <span className="ra-pos" aria-live="polite">{state === "ended" ? t("读完了") : busy && index === 0 ? t("正在准备…") : `${index + 1} / ${total}`}</span>
          {settingsButton}
          <button className="ra-icon" aria-label={t("停止朗读")} onClick={stopReading}><X size={18} /></button>
        </div>
      )}
      {setup && createPortal(<Modal title={t("朗读设置")} className="settings-modal" done onClose={() => setSetup(false)}><ReadAloudSettings /></Modal>, document.body)}
    </div>
  );
}

/** Tints the sentence being read, colours its spoken words, keeps it in view and makes sentences tappable.
 *  `article`: the element holding the marked sentences; its nearest scrolling ancestor is followed. */
export function useReadAlongPage(owner: string, article: React.RefObject<HTMLElement | null>) {
  const { active, index, state } = useReadAlong(useShallow((s) => ({ active: s.owner === owner, index: s.index, state: s.state })));
  const [follow, setFollow] = useState(true);
  const programmatic = useRef(0);
  const scroller = () => article.current?.closest<HTMLElement>(".deep-read") ?? null;

  useEffect(() => {
    const root = article.current;
    if (!root) return;
    root.querySelectorAll(".ra-s.on").forEach((n) => n.classList.remove("on"));
    root.classList.toggle("ra-on", active);
    if (!active || state === "ended") return;
    const spans = root.querySelectorAll<HTMLElement>(`.ra-s[data-s="${index}"]`);
    spans.forEach((n) => n.classList.add("on"));
    const box = scroller();
    if (follow && box && spans[0]) {
      const top = spans[0].getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      const visible = top > box.scrollTop + 80 && top < box.scrollTop + box.clientHeight - 120;
      if (!visible) {
        programmatic.current = performance.now() + 700;
        box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
      }
    }
  }, [active, index, state, follow]);

  // Scrolling by hand stops following until 回到朗读位置.
  useEffect(() => {
    const box = scroller();
    if (!box || !active) return;
    const away = () => { if (performance.now() > programmatic.current) setFollow(false); };
    box.addEventListener("touchmove", away, { passive: true });
    box.addEventListener("wheel", away, { passive: true });
    return () => { box.removeEventListener("touchmove", away); box.removeEventListener("wheel", away); };
  }, [active]);
  useEffect(() => { if (!active) setFollow(true); }, [active]);

  // Spoken words: a CSS highlight over the start of the sentence (no DOM changes; WebKit 17.2+, else tint only).
  useEffect(() => {
    const H = (window as any).Highlight, reg = (globalThis.CSS as any)?.highlights;
    if (!H || !reg || !active) return;
    const hl = new H();
    reg.set("ra-spoken", hl);
    const paint = (spoken: number, i: number) => {
      hl.clear();
      const root = article.current;
      if (!root || spoken <= 0) return;
      const range = document.createRange();
      let left = spoken, started = false;
      for (const span of Array.from(root.querySelectorAll<HTMLElement>(`.ra-s[data-s="${i}"]`))) {
        const node = span.firstChild as Text | null;
        if (!node) continue;
        if (!started) { range.setStart(node, 0); started = true; }
        if (left <= node.length) { range.setEnd(node, left); hl.add(range); return; }
        left -= node.length;
        range.setEnd(node, node.length);
      }
      if (started) hl.add(range);
    };
    const s0 = useReadAlong.getState();
    paint(s0.spoken, s0.index);
    const un = useReadAlong.subscribe((s, p) => { if (s.spoken !== p.spoken || s.index !== p.index) paint(s.state === "ended" ? 0 : s.spoken, s.index); });
    return () => { un(); hl.clear(); reg.delete("ra-spoken"); };
  }, [active]);

  /** Tap handler for the article: reads from the tapped sentence while reading is on. */
  const onClick = (e: React.MouseEvent): boolean => {
    if (!active) return false;
    const el = e.target as HTMLElement;
    if (el.closest("a, [data-t]")) return false;
    if (!window.getSelection()?.isCollapsed) return false; // selecting text, not jumping
    const s = el.closest<HTMLElement>(".ra-s");
    if (!s) return false;
    setFollow(true);
    selectionFeedback();
    seekReading(Number(s.dataset.s));
    return true;
  };
  const backToReading = !active || follow || state === "ended" ? null : (
    <button className="ra-return" onClick={() => setFollow(true)}><LocateFixed size={15} /> {t("回到朗读位置")}</button>
  );
  return { onClick, backToReading };
}
