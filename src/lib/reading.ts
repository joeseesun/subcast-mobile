// Settings › 阅读与字幕 take effect as CSS variables on the root, so every subtitle (video, audio, full screen)
// and the Q&A follow one set of values. Web fonts load only when chosen.
import { useEffect } from "react";
import { useStore } from "../store";
import { POSTER_FONTS, loadCss } from "./poster";

export const SUB_SCALE = { s: 0.86, m: 1, l: 1.18, xl: 1.38 } as const;
/** Subtitle fonts: the system's, or the poster's open-source ones (loaded from a CDN when picked). */
export const SUB_FONTS = { system: "", serif: "serif", kai: "kai", sans: "sans" } as const;

export const READ_LEADING = { tight: 1.7, normal: 1.95, loose: 2.25 } as const;
export const READ_SIZE = { min: 14, max: 24, base: 17 } as const;

export function useReadingSettings() {
  const s = useStore((x) => x.settings);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--sub-scale", String(SUB_SCALE[s.subtitleSize ?? "m"]));
    root.setProperty("--chat-scale", s.chatSize === "l" ? "1.12" : "1");
    const f = POSTER_FONTS.find((x) => x.id === SUB_FONTS[s.subtitleFont ?? "sans"]);
    if (f?.css) void loadCss(f.css).catch(() => {});
    root.setProperty("--sub-font", f ? `${f.family}, var(--font, system-ui)` : "inherit");
    document.documentElement.dataset.subLook = s.subtitleLook ?? "outline";
    document.documentElement.dataset.nextLine = s.audioNextLine ? "on" : "off";
    // 精读 articles (乔木精读 and AI 精读). Legacy "sys" maps to Noto Serif SC.
    const rfId = s.readFont === "sys" ? "serif" : s.readFont;
    const rf = POSTER_FONTS.find((x) => x.id === rfId);
    if (rf?.css) void loadCss(rf.css).catch(() => {});
    root.setProperty("--read-font", rf ? `${rf.family}, var(--font, system-ui)` : "var(--font, system-ui)");
    // Preload real multi-weight Noto Serif SC + Noto Sans SC when online (falls back cleanly to system fonts offline).
    if (navigator.onLine) {
      for (const id of ["serif", "sans"] as const) {
        const font = POSTER_FONTS.find((x) => x.id === id);
        if (font?.css) void loadCss(font.css).catch(() => {});
      }
    }
    root.setProperty("--read-size", `${s.readSize ?? READ_SIZE.base}px`);
    root.setProperty("--read-leading", String(READ_LEADING[s.readLeading ?? "normal"]));
    document.documentElement.dataset.readPaper = s.readPaper ?? "plain";
  }, [s.subtitleSize, s.subtitleFont, s.subtitleLook, s.chatSize, s.audioNextLine, s.readFont, s.readSize, s.readLeading, s.readPaper]);
}
