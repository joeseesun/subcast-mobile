import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { t } from "./i18n";

/** Opens the system share sheet (iOS / Android) through the app's own `mobile` plugin; false when it isn't there. */
async function nativeShare(args: { text?: string; path?: string; mime?: string; title?: string }): Promise<boolean> {
  try { await invoke("plugin:mobile|share", args); return true; } catch (e) { console.warn("share", e); return false; }
}

/** Shares a piece of text (an OPML export, a quote): the share sheet, else the clipboard. */
export async function shareText(text: string, title?: string) {
  if (await nativeShare({ text, title })) return;
  try { await navigator.clipboard.writeText(text); useStore.getState().notify(t("已复制到剪贴板")); }
  catch { useStore.getState().notify(t("分享失败")); }
}

/** Shares a file saved by the app (a poster image). */
export async function shareFile(path: string, mime: string, title?: string) {
  if (await nativeShare({ path, mime, title })) return;
  useStore.getState().notify(t("已保存到 {path}", { path: path.split("/").slice(-2).join("/") }));
}
