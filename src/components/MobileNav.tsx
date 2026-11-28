import { useEffect, useState } from "react";
import { selectionFeedback } from "../lib/feedback";
import { useShallow } from "zustand/react/shallow";
import { BrandGlyph } from "./BrandGlyph";
import { PageHeading } from "./PageHeading";
import { useLibrary } from "../lib/library";
import { useOffline } from "../lib/offline";
import { useNotes } from "../lib/notes";
import { api } from "../lib/api";
import { ChevronRight } from "lucide-react";
import { useStore, type View } from "../store";
import { t, tk, useLang } from "../lib/i18n";
import { LibraryShows } from "./Chrome";

export const mobileTabs = [
  { id: "latest", label: tk("首页"), glyph: "listen" },
  { id: "discover", label: tk("发现"), glyph: "discover" },
  { id: "library", label: tk("我的"), glyph: "library" },
] as const;
export type Root = typeof mobileTabs[number]["id"];

export function selectedRoot(view: View, history: View[]) {
  return [...history, view].reverse().find((v) => mobileTabs.some(({ id }) => id === v.kind))?.kind ?? "library";
}

export function switchRoot(root: Root) {
  const store = useStore.getState();
  if (store.view.kind !== root) store.set({ view: { kind: root }, history: [] });
  else document.querySelector(".page")?.scrollTo({ top: 0, behavior: "smooth" });
}

export function MobileNav() {
  const { view, history } = useStore(useShallow((s) => ({ view: s.view, history: s.history })));
  useLang((s) => s.lang);
  if (view.kind === "episode") return null;
  const root = selectedRoot(view, history);
  return <nav className="m-nav" aria-label={t("主导航")}>
    {mobileTabs.map(({ id, label, glyph }) => (
      <button key={id} className={`m-tab ${root === id ? "on" : ""}`} aria-current={root === id ? "page" : undefined}
        onClick={() => { if (view.kind !== id) selectionFeedback(); switchRoot(id); }}><BrandGlyph name={glyph} /><span>{t(label)}</span></button>
    ))}
  </nav>;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function shortSpan(secs: number) {
  const m = Math.round(secs / 60);
  if (m < 1) return t("{n} 秒", { n: Math.round(secs) });
  if (m < 60) return t("{n} 分钟", { n: m });
  const h = Math.floor(m / 60), r = m % 60;
  return r ? t("{h} 小时 {m} 分", { h, m: r }) : t("{h} 小时", { h });
}

export function LibraryView() {
  const { set, go, openSettings } = useStore(useShallow((s) => ({ set: s.set, go: s.go, openSettings: s.openSettings })));
  const saved = useLibrary((state) => state.favorites.length);
  const cached = useOffline((state) => Object.keys(state.saved).length);
  const noted = useNotes((state) => state.notes.length);
  const [week, setWeek] = useState<{ total: number; bars: number[]; days: number } | null>(null);
  useEffect(() => {
    const DAY = 86_400_000;
    const today = new Date();
    const keys = Array.from({ length: 7 }, (_, i) => ymd(new Date(today.getTime() - (6 - i) * DAY)));
    void api.listeningStats(keys[0]).then((rows) => {
      const byDay = new Map<string, number>();
      for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.seconds);
      const bars = keys.map((k) => byDay.get(k) ?? 0);
      const total = bars.reduce((a, b) => a + b, 0);
      const days = bars.filter((s) => s >= 300).length;
      setWeek({ total, bars, days });
    }).catch(() => {});
  }, []);
  const maxBar = Math.max(1, ...(week?.bars ?? [0]));
  return <div className="page m-library">
    <PageHeading title={t("我的")}>
      <button className="heading-tool" onClick={() => openSettings()} aria-label={t("设置")}><BrandGlyph name="settings" /></button>
    </PageHeading>
    <div className="library-collections">
      <button onClick={() => go({ kind: "recent", saved: true })}><BrandGlyph name="saved" /><span>{t("收藏")}</span>{saved > 0 && <small>{saved}</small>}</button>
      <button onClick={() => go({ kind: "downloads" })}><BrandGlyph name="cache" /><span>{t("离线音频")}</span>{cached > 0 && <small>{cached}</small>}</button>
      <button onClick={() => go({ kind: "recent" })}><BrandGlyph name="history" /><span>{t("最近播放")}</span></button>
      <button onClick={() => go({ kind: "notes" })}><BrandGlyph name="quote" /><span>{t("收藏的句子")}</span>{noted > 0 && <small>{noted}</small>}</button>
      <button className="stats-summary-card" onClick={() => go({ kind: "stats" })}>
        <BrandGlyph name="stats" />
        <span className="stats-summary-text">
          <strong>{t("收听统计")}</strong>
          <small>{week && week.total >= 60
            ? t("近 7 天已听 {time} · 活跃 {days} 天", { time: shortSpan(week.total), days: week.days })
            : t("记录你的收听时光")}</small>
        </span>
        {week && week.total >= 60 ? (
          <span className="stats-spark" aria-hidden>
            {week.bars.map((v, i) => <i key={i} className={v > 0 ? "on" : ""} style={{ height: `${Math.max(18, Math.round((v / maxBar) * 100))}%` }} />)}
          </span>
        ) : <ChevronRight size={17} className="stats-summary-arrow" aria-hidden />}
      </button>
    </div>
    <div className="module-head">
      <h2 className="module-title">{t("订阅节目")}</h2>
      <button className="link-btn" onClick={() => set({ addOpen: true, addTab: "search" })}><BrandGlyph name="plus" size={20} />{t("添加")}</button>
    </div>
    <LibraryShows />
  </div>;
}
