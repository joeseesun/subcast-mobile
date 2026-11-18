import { useRef, useState } from "react";
import { Check, FileUp, Loader2 } from "lucide-react";
import { api, errorText } from "../lib/api";
import { useStore } from "../store";
import { t } from "../lib/i18n";
import { sameFeed } from "../lib/picks";

export interface ImportItem { input: string; title: string; thumb?: string; source: "opml" | "csv" | "newpipe" | "freetube" }

const ytChannel = (id: string) => `https://www.youtube.com/channel/${id}`;

/** Every subscription a file holds, whatever app wrote it. */
export function parseImport(name: string, text: string): ImportItem[] {
  const out: ImportItem[] = [];
  const push = (x: ImportItem) => { if (x.input && !out.some((o) => o.input === x.input)) out.push(x); };
  const trimmed = text.trim();
  if (trimmed.startsWith("<")) {
    // OPML: Xiaoyuzhou, Pocket Casts, Overcast, Apple Podcasts (macOS), Invidious…
    const doc = new DOMParser().parseFromString(trimmed, "text/xml");
    doc.querySelectorAll("outline[xmlUrl], outline[xmlurl]").forEach((o) => {
      const url = o.getAttribute("xmlUrl") ?? o.getAttribute("xmlurl") ?? "";
      const id = url.match(/channel_id=(UC[\w-]{22})/)?.[1];
      push({ input: id ? ytChannel(id) : url, title: o.getAttribute("title") || o.getAttribute("text") || url, source: "opml" });
    });
    return out;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const v = JSON.parse(trimmed);
      // NewPipe: { subscriptions: [{ service_id, url, name }] }
      for (const s of v?.subscriptions ?? []) if (typeof s?.url === "string") push({ input: s.url, title: s.name ?? s.url, source: "newpipe" });
      // FreeTube profiles: [{ subscriptions: [{ id, name, thumbnail }] }]; Takeout JSON: [{ snippet: { resourceId: { channelId }, title } }]
      for (const p of Array.isArray(v) ? v : v?.profiles ?? []) {
        for (const s of p?.subscriptions ?? []) if (typeof s?.id === "string") push({ input: ytChannel(s.id), title: s.name ?? s.id, thumb: s.thumbnail, source: "freetube" });
        const c = p?.snippet?.resourceId?.channelId;
        if (c) push({ input: ytChannel(c), title: p.snippet.title ?? c, source: "csv" });
      }
    } catch { /* not JSON after all */ }
    if (out.length || !/\.db$/i.test(name)) return out;
  }
  // FreeTube .db: one JSON profile per line.
  if (/\.db$/i.test(name)) {
    for (const line of trimmed.split("\n")) { try { for (const s of JSON.parse(line)?.subscriptions ?? []) if (s?.id) push({ input: ytChannel(s.id), title: s.name ?? s.id, source: "freetube" }); } catch { /* skip */ } }
    if (out.length) return out;
  }
  // Google Takeout subscriptions.csv: Channel Id,Channel Url,Channel Title
  for (const line of trimmed.split(/\r?\n/)) {
    const id = line.match(/^(UC[\w-]{22})\s*,/)?.[1];
    if (id) { const cols = line.split(","); push({ input: ytChannel(id), title: cols.slice(2).join(",").trim() || id, source: "csv" }); }
  }
  return out;
}

export function ImportPanel({ onDone }: { onDone?: () => void }) {
  const shows = useStore((s) => s.shows);
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const has = (input: string) => shows.some((s) => sameFeed(s.feedUrl, input) || (input.includes("/channel/") && s.feedUrl.includes(input.split("/channel/")[1].slice(2))));

  const offer = (list: ImportItem[]) => {
    setItems(list);
    setPicked(new Set(list.filter((x) => !has(x.input)).map((x) => x.input)));
    if (!list.length) setError(t("文件里没有找到订阅"));
  };
  const fromFile = async (f: File) => {
    setBusy(true); setError(null); setItems(null);
    try { offer(parseImport(f.name, await f.text())); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const go = async () => {
    const list = (items ?? []).filter((x) => picked.has(x.input));
    let done = 0, failed = 0;
    setProgress({ done, total: list.length, failed });
    const queue = [...list];
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (let x = queue.shift(); x; x = queue.shift()) {
        try { await api.addSubscription(x.input); } catch { failed++; }
        done++; setProgress({ done, total: list.length, failed });
      }
    }));
    await useStore.getState().reloadShows();
    useStore.getState().notify(failed ? t("已导入 {n} 个，{f} 个没有成功", { n: done - failed, f: failed }) : t("已导入 {n} 个订阅", { n: done }));
    setProgress(null); setItems(null);
    onDone?.();
  };


  if (items?.length) {
    const fresh = items.filter((x) => !has(x.input));
    return (
      <div className="import">
        <div className="import-list-head">
          <p className="small">{t("找到 {n} 个，其中 {m} 个还没订阅", { n: items.length, m: fresh.length })}</p>
          <button className="link-btn small" onClick={() => setPicked(picked.size === fresh.length ? new Set() : new Set(fresh.map((x) => x.input)))}>{picked.size === fresh.length ? t("全不选") : t("全选")}</button>
        </div>
        <div className="import-list">
          {items.map((x) => {
            const done = has(x.input);
            return (
              <label key={x.input} className={`import-row ${done ? "done" : ""}`}>
                <input type="checkbox" disabled={done || progress != null} checked={done || picked.has(x.input)} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(x.input) : n.delete(x.input); setPicked(n); }} />
                {x.thumb ? <img src={x.thumb} alt="" loading="lazy" /> : <span className="import-ph">{x.title.slice(0, 1)}</span>}
                <span className="clamp1">{x.title}</span>
                {done && <span className="sub-done"><Check size={12} /> {t("已订阅")}</span>}
              </label>
            );
          })}
        </div>
        <div className="modal-foot">
          {progress && <span className="small muted"><Loader2 size={13} className="spin" /> {t("正在订阅 {done} / {total}", { done: progress.done, total: progress.total })}</span>}
          <div className="spacer" />
          <button className="btn ghost" onClick={() => setItems(null)} disabled={progress != null}>{t("返回")}</button>
          <button className="btn primary" onClick={() => void go()} disabled={!picked.size || progress != null}>{t("订阅 {n} 个", { n: picked.size })}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="import">
      <div className="import-card phone-import">
        <FileUp size={32} aria-hidden />
        <h3>{t("订阅文件")}</h3>
        <p className="muted">OPML · CSV · JSON · FreeTube</p>
        <button className="btn primary" onClick={() => fileInput.current?.click()} disabled={busy}>{t("选择文件")}</button>
        <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = ""; }} />
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
