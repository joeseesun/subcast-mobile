import { useStore } from "../store";
import { t } from "./i18n";
import { speakSystem, synthesize, type Spoken } from "./voices";

/** Reads text aloud with the chosen voice service (voices.ts), a sentence-aligned chunk (≤ 900 chars) at a time,
 *  prefetching the next; the phone's own voice speaks it directly. */
let session = 0;
let audio: HTMLAudioElement | null = null;

export function chunks(text: string, max = 900): string[] {
  const parts = text.replace(/\s+\n/g, "\n").split(/(?<=[。！？!?；;\n])/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ""; }
    cur += p.length > max ? p.slice(0, max) : p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** Called when anything starts speaking, so a read-along in progress stops (see readAlong.ts). */
export const stopHooks = new Set<() => void>();

export function stopSpeaking() {
  for (const hook of stopHooks) hook();
  session++;
  audio?.pause();
  audio = null;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  useStore.getState().set({ speaking: false });
}

export async function speak(text: string, onError?: (m: string) => void) {
  stopSpeaking();
  const id = ++session;
  const { player, playing } = useStore.getState();
  if (playing) player?.toggle();
  useStore.getState().set({ speaking: true });
  const parts = chunks(text);
  const fetchPart = (i: number): Promise<Spoken | null> => (i < parts.length ? synthesize(parts[i]) : Promise.resolve(null));
  let next = fetchPart(0);
  try {
    for (let i = 0; i < parts.length; i++) {
      const spoken = await next;
      if (id !== session || !spoken) return;
      if (spoken.kind === "system") { next = fetchPart(i + 1); await speakSystem(parts[i]); if (id !== session) return; continue; }
      next = fetchPart(i + 1);
      const el = new Audio(spoken.url);
      el.playbackRate = spoken.playbackRate;
      audio = el;
      await new Promise<void>((resolve, reject) => { el.onended = () => resolve(); el.onerror = () => reject(new Error(t("音频播放失败"))); void el.play().catch(reject); });
      if (id !== session) return;
    }
  } catch (e) {
    if (id === session) onError?.(String((e as any)?.message ?? e));
  } finally {
    if (id === session) useStore.getState().set({ speaking: false });
  }
}
