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

const keyOf = (time: number) => Math.round(time * 10);

/** The line playing now in `ep`: its start, text and translation (null text when there are no subtitles yet). */
function lineNow(ep: Episode) {
  const { time } = useStore.getState();
  const transcript = useJobs.getState().transcripts[ep.id];
  const items = useJobs.getState().translations[ep.id]?.items;
  const i = transcript ? lineAt(transcript.segments, time) : -1;
  const seg = i >= 0 ? transcript!.segments[i] : null;
  return { start: seg ? seg.start : Math.max(0, time - 5), orig: seg?.text.trim() ?? "", zh: (seg && items?.[i]?.trim()) || undefined };
}

/** The note on the line playing now, if it has one. */
export function noteOnLineNow(ep: Episode): Note | undefined {
  const at = lineNow(ep).start;
  return useNotes.getState().notes.find((n) => n.episodeId === ep.id && Math.abs(n.time - at) < 1);
}

/** 划线 on the line playing now, or takes it off when it is already there. Returns the note added, or null. */
export function toggleNoteOnLineNow(ep: Episode): Note | null {
  const existing = noteOnLineNow(ep);
  if (existing) { removeNote(existing.id); return null; }
  const line = lineNow(ep);
  const note: Note = {
    id: `${ep.id}-${keyOf(line.start)}`, episodeId: ep.id, episodeTitle: ep.title, showTitle: ep.showTitle,
    cover: ep.cover, time: line.start, orig: line.orig, zh: line.zh, at: Date.now(),
  };
  save([note, ...useNotes.getState().notes]);
  return note;
}

/** Start times (×10, rounded) of the lines with 划线 in an episode, as a stable string for selectors. */
export const notedKeys = (episodeId: string) => (s: { notes: Note[] }) =>
  s.notes.filter((n) => n.episodeId === episodeId).map((n) => keyOf(n.time)).join(",");
export const isNoted = (keys: string, time: number) => !!keys && keys.split(",").includes(String(keyOf(time)));

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
