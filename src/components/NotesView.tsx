// 笔记: the lines saved with 划线, grouped by episode, newest first. A line plays from where it was said; the whole
// list exports as Markdown through the share sheet.
import { useMemo } from "react";
import { Share, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { clock } from "../lib/format";
import { notesMarkdown, removeNote, useNotes, type Note } from "../lib/notes";
import { showName } from "../lib/picks";
import { shareText } from "../lib/share";
import { selectionFeedback } from "../lib/feedback";
import { useZh } from "../lib/zh";
import { t } from "../lib/i18n";
import { useStore } from "../store";
import { seekEpisode } from "./Players";
import { PageHeading } from "./PageHeading";
import { BookmarkArt, EmptyState } from "./Illustrations";

async function playNote(n: Note) {
  const ep = await api.getEpisode(n.episodeId).catch(() => null);
  if (!ep) { useStore.getState().notify(t("找不到这一集了")); return; }
  useStore.getState().openEpisode(ep);
  seekEpisode(ep, n.time);
}

function NoteGroup({ notes }: { notes: Note[] }) {
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
      <span className="note-time">{clock(n.time)}</span>
      <div className="note-text">
        {n.zh && <p className="note-zh">{n.zh}</p>}
        {n.orig && <p className={n.zh ? "note-orig" : "note-zh"}>{n.orig}</p>}
        {!n.zh && !n.orig && <p className="note-orig">{t("书签")}</p>}
      </div>
      <button className="note-del" aria-label={t("删除")} onClick={(e) => { e.stopPropagation(); removeNote(n.id); }}><Trash2 size={16} /></button>
    </div>)}
  </section>;
}

export function NotesView() {
  const notes = useNotes((s) => s.notes);
  const groups = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of [...notes].sort((a, b) => b.at - a.at)) map.set(n.episodeId, [...(map.get(n.episodeId) ?? []), n]);
    return [...map.values()];
  }, [notes]);
  return <div className="page collection-page notes-page">
    <PageHeading title={t("我的划线")}>
      {notes.length > 0 && <button className="heading-tool" aria-label={t("导出为 Markdown")} onClick={() => void shareText(notesMarkdown(notes), t("声渡笔记"))}><Share size={20} /></button>}
    </PageHeading>
    {notes.length > 0 && <p className="muted page-sub">{t("{n} 条划线 · 点一条从那里播放", { n: notes.length })}</p>}
    {!notes.length
      ? <EmptyState art={<BookmarkArt />} title={t("还没有划线")} note={t("听到好句子时，点播放器下方的「划线」，这句就会存到这里。")} />
      : groups.map((g) => <NoteGroup key={g[0].episodeId} notes={g} />)}
  </div>;
}
