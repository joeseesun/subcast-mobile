// Development only (stripped from release builds): lets a script drive navigation in the simulator by writing
// public/__nav.json, e.g. {"n":1,"go":{"kind":"discover"}} or {"n":2,"episode":0} (the nth recent episode),
// {"n":3,"settings":"ai"}, {"n":4,"tab":"chat"}, {"n":5,"play":true}, {"n":6,"click":"css selector"}.
import { api } from "./api";
import { useStore } from "../store";
import { PICKS } from "./picks";

const send = (line: string) => void fetch("/__log", { method: "POST", body: line }).catch(() => {});

export function startDevNav() {
  Object.assign(window, { __store: useStore, __api: api, __picks: PICKS });
  for (const k of ["log", "warn", "error"] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => { orig(...a); send(`[${k}] ${a.map((x) => (x instanceof Error ? x.stack ?? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`); };
  }
  window.addEventListener("error", (e) => send(`[onerror] ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => send(`[rejection] ${String((e.reason as Error)?.stack ?? e.reason)}`));
  let last = -1;
  window.setInterval(async () => {
    try {
      const r = await fetch(`/__nav.json?t=${Date.now()}`);
      if (!r.ok) return;
      const cmd = await r.json();
      if (cmd.n === last) return;
      const first = last === -1;
      last = cmd.n;
      if (first) return; // don't replay an old command after a reload
      const s = useStore.getState();
      if (cmd.go) s.go(cmd.go);
      if (cmd.episode != null) { const eps = await api.listEpisodes(undefined, 30); const ep = eps[cmd.episode]; if (ep) s.openEpisode(ep); }
      if (cmd.settings) s.openSettings(cmd.settings);
      if (cmd.close) s.set({ settingsOpen: false, addOpen: false });
      if (cmd.play) s.player?.toggle();
      if (cmd.click) (document.querySelector(cmd.click) as HTMLElement | null)?.click();
      if (cmd.eval) { try { send(`[eval] ${String(await new Function(`return (async () => { ${cmd.eval} })()`)())}`); } catch (e) { send(`[eval-error] ${e}`); } }
    } catch { /* no command file */ }
  }, 1000);
}
