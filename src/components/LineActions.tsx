// Press and hold a subtitle line (in the 字幕 list or under the player) for what you can do with that one line:
// save it, play from it, copy it with its source, make a poster, or ask about it. Saved lines are tinted like a
// highlighter wherever they show, and collect on the 收藏的句子 page.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Bookmark, BookmarkCheck, ChevronRight, Copy, Image as ImageIcon, MessageCircle, Play } from "lucide-react";
import type { Episode } from "../lib/api";
import { clock } from "../lib/format";
import { showName } from "../lib/picks";
import { lineSaved, lineText, removeNote, toggleNoteOnLine, useNotes, type Note } from "../lib/notes";
import { selectionFeedback } from "../lib/feedback";
import { t } from "../lib/i18n";
import { useStore } from "../store";
import { MobileSheet } from "./MobileSheet";
import { seekEpisode } from "./Players";

const useLineSheet = create<{ open: { ep: Episode; index: number } | null; flash: Note | null }>(() => ({ open: null, flash: null }));

/** Opens the actions for line `index` of `ep`'s transcript. */
export function openLineActions(ep: Episode, index: number) {
  if (!lineText(ep, index)) return;
  selectionFeedback();
  useLineSheet.setState({ open: { ep, index } });
}

/** Mount once on the episode page. */
export function LineActions() {
  const open = useLineSheet((s) => s.open);
  const flash = useLineSheet((s) => s.flash);
  return <>
    {open && <LineSheet ep={open.ep} index={open.index} />}
    {flash && <SavedFlash note={flash} />}
  </>;
}

function LineSheet({ ep, index }: { ep: Episode; index: number }) {
  const line = lineText(ep, index)!;
  useNotes((s) => s.notes); // re-render when saved state changes
  const saved = lineSaved(ep, index);
  const close = () => useLineSheet.setState({ open: null });
  const text = [line.zh, line.orig].filter(Boolean).join("\n");
  const source = `——《${ep.title}》${ep.showTitle ? ` · ${showName(ep.showTitle)}` : ""} · ${clock(line.start)}${ep.link ? `\n${ep.link}` : ""}`;
  const act = (fn: () => void) => () => { selectionFeedback(); close(); fn(); };
  return <MobileSheet title={clock(line.start)} onClose={close} className="line-sheet">
    <blockquote className="line-quote">
      {line.zh && <p className="zh">{line.zh}</p>}
      {line.orig && <p className={line.zh ? "orig" : "zh"}>{line.orig}</p>}
    </blockquote>
    <div className="line-acts">
      <button className={`line-act primary ${saved ? "on" : ""}`} onClick={act(() => {
        const note = toggleNoteOnLine(ep, index);
        if (note) useLineSheet.setState({ flash: note });
        else useStore.getState().notify(t("已取消收藏"));
      })}>
        {saved ? <BookmarkCheck size={20} aria-hidden /> : <Bookmark size={20} aria-hidden />}<span>{saved ? t("已收藏 · 点按取消") : t("收藏这句")}</span>
      </button>
      <button className="line-act" onClick={act(() => seekEpisode(ep, line.start))}><Play size={20} aria-hidden /><span>{t("从这里播放")}</span></button>
      <button className="line-act" onClick={act(async () => {
        try { await navigator.clipboard.writeText(`“${text}”\n${source}`); useStore.getState().notify(t("已复制，带出处")); }
        catch { useStore.getState().notify(t("复制失败")); }
      })}><Copy size={20} aria-hidden /><span>{t("复制")}</span></button>
      <button className="line-act" onClick={act(() => window.dispatchEvent(new CustomEvent("subcast-poster", { detail: { text, ts: clock(line.start), episodeId: ep.id, zh: line.zh, orig: line.orig } })))}>
        <ImageIcon size={20} aria-hidden /><span>{t("生成海报")}</span>
      </button>
      <button className="line-act" onClick={act(() => window.dispatchEvent(new CustomEvent("subcast-ask-selection", { detail: line.orig || line.zh })))}>
        <MessageCircle size={20} aria-hidden /><span>{t("问问这句")}</span>
      </button>
    </div>
  </MobileSheet>;
}

/** What was just saved, for a few seconds: the line itself, undo, and the way to all of them. */
function SavedFlash({ note }: { note: Note }) {
  const close = () => useLineSheet.setState({ flash: null });
  useEffect(() => { const timer = window.setTimeout(close, 4500); return () => window.clearTimeout(timer); }, [note.id]);
  return createPortal(<div className="note-flash" role="status">
    <div className="note-flash-head"><BookmarkCheck size={15} aria-hidden /><span>{t("已收藏这句")} · {clock(note.time)}</span></div>
    <p className="note-flash-text">{note.zh ?? note.orig}</p>
    <div className="note-flash-actions">
      <button onClick={() => { removeNote(note.id); close(); }}>{t("撤销")}</button>
      <button className="go" onClick={() => { close(); useStore.getState().go({ kind: "notes" }); }}>{t("查看收藏的句子")}<ChevronRight size={15} aria-hidden /></button>
    </div>
  </div>, document.body);
}
