import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { tr } from "./i18n";

/** A match inside one show: which part of the episode matched, a few words around it, and for subtitles the time. */
/** One day-hour of listening to one episode (from the player; seeks don't count). */
export interface ListenRow { day: string; hour: number; episodeId: string; showId: string; seconds: number; translated: boolean; showTitle: string; kind: string; cover: string; episodeTitle: string; video: boolean; duration: number; progress: number; published: number }

export interface ShowHit { episode: Episode; field: "title" | "notes" | "transcript"; snippet: string; time?: number | null }

export interface Show {
  id: string;
  kind: "youtube" | "podcast" | "xiaoyuzhou" | "single" | "qiaomu";
  title: string;
  author?: string;
  cover?: string;
  feedUrl: string;
  link?: string;
  description?: string;
  updatedAt: number;
  unplayed: number;
}

export interface Episode {
  id: string;
  showId: string;
  guid: string;
  title: string;
  published?: number;
  duration?: number;
  audioUrl?: string;
  videoId?: string;
  link?: string;
  cover?: string;
  notes?: string;
  transcriptUrl?: string;
  transcriptType?: string;
  progress: number;
  hasTranscript: boolean;
  showTitle?: string;
  /** Has a 乔木精读 article. */
  deep?: boolean;
}

export interface Segment { start: number; end: number; text: string }
export interface Transcript { episodeId: string; source: string; language: string; segments: Segment[] }
export interface SearchResult { title: string; author: string; cover?: string; feedUrl: string; genre?: string; episodes?: number }
export interface ModelInfo { id: string; name: string; sizeMb: number; note: string; installed: boolean; /** Another app's copy, used in place (no download). */ from?: string | null }
export interface Provider { id: string; name: string; protocol: "openai" | "anthropic" | "cli"; baseUrl: string; model: string; needsKey: boolean; keyUrl?: string; models?: string[]; group?: "relay" | "provider" | "local" | "cli" }
export interface CloudAsr { id: string; name: string; note: string; protocol: "doubao" | "openai" | "deepseek"; baseUrl: string; model: string; models: string[]; keyUrl?: string; needsKey: boolean; chunkSecs?: number }
export interface ChatMessage { role: "user" | "assistant"; content: string; /** Which model wrote an answer, for display. */ model?: string }

/** An episode saved for offline listening. */
export interface Saved { episodeId: string; path: string; bytes: number; savedAt: number }

export interface AsrEvent { episodeId: string; stage: "download" | "transcribe" | "segment" | "done" | "error"; progress: number; message?: string; segment?: Segment }

type EpisodeDetail = { audio?: string; deepRead?: string };
const detailRequests = new Map<string, Promise<EpisodeDetail>>();
function qiaomuDetail(episodeId: string) {
  const pending = detailRequests.get(episodeId);
  if (pending) return pending;
  const request = invoke<EpisodeDetail>("qiaomu_detail", { episodeId }).finally(() => detailRequests.delete(episodeId));
  detailRequests.set(episodeId, request);
  return request;
}

export const api = {
  addSubscription: (input: string) => invoke<{ show?: Show; episode?: Episode }>("add_subscription", { input }),
  refreshShow: (id: string) => invoke<Show>("refresh_show", { id }),
  refreshAll: () => invoke<{ shows: number; newEpisodes: number; skipped: boolean }>("refresh_all"),
  listShows: () => invoke<Show[]>("list_shows"),
  listEpisodes: (showId?: string, limit?: number) => invoke<Episode[]>("list_episodes", { showId, limit }),
  recentEpisodes: () => invoke<Episode[]>("recent_episodes"),
  getEpisode: (id: string) => invoke<Episode | null>("get_episode", { id }),
  removeShow: (id: string) => invoke<void>("remove_show", { id }),
  setProgress: (id: string, seconds: number) => invoke<void>("set_progress", { id, seconds }),
  searchShow: (showId: string, query: string) => invoke<ShowHit[]>("search_show", { showId, query }),
  searchPodcasts: (term: string, country?: string) => invoke<SearchResult[]>("search_podcasts", { term, country }),
  loadTranscript: (episodeId: string) => invoke<Transcript | null>("load_transcript", { episodeId }),
  fetchOfficialTranscript: (episodeId: string) => invoke<Transcript | null>("fetch_official_transcript", { episodeId }),
  transcribe: (episodeId: string, model: string, language: string, cloud?: CloudAsr) => invoke<Transcript>("transcribe", { episodeId, model, language, cloud: cloud ?? null }),
  cancelJob: (id: string) => invoke<void>("cancel_job", { id }),
  /** Phones transcribe in the cloud only: one stand-in "model" that is always ready (the service is settings.asrEngine). */
  asrModels: async (): Promise<ModelInfo[]> => [{ id: "cloud", name: "云端识别", sizeMb: 0, note: "", installed: true }], // i18n-ignore (stand-in, never shown)
  logListen: (episodeId: string, showId: string, seconds: number, translated: boolean) => invoke<void>("log_listen", { episodeId, showId, seconds, translated }),
  listeningStats: (since: string) => invoke<ListenRow[]>("listening_stats", { since }),
  sharedTranscript: (episodeId: string) => invoke<Transcript | null>("shared_transcript", { episodeId }),
  /** The ids (of these) the shared library has subtitles for. */
  sharedExists: (episodeIds: string[]) => invoke<string[]>("shared_exists", { episodeIds }),
  /** A 导读 someone shared (saved as this episode's own when found). */
  sharedGuide: (episodeId: string) => invoke<string | null>("shared_guide", { episodeId }),
  shareGuide: (episodeId: string, text: string, model: string) => invoke<string>("share_guide", { episodeId, text, model }),
  getBlob: (episodeId: string, kind: string) => invoke<string | null>("get_blob", { episodeId, kind }),
  setBlob: (episodeId: string, kind: string, data: string) => invoke<void>("set_blob", { episodeId, kind, data }),
  getSettings: () => invoke<unknown>("get_settings"),
  setSettings: (settings: unknown) => invoke<void>("set_settings", { settings }),
  setApiKey: (provider: string, key: string) => invoke<void>("set_api_key", { provider, key }),
  hasApiKey: (provider: string) => invoke<boolean>("has_api_key", { provider }),
  /** Free Google translation with a persistent cache (no model needed). */
  previewShow: (input: string) => invoke<{ show: Show; episodes: Episode[]; fetchedAt: number }>("preview_show", { input }),
  /** Saves into the app's Documents/SubCast folder and returns the path. */
  saveImage: (name: string, base64: string) => invoke<string>("save_image", { name, base64 }),
  cachedShow: (input: string) => invoke<{ show: Show; episodes: Episode[]; fetchedAt: number } | null>("cached_show", { input }),
  qiaomuDetail,
  listModels: (provider: Provider) => invoke<string[]>("list_models", { provider }),
  ttsSpeak: (text: string, voice: string, resource?: string) => invoke<string>("tts_speak", { text, voice, resource }),
  youtubeStream: (videoId: string, mode: "native-hls" | "proxy-hls" | "relay" | "mp4", fresh = false) => invoke<{ url: string; kind: "hls" | "mp4" }>("youtube_stream", { videoId, mode, fresh }),
  uiReady: () => invoke<{ shell: string; build: number | null }>("ui_ready"),
  shareTranslation: (episodeId: string, engine: string, model: string) => invoke<string>("share_translation", { episodeId, engine, model }),
  exportOpml: () => invoke<string>("export_opml"),
  refreshConfig: () => invoke<void>("refresh_config"),
  prepareYoutube: () => invoke<void>("prepare_youtube"),
  youtubeTracks: (episodeId: string) => invoke<{ language: string; auto: boolean }[]>("youtube_tracks", { episodeId }),
  useYoutubeTrack: (episodeId: string, language: string, auto: boolean) => invoke<Transcript>("use_youtube_track", { episodeId, language, auto }),
  translateTexts: (texts: string[], target = "zh-CN") => invoke<string[]>("translate_texts", { texts, target }),
  downloadEpisode: (episodeId: string) => invoke<Saved>("download_episode", { episodeId }),
  listDownloads: () => invoke<Saved[]>("list_downloads"),
  deleteDownload: (episodeId: string) => invoke<void>("delete_download", { episodeId }),
  clearDownloads: () => invoke<void>("clear_downloads"),
  storageInfo: () => invoke<{ downloads: number; models: number; library: number; temp: number }>("storage_info"),
  clearTemp: () => invoke<void>("clear_temp"),
  fullNotes: (episodeId: string) => invoke<string | null>("full_notes", { episodeId }),
};

let llmCounter = 0;

/** Streams one model reply. `onDelta` receives the text so far. */
export async function llmChat(opts: {
  provider: Provider;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  jsonMode?: boolean;
  onDelta?: (full: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const requestId = `llm-${Date.now()}-${llmCounter++}`;
  let full = "";
  let unlisten: UnlistenFn | undefined;
  if (opts.onDelta) {
    unlisten = await listen<{ requestId: string; delta: string }>("llm", (ev) => {
      if (ev.payload.requestId !== requestId) return;
      full += ev.payload.delta;
      opts.onDelta!(full);
    });
  }
  const abort = () => void api.cancelJob(requestId);
  opts.signal?.addEventListener("abort", abort);
  try {
    const { id, protocol, baseUrl, model } = opts.provider;
    return await invoke<string>("llm_chat", {
      requestId,
      provider: { id, protocol, baseUrl, model },
      system: opts.system,
      messages: opts.messages,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
  } finally {
    unlisten?.();
    opts.signal?.removeEventListener("abort", abort);
  }
}

/** The error as it came, for matching on its wording; show it with errorText (or tr). */
export const rawErrorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
/** YouTube's "confirm you're not a bot" check, as the backend words it (asr.rs with_bot_fallback). */
export const isBotCheck = (m: string) => m.includes("YouTube 要求验证「不是机器人」。选一个"); // i18n-ignore (matches the backend's text)
export const errorText = (e: unknown) => tr(rawErrorText(e));
