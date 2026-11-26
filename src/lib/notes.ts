// 笔记: sentences saved while listening (划线), after Snipd's one-tap snips. Each keeps the line as heard (original and
// Chinese), where it is in the episode and which episode, so the notes page can play it again or export it all as
// Markdown. Stored in the library database (blob "_app"/"notes") like favorites.
import { create } from "zustand";
import { api, type Episode } from "./api";
import { useJobs } from "./jobs";
import { clock } from "./format";
import { showName } from "./picks";
import { t } from "./i18n";
import { useStore } from "../store";

export interface Note {
  id: string;
  episodeId: string;
  episodeTitle: string;
  showTitle?: string;
  cover?: string;
  /** Where the line starts, in seconds. */
  time: number;
  orig: string;
  zh?: string;
  at: number;
}

export const useNotes = create<{ notes: Note[] }>(() => ({ notes: [] }));
const KEY = ["_app", "notes"] as const;
const save = (notes: Note[]) => { useNotes.setState({ notes }); void api.setBlob(...KEY, JSON.stringify(notes)); };

export async function loadNotes() {
  try { const raw = await api.getBlob(...KEY); if (raw) useNotes.setState({ notes: JSON.parse(raw) }); } catch { /* none yet */ }
}

/** The line playing at `time` (same rule as the transcript's highlight). */
function lineAt(segments: { start: number }[], time: number): number {
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (segments[mid].start <= time + 0.15) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}

/** Saves the line playing now in `ep` (or just the moment, when there are no subtitles yet). */
export function noteCurrentLine(ep: Episode) {
  const { time } = useStore.getState();
  const transcript = useJobs.getState().transcripts[ep.id];
  const items = useJobs.getState().translations[ep.id]?.items;
  const i = transcript ? lineAt(transcript.segments, time) : -1;
  const seg = i >= 0 ? transcript!.segments[i] : null;
  const at = seg ? seg.start : Math.max(0, time - 5);
  const { notes } = useNotes.getState();
  if (notes.some((n) => n.episodeId === ep.id && Math.abs(n.time - at) < 1)) { useStore.getState().notify(t("这句已经划过了")); return; }
  const note: Note = {
    id: `${ep.id}-${Math.round(at * 10)}`, episodeId: ep.id, episodeTitle: ep.title, showTitle: ep.showTitle,
    cover: ep.cover, time: at, orig: seg?.text.trim() ?? "", zh: (seg && items?.[i]?.trim()) || undefined, at: Date.now(),
  };
  save([note, ...notes]);
  useStore.getState().notify(seg ? t("已划线，在资料库 › 笔记里") : t("已记下这个时间点，在资料库 › 笔记里"));
}

export function removeNote(id: string) {
  save(useNotes.getState().notes.filter((n) => n.id !== id));
}

/** All notes as Markdown, grouped by episode, newest episode first. */
export function notesMarkdown(notes: Note[]): string {
  const groups = new Map<string, Note[]>();
  for (const n of notes) groups.set(n.episodeId, [...(groups.get(n.episodeId) ?? []), n]);
  const out: string[] = [`# ${t("声渡笔记")}`, ""];
  for (const list of groups.values()) {
    const first = list[0];
    out.push(`## ${first.episodeTitle}`);
    if (first.showTitle) out.push(`*${showName(first.showTitle)}*`);
    out.push("");
    for (const n of [...list].sort((a, b) => a.time - b.time)) {
      const lines = [n.zh, n.orig].filter(Boolean) as string[];
      out.push(lines.length ? `> ${lines.join("\n> ")}` : `> ${t("书签")}`);
      out.push(`> — ${clock(n.time)}`, "");
    }
  }
  return out.join("\n").trim() + "\n";
}
