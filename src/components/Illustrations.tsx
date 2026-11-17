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
    <svg {...frame(112, 80, "ia-ask", className)}>
      <ellipse className="art-floor" cx="56" cy="71" rx="27" ry="4" />
      <path className="art-wash" d="M24 18h55a12 12 0 0 1 12 12v14a12 12 0 0 1-12 12H45L31 66V56h-7a12 12 0 0 1-12-12V30a12 12 0 0 1 12-12Z"/>
      <path className="s" d="M53 12h27a17 17 0 0 1 17 17v8"/>
      <g className="ia-eq art-exchange"><path d="M33 35v7m9-12v17m9-22v27m9-20v13m9-10v7" /></g>
    </svg>
  );
}

/** A page with a timeline; `writing` draws its lines one by one while the model works. */
export function PageArt({ writing, className }: Art & { writing?: boolean }) {
  return (
    <svg {...frame(116, 83, `ia-page${writing ? " is-writing" : ""}`, className)}>
      <ellipse className="art-floor" cx="59" cy="75" rx="34" ry="4" />
      <rect className="art-wash s" x="21" y="15" width="66" height="52" rx="8" transform="rotate(-8 54 41)" />
      <rect className="art-paper" x="29" y="10" width="65" height="55" rx="8" />
      <rect className="ia-mark" x="51" y="32" width="34" height="7" rx="3" />
      <path className="s" d="M43 24v29" />
      <g className="ia-lines">
        <path d="M53 22h29" /><path className="s" d="M53 27h20" />
        <path d="M53 35h27" /><path className="s" d="M53 41h16" />
        <path d="M53 51h24" />
      </g>
      <g className="ia-dots"><circle cx="43" cy="22" r="2.3" /><circle className="a" cx="43" cy="35" r="2.3" /><circle cx="43" cy="51" r="2.3" /></g>
    </svg>
  );
}

/** Sound on the left, a subtitle line on the right: what this app does, drawn small. */
export function WaveToTextArt({ className }: Art) {
  return (
    <svg {...frame(142, 83, "ia-w2t", className)}>
      <ellipse className="art-floor" cx="73" cy="71" rx="41" ry="4" />
      <circle className="art-wash" cx="37" cy="40" r="23" />
      <g className="ia-eq"><path d="M23 36v8" /><path d="M30 32v16" /><path className="a" d="M37 27v26" /><path d="M44 33v14" /><path d="M51 36v8" /></g>
      <g className="ia-flow"><circle cx="65" cy="40" r="1" /><circle cx="71" cy="40" r="1" /><circle cx="77" cy="40" r="1" /></g>
      <rect className="art-paper" x="83" y="24" width="47" height="32" rx="8" />
      <path className="a" d="M90 35h5" />
      <g className="ia-sub"><path d="M101 35h20" /><path className="s" d="M91 44h26" /></g>
    </svg>
  );
}

export function BookmarkArt() {
  return <svg {...frame(116, 86, "ia-bookmark")}>
    <ellipse className="art-floor" cx="58" cy="76" rx="32" ry="4" />
    <rect x="21" y="17" width="52" height="51" rx="9" className="art-wash s" transform="rotate(-10 47 43)" />
    <rect x="37" y="13" width="52" height="51" rx="9" className="art-paper" />
    <path className="s" d="M47 44h20m-20 7h28" />
    <path className="bookmark-ribbon" d="M63 13h16v26l-8-5-8 5z" />
  </svg>;
}

/** A tray with sound dropping in; `busy` keeps it falling. */
export function TrayArt({ busy, className }: Art & { busy?: boolean }) {
  return (
    <svg {...frame(116, 83, `ia-tray${busy ? " is-busy" : ""}`, className)}>
      <ellipse className="art-floor" cx="58" cy="72" rx="33" ry="4" />
      <path className="art-wash" d="M20 45h20l7 8h23l7-8h19v12a9 9 0 0 1-9 9H29a9 9 0 0 1-9-9V45Z" />
      <path className="s" d="m20 45 10-13h12m54 13L86 32H74" />
      <path d="M20 45h20l7 8h23l7-8h19" />
      <g className="ia-drop"><path d="M45 23v8" /><path d="M52 18v18" /><path className="a" d="M58 12v30" /><path d="M64 18v18M71 23v8" /></g>
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
    <svg {...frame(100, 74, "ia-seek", className)}>
      <ellipse className="art-floor" cx="53" cy="66" rx="28" ry="4" />
      <path className="s" d="M69 18h16m-11 6h7" />
      <g className="ia-lens">
        <circle className="art-wash" cx="43" cy="31" r="20" />
        <path className="art-handle" d="m58 45 16 14" />
        <path className="a" d="M31 32h5l4-9 6 15 4-6h5" />
      </g>
    </svg>
  );
}

export function QuietArt() {
  return <svg {...frame(116, 78, "ia-orbit")}>
    <ellipse className="art-floor" cx="58" cy="69" rx="35" ry="4" />
    <ellipse className="art-wash" cx="58" cy="38" rx="34" ry="20" transform="rotate(-14 58 38)" />
    <ellipse className="s" cx="58" cy="38" rx="25" ry="13" transform="rotate(-14 58 38)" />
    <ellipse className="s" cx="58" cy="38" rx="15" ry="6" transform="rotate(-14 58 38)" />
    <path className="a orbit-echo" d="M16 42c4-13 31-27 56-30" />
    <circle cx="58" cy="38" r="2.6" className="f" />
  </svg>;
}

export function BookArt({ className }: Art) {
  return (
    <svg {...frame(116, 84, "ia-book", className)}>
      <ellipse className="art-floor" cx="58" cy="73" rx="38" ry="4" />
      <path className="art-paper" d="M58 24c-8-6-21-7-36-5v40c15-2 28-1 36 5 8-6 21-7 36-5V19c-15-2-28-1-36 5Z"/>
      <path className="s" d="M58 24v40M31 32h17m-17 8h19m-19 8h13m23-7h18m-18 8h12" />
      <path className="a ia-ribbon" d="M72 20v17l4-3 4 3V19" />
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
