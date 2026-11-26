import { invoke } from "@tauri-apps/api/core";

export function selectionFeedback() {
  void invoke("plugin:mobile|selection_feedback").catch(() => {});
}
