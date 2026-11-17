import { useShallow } from "zustand/react/shallow";
import { ChartColumn, Compass, Download, Inbox, Library, Plus, Settings as Cog } from "lucide-react";
import { useStore, type View } from "../store";
import { t, useLang } from "../lib/i18n";
import { useOffline } from "../lib/offline";
import { Sidebar } from "./Chrome";

/** The phone's bottom tab bar: 首页, 发现, 订阅 (the desktop sidebar's list), 统计 and 设置. */
export function MobileNav() {
  const { view, set, openSettings } = useStore(useShallow((s) => ({ view: s.view, set: s.set, openSettings: s.openSettings })));
  useLang((s) => s.lang);
  if (view.kind === "episode") return null;
  // Show and channel pages are reached from the subscription list, so they keep its tab lit.
  const on = (k: View["kind"]) => view.kind === k || (k === "library" && (view.kind === "show" || view.kind === "channel" || view.kind === "downloads"));
  const tab = (v: View, icon: React.ReactNode, label: string) => (
    <button key={v.kind} className={`m-tab ${on(v.kind) ? "on" : ""}`} aria-current={on(v.kind) ? "page" : undefined} onClick={() => set({ view: v, history: [] })}>{icon}<span>{label}</span></button>
  );
  return (
    <nav className="m-nav" aria-label={t("主导航")}>
      {tab({ kind: "latest" }, <Inbox size={21} />, t("首页"))}
      {tab({ kind: "discover" }, <Compass size={21} />, t("发现"))}
      {tab({ kind: "library" }, <Library size={21} />, t("订阅"))}
      {tab({ kind: "stats" }, <ChartColumn size={21} />, t("统计"))}
      <button className="m-tab" onClick={() => openSettings()}><Cog size={21} /><span>{t("设置")}</span></button>
    </nav>
  );
}

/** 订阅: the shows the listener follows and the curated 精读 channels, as a page. */
export function LibraryView() {
  const { set, go } = useStore(useShallow((s) => ({ set: s.set, go: s.go })));
  const hasDownloads = useOffline((s) => Object.keys(s.saved).length + Object.keys(s.active).length > 0);
  return (
    <div className="page m-library">
      <div className="page-head">
        <h1 className="page-title">{t("订阅")}</h1>
        <div className="row-actions">
          {hasDownloads && <button className="btn ghost sm" onClick={() => go({ kind: "downloads" })}><Download size={14} /> {t("已下载")}</button>}
          <button className="btn primary sm" onClick={() => set({ addOpen: true, addTab: "search" })}><Plus size={14} /> {t("添加节目")}</button>
        </div>
      </div>
      <Sidebar />
    </div>
  );
}
