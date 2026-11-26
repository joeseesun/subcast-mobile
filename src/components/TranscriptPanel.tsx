import { useLongPress } from "../lib/longPress";
import { openLineActions } from "./LineActions";
import { STORE, youtubeOnly } from "../lib/edition";
import { seekEpisode } from "./Players";
import { useShallow } from "zustand/react/shallow";
import { SkeletonLines } from "./Skeleton";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { flushSync } from "react-dom";
import { BookA, Check, ChevronDown, Languages, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Modal } from "./Chrome";
import { BrandGlyph } from "./BrandGlyph";
import { MobileSheet } from "./MobileSheet";
import { selectionFeedback } from "../lib/feedback";
import type { EpisodeContext } from "../lib/ai";
import { CassetteArt, FlatLineArt, TrayArt, WaveToTextArt } from "./Illustrations";
import { bytes } from "../lib/offline";
import { api, errorText, rawErrorText, type Episode, type ModelInfo, type Segment } from "../lib/api";
import { clock } from "../lib/format";
import { generateTranscript, loadTranscript, llmReady, loadTranslation, needsTranslation, stopTranslation, switchYoutubeTrack, translateEpisode, useJobs } from "../lib/jobs";
import { providerFor, useStore } from "../store";
import { ASR_SERVICES, CLOUD_ASR_MAIN, type Settings } from "../lib/settings";
import { lang, t, tk, tr, useLang } from "../lib/i18n";
import { isNoted, notedKeys, useNotes } from "../lib/notes";

const SOURCE_LABEL: Record<string, string> = { youtube: tk("YouTube 字幕"), "youtube-auto": tk("YouTube 自动字幕"), rss: tk("节目方文字稿"), whisper: tk("本机识别"), cloud: tk("云端识别"), qiaomu: tk("精读站原文 · 时间为估算"), "qiaomu-timed": tk("精读站原文"), podscribe: tk("Podscribe 文字稿") };

/** "shared:qwen3" → "共享字幕 · Qwen3"; unknown sources read as plain "字幕" rather than an internal id. */
function sourceLabel(source: string) {
  if (SOURCE_LABEL[source]) return t(SOURCE_LABEL[source]);
  if (source.startsWith("shared:")) {
    const model = source.slice(7);
    const name = /^qwen/i.test(model) ? "Qwen3-ASR" : /whisper/i.test(model) ? "Whisper" : model ? model[0].toUpperCase() + model.slice(1) : "";
    return name ? `${t("共享字幕")} · ${name}` : t("共享字幕");
  }
  return t("字幕");
}

export function activeIndex(segments: Segment[], time: number): number {
  let lo = 0, hi = segments.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time + 0.15) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  return i < 0 ? text : <>{text.slice(0, i)}<mark>{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

const Row = memo(function Row({ index, seg, zh, active, mode, pending, onSeek, query, current, noted }: { index: number; seg: Segment; zh?: string | null; active: boolean; mode: string; pending: boolean; onSeek: (t: number) => void; query: string; current: boolean; noted?: boolean }) {
  const showZh = mode !== "original";
  const showOrig = mode !== "translation" || (!zh && !pending);
  return (
    <div className={`line ${active ? "active" : ""} ${current ? "hit" : ""} ${noted ? "noted" : ""}`} data-i={index} data-active={active || undefined} data-hit={current || undefined} aria-current={active ? "time" : undefined} role="button" tabIndex={0} onClick={() => onSeek(seg.start)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSeek(seg.start); } }}>
      <span className="line-time">{clock(seg.start)}</span>
      <div className="line-text">
        {showZh && (zh ? <p className="zh">{highlight(zh, query)}</p> : pending ? <span className="skeleton" /> : null)}
        {showOrig && <p className="orig">{highlight(seg.text, query)}</p>}
      </div>
    </div>
  );
});

function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const refresh = () => api.asrModels().then(setModels);
  useEffect(() => { void refresh(); }, []);
  return { models, refresh };
}

export function useModelDownload(onDone: () => void) {
  const [downloading, setDownloading] = useState<{ id: string; received: number; total?: number } | null>(null);
  useEffect(() => {
    const un = listen<{ id: string; received: number; total?: number }>("model-download", (e) => setDownloading(e.payload));
    return () => { void un.then((f) => f()); };
  }, []);
  /** Tries the China mirror first, then the original source if that fails: no setting needed. */
  // Phones have no local models to download: the cloud stand-in is always ready.
  const start = async (_id: string, _legacy?: boolean) => { onDone(); return true; };
  return { downloading, start, cancel: (id: string) => api.cancelJob(`model:${id}`) };
}

/** The one line under the tabs that says how this episode's subtitles stand, with the one action that applies. */
function StatusLine({ left, text, spin, progress, action, right, title }: { left?: React.ReactNode; text: React.ReactNode; spin?: boolean; progress?: number; action?: React.ReactNode; right?: React.ReactNode; title?: string }) {
  return (
    <div className="status-line" title={title}>
      {left}
      <span className="status-text" key={typeof text === "string" ? text : undefined}>{spin && <Loader2 size={13} className="spin" />}{text}</span>
      {progress != null && <div className="bar slim"><div style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>}
      <div className="spacer" />
      {action}
      {right}
    </div>
  );
}

export function TranscriptPanel({ ep }: { ep: Episode }) {
  const transcript = useJobs((s) => s.transcripts[ep.id]);
  const official = useJobs((s) => s.officialChecked[ep.id]);
  const officialError = useJobs((s) => s.officialError[ep.id]);
  const translation = useJobs((s) => s.translations[ep.id]);
  const notedLines = useNotes(notedKeys(ep.id));
  const { settings, saveSettings, current, openSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, current: s.current, openSettings: s.openSettings })));
  const isCurrent = current?.id === ep.id;
  const list = useRef<HTMLDivElement>(null);
  // Press and hold a line for its actions (save, play from, copy, poster, ask).
  useLongPress(list, ".line", (el) => openLineActions(ep, Number(el.dataset.i)));
  const [following, setFollowing] = useState(true);
  const [cueVisible, setCueVisible] = useState(true);
  const scrollBeforeSearch = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hit, setHit] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [canUpgrade, setCanUpgrade] = useState(false);
  const segments = transcript?.segments ?? [];
  const active = useStore((s) => isCurrent && transcript ? activeIndex(transcript.segments, s.time) : -1);
  const seek = useCallback((time: number) => {
    if (!searching) setFollowing(true);
    seekEpisode(ep, time);
  }, [ep, searching]);
  const wantsZh = transcript ? needsTranslation(transcript) : false;
  const mode = wantsZh ? settings.subtitleMode : "original";

  useEffect(() => { if (transcript) void loadTranslation(ep.id, transcript.segments.length); }, [transcript, ep.id]);
  useEffect(() => { void llmReady("translate").then(setCanUpgrade); }, [settings]);


  useEffect(() => {
    const pane = list.current;
    const row = pane?.querySelector<HTMLElement>("[data-active]");
    if (!pane || !row || searching) return;
    if (!following) {
      const observer = new IntersectionObserver(([entry]) => {
        setCueVisible(entry.isIntersecting && entry.intersectionRatio >= 0.85);
      }, { root: pane, threshold: [0, 0.85] });
      observer.observe(row);
      return () => observer.disconnect();
    }
    const bounds = pane.getBoundingClientRect();
    const cue = row.getBoundingClientRect();
    if (cue.top <= bounds.top || cue.bottom >= bounds.bottom) {
      const top = cue.top - bounds.top - Math.max(0, (bounds.height - cue.height) / 3);
      pane.scrollBy({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [active, following, searching]);

  const startSearch = useCallback(() => {
    if (!searching) scrollBeforeSearch.current = list.current?.scrollTop ?? 0;
    flushSync(() => setSearching(true));
    searchInput.current?.focus();
  }, [searching]);
  const closeSearch = () => {
    const previous = scrollBeforeSearch.current;
    setQuery("");
    setSearching(false);
    if (!following) requestAnimationFrame(() => list.current?.scrollTo({ top: previous }));
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        startSearch();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [startSearch]);

  const matches = useMemo(() => {
    if (!query) return null;
    const q = query.toLowerCase();
    return segments.map((s, i) => (s.text.toLowerCase().includes(q) || translation?.items[i]?.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0);
  }, [query, segments, translation]);
  useEffect(() => { setHit(0); }, [query]);
  useEffect(() => { list.current?.querySelector<HTMLElement>("[data-hit]")?.scrollIntoView({ block: "center" }); }, [hit, matches]);

  if (!transcript) return <NoTranscript ep={ep} official={official} officialError={officialError} />;

  const total = segments.length;
  const done = Math.min(total, translation?.items.slice(0, total).filter((x) => x != null).length ?? 0);
  const running = !!translation?.running;
  const providerName = providerFor(settings, "translate")?.name;
  const engineName = translation?.engine === "shared" ? t("共享译文") : translation?.engine === "youtube" ? t("节目方中文字幕") : translation?.engine === "google" ? t("谷歌翻译") : t("{name}翻译", { name: providerName ? t(providerName) : t("模型") });
  const error = startError ?? translation?.error;
  const pending = wantsZh && (running || (!error && done < total));
  const start = (force?: "llm" | "google") => { setStartError(null); translateEpisode(ep, transcript, force).catch((e) => setStartError(rawErrorText(e))); };

  const modeControl = wantsZh && (
    <div className="seg-control" role="radiogroup" aria-label={t("字幕显示（快捷键 C）")}>
      {(["bilingual", "translation", "original"] as const).map((m) => (
        <button key={m} role="radio" aria-checked={settings.subtitleMode === m} className={settings.subtitleMode === m ? "on" : ""} onClick={() => saveSettings({ subtitleMode: m })}>
          {m === "bilingual" ? t("双语") : m === "translation" ? t("中文") : t("原文")}
        </button>
      ))}
    </div>
  );
  const searchBtn = <>
    {transcript.source.startsWith("youtube") && <TrackPicker ep={ep} language={transcript.language} auto={transcript.source === "youtube-auto"} />}
    <button className="icon-btn" title={t("搜索文稿（⌘F）")} onClick={startSearch}><Search size={15} /></button>
    {wantsZh && canUpgrade && <PanelMenu ep={ep} onRetranslate={() => start("llm")} />}
  </>;
  const source = sourceLabel(transcript.source);

  let status: React.ReactNode;
  if (!wantsZh) status = <StatusLine left={<span className="source-tag">{source}</span>} text="" right={searchBtn} />;
  else if (running) status = <StatusLine left={modeControl} text={t("{engine} · 正在翻译 {done}/{total}", { engine: engineName, done, total })} spin progress={done / total} action={<button className="btn ghost sm" onClick={() => stopTranslation(ep.id)}>{t("停止")}</button>} right={searchBtn} />;
  else if (error && /设置|API Key|模型/.test(error)) status = <StatusLine left={modeControl} text={tr(error)} action={<button className="btn primary sm" onClick={() => openSettings("model")}>{t("去设置")}</button>} right={searchBtn} />;
  else if (done < total && (error || translation?.failed)) status = <StatusLine left={modeControl} text={`${t("已翻译 {done}/{total}", { done, total })}${error ? ` · ${tr(error).slice(0, 40)}` : ""}`} action={<button className="btn primary sm" onClick={() => start()}>{t("重试")}</button>} right={searchBtn} />;
  else if (done < total) status = <StatusLine left={modeControl} text={done ? t("已翻译 {done}/{total}", { done, total }) : source} action={<button className="btn primary sm" onClick={() => start()}>{done ? t("继续翻译") : t("翻译成中文")}</button>} right={searchBtn} />;
  else status = <StatusLine left={modeControl} text="" title={`${source} · ${engineName}`} action={translation?.engine === "google" && canUpgrade ? <button className="btn ghost sm" onClick={() => start("llm")}>{t("用模型重译")}</button> : undefined} right={searchBtn} />;

  const rows = matches ?? segments.map((_, i) => i);
  return (
    <div className="transcript">
      {status}
      {searching && (
        <div className="search-row">
          <Search size={14} />
          <input ref={searchInput} spellCheck={false} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("搜索中文或原文")}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
              if (e.key === "Enter" && matches?.length) setHit((h) => (h + (e.shiftKey ? -1 : 1) + matches.length) % matches.length);
            }} />
          {matches && <span className="muted small">{matches.length ? `${hit + 1}/${matches.length}` : t("无结果")}</span>}
          <button className="icon-btn sm" onClick={closeSearch} aria-label={t("关闭搜索")}><X size={14} /></button>
        </div>
      )}
      <div className="transcript-body">
        <div className="lines" ref={list} onTouchMove={() => !searching && setFollowing(false)}
          onWheel={() => !searching && setFollowing(false)}
          onKeyDown={(event) => {
            if (!searching && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) setFollowing(false);
          }}>
          {rows.map((i, k) => (
            <Row key={i} index={i} seg={segments[i]} zh={translation?.items[i]} active={i === active} mode={mode} pending={pending} onSeek={seek} query={query} current={!!matches && k === hit} noted={isNoted(notedLines, segments[i].start)} />
          ))}
          {!matches && total > 0 && (
            <div className={`lines-end ${active === total - 1 ? "reached" : ""}`}>
              <FlatLineArt />
              {active === total - 1 && <p>{t("到最后一句了，耳朵辛苦了")}</p>}
            </div>
          )}
        </div>
        {!searching && !following && active >= 0 && !cueVisible && (
          <button className="transcript-follow" onClick={() => {
            selectionFeedback();
            setFollowing(true);
            list.current?.querySelector<HTMLElement>("[data-active]")?.focus({ preventScroll: true });
          }}>
            <BrandGlyph name="sound" size={17} />{t("回到播放位置")}
          </button>
        )}
      </div>
    </div>
  );
}

/** "…" on the subtitle bar: the rarer tools (本集术语表, retranslating with the model). */
function PanelMenu({ ep, onRetranslate }: { ep: Episode; onRetranslate: () => void }) {
  const [menu, setMenu] = useState(false);
  const [gloss, setGloss] = useState(false);
  return <>
    <button className="icon-btn" aria-label={t("更多")} aria-haspopup="dialog" onClick={() => setMenu(true)}><BrandGlyph name="more" size={21} /></button>
    {menu && <MobileSheet title={t("字幕")} onClose={() => setMenu(false)}>
      <button onClick={() => { setMenu(false); setGloss(true); }}><BookA />{t("本集术语表…")}</button>
      <button onClick={() => { setMenu(false); onRetranslate(); }}><RefreshCw />{t("用模型重新翻译")}</button>
    </MobileSheet>}
    {gloss && <Glossary ep={ep} onRetranslate={onRetranslate} onClose={() => setGloss(false)} />}
  </>;
}

/** The episode's names and terms (made before translating), editable; edits are kept when it is remade. */
function Glossary({ ep, onRetranslate, onClose }: { ep: Episode; onRetranslate: () => void; onClose: () => void }) {
  const [open, setOpenRaw] = useState(false);
  const setOpen = (v: boolean) => { setOpenRaw(v); if (!v) onClose(); };
  useEffect(() => { void load(); }, []);
  const [ctx, setCtx] = useState<EpisodeContext | null>(null);
  const [rows, setRows] = useState<{ src: string; zh: string; user?: boolean }[]>([]);
  useLang((s) => s.lang);
  const load = async () => {
    let c: EpisodeContext | null = null;
    try { const raw = await api.getBlob(ep.id, "ctx"); c = raw ? JSON.parse(raw) : null; } catch { c = null; }
    setCtx(c); setRows(c?.terms ?? []); setOpen(true);
  };
  const save = async (andRetranslate: boolean) => {
    const terms = rows.map((r) => ({ src: r.src.trim(), zh: r.zh.trim(), user: true })).filter((r) => r.src && r.zh);
    const next: EpisodeContext = { summary: ctx?.summary ?? "", speakers: ctx?.speakers ?? [], terms, basis: ctx?.basis };
    await api.setBlob(ep.id, "ctx", JSON.stringify(next));
    setOpen(false);
    if (andRetranslate) onRetranslate();
  };
  return (
    <>
      {open && (
        <Modal title={t("本集术语表")} onClose={() => setOpen(false)}>
          <div className="gloss">
            <p className="muted small">{t("翻译每一句时都会照这里的译法，保证人名和术语前后一致。改动会保留。")}</p>
            {ctx?.summary && <p className="gloss-summary">{ctx.summary}</p>}
            <div className="gloss-list">
              {rows.map((r, i) => (
                <div className="gloss-row" key={i}>
                  <input value={r.src} placeholder={t("原文")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, src: e.target.value } : x)))} />
                  <span className="arrow">→</span>
                  <input value={r.zh} placeholder={t("译为")} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, zh: e.target.value } : x)))} />
                  <button className="icon-btn sm" aria-label={t("删除")} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={13} /></button>
                </div>
              ))}
              {!rows.length && <p className="muted small">{t("还没有术语。翻译开始时会自动整理，也可以自己添加。")}</p>}
            </div>
            <div className="gloss-foot">
              <button className="btn sm" onClick={() => setRows([...rows, { src: "", zh: "" }])}>{t("添加")}</button>
              <span className="spacer" />
              <button className="btn sm" onClick={() => void save(false)}>{t("保存")}</button>
              <button className="btn sm primary" onClick={() => void save(true)}>{t("保存并重新翻译")}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

const trackCache = new Map<string, { language: string; auto: boolean }[]>();
/** The subtitle language, when the video has captions in more than one. */
function TrackPicker({ ep, language, auto }: { ep: Episode; language: string; auto: boolean }) {
  const [tracks, setTracks] = useState(trackCache.get(ep.id) ?? null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useLang((s) => s.lang);
  useEffect(() => {
    if (!open || tracks) return;
    let visible = true;
    void api.youtubeTracks(ep.id).then((list) => {
      if (!visible) return;
      if (list.length) trackCache.set(ep.id, list);
      setTracks(list);
    }).catch(() => { if (visible) setFailed(true); });
    return () => { visible = false; };
  }, [ep.id, open, tracks, attempt]);

  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([lang()], { type: "language" }); } catch { /* old WebView */ }
  const label = (track: { language: string; auto: boolean }) => {
    let name = track.language;
    try { name = names?.of(name) ?? name; } catch { /* unknown language */ }
    return track.auto ? `${name} · ${t("自动生成")}` : name;
  };
  const pick = async (track: { language: string; auto: boolean }) => {
    setOpen(false);
    if (track.language === language && track.auto === auto) return;
    selectionFeedback();
    setBusy(true);
    try { await switchYoutubeTrack(ep, track.language, track.auto); }
    catch (e) { useStore.getState().notify(t("切换字幕失败：{error}", { error: errorText(e) })); }
    finally { setBusy(false); }
  };
  const available = tracks?.length ? tracks : [{ language, auto }];
  return <>
    <button className="icon-btn" aria-label={t("字幕语言")} aria-haspopup="dialog" disabled={busy}
      onClick={() => { setFailed(false); setOpen(true); }}>
      {busy ? <Loader2 size={19} className="spin" /> : <Languages size={19} />}
    </button>
    {open && <MobileSheet title={t("字幕语言")} onClose={() => setOpen(false)}>
      {available.map((track) => {
        const selected = track.language === language && track.auto === auto;
        return <button key={`${track.auto}:${track.language}`} aria-pressed={selected} onClick={() => void pick(track)}>
          {label(track)}{selected && <Check className="row-check" />}
        </button>;
      })}
      {failed ? <button onClick={() => { setFailed(false); setAttempt((n) => n + 1); }}><RefreshCw />{t("重试")}</button>
        : !tracks && <p className="sheet-status" role="status"><Loader2 size={16} className="spin" />{t("正在查找字幕…")}</p>}
    </MobileSheet>}
  </>;
}

/** What the episode's pickers offer: the main cloud services and whatever is in use. The rest are in Settings
 *  (the 「更多…」 entry opens it). */
const pickerCloud = (s: Settings) => ASR_SERVICES.filter((a) => CLOUD_ASR_MAIN.includes(a.id) || s.asrEngine === a.id);

/** Episodes transcription was started for automatically this session (never twice). */
const autoStarted = new Set<string>();

function NoTranscript({ ep, official, officialError }: { ep: Episode; official?: string; officialError?: string }) {
  const asr = useJobs((s) => s.asr[ep.id]);
  const { settings, saveSettings, player, current } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, player: s.player, current: s.current })));
  const { models, refresh } = useModels();
  const { downloading, start, cancel } = useModelDownload(refresh);
  const [options, setOptions] = useState(false);
  const model = models.find((m) => m.id === settings.asrModel) ?? models[0];
  const cloud = settings.asrEngine !== "local" ? settings.cloudAsr[settings.asrEngine] : undefined;
  const [cloudKey, setCloudKey] = useState<boolean | null>(null);
  const settingsOpen = useStore((s) => s.settingsOpen);
  useEffect(() => {
    setCloudKey(null);
    // DeepSeek recognition shares the Q&A key.
    if (cloud?.needsKey && !settingsOpen) void Promise.all([api.hasApiKey(`asr.${cloud.id}`), cloud.protocol === "deepseek" ? api.hasApiKey("deepseek") : Promise.resolve(false)]).then(([a, b]) => setCloudKey(a || b));
  }, [cloud?.id, settingsOpen]);
  const missingKey = !!cloud?.needsKey && cloudKey === false;
  const pickEngine = (value: string) => {
    if (value === "more") { useStore.getState().openSettings("asr"); return; }
    const [kind, id] = value.split(":");
    void saveSettings(kind === "cloud" ? { asrEngine: id } : { asrEngine: "local", asrModel: id });
  };
  const generate = async () => {
    if (!model) return;
    if (missingKey) { useStore.getState().openSettings("asr"); return; }
    if (!cloud && !model.installed && !(await start(model.id, settings.mirrorFirst))) return;
    void generateTranscript(ep, model.id, settings.asrLanguage);
  };
  const retry = () => useJobs.setState((s) => { const a = { ...s.asr }; delete a[ep.id]; return { asr: a }; });
  // Once a way of transcribing is ready (local model downloaded, or a cloud service the listener chose with its
  // key), pressing play on an episode that has no subtitles anywhere (cache, publisher, shared library: all
  // checked by now) starts transcribing by itself. The first time still takes a click (it downloads ~1 GB).
  const playing = useStore((s) => s.playing && s.current?.id === ep.id);
  // The store edition never fetches a YouTube video's audio to transcribe it (App Review 5.2.3).
  const noTranscribe = STORE && youtubeOnly(ep);
  const ready = !noTranscribe && !!model && (cloud ? cloudKey === true || !cloud.needsKey : model.installed);
  useEffect(() => {
    if (playing && ready && official === "none" && !asr && !autoStarted.has(ep.id)) { autoStarted.add(ep.id); void generateTranscript(ep, model!.id, settings.asrLanguage); }
  }, [playing, ready, official, !!asr, ep.id]);
  /** Stops the running transcription and waits until it has stopped. */
  const stopRunning = async () => {
    await api.cancelJob(ep.id);
    for (let i = 0; i < 80 && useJobs.getState().asr[ep.id]?.stage !== "error" && useJobs.getState().asr[ep.id]?.stage !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    retry();
  };
  /** Mid-way, switch to another way of transcribing: the running one stops, the new one starts from the beginning. */
  const switchEngine = async (value: string) => {
    if (value === "more") { useStore.getState().openSettings("asr"); return; }
    const [kind, id] = value.split(":");
    await saveSettings(kind === "cloud" ? { asrEngine: id } : { asrEngine: "local", asrModel: id });
    await stopRunning();
    const m = kind === "cloud" ? models.find((x) => x.id === settings.asrModel) ?? models[0] : models.find((x) => x.id === id);
    if (!m) return;
    if (kind !== "cloud" && !m.installed && !(await start(m.id, settings.mirrorFirst))) return;
    void generateTranscript(ep, m.id, settings.asrLanguage);
  };

  if (official === "searching" || official === undefined) {
    return <div className="transcript"><StatusLine text={t("正在查找字幕…")} spin /><SkeletonLines /></div>;
  }
  if (noTranscribe && !asr) {
    return <GenCard icon={<TrayArt />} title={t("这个视频还没有字幕")} note={t("视频作者没有提供字幕，社区里也还没有人分享。可以先看视频，或在 YouTube 里打开。")} />;
  }
  if (downloading) {
    const pct = downloading.total ? downloading.received / downloading.total : 0;
    return (
      <GenCard icon={<TrayArt busy />} title={t("正在准备识别模型")} note={t("只需下载这一次，完成后自动生成字幕。可以先听着。")}>
        <div className="gen-progress"><div className="bar live"><div style={{ width: `${Math.max(2, pct * 100)}%` }} /></div><span>{Math.round(pct * 100)}%</span></div>
        {downloading.total ? <p className="gen-size num">{bytes(downloading.received)} / {bytes(downloading.total)}</p> : null}
        <button className="btn ghost sm" onClick={() => cancel(downloading.id)}>{t("取消")}</button>
      </GenCard>
    );
  }
  if (asr && asr.stage !== "done") {
    if (asr.stage === "error") {
      return (
        <GenCard icon={<CassetteArt mode="tangled" />} title={t("字幕没有生成成功")} note={t("可以换一个识别模型，或检查网络后再试。")}>
          {asr.message && <p className="gen-warn" title={tr(asr.message)}><span>{plainError(tr(asr.message))}</span></p>}
          <button className="btn primary gen-go" onClick={retry}>{t("重试")}</button>
        </GenCard>
      );
    }
    const label = asr.message ? tr(asr.message) : asr.stage === "download" ? t("正在获取音频") : ep.duration ? t("正在识别 · {elapsed} / {total}", { elapsed: clock(asr.progress * ep.duration), total: clock(ep.duration) }) : t("正在识别");
    return (
      <div className="transcript">
        <StatusLine text={`${label} · ${Math.round(asr.progress * 100)}%`} spin progress={asr.progress} action={
          <span className="row-actions tight">
            <select className="engine-switch-mini" aria-label={t("换一种识别方式")} title={t("换一种识别方式（从头开始）")} value="" onChange={(e) => e.target.value && void switchEngine(e.target.value)}>
              <option value="">{t("换一种方式…")}</option>
              <optgroup label={t("云端服务 · 更快，需要 Key")}>
                {pickerCloud(settings).filter((a) => settings.asrEngine !== a.id).map((a) => <option key={a.id} value={`cloud:${a.id}`}>{t(a.name)}</option>)}
              </optgroup>
              <option value="more">{t("更多")}…</option>
            </select>
            <button className="btn ghost sm" onClick={() => void stopRunning()}>{t("取消")}</button>
          </span>
        } />
        <div className="lines">
          {asr.live.map((s, i) => (
            <div className="line live" key={i} role="button" tabIndex={0} onClick={() => current?.id === ep.id && player?.seek(s.start)}>
              <span className="line-time">{clock(s.start)}</span>
              <div className="line-text"><p className="orig">{s.text}{i === asr.live.length - 1 && <span className="live-caret" aria-hidden />}</p></div>
            </div>
          ))}
          {!asr.live.length && (
            <div className="asr-wait">
              <CassetteArt mode={asr.stage === "download" ? "fetch" : "listen"} />
              <p className="muted">{asr.stage === "download" ? t("先把音频取回来，马上开始听写") : t("识别完成后会一次性显示全部文字")}</p>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <GenCard icon={<WaveToTextArt />} title={official === "error" ? t("字幕暂未载入") : t("这集还没有字幕")}
      note={cloud ? t("生成字幕会将音频发送到{name}。", { name: t(cloud.name) }) : undefined}>
      {official === "error" && <button className="btn" title={officialError ? plainError(tr(officialError)) : undefined} onClick={() => void loadTranscript(ep)}>{t("重新获取字幕")}</button>}
      <button className="btn primary gen-go" onClick={generate} disabled={!model}>{missingKey ? t("先填写 API Key") : t("生成字幕")}</button>

      <button className="link-btn gen-more" aria-expanded={options} onClick={() => setOptions(!options)}>{t("识别设置")}<ChevronDown size={12} className={options ? "flip" : ""} /></button>

      {options && (
        <div className="gen-options">
          <label><span>{t("识别方式")}</span>
            <select value={`cloud:${cloud?.id}`} onChange={(e) => pickEngine(e.target.value)}>
              <optgroup label={t("云端服务 · 更快，需要 Key")}>
                {pickerCloud(settings).map((a) => <option key={a.id} value={`cloud:${a.id}`}>{t(a.name)}</option>)}
              </optgroup>
              <option value="more">{t("更多")}…</option>
            </select>
          </label>
        </div>
      )}
    </GenCard>
  );
}

/** An error for reading: long addresses carry no meaning for the listener (the full text stays in the tooltip). */
const plainError = (m: string) => m.replace(/[：:]?\s*https?:\/\/\S+/g, "").trim() || m;

/** The centred card shown in the subtitle panel while an episode has no subtitles yet. */
function GenCard({ icon, title, note, children }: { icon: React.ReactNode; title: string; note?: string; children?: React.ReactNode }) {
  return (
    <div className="transcript">
      <div className="gen-wrap">
        <div className="gen-card">
          <span className="gen-art" aria-hidden>{icon}</span>
          <h3 className="gen-title">{title}</h3>
          {note && <p className="gen-note">{note}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
