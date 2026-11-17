import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./mobile.css";
import "./editorial.css";

import { startDevNav } from "./lib/devnav";
if (import.meta.env.DEV) startDevNav();
import { IS_MAC } from "./lib/i18n";

// Only macOS draws its window buttons inside the page (overlay title bar); Windows and Linux have a native title bar.
document.documentElement.classList.toggle("is-mac", IS_MAC);

// Never leave a blank window: show startup failures.
const showFatal = (msg: string) => {
  const el = document.createElement("pre");
  el.style.cssText = "position:fixed;left:0;right:0;bottom:0;margin:0;padding:12px;background:#b42318;color:#fff;font:12px monospace;white-space:pre-wrap;z-index:99";
  el.textContent = msg;
  document.body.appendChild(el);
};
window.addEventListener("error", (e) => showFatal(`${e.message}\n${String(e.error?.stack ?? "").split("\n").slice(0, 4).join("\n")}`));
// An interrupted media play() or a cancelled request is expected, not a failure.
const benign = (r: unknown) => /AbortError|aborted|interrupted by a (new load|call to pause)/i.test(String((r as Error)?.name ?? "") + String((r as Error)?.message ?? r));
window.addEventListener("unhandledrejection", (e) => { if (!benign(e.reason)) showFatal(String((e.reason as Error)?.stack ?? e.reason)); });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
