// Episodes saved on this computer for listening without a network. The files live in the app's data folder;
// this store mirrors which ones exist and which are downloading.
import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, type Episode, type Saved } from "./api";
import { t } from "./i18n";
import { useStore } from "../store";

interface OfflineState {
  saved: Record<string, Saved>;
  /** Download progress 0–1, or null while the size is unknown (YouTube). */
  active: Record<string, number | null>;
}

export const useOffline = create<OfflineState>(() => ({ saved: {}, active: {} }));

let started = false;
export async function startOffline() {
  if (started) return;
  started = true;
  await refreshSaved();
  void listen<{ episodeId: string; progress: number | null }>("offline", (ev) => {
    const { episodeId, progress } = ev.payload;
    useOffline.setState((s) => (episodeId in s.active ? { active: { ...s.active, [episodeId]: progress } } : s));
  });
}

export async function refreshSaved() {
  const list = await api.listDownloads().catch(() => [] as Saved[]);
  useOffline.setState({ saved: Object.fromEntries(list.map((x) => [x.episodeId, x])) });
}

const drop = (map: Record<string, number | null>, id: string) => { const n = { ...map }; delete n[id]; return n; };

export async function downloadEpisode(ep: Episode) {
  if (useOffline.getState().active[ep.id] !== undefined) return;
  useOffline.setState((s) => ({ active: { ...s.active, [ep.id]: 0 } }));
  try {
    const saved = await api.downloadEpisode(ep.id);
    useOffline.setState((s) => ({ saved: { ...s.saved, [ep.id]: saved }, active: drop(s.active, ep.id) }));
    useStore.getState().notify(t("已下载，没有网络也能听"));
  } catch (e) {
    useOffline.setState((s) => ({ active: drop(s.active, ep.id) }));
    const msg = errorText(e);
    if (!/已取消|Canceled|キャンセル/.test(msg)) useStore.getState().notify(t("下载没有完成：{error}", { error: msg }));
  }
}

export const cancelDownload = (id: string) => void api.cancelJob(`dl:${id}`);

export async function removeDownload(id: string) {
  await api.deleteDownload(id);
  useOffline.setState((s) => { const saved = { ...s.saved }; delete saved[id]; return { saved }; });
}

export async function clearDownloads() {
  await api.clearDownloads();
  useOffline.setState({ saved: {} });
}

/** Where to play an episode's audio from: the saved file when there is one. */
export function audioSrc(ep: Episode): string | undefined {
  const saved = useOffline.getState().saved[ep.id];
  return saved ? convertFileSrc(saved.path) : ep.audioUrl;
}

export const isSaved = (id: string) => !!useOffline.getState().saved[id];

export function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
