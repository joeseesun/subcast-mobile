// Read-along (after the desktop app's lib/readAlong.ts): reads an article aloud a sentence at a time with Doubao
// speech, says which sentence and which characters are being spoken so the page can highlight them, jumps to any
// sentence, and picks up where the reader left off. The next sentence is made while this one plays.
import { create } from "zustand";
import { api } from "./api";
import { useStore } from "../store";
import { stopHooks, stopSpeaking } from "./tts";
import { estimateMarks, spokenChars, type Mark } from "./sentences";
import { t } from "./i18n";

export type ReadState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

interface ReadAlong {
  /** What is being read (e.g. "deep:<episode id>"); null when nothing is. */
  owner: string | null;
  sentences: string[];
  index: number;
  state: ReadState;
  /** Characters of the current sentence already spoken (estimated from the audio's length). */
  spoken: number;
  error: string | null;
  /** When the error happened, so a page opened later doesn't announce an old one. */
  errorAt: number;
}

export const useReadAlong = create<ReadAlong>(() => ({ owner: null, sentences: [], index: 0, state: "idle", spoken: 0, error: null, errorAt: 0 }));
const set = (p: Partial<ReadAlong>) => useReadAlong.setState(p);

let gen = 0;
let audio: HTMLAudioElement | null = null;
let raf = 0;
const cache = new Map<string, Promise<string>>();

const progressKey = (owner: string) => `subcast-read:${owner}`;
/** Where the reader stopped last time, if inside the article. */
export function resumeIndex(owner: string, total: number): number {
  try { const i = Number(localStorage.getItem(progressKey(owner))); return i > 0 && i < total ? i : 0; } catch { return 0; }
}
function remember(owner: string, index: number | null) {
  try { if (index == null) localStorage.removeItem(progressKey(owner)); else localStorage.setItem(progressKey(owner), String(index)); } catch { /* private mode */ }
}

function synth(text: string): Promise<string> {
  const { ttsVoice, ttsResource } = useStore.getState().settings;
  const key = `${ttsVoice}|${ttsResource}|${text}`;
  let p = cache.get(key);
  if (!p) {
    p = api.ttsSpeak(text, ttsVoice, ttsResource).then((b64) => `data:audio/wav;base64,${b64}`);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Stops sound without changing the state (the caller sets it). */
function halt() {
  gen++;
  cancelAnimationFrame(raf);
  if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio = null; }
}

function ticker(el: HTMLAudioElement, marks: () => Mark[], g: number) {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (g !== gen || el.paused) return;
    const list = marks();
    if (list.length) { const n = spokenChars(list, el.currentTime); if (n !== useReadAlong.getState().spoken) set({ spoken: n }); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

async function playFrom(i: number) {
  const { owner, sentences } = useReadAlong.getState();
  if (!owner) return;
  halt();
  const g = gen;
  if (i >= sentences.length) { set({ state: "ended", index: sentences.length - 1, spoken: 0 }); remember(owner, null); return; }
  set({ index: i, spoken: 0, state: "loading", error: null });
  remember(owner, i);
  const text = sentences[i];
  const fail = (e: unknown) => { if (g === gen) set({ state: "error", error: String((e as Error)?.message ?? e), errorAt: Date.now() }); };
  try {
    const url = await synth(text);
    if (g !== gen) return;
    if (i + 1 < sentences.length) synth(sentences[i + 1]).catch(() => {});
    const el = new Audio(url);
    audio = el;
    let marks: Mark[] = [];
    el.onloadedmetadata = () => { marks = estimateMarks(text, el.duration); };
    el.onended = () => { set({ spoken: text.length }); if (g === gen) void playFrom(i + 1); };
    el.onerror = () => fail(new Error(t("音频播放失败")));
    await el.play();
    if (g !== gen) { el.pause(); return; }
    set({ state: "playing" });
    ticker(el, () => marks, g);
  } catch (e) { fail(e); }
}

function pauseEpisode() {
  const { player, playing } = useStore.getState();
  if (playing) player?.toggle();
}

/** Starts reading `sentences` for `owner` at sentence `index`. */
export function startReading(owner: string, sentences: string[], index = 0) {
  stopSpeaking(); // anything else reading aloud (and an earlier read-along) stops
  pauseEpisode();
  set({ owner, sentences, index, state: "loading", spoken: 0, error: null });
  void playFrom(index);
}

/** Reads from sentence `i` (tapping a sentence, previous / next). */
export function seekReading(i: number) {
  const { owner, sentences } = useReadAlong.getState();
  if (!owner) return;
  pauseEpisode();
  void playFrom(Math.max(0, Math.min(sentences.length - 1, i)));
}

export function toggleReading() {
  const { state, index, sentences } = useReadAlong.getState();
  if (state === "playing" || state === "loading") {
    if (audio && state === "playing") { audio.pause(); cancelAnimationFrame(raf); set({ state: "paused" }); return; }
    halt();
    set({ state: "paused", spoken: 0 });
    return;
  }
  if (state === "paused" && audio) {
    pauseEpisode();
    const el = audio, g = gen;
    void el.play().then(() => {
      if (g !== gen) return;
      set({ state: "playing" });
      const marks = estimateMarks(sentences[index] ?? "", el.duration);
      ticker(el, () => marks, g);
    }).catch((e) => set({ state: "error", error: String(e?.message ?? e), errorAt: Date.now() }));
    return;
  }
  seekReading(state === "ended" ? 0 : index);
}

export function stopReading() {
  halt();
  set({ owner: null, sentences: [], index: 0, state: "idle", spoken: 0, error: null });
}

// Something else started speaking (another 朗读 button): this stops.
stopHooks.add(() => { if (useReadAlong.getState().owner) stopReading(); });

// The episode starting to play pauses the reading.
useStore.subscribe((s, prev) => {
  if (s.playing && !prev.playing && useReadAlong.getState().state === "playing") toggleReading();
});
