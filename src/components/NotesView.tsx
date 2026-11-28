// 收藏的句子: lines saved by pressing and holding a subtitle, grouped by episode, newest first. A line plays from where it was said;
// a tap on "···" offers poster, copy, play, or undoable delete; the whole list exports as Markdown through the share sheet.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Image as ImageIcon, Play, Share, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { clock } from "../lib/format";
import { notesMarkdown, removeNote, restoreNote, useNotes, type Note } from "../lib/notes";
import { showName } from "../lib/picks";
import { shareText } from "../lib/share";
import { selectionFeedback } from "../lib/feedback";
import { useZh } from "../lib/zh";
import { t } from "../lib/i18n";
import { useStore } from "../store";
import { seekEpisode } from "./Players";
import { PageHeading } from "./PageHeading";
import { BookmarkArt, EmptyState } from "./Illustrations";
import { BrandGlyph } from "./BrandGlyph";
import { MobileSheet } from "./MobileSheet";

async function playNote(n: Note) {
  const ep = await api.getEpisode(n.episodeId).catch(() => null);
  if (!ep) { useStore.getState().notify(t("找不到这一集了")); return; }
  useStore.getState().openEpisode(ep);
  seekEpisode(ep, n.time);
}

function NoteGroup({ notes, onMenu }: { notes: Note[]; onMenu: (n: Note) => void }) {
  const first = notes[0];
  const zhTitle = useZh(first.episodeTitle);
  return <section className="note-group">
    <header className="note-ep">
      {first.cover ? <img src={first.cover} alt="" loading="lazy" /> : <span className="cover-fallback" />}
      <div>
        <p className="note-ep-title">{zhTitle ?? first.episodeTitle}</p>
        {first.showTitle && <p className="note-ep-show">{showName(first.showTitle)}</p>}
      </div>
    </header>
    {[...notes].sort((a, b) => a.time - b.time).map((n) => <div key={n.id} className="note-card" role="button" tabIndex={0}
      onClick={() => { selectionFeedback(); void playNote(n); }} onKeyDown={(e) => e.key === "Enter" && void playNote(n)}>
      <div className="note-card-head">
        <span className="note-time">{clock(n.time)}</span>
        <button className="note-del" aria-label={t("更多")} aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); selectionFeedback(); onMenu(n); }}><BrandGlyph name="more" size={18} /></button>
      </div>
      <div className="note-text">
        {n.zh && <p className="note-zh">{n.zh}</p>}
        {n.orig && <p className={n.zh ? "note-orig" : "note-zh"}>{n.orig}</p>}
        {!n.zh && !n.orig && <p className="note-orig">{t("书签")}</p>}
      </div>
    </div>)}
  </section>;
}

function DeletedFlash({ note, onUndo, onClose }: { note: Note; onUndo: () => void; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 4500); return () => window.clearTimeout(timer); }, [note.id, onClose]);
  return createPortal(<div className="note-flash" role="status">
    <div className="note-flash-head"><Trash2 size={14} aria-hidden /><span>{t("已删除这句")} · {clock(note.time)}</span></div>
    <p className="note-flash-text">{note.zh ?? note.orig}</p>
    <div className="note-flash-actions">
      <button className="go" onClick={onUndo}>{t("撤销")}</button>
      <button onClick={onClose}>{t("关闭")}</button>
    </div>
  </div>, document.body);
}

export function NotesView() {
  const notes = useNotes((s) => s.notes);
  const [active, setActive] = useState<Note | null>(null);
  const [deleted, setDeleted] = useState<Note | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of [...notes].sort((a, b) => b.at - a.at)) map.set(n.episodeId, [...(map.get(n.episodeId) ?? []), n]);
    return [...map.values()];
  }, [notes]);

  const copyNote = async (n: Note) => {
    const text = [n.zh, n.orig].filter(Boolean).join("\n");
    const source = `——《${n.episodeTitle}》${n.showTitle ? ` · ${showName(n.showTitle)}` : ""} · ${clock(n.time)}`;
    try { await navigator.clipboard.writeText(`“${text}”\n${source}`); useStore.getState().notify(t("已复制，带出处")); }
    catch { useStore.getState().notify(t("复制失败")); }
  };

  return <div className="page collection-page notes-page">
    <PageHeading title={t("收藏的句子")}>
      {notes.length > 0 && <button className="heading-tool" aria-label={t("导出为 Markdown")} onClick={() => void shareText(notesMarkdown(notes), t("声渡笔记"))}><Share size={20} /></button>}
    </PageHeading>
    {notes.length > 0 && <p className="muted page-sub">{t("{n} 句 · 点一句从那里播放", { n: notes.length })}</p>}
    {!notes.length
      ? <EmptyState art={<BookmarkArt />} title={t("还没有收藏的句子")} note={t("听到好句子时，按住那句字幕，选「收藏这句」，就会存到这里。")} />
      : groups.map((g) => <NoteGroup key={g[0].episodeId} notes={g} onMenu={setActive} />)}
    {active && (
      <MobileSheet title={clock(active.time)} onClose={() => setActive(null)} className="line-sheet">
        <blockquote className="line-quote">
          {active.zh && <p className="zh">{active.zh}</p>}
          {active.orig && <p className={active.zh ? "orig" : "zh"}>{active.orig}</p>}
        </blockquote>
        <div className="line-acts">
          <button className="line-act primary" onClick={() => { const n = active; setActive(null); selectionFeedback(); void playNote(n); }}>
            <Play size={20} aria-hidden /><span>{t("从这里播放")}</span>
          </button>
          <button className="line-act" onClick={() => {
            const n = active; setActive(null); selectionFeedback();
            const text = [n.zh, n.orig].filter(Boolean).join("\n");
            window.dispatchEvent(new CustomEvent("subcast-poster", { detail: { text, ts: clock(n.time), episodeId: n.episodeId, zh: n.zh, orig: n.orig } }));
          }}><ImageIcon size={20} aria-hidden /><span>{t("生成海报")}</span></button>
          <button className="line-act" onClick={() => { const n = active; setActive(null); selectionFeedback(); void copyNote(n); }}>
            <Copy size={20} aria-hidden /><span>{t("复制")}</span>
          </button>
          <button className="line-act destructive" onClick={() => { const n = active; setActive(null); selectionFeedback(); removeNote(n.id); setDeleted(n); }}>
            <Trash2 size={20} aria-hidden /><span>{t("删除")}</span>
          </button>
        </div>
      </MobileSheet>
    )}
    {deleted && <DeletedFlash note={deleted} onUndo={() => { selectionFeedback(); restoreNote(deleted); setDeleted(null); }} onClose={() => setDeleted(null)} />}
  </div>;
}
