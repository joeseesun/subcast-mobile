import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "./i18n";

export function selectionFeedback() {
  if (IS_MAC) void invoke("plugin:mobile|selection_feedback").catch(() => {});
}
