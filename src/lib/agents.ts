// Local AI agents (Claude Code, Codex…) exist only in the desktop app. Phones keep the types so shared code
// compiles; nothing is ever found.
import { create } from "zustand";
import type { Provider } from "./api";
import { tk } from "./i18n";

export type AgentKind = "claude" | "codex" | "antigravity" | "gemini" | "qwen" | "kimi" | "opencode";
export interface FoundAgent { kind: AgentKind; path: string; version: string; login: "ready" | "needsLogin" | "unknown" }

export const AGENTS: Record<AgentKind, { name: string; vendor: string; login: string; plan: string; models: string[]; install: string }> = {
  claude: { name: "Claude Code", vendor: "Anthropic", login: "claude", plan: tk("Claude 订阅（Pro / Max）"), models: ["sonnet", "opus", "haiku"], install: "https://claude.com/claude-code" },
  codex: { name: "Codex", vendor: "OpenAI", login: "codex login", plan: tk("ChatGPT 订阅"), models: [], install: "https://developers.openai.com/codex/cli" },
  antigravity: { name: "Antigravity CLI", vendor: "Google", login: "agy", plan: tk("Google 账号（Gemini）"), models: ["gemini-3.8-flash-medium", "gemini-3.8-flash-high", "gemini-3.8-flash-low"], install: "https://antigravity.google" },
  qwen: { name: "Qwen Code", vendor: tk("阿里通义"), login: "qwen", plan: tk("通义账号"), models: [], install: "https://github.com/QwenLM/qwen-code" },
  kimi: { name: "Kimi Code", vendor: tk("月之暗面"), login: "kimi", plan: tk("Kimi 账号"), models: [], install: "https://www.kimi.com/code" },
  opencode: { name: "OpenCode", vendor: "OpenCode", login: "opencode auth login", plan: tk("OpenCode 里登录的服务"), models: [], install: "https://opencode.ai" },
  gemini: { name: "Gemini CLI", vendor: "Google", login: "gemini", plan: tk("Gemini API Key 或企业版账号"), models: [], install: "https://github.com/google-gemini/gemini-cli" },
};

export const agentProviderId = (k: AgentKind) => `cli-${k}`;
export const agentOf = (p?: Provider | null): AgentKind | null => (p?.protocol === "cli" ? (p.id.replace(/^cli-/, "") as AgentKind) : null);

export function agentProvider(k: AgentKind): Provider {
  return { id: agentProviderId(k), name: AGENTS[k].name, group: "cli", protocol: "cli", baseUrl: "local", model: "", needsKey: false, models: AGENTS[k].models };
}

interface AgentsState { found: FoundAgent[] | null; checking: boolean }
export const useAgents = create<AgentsState>(() => ({ found: null, checking: false }));

/** Phones have no local AI agents (Claude Code, Codex…): the list is always empty. */
export async function detectAgents() { useAgents.setState({ found: [], checking: false }); }

/** Starts the agent behind a provider in the background, so the first answer is quicker. */
export function warmAgent(p?: Provider | null) {
  void p;
}
