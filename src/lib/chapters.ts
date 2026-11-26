// Chapters from an episode's show notes: YouTube descriptions and many podcasts list them as
// "00:00 Intro" / "(12:34) Topic" / "1:02:03 – Title". Only a real list counts: at least three
// entries, the first within ten minutes, all in order and inside the episode.
import { notesText } from "./format";

export interface Chapter { start: number; title: string }

const STAMP = /^\s*[-–—•*·]?\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*(?:[-–—:|·.]\s*)?(.+?)\s*$/;
const TRAILING = /^(.+?)\s*[-–—|(（[]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[)）\]]?\s*$/;

function seconds(stamp: string): number {
  return stamp.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
}

export function parseChapters(notes?: string, duration?: number): Chapter[] {
  if (!notes || !/\d:\d\d/.test(notes)) return [];
  const lines = notesText(notes).split(/\n+/);
  const found: Chapter[] = [];
  for (const line of lines) {
    if (line.length > 160) continue;
    let m = STAMP.exec(line);
    let stamp = m?.[1], title = m?.[2];
    if (!m) { const t = TRAILING.exec(line); stamp = t?.[2]; title = t?.[1]; }
    if (!stamp || !title) continue;
    title = title.replace(/^[-–—:|·.\s]+/, "").trim();
    if (!title || /^\d+:\d\d/.test(title)) continue;
    found.push({ start: seconds(stamp), title });
  }
  // Some feeds run the outline together on one line: "OUTLINE: 00:00:34 第一章 黑暗 00:47:55 第二章 角落 …".
  if (found.length < 3) found.splice(0, found.length, ...inline(lines.join("\n")));
  if (found.length < 3 || found[0].start > 600) return [];
  for (let i = 1; i < found.length; i++) if (found[i].start <= found[i - 1].start) return [];
  if (duration && found[found.length - 1].start >= duration) return [];
  if (found[0].start > 0) found.unshift({ start: 0, title: "" });
  return found;
}

export function chapterAt(chapters: Chapter[], time: number): number {
  let i = 0;
  while (i + 1 < chapters.length && chapters[i + 1].start <= time + 0.5) i++;
  return i;
}

function inline(text: string): Chapter[] {
  const marks = [...text.matchAll(/(?<![\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?![\d:])/g)];
  return marks.map((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    let title = text.slice(from, to).split(/\n|\s{2,}|\s(?=[A-Z]{3,})/)[0];
    title = title.replace(/^[\s\-–—:|·.)\]]+/, "").replace(/[\s\-–—|(（[]+$/, "").trim().slice(0, 80);
    return { start: seconds(m[1]), title };
  }).filter((c) => c.title);
}
