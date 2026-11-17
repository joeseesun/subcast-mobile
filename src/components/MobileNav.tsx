import { selectionFeedback } from "../lib/feedback";
import { useShallow } from "zustand/react/shallow";
import { Bookmark, ChartColumn, ChevronRight, Compass, Download, House, Library, Plus, Settings } from "lucide-react";
import { useStore, type View } from "../store";
import { t, useLang } from "../lib/i18n";
import { LibraryShows } from "./Chrome";

const roots = ["latest", "discover", "library"];
export function MobileNav() {
  const { view, history, set } = useStore(useShallow((s) => ({ view: s.view, history: s.history, set: s.set })));
  useLang((s) => s.lang);
  if (view.kind === "episode") return null;
  const root = [...history, view].reverse().find((v) => roots.includes(v.kind))?.kind ?? "library";
  const tab = (v: View, icon: React.ReactNode, label: string) => (
    <button className={`m-tab ${root === v.kind ? "on" : ""}`} aria-current={root === v.kind ? "page" : undefined}
      onClick={() => { if (view.kind !== v.kind) { selectionFeedback(); set({ view: v, history: [] }); } else document.querySelector(".page")?.scrollTo({ top: 0 }); }}>{icon}<span>{label}</span></button>
  );
  return <nav className="m-nav" aria-label={t("主导航")}>
    {tab({ kind: "latest" }, <House />, t("首页"))}
    {tab({ kind: "discover" }, <Compass />, t("发现"))}
    {tab({ kind: "library" }, <Library />, t("资料库"))}
  </nav>;
}

export function LibraryView() {
  const { set, go, openSettings } = useStore(useShallow((s) => ({ set: s.set, go: s.go, openSettings: s.openSettings })));
  return <div className="page m-library">
    <div className="page-head"><h1 className="page-title">{t("资料库")}</h1>
      <button className="round-btn" onClick={() => openSettings()} aria-label={t("设置")}><Settings /></button>
    </div>
    <div className="settings-list library-links">
      <button onClick={() => go({ kind: "recent", saved: true })}><Bookmark /><span>{t("收藏")}</span><ChevronRight /></button>
      <button onClick={() => go({ kind: "downloads" })}><Download /><span>{t("已下载")}</span><ChevronRight /></button>
      <button onClick={() => go({ kind: "stats" })}><ChartColumn /><span>{t("收听统计")}</span><ChevronRight /></button>
    </div>
    <div className="module-head"><h2 className="module-title">{t("订阅节目")}</h2>
      <button className="link-btn" onClick={() => set({ addOpen: true, addTab: "search" })}><Plus size={18} />{t("添加")}</button>
    </div><LibraryShows />
  </div>;
}
