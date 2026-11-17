// Settings › 阅读与字幕 take effect as CSS variables on the root, so every subtitle (video, audio, full screen)
// and the Q&A follow one set of values. Web fonts load only when chosen.
import { useEffect } from "react";
import { useStore } from "../store";
import { POSTER_FONTS, loadCss } from "./poster";

export const SUB_SCALE = { s: 0.86, m: 1, l: 1.18, xl: 1.38 } as const;
/** Subtitle fonts: the system's, or the poster's open-source ones (loaded from a CDN when picked). */
export const SUB_FONTS = { system: "", serif: "serif", kai: "kai", sans: "sans" } as const;

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
  }, [s.subtitleSize, s.subtitleFont, s.subtitleLook, s.chatSize, s.audioNextLine]);
}
