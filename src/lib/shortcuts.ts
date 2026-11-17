// Keyboard shortcuts: one registry of actions with defaults (YouTube's where they overlap, so they feel familiar),
// overridable in Settings › 快捷键. A shortcut is "Mod+Shift+K" style text; Mod is ⌘ on macOS and Ctrl elsewhere.
import { create } from "zustand";
import { tk } from "./i18n";
import { IS_MAC } from "./i18n";

export type ActionId =
  | "playPause" | "back" | "forward" | "backShort" | "forwardShort" | "prevLine" | "nextLine"
  | "fullscreen" | "subtitleMode" | "speedUp" | "speedDown" | "mute"
  | "toggleSidebar" | "togglePanel" | "search" | "settings" | "keysHelp";

export interface ActionDef { id: ActionId; label: string; group: string; keys: string[]; /** Works while typing in a text box. */ global?: boolean }

export const ACTIONS: ActionDef[] = [
  { id: "playPause", label: tk("播放 / 暂停"), group: tk("播放"), keys: ["Space", "K"] },
  { id: "back", label: tk("后退 15 秒"), group: tk("播放"), keys: ["ArrowLeft", "J"] },
  { id: "forward", label: tk("前进 30 秒"), group: tk("播放"), keys: ["ArrowRight", "L"] },
  { id: "backShort", label: tk("后退 5 秒"), group: tk("播放"), keys: ["Shift+ArrowLeft"] },
  { id: "forwardShort", label: tk("前进 5 秒"), group: tk("播放"), keys: ["Shift+ArrowRight"] },
  { id: "prevLine", label: tk("上一句"), group: tk("播放"), keys: ["ArrowUp"] },
  { id: "nextLine", label: tk("下一句"), group: tk("播放"), keys: ["ArrowDown"] },
  { id: "speedUp", label: tk("加快播放"), group: tk("播放"), keys: ["Shift+."] },
  { id: "speedDown", label: tk("减慢播放"), group: tk("播放"), keys: ["Shift+,"] },
  { id: "mute", label: tk("静音"), group: tk("播放"), keys: ["M"] },
  { id: "fullscreen", label: tk("全屏看视频"), group: tk("视频与字幕"), keys: ["F"] },
  { id: "subtitleMode", label: tk("切换字幕：双语 / 中文 / 原文"), group: tk("视频与字幕"), keys: ["C"] },
  { id: "toggleSidebar", label: tk("显示 / 收起侧栏"), group: tk("窗口"), keys: ["Mod+B"], global: true },
  { id: "togglePanel", label: tk("显示 / 收起字幕栏"), group: tk("窗口"), keys: ["Mod+\\"], global: true },
  { id: "search", label: tk("搜索节目"), group: tk("窗口"), keys: ["Mod+L"], global: true },
  { id: "settings", label: tk("打开设置"), group: tk("窗口"), keys: ["Mod+,"], global: true },
  { id: "keysHelp", label: tk("查看快捷键"), group: tk("窗口"), keys: ["Mod+/"], global: true },
];

/** Whether the shortcut cheat sheet (⌘/) is showing. */
export const useKeysHelp = create<{ open: boolean }>(() => ({ open: false }));

/** The system's own: never assignable (quit, close, hide, minimise, copy/paste/select all/undo). */
const RESERVED = new Set(["Mod+Q", "Mod+W", "Mod+H", "Mod+M", "Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Mod+Shift+Z", "Mod+Tab", "Alt+F4", "Mod+F", "Escape", "Tab", "Enter"]);

const KEY_NAMES: Record<string, string> = { " ": "Space", Spacebar: "Space", Esc: "Escape" };

/** The shortcut a key press makes, in our notation; null for a lone modifier. */
export function comboOf(e: KeyboardEvent): string | null {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"].includes(e.key)) return null;
  // Letters and digits by physical key (so Shift and keyboard layouts don't change them); others by their name.
  let key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : KEY_NAMES[e.key] ?? e.key;
  if (key.length === 1) key = key.toUpperCase();
  if (e.code === "Comma") key = ","; else if (e.code === "Period") key = "."; else if (e.code === "Backslash") key = "\\"; else if (e.code === "Slash") key = "/";
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  const parts = [mod && "Mod", !IS_MAC && e.metaKey && "Meta", IS_MAC && e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean);
  return parts.join("+");
}

const SYMBOLS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Space", Escape: "Esc", Backspace: "⌫" };
/** For display: ⌘⇧K on macOS, Ctrl+Shift+K elsewhere. */
export function prettyCombo(c: string): string {
  const parts = c.split("+").filter((p, i, all) => p !== "" || i === all.length - 1).map((p) => p || "+");
  if (IS_MAC) return parts.map((p) => ({ Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" }[p] ?? SYMBOLS[p] ?? p)).join("");
  return parts.map((p) => ({ Mod: "Ctrl", Alt: "Alt", Shift: "Shift" }[p] ?? SYMBOLS[p] ?? p)).join("+");
}

/** The keys in force for every action: the listener's own where set, else the defaults. */
export function keymap(custom?: Partial<Record<ActionId, string[]>>): Record<ActionId, string[]> {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, custom?.[a.id] ?? a.keys])) as Record<ActionId, string[]>;
}

/** The action a key press triggers, if any. */
export function actionFor(combo: string, custom?: Partial<Record<ActionId, string[]>>): ActionId | null {
  const map = keymap(custom);
  return (ACTIONS.find((a) => map[a.id].includes(combo))?.id) ?? null;
}

/** Why a combo can't be used (reserved), or which action already has it. */
export function checkCombo(combo: string, forAction: ActionId, custom?: Partial<Record<ActionId, string[]>>): { reserved: boolean; takenBy: ActionId | null } {
  if (RESERVED.has(combo)) return { reserved: true, takenBy: null };
  const map = keymap(custom);
  return { reserved: false, takenBy: ACTIONS.find((a) => a.id !== forAction && map[a.id].includes(combo))?.id ?? null };
}

/** A plain key (no ⌘/Ctrl/Alt) would type into text boxes, so it only works outside them. */
export const isPlain = (combo: string) => !/(^|\+)(Mod|Ctrl|Alt|Meta)\+/.test(combo);
