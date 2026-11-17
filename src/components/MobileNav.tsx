import { selectionFeedback } from "../lib/feedback";
import { useShallow } from "zustand/react/shallow";
import { Bookmark, ChartColumn, ChevronRight, Compass, Download, House, Library, Plus, Settings } from "lucide-react";
import { useStore, type View } from "../store";
import { t, tk, useLang } from "../lib/i18n";
import { LibraryShows } from "./Chrome";

export const mobileTabs = [
  { id: "latest", label: tk("首页"), Icon: House },
  { id: "discover", label: tk("发现"), Icon: Compass },
  { id: "library", label: tk("资料库"), Icon: Library },
] as const;
export type Root = typeof mobileTabs[number]["id"];

export function selectedRoot(view: View, history: View[]) {
  return [...history, view].reverse().find((v) => mobileTabs.some(({ id }) => id === v.kind))?.kind ?? "library";
}

export function switchRoot(root: Root) {
  const store = useStore.getState();
  if (store.view.kind !== root) store.set({ view: { kind: root }, history: [] });
  else document.querySelector(".page")?.scrollTo({ top: 0 });
}

export function MobileNav() {
  const { view, history } = useStore(useShallow((s) => ({ view: s.view, history: s.history })));
  useLang((s) => s.lang);
  if (view.kind === "episode") return null;
  const root = selectedRoot(view, history);
  return <nav className="m-nav" aria-label={t("主导航")}>
    {mobileTabs.map(({ id, label, Icon }) => (
      <button key={id} className={`m-tab ${root === id ? "on" : ""}`} aria-current={root === id ? "page" : undefined}
        onClick={() => { if (view.kind !== id) selectionFeedback(); switchRoot(id); }}><Icon /><span>{t(label)}</span></button>
    ))}
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
      <button onClick={() => go({ kind: "downloads" })}><Download /><span>{t("离线音频")}</span><ChevronRight /></button>
      <button onClick={() => go({ kind: "stats" })}><ChartColumn /><span>{t("收听统计")}</span><ChevronRight /></button>
    </div>
    <div className="module-head"><h2 className="module-title">{t("订阅节目")}</h2>
      <button className="link-btn" onClick={() => set({ addOpen: true, addTab: "search" })}><Plus size={18} />{t("添加")}</button>
    </div><LibraryShows />
  </div>;
}
