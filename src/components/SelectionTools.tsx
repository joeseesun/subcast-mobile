import { useEffect, useRef, useState } from "react";
import { Copy, Image as ImageIcon, Languages, Loader2, X } from "lucide-react";
import { shareFile } from "../lib/share";
import { api, type Episode } from "../lib/api";
import { CJK, POSTER_FONTS, POSTER_THEMES, drawPoster, loadPosterFont, type PosterInput } from "../lib/poster";
import { showName } from "../lib/picks";
import { useStore } from "../store";
import { t } from "../lib/i18n";
import { Modal } from "./Chrome";
import logoUrl from "../assets/logo.png";

const ZONES = ".deep-body, .lines, .notes-body, .chat-scroll, .summary";

interface Sel { text: string; x: number; y: number; below: boolean; ts?: string }


const toSeconds = (t?: string) => (t ? t.split(":").reduce((n, p) => n * 60 + Number(p), 0) : 0);

/** A small toolbar over selected text in transcripts, 精读 and notes: copy with source, translate, make a poster. */
export function SelectionTools() {
  const [sel, setSel] = useState<Sel | null>(null);
  const [tr, setTr] = useState<string | null>(null);
  const [poster, setPoster] = useState<{ text: string; ts?: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const read = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { setSel(null); setTr(null); return; }
      const text = s.toString().replace(/\s+/g, " ").trim();
      const r = s.getRangeAt(0);
      const host = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement) as HTMLElement | null;
      if (text.length < 4 || !host?.closest(ZONES) || host.closest(".sel-bar")) { setSel(null); return; }
      const rect = r.getBoundingClientRect();
      const ts = (r.startContainer.parentElement?.closest(".line")?.querySelector(".line-time")?.textContent ?? undefined) || undefined;
      const below = rect.top < 70;
      setTr(null);
      setSel({ text, x: Math.max(8, Math.min(rect.left + rect.width / 2, innerWidth - 8)), y: below ? rect.bottom + 10 : rect.top - 10, below, ts });
    };
    const onChange = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(read, 220); };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const episode = async (): Promise<Episode | null> => {
    const { view, current } = useStore.getState();
    if (view.kind === "episode") return (await api.getEpisode(view.id)) ?? current;
    return current;
  };
  const copy = async () => {
    if (!sel) return;
    const ep = await episode();
    const src = ep ? `——《${ep.title}》${ep.showTitle ? ` · ${showName(ep.showTitle)}` : ""}${sel.ts ? ` · ${sel.ts}` : ""}${ep.link ? `\n${ep.link}` : ""}` : "";
    try { await navigator.clipboard.writeText(`“${sel.text}”\n${src}`); useStore.getState().notify(t("已复制，带出处")); } catch { useStore.getState().notify(t("复制失败")); }
  };
  const translate = async () => {
    if (!sel) return;
    setTr("…");
    try { setTr((await api.translateTexts([sel.text], CJK.test(sel.text) && !/[a-z]{4}/i.test(sel.text) ? "en" : "zh-CN"))[0] || t("没有翻译结果")); }
    catch { setTr(t("翻译服务暂时连不上，稍后再试")); }
  };

  return (
    <>
      {sel && (
        <div className={`sel-bar ${sel.below ? "below" : ""}`} style={{ left: sel.x, top: sel.y }} role="toolbar" aria-label={t("选中文字操作")} onMouseDown={(e) => e.preventDefault()}>
          <div className="sel-actions">
            <button onClick={copy}><Copy size={13} /> {t("复制")}</button>
            <button onClick={translate}><Languages size={13} /> {t("翻译")}</button>
            <button onClick={() => { setPoster({ text: sel.text, ts: sel.ts }); setSel(null); }}><ImageIcon size={13} /> {t("生成海报")}</button>
          </div>
          {tr && <div className="sel-tr">{tr === "…" ? <Loader2 size={13} className="spin" /> : tr}</div>}
        </div>
      )}
      {poster && <PosterDialog text={poster.text} ts={poster.ts} getEpisode={episode} onClose={() => setPoster(null)} />}
    </>
  );
}

const PREF = "subcast-poster";
const readPref = (): { theme?: string; font?: string } => { try { return JSON.parse(localStorage.getItem(PREF) ?? "{}"); } catch { return {}; } };

function PosterDialog({ text, ts, getEpisode, onClose }: { text: string; ts?: string; getEpisode: () => Promise<Episode | null>; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState(() => t("SubCast 摘句"));
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<PosterInput | null>(null);
  const [themeId, setThemeId] = useState(() => readPref().theme ?? POSTER_THEMES[0].id);
  const [fontId, setFontId] = useState(() => readPref().font ?? POSTER_FONTS[0].id);
  const [fontBusy, setFontBusy] = useState(false);
  const logo = useRef<HTMLImageElement | null>(null);
  // Translate and gather the source once; the drawing is redone on every theme or font change.
  useEffect(() => {
    (async () => {
      try {
        const ep = await getEpisode();
        // A selection across a bilingual row comes with its timestamp and both lines: drop the time, split the languages.
        const lines = text.split(/\n+/).map((l) => l.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*/, "").trim()).filter(Boolean)
          // "中文译文 English original" on one line: cut where the English sentence starts after the last Chinese character.
          .flatMap((l) => { const m = l.match(/^(.*[\u4e00-\u9fff][^A-Za-z]*?)\s*([A-Z"'“‘(][A-Za-z].{10,})$/); return m && !CJK.test(m[2]) ? [m[1].trim(), m[2].trim()] : [l]; });
        const zhPart = lines.filter((l) => CJK.test(l)).join("");
        const enPart = lines.filter((l) => !CJK.test(l)).join(" ");
        const cjk = !!zhPart && !/[a-z]{6}/i.test(zhPart);
        let zh = zhPart, en = enPart;
        if (!cjk) { en = lines.join(" "); try { zh = (await api.translateTexts([en], "zh-CN"))[0] ?? ""; } catch { zh = ""; } }
        const titleZh = ep ? (await api.translateTexts([ep.title], "zh-CN").catch(() => [ep.title]))[0] || ep.title : "";
        const secs = toSeconds(ts);
        const link = ep?.videoId ? `https://www.youtube.com/watch?v=${ep.videoId}${secs ? `&t=${Math.floor(secs)}s` : ""}` : ep?.link;
        const img = new Image(); img.src = logoUrl; await img.decode().catch(() => {}); logo.current = img;
        setName(t("SubCast 摘句 {title}", { title: (titleZh || "").slice(0, 20) }));
        setInput({
          zh, en,
          title: titleZh,
          // The show keeps its own name (Acquired, not 收购): it is what readers will search for.
          show: ep?.showTitle ?? "",
          meta: [ep?.published ? new Date(ep.published).toLocaleDateString("zh-CN") : "", ts ? t("第 {ts}", { ts }) : ""].filter(Boolean).join(" · "),
          url: link,
          ts,
        });
      } catch (e) { setError(String((e as any)?.message ?? e)); }
    })();
  }, []);
  useEffect(() => {
    if (!input) return;
    let live = true;
    try { localStorage.setItem(PREF, JSON.stringify({ theme: themeId, font: fontId })); } catch { /* private mode */ }
    (async () => {
      const theme = POSTER_THEMES.find((x) => x.id === themeId) ?? POSTER_THEMES[0];
      let font = POSTER_FONTS.find((x) => x.id === fontId) ?? POSTER_FONTS[0];
      if (font.css) {
        setFontBusy(true);
        const ok = await loadPosterFont(font, [input.zh, input.title, input.show].join(""));
        if (!live) return;
        setFontBusy(false);
        if (!ok) { useStore.getState().notify(t("字体没有加载成功，先用系统字体")); font = POSTER_FONTS[0]; }
      }
      const c = await drawPoster(input, logo.current ?? undefined, theme, font);
      if (live) setUrl(c.toDataURL("image/png"));
    })();
    return () => { live = false; };
  }, [input, themeId, fontId]);
  const save = async () => { if (!url) return; try { const p = await api.saveImage(name, url); await shareFile(p, "image/png", name); } catch (e) { useStore.getState().notify(String(e)); } };
  const copyImg = async () => {
    if (!url) return;
    try { const blob = await (await fetch(url)).blob(); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); useStore.getState().notify(t("图片已复制")); }
    catch { useStore.getState().notify(t("复制失败，请用「保存图片」")); }
  };
  return (
    <Modal title={t("分享海报")} onClose={onClose} wide>
      <div className="poster-layout">
        <div className="poster-pv">
          {url ? <img src={url} alt={t("分享海报")} /> : error ? <p className="error-text">{error}</p> : <div className="poster-wait"><Loader2 className="spin" size={18} /> {t("正在生成海报…")}</div>}
          {fontBusy && url && <span className="poster-busy"><Loader2 className="spin" size={13} /> {t("正在加载字体…")}</span>}
        </div>
        <div className="poster-side">
          <p className="poster-label">{t("主题")}</p>
          <div className="poster-themes">
            {POSTER_THEMES.map((th) => (
              <button key={th.id} type="button" className={`poster-theme ${themeId === th.id ? "on" : ""}`} aria-pressed={themeId === th.id} onClick={() => setThemeId(th.id)}>
                <span className="swatch" style={{ background: th.bg2 ? `linear-gradient(160deg, ${th.bg}, ${th.bg2})` : th.bg }}><i style={{ background: th.accent }} /><b style={{ color: th.ink }}>文</b></span>
                <span>{t(th.name)} · {t(th.style)}</span>
              </button>
            ))}
          </div>
          <p className="poster-label">{t("字体")}</p>
          <div className="poster-fonts">
            {POSTER_FONTS.map((f) => (
              <button key={f.id} type="button" className={`poster-font ${fontId === f.id ? "on" : ""}`} aria-pressed={fontId === f.id} onClick={() => setFontId(f.id)}>
                <span className="pf-name">{t(f.name)}</span>
                {f.css && <span className="pf-note">{t("开源")}</span>}
              </button>
            ))}
          </div>
          <p className="muted small">{t("开源字体第一次使用时联网下载，只取海报上用到的字。")}</p>
        </div>
      </div>
      <div className="modal-foot">
        <span className="spacer" />
        <button className="btn ghost" onClick={onClose}><X size={14} /> {t("关闭")}</button>
        <button className="btn" onClick={copyImg} disabled={!url}><Copy size={14} /> {t("复制图片")}</button>
        <button className="btn primary" onClick={save} disabled={!url}>{t("保存图片")}</button>
      </div>
    </Modal>
  );
}
