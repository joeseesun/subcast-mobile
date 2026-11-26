// Voices for 朗读 and 精读跟读, after the desktop app: the phone's own voices (WebKit speech synthesis, offline, no
// key) and the cloud services the Rust side speaks with (speech.rs). Each service keeps its own voice, model and key.
import { api } from "./api";
import { t, tk } from "./i18n";
import { VOICES, type Settings } from "./settings";
import { useStore } from "../store";

export type TtsProtocol = "edge" | "system" | "doubao" | "mimo" | "openai" | "qwen" | "minimax" | "elevenlabs" | "deepseek";
export interface TtsVoice { id: string; name: string }
export interface TtsService {
  id: string;
  name: string;
  note: string;
  group: "local" | "cloud";
  protocol: TtsProtocol;
  baseUrl: string;
  model: string;
  models: string[];
  voice: string;
  voices: TtsVoice[];
  resource?: string;
  keyUrl?: string;
  needsKey: boolean;
  /** Shown as placeholder on the Key field when an AI/ASR key can be reused. */
  sharedKeyHint?: string;
}

export interface TtsRequest {
  engine: string; protocol: TtsProtocol; baseUrl?: string; model?: string; voice: string; resource?: string;
  text: string; rate?: number; needsKey?: boolean;
}

const v = (list: readonly (readonly [string, string])[]): TtsVoice[] => list.map(([id, name]) => ({ id, name }));

export const TTS_SERVICES: TtsService[] = [
  {
    id: "system", name: tk("系统语音"), note: tk("优先使用本机增强语音，完全离线、无需 Key"), group: "local",
    protocol: "system", baseUrl: "", model: "", models: [], needsKey: false,
    voice: "", voices: [],
  },
  {
    id: "doubao", name: tk("豆包语音"), note: tk("中文自然度高，支持复刻音色和原生变速"), group: "cloud",
    protocol: "doubao", baseUrl: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
    model: "seed-tts-2.0", models: ["seed-tts-2.0"], resource: "seed-tts-2.0",
    keyUrl: "https://console.volcengine.com/speech/new/setting/apikeys?projectName=default",
    needsKey: true, sharedKeyHint: tk("填过豆包语音识别的可以留空"),
    voice: "zh_female_vv_uranus_bigtts",
    voices: v(VOICES),
  },
  {
    id: "deepseek", name: "DeepSeek", note: tk("两种音色，中英文都能读，与 AI 模型共用 Key"), group: "cloud",
    protocol: "deepseek", baseUrl: "https://api.deepseek.com", model: "", models: [],
    keyUrl: "https://platform.deepseek.com/api_keys",
    needsKey: true, sharedKeyHint: tk("填过「AI 模型」里的 DeepSeek 可以留空"),
    voice: "stella",
    voices: v([
      ["stella", tk("Stella（女声）")],
      ["tide", tk("Tide（男声）")],
    ]),
  },
  {
    id: "mimo", name: tk("小米 MiMo"), note: tk("自然播客语调，与 AI 模型共用 Key"), group: "cloud",
    protocol: "mimo", baseUrl: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.5-tts", models: ["mimo-v2.5-tts"],
    keyUrl: "https://platform.xiaomimimo.com/",
    needsKey: true, sharedKeyHint: tk("填过「AI 模型」里的小米 MiMo 可以留空"),
    voice: "mimo_default",
    // mimo-v2.5-tts's built-in voices (the old v2 ids default_zh / default_en are rejected with HTTP 400).
    voices: v([
      ["mimo_default", tk("默认")],
      ["冰糖", tk("冰糖")], // i18n-ignore (API voice id)
      ["茉莉", tk("茉莉")], // i18n-ignore (API voice id)
      ["苏打", tk("苏打")], // i18n-ignore (API voice id)
      ["白桦", tk("白桦")], // i18n-ignore (API voice id)
      ["Mia", "Mia"],
      ["Chloe", "Chloe"],
      ["Milo", "Milo"],
      ["Dean", "Dean"],
    ]),
  },
  {
    id: "qwen", name: tk("通义 Qwen-TTS"), note: tk("阿里云百炼，音质清晰，与通义千问共用 Key"), group: "cloud",
    protocol: "qwen", baseUrl: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    model: "qwen3-tts-flash", models: ["qwen3-tts-flash", "qwen-tts"],
    keyUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    needsKey: true, sharedKeyHint: tk("填过「AI 模型」里的通义千问可以留空"),
    voice: "Cherry",
    voices: v([
      ["Cherry", tk("芊悦 Cherry")],
      ["Ethan", tk("晨煦 Ethan")],
      ["Chelsie", tk("千雪 Chelsie")],
      ["Serena", tk("苏瑶 Serena")],
      ["Dylan", tk("晓东 Dylan")],
      ["Jada", tk("阿珍 Jada")],
      ["Sunny", tk("晴儿 Sunny")],
    ]),
  },
  {
    id: "openai", name: "OpenAI", note: tk("官方语音接口，与 OpenAI 模型共用 Key"), group: "cloud",
    protocol: "openai", baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini-tts", models: ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true, sharedKeyHint: tk("填过「AI 模型」里的 OpenAI 可以留空"),
    voice: "alloy",
    voices: v([
      ["alloy", "Alloy"], ["ash", "Ash"], ["coral", "Coral"], ["echo", "Echo"],
      ["nova", "Nova"], ["onyx", "Onyx"], ["sage", "Sage"], ["shimmer", "Shimmer"],
    ]),
  },
  {
    id: "edge", name: tk("Edge 在线语音"), note: tk("无需 API Key，高峰期可能限流"), group: "cloud",
    protocol: "edge", baseUrl: "", model: "", models: [], needsKey: false,
    voice: "zh-CN-YunxiNeural",
    voices: v([
      ["zh-CN-YunxiNeural", tk("云希（男声）")],
      ["zh-CN-XiaoxiaoNeural", tk("晓晓（女声）")],
      ["zh-CN-YunjianNeural", tk("云健（播音）")],
      ["zh-CN-XiaoyiNeural", tk("晓伊（温和）")],
      ["zh-CN-YunyangNeural", tk("云扬（新闻）")],
      ["zh-TW-HsiaoChenNeural", tk("晓臻（台湾）")],
      ["zh-HK-HiuMaanNeural", tk("晓曼（粤语）")],
      ["en-US-AndrewMultilingualNeural", "Andrew"],
      ["en-US-EmmaMultilingualNeural", "Emma"],
    ]),
  },
  {
    id: "siliconflow", name: tk("硅基流动"), note: tk("CosyVoice2 / MOSS，价格低，与硅基流动共用 Key"), group: "cloud",
    protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1",
    model: "FunAudioLLM/CosyVoice2-0.5B", models: ["FunAudioLLM/CosyVoice2-0.5B", "fnlp/MOSS-TTSD-v0.5"],
    keyUrl: "https://cloud.siliconflow.cn/account/ak",
    needsKey: true, sharedKeyHint: tk("填过「AI 模型」里的硅基流动可以留空"),
    voice: "anna",
    voices: v([
      ["anna", tk("Anna（沉稳女声）")],
      ["alex", tk("Alex（沉稳男声）")],
      ["bella", tk("Bella（激情女声）")],
      ["benjamin", tk("Benjamin（低沉男声）")],
      ["claire", tk("Claire（温柔女声）")],
      ["charles", tk("Charles（磁性男声）")],
      ["diana", tk("Diana（欢快女声）")],
      ["david", tk("David（欢快男声）")],
    ]),
  },
  {
    id: "minimax", name: "MiniMax", note: tk("Speech 02 / 2.6，韵律自然，与 MiniMax 共用 Key"), group: "cloud",
    protocol: "minimax", baseUrl: "https://api.minimaxi.com/v1",
    model: "speech-02-hd", models: ["speech-02-hd", "speech-02-turbo", "speech-2.6-hd"],
    keyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    needsKey: true, sharedKeyHint: tk("填过「AI 模型」里的 MiniMax 可以留空"),
    voice: "male-qn-qingse",
    voices: v([
      ["male-qn-qingse", tk("青涩青年")],
      ["female-shaonv", tk("少女音色")],
      ["male-qn-jingying", tk("精英青年")],
      ["female-yujie", tk("御姐音色")],
      ["presenter_male", tk("男性主持人")],
      ["presenter_female", tk("女性主持人")],
      ["audiobook_male_1", tk("有声书男声")],
      ["audiobook_female_1", tk("有声书女声")],
    ]),
  },
  {
    id: "elevenlabs", name: "ElevenLabs", note: tk("多语种拟真语音，英文表现突出"), group: "cloud",
    protocol: "elevenlabs", baseUrl: "https://api.elevenlabs.io/v1",
    model: "eleven_multilingual_v2", models: ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_turbo_v2_5"],
    keyUrl: "https://elevenlabs.io/app/settings/api-keys",
    needsKey: true,
    voice: "JBFqnCBsd6RMkjVDRZzb",
    voices: v([
      ["JBFqnCBsd6RMkjVDRZzb", "George"],
      ["21m00Tcm4TlvDq8ikWAM", "Rachel"],
      ["EXAVITQu4vr4xnSDxMaL", "Sarah"],
      ["pNInz6obpgDQGcFmaJgB", "Adam"],
      ["Xb7hH8MSUJpSbSDYk0k2", "Alice"],
    ]),
  },
  {
    id: "custom", name: tk("其他（OpenAI 兼容）"), note: tk("兼容 /audio/speech 的云端或本机服务"), group: "cloud",
    protocol: "openai", baseUrl: "http://127.0.0.1:8880/v1",
    model: "tts-1", models: ["tts-1"],
    needsKey: false,
    voice: "alloy",
    voices: [],
  },
];

/** Free services first, then the cloud ones roughly by how good they are for Chinese. */
const ORDER = ["system", "edge", "doubao", "deepseek", "mimo", "qwen", "minimax", "openai", "siliconflow", "elevenlabs", "custom"];
export const SERVICES = [...TTS_SERVICES].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

/** The service with what the listener changed on it (voice, model, address). */
export function serviceOf(s: Settings, id = s.ttsEngine): TtsService {
  const base = SERVICES.find((x) => x.id === id) ?? SERVICES.find((x) => x.id === "edge")!;
  const own = s.ttsServices?.[base.id] ?? {};
  const legacy = base.id === "doubao" && !own.voice ? { voice: s.ttsVoice, resource: s.ttsResource } : {};
  return { ...base, ...legacy, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v)) };
}

/** Where a voice service's key lives. Services that are also AI models share that one key both ways: a key typed
 *  here is the one 问答 uses, and one entered under AI 模型 reads aloud too (speech.rs looks there as well). */
const SHARED_KEY: Record<string, string> = { deepseek: "deepseek", openai: "openai", siliconflow: "siliconflow", mimo: "mimo", qwen: "qwen-cn", minimax: "minimax-cn" };
export const keyAccount = (id: string) => SHARED_KEY[id] ?? `tts.${id}`;

/** First launch with this version: someone who already set up Doubao speech keeps it; else a DeepSeek key already
 *  there for 问答 reads aloud too; else Edge (natural neural voices, no key). */
export async function chooseDefaultEngine() {
  const s = useStore.getState().settings;
  if (s.ttsEngine) return;
  const has = (k: string) => api.hasApiKey(k).catch(() => false);
  const doubao = (await has("tts.doubao")) || (await has("asr.doubao"));
  const deepseek = !doubao && (await has("deepseek"));
  await useStore.getState().saveSettings({ ttsEngine: doubao ? "doubao" : deepseek ? "deepseek" : "edge" });
}

/** DeepSeek has no speed setting: it speaks at 1× and playback is sped up instead. */
const NO_NATIVE_SPEED = new Set(["deepseek"]);

export type Spoken = { kind: "audio"; url: string; playbackRate: number } | { kind: "system" };

/** Makes `text` into audio with the chosen service (or says to use the phone's voice). */
export async function synthesize(text: string, opts?: { engine?: string; voice?: string }): Promise<Spoken> {
  const s = useStore.getState().settings;
  const svc = serviceOf(s, opts?.engine);
  if (svc.protocol === "system") return { kind: "system" };
  const wanted = s.ttsRate || 1;
  const rate = NO_NATIVE_SPEED.has(svc.protocol) ? 1 : wanted;
  const out = await api.ttsSynthesize({
    engine: svc.id, protocol: svc.protocol, baseUrl: svc.baseUrl || undefined, model: svc.model || undefined,
    voice: opts?.voice ?? svc.voice, resource: svc.resource || undefined, text, rate, needsKey: svc.needsKey,
  });
  return { kind: "audio", url: `data:${out.mime};base64,${out.data}`, playbackRate: wanted / rate };
}

/** The phone's voices for Chinese and English, best first (enhanced/premium before compact). */
export function systemVoices(): SpeechSynthesisVoice[] {
  const all = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : [];
  const score = (v: SpeechSynthesisVoice) => (/premium/i.test(v.name) || /premium/i.test(v.voiceURI) ? 2 : /enhanced/i.test(v.name) || /enhanced/i.test(v.voiceURI) ? 1 : 0);
  return all.filter((v) => /^(zh|en)/i.test(v.lang)).sort((a, b) => (a.lang.startsWith("zh") === b.lang.startsWith("zh") ? score(b) - score(a) : a.lang.startsWith("zh") ? -1 : 1));
}

/** Speaks with the phone's own voice. `onBoundary` gets the character reached (for the read-along highlight).
 *  Resolves when done; rejects when it fails. Cancel with speechSynthesis.cancel(). */
export function speakSystem(text: string, onBoundary?: (char: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof speechSynthesis === "undefined") { reject(new Error(t("这台设备不支持系统语音"))); return; }
    const s = useStore.getState().settings;
    const u = new SpeechSynthesisUtterance(text);
    const cjk = /[\u4e00-\u9fff]/.test(text);
    const chosen = serviceOf(s, "system").voice;
    const voices = systemVoices();
    u.voice = voices.find((v) => v.voiceURI === chosen && v.lang.startsWith(cjk ? "zh" : "en"))
      ?? voices.find((v) => v.lang.startsWith(cjk ? "zh" : "en")) ?? null;
    u.lang = u.voice?.lang ?? (cjk ? "zh-CN" : "en-US");
    u.rate = Math.max(0.5, Math.min(2, s.ttsRate || 1));
    if (onBoundary) u.onboundary = (e) => onBoundary(e.charIndex);
    u.onend = () => { alive.delete(u); resolve(); };
    u.onerror = (e) => { alive.delete(u); if (e.error === "interrupted" || e.error === "canceled") resolve(); else reject(new Error(t("系统语音播放失败"))); };
    alive.add(u); // WebKit drops an utterance nothing references any more, and its onend with it
    speechSynthesis.speak(u);
  });
}
const alive = new Set<SpeechSynthesisUtterance>();
