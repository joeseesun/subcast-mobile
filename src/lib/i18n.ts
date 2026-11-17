// Interface language. Strings are written in Simplified Chinese in the code and looked up in a dictionary for the
// other languages, so the source stays readable and a missing entry simply falls back to Chinese.
// `npm run i18n` lists strings that are not wrapped yet and dictionary entries that are missing.
import { create } from "zustand";
import en from "../locales/en";
import ja from "../locales/ja";
import zhTW from "../locales/zh-TW";

export type Lang = "zh-CN" | "zh-TW" | "en" | "ja";
export type LangSetting = "auto" | Lang;

/** Each language's own name, so people can find theirs whatever is showing now. */
export const LANGS: { id: Lang; name: string }[] = [
  { id: "zh-CN", name: "简体中文" }, // i18n-ignore
  { id: "zh-TW", name: "繁體中文" }, // i18n-ignore
  { id: "en", name: "English" },
  { id: "ja", name: "日本語" }, // i18n-ignore
];

const DICTS: Record<Lang, Record<string, string>> = { "zh-CN": {}, "zh-TW": zhTW, en, ja };

export function systemLang(): Lang {
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const raw of prefs) {
    const l = raw.toLowerCase();
    if (l.startsWith("zh")) return /hant|tw|hk|mo/.test(l) ? "zh-TW" : "zh-CN";
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("en")) return "en";
  }
  return "en";
}

let current: Lang = "zh-CN";
export const useLang = create<{ lang: Lang }>(() => ({ lang: current }));

export function setLang(setting: LangSetting | undefined) {
  current = !setting || setting === "auto" ? systemLang() : setting;
  document.documentElement.lang = current === "zh-CN" ? "zh-Hans" : current === "zh-TW" ? "zh-Hant" : current;
  useLang.setState({ lang: current });
}

export const lang = () => current;
/** Chinese interfaces get machine-translated titles and notes; others show the originals. */
export const isChineseUi = () => current === "zh-CN" || current === "zh-TW";

/** Shortcut labels are written with ⌘; Windows and Linux show Ctrl+ instead. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const kbd = (s: string) => (IS_MAC ? s : s.replace(/⌘/g, "Ctrl+"));
const fill = (s: string, vars?: Record<string, string | number>) =>
  kbd(vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

/** The interface text for a Chinese source string. Use `{name}` placeholders for values. */
export function t(source: string, vars?: Record<string, string | number>): string {
  return fill(DICTS[current][source] ?? source, vars);
}

/** Like t(), for a source string that needs different wording depending on where it is shown (the key is `source@context`). */
export function tx(context: string, source: string, vars?: Record<string, string | number>): string {
  const d = DICTS[current];
  return fill(d[`${source}@${context}`] ?? d[source] ?? source, vars);
}

/** Marks a string for translation without translating it (for module-level constants); translate with t() where shown. */
export const tk = (source: string) => source;

// Messages from the Rust side arrive already formatted ("请求失败（403）：…"). Dictionary keys for those keep
// Rust's placeholders ({} or {name}); they are matched as patterns, and the captured values carried over.
/** Unnamed placeholders ({}) are matched by their order among the unnamed ones. */
function positional(names: string[]) {
  let i = 0;
  return names.map((n) => n || `#${i++}`);
}

let patterns: { re: RegExp; key: string; names: string[] }[] | null = null;
function patternList() {
  if (patterns) return patterns;
  const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const keys = new Set([...Object.keys(en), ...Object.keys(ja), ...Object.keys(zhTW)]);
  patterns = [...keys]
    .filter((k) => /\{\w*\}/.test(k))
    .map((key) => ({
      key,
      names: positional([...key.matchAll(/\{(\w*)\}/g)].map((m) => m[1])),
      re: new RegExp(`^${key.split(/\{\w*\}/).map(esc).join("([\\s\\S]*?)")}$`),
    }));
  return patterns;
}

/** Translates text that came from elsewhere (errors, progress messages) when it is one of ours. */
export function tr(text: string): string {
  if (current === "zh-CN" || !text) return text;
  const dict = DICTS[current];
  if (dict[text]) return dict[text];
  for (const { re, key, names } of patternList()) {
    const m = text.match(re);
    if (!m || !dict[key]) continue;
    const values = Object.fromEntries(names.map((n, i) => [n, tr(m[i + 1] ?? "")]));
    let i = 0;
    return dict[key].replace(/\{(\w*)\}/g, (_, n: string) => values[n || `#${i++}`] ?? "");
  }
  return text;
}
