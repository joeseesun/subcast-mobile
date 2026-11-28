import { api, type CloudAsr, type Provider } from "./api";
import { t, tk, type LangSetting } from "./i18n";

export interface SyncSettings {
  icloudEnabled: boolean;
  icloudDir: string;
  webdavEnabled: boolean;
  webdavUrl: string;
  webdavPath: string;
  webdavUsername: string;
  autoSync: boolean;
  syncProgress: boolean;
  syncContent: boolean;
}

export interface Settings {
  providers: Record<string, Provider>;
  chatProvider: string;
  translateProvider: string;
  /** auto: the user's model when it is set up, else Google; google: always Google; llm: always the model. */
  translateMode: "auto" | "google" | "llm";
  onboarded: boolean;
  proxy: string;
  asrModel: string;
  asrLanguage: string;
  mirrorFirst: boolean;
  autoTranslate: boolean;
  /** fast: one pass. best: a second pass that makes each line read naturally (about twice the model cost). */
  translateQuality: "fast" | "best";
  /** Give recognition and translation the episode's title and show notes (names and terms come out right). */
  useShowNotes: boolean;
  /** The listener picked the models themselves: local agents are never switched in automatically after that. */
  modelChosen?: boolean;
  /** When YouTube asks to confirm "not a bot", download with this browser's YouTube sign-in ("" = never). */
  ytCookiesBrowser?: string;
  /** Shortcuts the listener changed (Settings › 快捷键); the rest use the defaults in lib/shortcuts.ts. */
  /** Reading: subtitle size step, font, video subtitle look, Q&A text size, the next line on audio, skips, auto-next. */
  subtitleSize?: "s" | "m" | "l" | "xl";
  subtitleFont?: "system" | "serif" | "kai" | "sans";
  subtitleLook?: "box" | "outline";
  chatSize?: "m" | "l";
  /** 精读 reading: typeface (a poster font id, or "system" for the system sans), size in px, line spacing, paper. */
  readFont?: "system" | "sys" | "serif" | "kai" | "song" | "sans";
  readSize?: number;
  readLeading?: "tight" | "normal" | "loose";
  readPaper?: "plain" | "paper";
  audioNextLine?: boolean;
  skipBack?: number;
  /** The speed last chosen for each show (show id → rate), applied when one of its episodes loads. */
  showRates?: Record<string, number>;
  skipForward?: number;
  autoNext?: boolean;
  shortcuts?: Partial<Record<import("./shortcuts").ActionId, string[]>>;
  /** The local agent SubCast switched in on its own (shown as such in settings). */
  autoPicked?: string;
  subtitleMode: "bilingual" | "original" | "translation";
  playbackRate: number;
  /** "local", or the id of a cloud transcription service. */
  asrEngine: string;
  cloudAsr: Record<string, CloudAsr>;
  /** The voice service for 朗读 and 精读跟读 (see voices.ts); "" until chosen (then picked on first launch). */
  ttsEngine: string;
  /** What the listener changed per voice service: voice, model, address. */
  ttsServices: Record<string, { voice?: string; model?: string; baseUrl?: string; resource?: string }>;
  /** Reading speed for 朗读 (0.8–1.5). */
  ttsRate: number;
  /** Legacy Doubao fields, carried into ttsServices.doubao. */
  ttsVoice: string;
  ttsResource: string;
  /** The chat model picked in the chat box; "" means the chat provider's own model. */
  chatModel: string;
  /** A standing instruction added to every question. */
  chatPrompt: string;
  chatPromptOn: boolean;
  /** null keeps the built-in list, so it can improve with updates until the user edits it. */
  quickPrompts: QuickPrompt[] | null;
  /** Interface language; "auto" follows the system. */
  uiLang: LangSetting;
  /** Show the "subscribe on YouTube" links for shows that have an official channel. */
  /** Download new versions in the background; they install on the next restart. */
  autoUpdate: boolean;
  /** The Discover banner for our own show was closed by the user. */
  homeBannerHidden: boolean;
  /** Upload transcripts we make to the shared library (anonymous; reading shared ones is always on). */
  shareTranscripts: boolean;
  /** User-defined custom display names per show id (synced with Desktop). */
  showAliases?: Record<string, string>;
  /** Cross-device sync via iCloud Drive and/or WebDAV. */
  sync: SyncSettings;
}

export interface QuickPrompt { id: string; title: string; body: string; enabled: boolean }

export const BUILTIN_PROMPTS: QuickPrompt[] = ([
  ["oneline", tk("一句话总结"), tk("用一句话（不超过 40 字）说清这期最核心的结论，再用一句话说明为什么值得听。")],
  ["brief", tk("三分钟看懂这期"), tk("用三分钟能读完的篇幅讲清这期节目：主要聊了什么、得出了什么结论、为什么值得关注。最后推荐 3 个最值得听的片段，附时间戳。")],
  ["insights", tk("最有价值的观点"), tk("列出这期最有信息量的 5–8 个观点，按重要性排序。每条写：一句加粗的观点、嘉宾给出的理由、原话时间戳。")],
  ["debate", tk("反直觉和有争议的地方"), tk("这期有哪些反直觉或有争议的观点？逐条说明：通常大家怎么看、嘉宾怎么说、他的理由站不站得住、可能漏掉了什么。")],
  ["numbers", tk("数据和预测"), tk("把节目里出现的具体数字、时间表和对未来的预测整理成表格，列：内容、谁说的、时间戳、可信度和理由。")],
  ["resources", tk("提到的书和资源"), tk("整理节目里提到的书、论文、公司、产品、工具和人物，按类别列出，每项一句话说明，并附时间戳。")],
  ["action", tk("我能用上什么"), tk("站在普通从业者的角度，这期有哪些马上能用到工作或生活里的方法和建议？写成具体可做的动作，每条附出处时间戳。")],
  ["timeline", tk("按时间线梳理"), tk("按节目进行的顺序，把讨论分成 5–8 段，每段写：小标题、两三句要点、起始时间戳。")],
  ["explain", tk("讲给外行听"), tk("假设我完全不懂这个领域，用通俗的比方讲清这期最重要的 3 个概念或判断，每个附时间戳。")],
  ["quotes", tk("金句摘录"), tk("摘出 5–8 句最有分量的原话：保留原文，外语附中文翻译，注明是谁说的和时间戳。")],
  ["terms", tk("术语和黑话"), tk("列出节目里出现的专业术语、缩写和圈内说法，给出英文原文、通俗的中文解释和出现的时间戳。")],
  ["followup", tk("值得追问的问题"), tk("如果我能采访这位嘉宾，最值得追问的 3 个问题是什么？说明为什么要问，以及节目里哪里没讲透。")],
  ["share", tk("写一段分享"), tk("把这期的精华写成一段适合发朋友圈的分享，200 字以内，口语化，突出一个最有冲击力的观点。")],
]).map(([id, title, body]) => ({ id: `builtin-${id}`, title, body, enabled: true }));

export const PROMPT_HINTS = [tk("先给结论，再展开"), tk("简洁，不说套话"), tk("多用列表和表格"), tk("术语保留英文原文"), tk("讲给外行听，多打比方")];

/** Built-ins that were taken out (a saved list may still have them). */
const RETIRED = new Set(["builtin-guest"]);
export const quickPrompts = (s: Settings) => (s.quickPrompts ?? BUILTIN_PROMPTS.map((p) => ({ ...p, title: t(p.title), body: t(p.body) }))).filter((p) => !RETIRED.has(p.id));

// The model catalogue, ported from Capwise. Model names are suggestions; every field stays editable because providers
// rename models often, and 「获取模型列表」 reads the live list from the provider.
type G = Provider["group"];
const o = (id: string, name: string, group: G, baseUrl: string, keyUrl: string | undefined, models: string[] = [], needsKey = group !== "local"): Provider =>
  ({ id, name, group, protocol: "openai", baseUrl, model: models[0] ?? "", needsKey, keyUrl, models });

export const PRESETS: Provider[] = [
  o("deepseek", "DeepSeek", "provider", "https://api.deepseek.com/v1", "https://platform.deepseek.com/api_keys", ["deepseek-flash", "deepseek-v4-pro"]),
  o("siliconflow", tk("硅基流动"), "relay", "https://api.siliconflow.cn/v1", "https://cloud.siliconflow.cn/account/ak", ["deepseek-ai/deepseek-v4-flash", "deepseek-ai/deepseek-v4-pro"]),
  o("tokendance", "TokenDance", "relay", "https://tokendance.space/gateway/v1", "https://tokendance.space/keys", ["deepseek-v4-flash", "qwen3.8-flash", "kimi-k3"]),
  o("openrouter", "OpenRouter", "relay", "https://openrouter.ai/api/v1", "https://openrouter.ai/settings/keys", ["anthropic/claude-sonnet-5.5"]),
  o("opencode-go", "OpenCode Go", "relay", "https://opencode.ai/zen/go/v1", "https://opencode.ai/auth", ["deepseek-v4.1-flash", "glm-5.3-flash", "kimi-k3", "longcat-2.0", "mimo-v2.6-flash"]),
  { id: "anthropic", name: "Claude（Anthropic）", group: "provider", protocol: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", needsKey: true, keyUrl: "https://console.anthropic.com/settings/keys", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  o("openai", "OpenAI", "provider", "https://api.openai.com/v1", "https://platform.openai.com/api-keys", ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]),
  o("google-gemini", "Google Gemini", "provider", "https://generativelanguage.googleapis.com/v1beta/openai", "https://aistudio.google.com/app/apikey", ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.1-pro-preview"]),
  o("moonshot", tk("Kimi（月之暗面）"), "provider", "https://api.moonshot.cn/v1", "https://platform.moonshot.cn/console/api-keys", ["kimi-k3", "kimi-k2.6"]),
  o("zhipu", tk("智谱 GLM"), "provider", "https://open.bigmodel.cn/api/paas/v4", "https://open.bigmodel.cn/usercenter/apikeys"),
  o("qwen-cn", tk("通义千问（百炼）"), "provider", "https://dashscope.aliyuncs.com/compatible-mode/v1", "https://bailian.console.aliyun.com/?apiKey=1"),
  o("doubao", tk("豆包（火山方舟）"), "provider", "https://ark.cn-beijing.volces.com/api/v3", "https://ai.volcengine.com/console/apikey"),
  o("minimax-cn", "MiniMax", "provider", "https://api.minimaxi.com/v1", "https://platform.minimaxi.com/user-center/basic-information/interface-key"),
  o("stepfun", tk("阶跃星辰"), "provider", "https://api.stepfun.com/v1", "https://platform.stepfun.com/interface-key"),
  o("qianfan", tk("百度千帆"), "provider", "https://qianfan.baidubce.com/v2", "https://console.bce.baidu.com/iam/#/iam/apikey/list"),
  o("hunyuan", tk("腾讯混元"), "provider", "https://api.hunyuan.cloud.tencent.com/v1", "https://console.cloud.tencent.com/hunyuan/api-key"),
  o("mimo", tk("小米 MiMo"), "provider", "https://api.xiaomimimo.com/v1", "https://platform.xiaomimimo.com/"),
  o("xai", "xAI", "provider", "https://api.x.ai/v1", "https://console.x.ai", ["grok-4.5", "grok-4.3"]),
  o("mistral", "Mistral", "provider", "https://api.mistral.ai/v1", "https://console.mistral.ai/api-keys"),
  o("groq", "Groq", "provider", "https://api.groq.com/openai/v1", "https://console.groq.com/keys"),
  o("perplexity", "Perplexity", "provider", "https://api.perplexity.ai", "https://www.perplexity.ai/settings/api", ["sonar", "sonar-pro"]),
  o("nvidia", "NVIDIA", "provider", "https://integrate.api.nvidia.com/v1", "https://build.nvidia.com/settings/api-keys"),
  o("together", "Together AI", "provider", "https://api.together.xyz/v1", "https://api.together.xyz/settings/api-keys"),
  o("fireworks", "Fireworks AI", "provider", "https://api.fireworks.ai/inference/v1", "https://fireworks.ai/account/api-keys"),
  o("cerebras", "Cerebras", "provider", "https://api.cerebras.ai/v1", "https://cloud.cerebras.ai/"),
  o("ollama", "Ollama", "local", "http://127.0.0.1:11434/v1", undefined, ["qwen3.5", "gemma4", "gpt-oss:20b"]),
  o("lmstudio", "LM Studio", "local", "http://127.0.0.1:1234/v1", undefined),
  o("magpie", "Magpie", "local", "http://127.0.0.1:3425/v1", "https://github.com/yetone/magpie"),
  o("custom", tk("其他（OpenAI 兼容）"), "provider", "", undefined, [], true),
];

export const GROUPS: { id: NonNullable<G>; name: string; note: string }[] = [
  { id: "relay", name: tk("一个 Key 用多家模型"), note: tk("中转平台") },
  { id: "provider", name: tk("模型厂商"), note: tk("官方接口") },
  { id: "local", name: tk("本机运行"), note: tk("不需要 Key") },
];

/** The cloud services shown up front (Settings and the episode's pickers); the rest sit behind 「更多」. */
export const CLOUD_ASR_MAIN = ["doubao", "siliconflow", "groq"];

/** Cloud transcription services, ported from Capwise. */
export const ASR_SERVICES: CloudAsr[] = [
  { id: "doubao", name: tk("豆包语音（极速版）"), note: tk("中文最准，5 分钟一段，速度快"), protocol: "doubao", baseUrl: "https://openspeech.bytedance.com/api/v3", model: "bigmodel", models: ["bigmodel"], keyUrl: "https://console.volcengine.com/speech/new/experience/asr", needsKey: true, chunkSecs: 300 },
  // DeepSeek's ASR takes ≤120 s per request and returns text only; 60 s pieces keep the timing close.
  { id: "deepseek", name: "DeepSeek", note: tk("和问答共用同一个 DeepSeek Key"), protocol: "deepseek", baseUrl: "https://api.deepseek.com", model: "asr", models: ["asr"], keyUrl: "https://platform.deepseek.com/api_keys", needsKey: true, chunkSecs: 60 },
  { id: "siliconflow", name: tk("硅基流动"), note: tk("Qwen3-ASR、SenseVoice 等，便宜"), protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen3-ASR-1.7B", models: ["Qwen/Qwen3-ASR-1.7B", "FunAudioLLM/SenseVoiceSmall", "XingChenAGI/XingChenASR-V3.2"], keyUrl: "https://cloud.siliconflow.cn/account/ak", needsKey: true, chunkSecs: 20 },
  { id: "groq", name: "Groq", note: tk("Whisper large-v3，极快"), protocol: "openai", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", models: ["whisper-large-v3-turbo", "whisper-large-v3"], keyUrl: "https://console.groq.com/keys", needsKey: true, chunkSecs: 600 },
  { id: "openai", name: "OpenAI", note: "Whisper / gpt-4o-transcribe", protocol: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-transcribe", models: ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"], keyUrl: "https://platform.openai.com/api-keys", needsKey: true, chunkSecs: 600 },
  { id: "glm", name: tk("智谱 GLM-ASR"), note: tk("中文识别"), protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-asr-2512", models: ["glm-asr-2512"], keyUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys", needsKey: true, chunkSecs: 25 },
  { id: "stepfun", name: tk("阶跃星辰"), note: "Step ASR", protocol: "openai", baseUrl: "https://api.stepfun.com/v1", model: "stepaudio-2.5-asr", models: ["stepaudio-2.5-asr", "step-asr"], keyUrl: "https://platform.stepfun.com/interface-key", needsKey: true, chunkSecs: 20 },
  { id: "local-server", name: tk("本机识别服务"), note: tk("OpenAI 兼容的本地服务"), protocol: "openai", baseUrl: "http://127.0.0.1:8765/v1", model: "Qwen/Qwen3-ASR-0.6B", models: ["Qwen/Qwen3-ASR-0.6B", "whisper-1"], needsKey: false, chunkSecs: 60 },
];

/** Doubao seed-tts-2.0 voices (from Capwise). */
export const VOICES: [string, string][] = [
  ["zh_female_vv_uranus_bigtts", "Vivi 2.0"],
  ["zh_male_liufei_uranus_bigtts", tk("刘飞 2.0")],
  ["zh_female_xiaohe_uranus_bigtts", tk("小何 2.0")],
  ["zh_male_m191_uranus_bigtts", tk("云舟 2.0")],
  ["zh_male_taocheng_uranus_bigtts", tk("小天 2.0")],
  ["zh_male_shenyeboke_uranus_bigtts", tk("深夜播客 2.0")],
  ["zh_male_youyoujunzi_uranus_bigtts", tk("悠悠君子 2.0")],
  ["zh_female_shuangkuaisisi_uranus_bigtts", tk("爽快思思 2.0")],
  ["zh_female_cancan_uranus_bigtts", tk("知性灿灿 2.0")],
  ["en_male_tim_uranus_bigtts", "Tim"],
  ["en_female_dacey_uranus_bigtts", "Dacey"],
];

export const DEFAULT_SYNC: SyncSettings = {
  icloudEnabled: false,
  icloudDir: "",
  webdavEnabled: false,
  webdavUrl: "",
  webdavPath: "/SubCast",
  webdavUsername: "",
  autoSync: true,
  syncProgress: true,
  syncContent: true,
};

export const DEFAULTS: Settings = {
  providers: Object.fromEntries(PRESETS.map((p) => [p.id, p])),
  chatProvider: "deepseek",
  translateProvider: "deepseek",
  translateMode: "auto",
  onboarded: false,
  proxy: "",
  asrModel: "qwen3-asr",
  asrLanguage: "auto",
  mirrorFirst: true,
  autoTranslate: true,
  translateQuality: "fast",
  useShowNotes: true,
  subtitleMode: "bilingual",
  playbackRate: 1,
  asrEngine: "deepseek",
  cloudAsr: Object.fromEntries(ASR_SERVICES.map((a) => [a.id, a])),
  ttsEngine: "",
  ttsServices: {},
  ttsRate: 1,
  ttsVoice: "zh_female_vv_uranus_bigtts",
  ttsResource: "seed-tts-2.0",
  chatModel: "",
  chatPrompt: "",
  chatPromptOn: true,
  quickPrompts: null,
  uiLang: "auto",
  autoUpdate: true,
  homeBannerHidden: false,
  shareTranscripts: true,
  sync: { ...DEFAULT_SYNC },
};

export async function loadSettings(): Promise<Settings> {
  const raw = (await api.getSettings()) as Partial<Settings> | null;
  if (!raw) return structuredClone(DEFAULTS);
  // Keep presets' metadata (key links, suggestions) current while keeping what the user edited.
  const providers: Record<string, Provider> = {};
  for (const p of PRESETS) providers[p.id] = { ...p, ...(raw.providers?.[p.id] ?? {}), keyUrl: p.keyUrl, models: p.models, needsKey: p.needsKey, name: p.name, group: p.group };
  const cloudAsr: Record<string, CloudAsr> = {};
  for (const a of ASR_SERVICES) cloudAsr[a.id] = { ...a, ...(raw.cloudAsr?.[a.id] ?? {}), name: a.name, note: a.note, models: a.models, keyUrl: a.keyUrl, needsKey: a.needsKey, protocol: a.protocol };
  const sync: SyncSettings = { ...DEFAULT_SYNC, ...(raw.sync ?? {}) };
  return migrate({ ...DEFAULTS, ...raw, providers, cloudAsr, sync });
}

/** 0.2.6 removed several switches; carry what each one meant into what remains. Idempotent. */
export function migrate(s: Settings): Settings {
  const out = { ...s };
  // Phones have no local recogniser: DeepSeek shares the Q&A key, so one key covers both.
  if (!out.asrEngine || out.asrEngine === "local" || !out.cloudAsr[out.asrEngine]) out.asrEngine = "deepseek";
  // "Always use the model" is now just the default; "always Google" stays as translation assigned to Google.
  if (out.translateMode === "llm") out.translateMode = "auto";
  // Translation is always on; someone who turned it off wanted the original only.
  if (out.autoTranslate === false) { out.subtitleMode = "original"; out.autoTranslate = true; }
  out.useShowNotes = true;
  out.asrLanguage = "auto";
  return out;
}
