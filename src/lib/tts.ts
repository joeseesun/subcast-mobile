import { api } from "./api";
import { useStore } from "../store";
import { t } from "./i18n";

/** Reads text aloud with Doubao TTS, a sentence-aligned chunk (≤ 900 chars) at a time, prefetching the next. */
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

export function stopSpeaking() {
  session++;
  audio?.pause();
  audio = null;
  useStore.getState().set({ speaking: false });
}

export async function speak(text: string, onError?: (m: string) => void) {
  stopSpeaking();
  const id = ++session;
  const { settings, player, playing } = useStore.getState();
  if (playing) player?.toggle();
  useStore.getState().set({ speaking: true });
  const parts = chunks(text);
  const fetchPart = (i: number) => (i < parts.length ? api.ttsSpeak(parts[i], settings.ttsVoice, settings.ttsResource) : Promise.resolve(null));
  let next = fetchPart(0);
  try {
    for (let i = 0; i < parts.length; i++) {
      const b64 = await next;
      if (id !== session || !b64) return;
      next = fetchPart(i + 1);
      const el = new Audio(`data:audio/wav;base64,${b64}`);
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
