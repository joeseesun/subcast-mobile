import { selectionFeedback } from "../lib/feedback";
import { useShallow } from "zustand/react/shallow";
import { BrandGlyph } from "./BrandGlyph";
import { PageHeading } from "./PageHeading";
import { useLibrary } from "../lib/library";
import { useOffline } from "../lib/offline";
import { useNotes } from "../lib/notes";
import { Quote } from "lucide-react";
import { useStore, type View } from "../store";
import { t, tk, useLang } from "../lib/i18n";
import { LibraryShows } from "./Chrome";

export const mobileTabs = [
  { id: "latest", label: tk("首页"), glyph: "listen" },
  { id: "discover", label: tk("发现"), glyph: "discover" },
  { id: "library", label: tk("资料库"), glyph: "library" },
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
    {mobileTabs.map(({ id, label, glyph }) => (
      <button key={id} className={`m-tab ${root === id ? "on" : ""}`} aria-current={root === id ? "page" : undefined}
        onClick={() => { if (view.kind !== id) selectionFeedback(); switchRoot(id); }}><BrandGlyph name={glyph} /><span>{t(label)}</span></button>
    ))}
  </nav>;
}

export function LibraryView() {
  const { set, go, openSettings } = useStore(useShallow((s) => ({ set: s.set, go: s.go, openSettings: s.openSettings })));
  const saved = useLibrary((state) => state.favorites.length);
  const cached = useOffline((state) => Object.keys(state.saved).length);
  const noted = useNotes((state) => state.notes.length);
  return <div className="page m-library">
    <PageHeading title={t("资料库")}>
      <button className="heading-tool" onClick={() => openSettings()} aria-label={t("设置")}><BrandGlyph name="settings" /></button>
    </PageHeading>
    <div className="library-collections">
      <button onClick={() => go({ kind: "recent", saved: true })}><BrandGlyph name="saved" /><span>{t("收藏")}</span>{saved > 0 && <small>{saved}</small>}</button>
      <button onClick={() => go({ kind: "downloads" })}><BrandGlyph name="cache" /><span>{t("离线音频")}</span>{cached > 0 && <small>{cached}</small>}</button>
      <button onClick={() => go({ kind: "recent" })}><BrandGlyph name="history" /><span>{t("最近播放")}</span></button>
      <button onClick={() => go({ kind: "notes" })}><Quote size={22} strokeWidth={1.7} /><span>{t("收藏的句子")}</span>{noted > 0 && <small>{noted}</small>}</button>
      <button onClick={() => go({ kind: "stats" })}><BrandGlyph name="stats" /><span>{t("收听统计")}</span></button>
    </div>
    <div className="module-head">
      <h2 className="module-title">{t("订阅节目")}</h2>
      <button className="link-btn" onClick={() => set({ addOpen: true, addTab: "search" })}><BrandGlyph name="plus" size={20} />{t("添加")}</button>
    </div>
    <LibraryShows />
  </div>;
}
