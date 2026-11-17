import { lang, t } from "./i18n";

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + ":" + String(s).padStart(2, "0");
}

export function parseClock(text: string): number | null {
  const parts = text.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((t, p) => t * 60 + p, 0);
}

export function duration(seconds?: number): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return m >= 60 ? t("{h} 小时 {m} 分", { h: Math.floor(m / 60), m: m % 60 }) : t("{m} 分钟", { m });
}

export function date(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms), now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days < 1 && d.getDate() === now.getDate()) return t("今天");
  if (days < 2) return t("昨天");
  if (days < 7) return t("{days} 天前", { days });
  const thisYear = d.getFullYear() === now.getFullYear();
  if (lang() !== "zh-CN") return new Intl.DateTimeFormat(lang(), thisYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" }).format(d);
  return thisYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; // i18n-ignore
}

/** A month (1–12) as shown in calendars: 「3月」 (or 「3 月」 when `spaced`) in Simplified Chinese, the locale's short name elsewhere. */
export function monthName(m: number, spaced = false): string {
  if (lang() !== "zh-CN") return new Intl.DateTimeFormat(lang(), { month: "short" }).format(new Date(2000, m - 1, 1));
  return spaced ? `${m} 月` : `${m}月`; // i18n-ignore
}

/** A month as a heading: 「3 月」 / 「2025 年 3 月」 in Simplified Chinese, the locale's long form elsewhere ("March 2025"). */
export function monthLabel(m: number, year?: number): string {
  if (lang() !== "zh-CN") return new Intl.DateTimeFormat(lang(), year ? { year: "numeric", month: "long" } : { month: "long" }).format(new Date(year ?? 2000, m - 1, 1));
  return year ? `${year} 年 ${m} 月` : `${m} 月`; // i18n-ignore
}

/** Strips HTML show notes to plain text with paragraph breaks. */
export function notesText(html?: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d)>/gi, "\n"), "text/html");
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

export const isChinese = (lang: string, sample = "") => /^zh/i.test(lang) || (lang === "auto" && /[一-鿿]/.test(sample));

/** A model's download size, one way everywhere: "960 MB", "1.4 GB". */
export const sizeMb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
