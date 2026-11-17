// Small hand-drawn illustrations for empty, waiting and finished states, plus the few easter eggs.
// Ink strokes take currentColor, soft strokes the line colour and one touch of the accent, so every piece follows the
// light and dark themes. Motion lives in styles.css ("delight" section) and stops under prefers-reduced-motion;
// the drawings are complete without it.
import { useEffect, useRef } from "react";
import { t } from "../lib/i18n";

type Art = { className?: string };

const frame = (w: number, h: number, name: string, className?: string) => ({
  viewBox: `0 0 ${w} ${h}`, width: w, height: h, fill: "none", "aria-hidden": true, focusable: "false" as const,
  className: `ia ${name}${className ? ` ${className}` : ""}`,
});

/** A plug and a socket leaning toward each other; hovering the card lets them meet. */
export function PlugArt({ className }: Art) {
  return (
    <svg {...frame(124, 48, "ia-plug", className)}>
      <g className="ia-l">
        <path d="M4 34c8 0 10-8 18-8h8" />
        <rect x="30" y="18" width="18" height="16" rx="4" />
        <path d="M48 22h7M48 30h7" />
      </g>
      <g className="ia-r">
        <path d="M90 26h8c8 0 10 8 18 8" />
        <rect x="68" y="14" width="22" height="24" rx="6" />
        <path className="s" d="M72 22h3M72 30h3" />
      </g>
      <path className="a ia-spark" d="M62 17v3M62 32v3M57.5 20.5l2 2M66.5 20.5l-2 2M57.5 31.5l2-2M66.5 31.5l-2-2" />
    </svg>
  );
}

/** A speech bubble with a voice moving inside it. */
export function AskArt({ className }: Art) {
  return (
    <svg {...frame(40, 40, "ia-ask", className)}>
      <path d="M10 6h20a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H17l-7 6v-6a6 6 0 0 1-6-6V12a6 6 0 0 1 6-6z" />
      <g className="ia-eq"><path d="M13 15v4" /><path d="M18 12v10" /><path className="a" d="M23 14v6" /><path d="M28 16v2" /></g>
    </svg>
  );
}

/** A page with a timeline; `writing` draws its lines one by one while the model works. */
export function PageArt({ writing, className }: Art & { writing?: boolean }) {
  return (
    <svg {...frame(96, 64, `ia-page${writing ? " is-writing" : ""}`, className)}>
      <rect x="18" y="4" width="60" height="56" rx="6" />
      <rect className="ia-mark" x="37" y="30" width="33" height="6" rx="2" />
      <path className="s" d="M30 18v32" />
      <g className="ia-lines">
        <path d="M38 16h28" /><path className="s" d="M38 22h20" />
        <path d="M38 33h30" /><path className="s" d="M38 39h16" />
        <path d="M38 50h24" />
      </g>
      <g className="ia-dots"><circle cx="30" cy="16" r="2.5" /><circle className="a" cx="30" cy="33" r="2.5" /><circle cx="30" cy="50" r="2.5" /></g>
    </svg>
  );
}

/** Sound on the left, a subtitle line on the right: what this app does, drawn small. */
export function WaveToTextArt({ className }: Art) {
  return (
    <svg {...frame(136, 56, "ia-w2t", className)}>
      <g className="ia-eq"><path d="M6 24v8" /><path d="M12 18v20" /><path d="M18 12v32" /><path d="M24 20v16" /><path d="M30 25v6" /></g>
      <g className="ia-flow"><circle cx="43" cy="28" r="1.4" /><circle cx="50" cy="28" r="1.4" /><circle cx="57" cy="28" r="1.4" /></g>
      <rect x="66" y="12" width="64" height="32" rx="7" />
      <path className="a" d="M74 23h5" />
      <g className="ia-sub"><path d="M85 23h37" /><path className="s" d="M74 33h40" /></g>
    </svg>
  );
}

/** A tray with sound dropping in; `busy` keeps it falling. */
export function TrayArt({ busy, className }: Art & { busy?: boolean }) {
  return (
    <svg {...frame(96, 64, `ia-tray${busy ? " is-busy" : ""}`, className)}>
      <path d="M18 38v12a6 6 0 0 0 6 6h48a6 6 0 0 0 6-6V38" />
      <path className="s" d="M32 47h32" />
      <g className="ia-drop"><path d="M42 18v8" /><path className="a" d="M48 11v22" /><path d="M54 18v8" /></g>
    </svg>
  );
}

const reel = (x: number) => `M${x} 26.5V24M${x + 3} 31.8l2.2 1.2M${x - 3} 31.8l-2.2 1.2`;

/** A cassette: reels turn slowly while fetching, faster while transcribing; `tangled` spills its tape. */
export function CassetteArt({ mode = "idle", className }: Art & { mode?: "idle" | "fetch" | "listen" | "tangled" }) {
  return (
    <svg {...frame(112, mode === "tangled" ? 84 : 68, `ia-tape is-${mode}`, className)}>
      <rect x="6" y="6" width="100" height="56" rx="7" />
      <rect className="s" x="22" y="18" width="68" height="24" rx="12" />
      <g className="ia-reel"><circle cx="36" cy="30" r="7" /><path d={reel(36)} /></g>
      <g className="ia-reel"><circle cx="76" cy="30" r="7" /><path d={reel(76)} /></g>
      <path className="s" d="M28 62l5-9h46l5 9" />
      <circle className="f ia-rec" cx="96" cy="14" r="2" />
      {mode === "tangled" && <path className="ia-spill" d="M50 62c-7 5-5 15 3 14s6-9 0-8-4 10 4 10 11-4 10-11" />}
    </svg>
  );
}

/** Equalizer bars: the boot screen and the logo easter egg. */
export function EqBars({ className }: Art) {
  return (
    <svg {...frame(44, 28, "ia-bars", className)}>
      <path d="M6 10v8" /><path d="M14 5v18" /><path className="a" d="M22 2v24" /><path d="M30 7v14" /><path d="M38 11v6" />
    </svg>
  );
}

/** A quiet line with one small blip passing along it. */
export function FlatLineArt({ className }: Art) {
  return (
    <svg {...frame(140, 36, "ia-flat", className)}>
      <path className="s" d="M4 18h128" />
      <path className="ia-blip" d="M56 18h6l3-6 4 12 3-6h6" />
      <circle className="f" cx="136" cy="18" r="2.5" />
    </svg>
  );
}

export function HeadphonesArt({ className }: Art) {
  return (
    <svg {...frame(80, 60, "ia-phones", className)}>
      <path d="M22 40v-8a18 18 0 0 1 36 0v8" />
      <rect x="16" y="37" width="10" height="16" rx="4" /><rect x="54" y="37" width="10" height="16" rx="4" />
      <g className="ia-waves"><path className="s" d="M10 40a7 7 0 0 0 0 10" /><path className="s" d="M5 36a13 13 0 0 0 0 18" /><path className="a" d="M70 40a7 7 0 0 1 0 10" /><path className="s" d="M75 36a13 13 0 0 1 0 18" /></g>
    </svg>
  );
}

export function SearchArt({ className }: Art) {
  return (
    <svg {...frame(44, 40, "ia-seek", className)}>
      <g className="ia-lens"><circle cx="18" cy="17" r="10" /><path d="M25.5 24.5L33 32" /><path className="a" d="M12 17h2l2-4 3 8 2-4h2" /></g>
    </svg>
  );
}

export function BookArt({ className }: Art) {
  return (
    <svg {...frame(96, 62, "ia-book", className)}>
      <path d="M48 14c-8-5-20-6-32-4v38c12-2 24-1 32 4 8-5 20-6 32-4V10c-12-2-24-1-32 4z" />
      <path d="M48 14v38" />
      <path className="s" d="M22 20h18M22 27h20M22 34h14M56 27h18M56 34h12" />
      <path className="a ia-ribbon" d="M64 12v14l3.5-3 3.5 3V11" />
    </svg>
  );
}

export function MoonArt({ className }: Art) {
  return <svg {...frame(12, 12, "ia-moon", className)}><path d="M10 7.6A4.6 4.6 0 0 1 4.4 2a4.6 4.6 0 1 0 5.6 5.6z" /></svg>;
}

/** The download button's tick; `fresh` draws it in, with a small ring, right after a download finishes. */
export function DoneCheck({ fresh }: { fresh?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden focusable="false" className={`dl-check${fresh ? " fresh" : ""}`}>
      <circle className="dl-burst" cx="10" cy="10" r="8" />
      <path d="M6.2 10.4l2.5 2.5 5-5.6" />
    </svg>
  );
}

/** Placeholder text with a drawing above it, for lists and panels that have nothing to show yet. */
export function EmptyState({ art, title, note, children, className }: { art?: React.ReactNode; title?: string; note?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`panel-empty empty-state${className ? ` ${className}` : ""}`}>
      {art && <div className="es-art">{art}</div>}
      {title && <p className="es-title">{title}</p>}
      {note && <p className="es-note">{note}</p>}
      {children}
    </div>
  );
}

// ---- easter eggs -------------------------------------------------------------------------------

/** Between midnight and five, empty states add a quiet good-night line. */
export function NightNote() {
  if (new Date().getHours() >= 5) return null;
  return <p className="night-note"><MoonArt />{t("夜深了，听完这期早点休息")}</p>;
}

/** Calls `onHit` after `count` clicks that land close together. */
export function useTaps(count: number, onHit: () => void, within = 1600) {
  const hits = useRef<number[]>([]);
  return () => {
    const now = Date.now();
    hits.current = [...hits.current.filter((x) => now - x < within), now];
    if (hits.current.length >= count) { hits.current = []; onHit(); }
  };
}

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** ↑↑↓↓←→←→BA anywhere outside a text field. */
export function useKonami(onCode: () => void) {
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let i = 0;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === KONAMI[i]) i++;
      // A third ↑ still leaves the last two as the code's opening pair.
      else i = key === "ArrowUp" ? (i === 2 ? 2 : 1) : 0;
      if (i === KONAMI.length) { i = 0; cb.current(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
}
