// 收藏的句子: lines saved while listening (press and hold a subtitle line), after Snipd's one-tap snips. Each keeps the line as heard (original and
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

/** Line `i` of the episode's transcript: its start, text and translation. */
function lineInfo(ep: Episode, i: number) {
  const transcript = useJobs.getState().transcripts[ep.id];
  const items = useJobs.getState().translations[ep.id]?.items;
  const seg = i >= 0 ? transcript?.segments[i] : undefined;
  return seg ? { start: seg.start, orig: seg.text.trim(), zh: items?.[i]?.trim() || undefined } : null;
}

/** The line playing now in `ep` (null text when there are no subtitles yet). */
function lineNow(ep: Episode) {
  const { time } = useStore.getState();
  const transcript = useJobs.getState().transcripts[ep.id];
  const i = transcript ? lineAt(transcript.segments, time) : -1;
  return lineInfo(ep, i) ?? { start: Math.max(0, time - 5), orig: "", zh: undefined };
}

const noteAt = (ep: Episode, start: number) => useNotes.getState().notes.find((n) => n.episodeId === ep.id && Math.abs(n.time - start) < 1);

function addNote(ep: Episode, line: { start: number; orig: string; zh?: string }): Note {
  const note: Note = {
    id: `${ep.id}-${keyOf(line.start)}`, episodeId: ep.id, episodeTitle: ep.title, showTitle: ep.showTitle,
    cover: ep.cover, time: line.start, orig: line.orig, zh: line.zh, at: Date.now(),
  };
  save([note, ...useNotes.getState().notes]);
  return note;
}

/** The note on the line playing now, if it has one. */
export function noteOnLineNow(ep: Episode): Note | undefined {
  return noteAt(ep, lineNow(ep).start);
}

/** Saves the line playing now, or takes it off when it is already there. Returns the note added, or null. */
export function toggleNoteOnLineNow(ep: Episode): Note | null {
  const existing = noteOnLineNow(ep);
  if (existing) { removeNote(existing.id); return null; }
  return addNote(ep, lineNow(ep));
}

/** Line `i` of the transcript as text, with its start time, for the line actions. */
export function lineText(ep: Episode, i: number) { return lineInfo(ep, i); }

/** Whether line `i` is saved. */
export function lineSaved(ep: Episode, i: number): boolean {
  const line = lineInfo(ep, i);
  return !!line && !!noteAt(ep, line.start);
}

/** Saves line `i`, or takes it off when it is already there. Returns the note added, or null. */
export function toggleNoteOnLine(ep: Episode, i: number): Note | null {
  const line = lineInfo(ep, i);
  if (!line) return null;
  const existing = noteAt(ep, line.start);
  if (existing) { removeNote(existing.id); return null; }
  return addNote(ep, line);
}

/** Start times (×10, rounded) of the lines with 划线 in an episode, as a stable string for selectors. */
export const notedKeys = (episodeId: string) => (s: { notes: Note[] }) =>
  s.notes.filter((n) => n.episodeId === episodeId).map((n) => keyOf(n.time)).join(",");
export const isNoted = (keys: string, time: number) => !!keys && keys.split(",").includes(String(keyOf(time)));

export function removeNote(id: string) {
  save(useNotes.getState().notes.filter((n) => n.id !== id));
}

export function restoreNote(note: Note) {
  const list = useNotes.getState().notes;
  if (list.some((n) => n.id === note.id)) return;
  save([note, ...list].sort((a, b) => b.at - a.at));
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
