// Brand marks for model services and local agents (LobeHub Icons, MIT; see src/assets/providers/LICENSE.md).
// Inlined as SVG text so single-colour marks follow the text colour in light and dark.
const FILES = import.meta.glob("../assets/providers/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const svg = (name: string) => FILES[`../assets/providers/${name}.svg`];

const BY_ID: Record<string, string> = {
  "cli-claude": "claude-color", "cli-codex": "codex-color", "cli-antigravity": "antigravity-color", "cli-gemini": "gemini-color",
  "cli-qwen": "qwen-color", "cli-kimi": "kimi-color", "cli-opencode": "opencode",
  deepseek: "deepseek-color", siliconflow: "siliconcloud-color", openrouter: "openrouter", "opencode-go": "opencode", anthropic: "claude-color",
  openai: "openai", "google-gemini": "gemini-color", moonshot: "kimi-color", zhipu: "zhipu-color", "qwen-cn": "qwen-color", doubao: "doubao-color",
  "minimax-cn": "minimax-color", stepfun: "stepfun-color", qianfan: "wenxin-color", hunyuan: "hunyuan-color", mimo: "xiaomimimo", xai: "grok",
  mistral: "mistral-color", groq: "groq", perplexity: "perplexity-color", nvidia: "nvidia-color", together: "together-color",
  fireworks: "fireworks-color", cerebras: "cerebras-color", ollama: "ollama", lmstudio: "lmstudio",
};

/** The SVG markup for a provider's mark, or undefined (the caller shows initials). */
export const providerIcon = (id: string): string | undefined => { const n = BY_ID[id]; return n ? svg(n) : undefined; };
