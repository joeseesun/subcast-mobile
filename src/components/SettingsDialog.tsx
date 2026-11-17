import { ask } from "../lib/confirm";
import { useShallow } from "zustand/react/shallow";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, Check, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Github, Loader2, MessageCircle, RefreshCw, Trash2, Captions, HardDrive, Info, PlayCircle, Mic, Volume2, SlidersHorizontal, Sparkles } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { ASR_SERVICES } from "../lib/settings";
import { stopSpeaking } from "../lib/tts";
import logoUrl from "../assets/logo.png";
import wechatQr from "../assets/about-wechat-qr.jpg";
import rewardQr from "../assets/about-reward-qr.png";
import { openUrl } from "@tauri-apps/plugin-opener";
import { shareText } from "../lib/share";
import { api, errorText, llmChat, type CloudAsr, type Provider } from "../lib/api";
import { useStore } from "../store";
import { Modal } from "./Chrome";
import { bytes, clearDownloads, useOffline } from "../lib/offline";

import { IS_MAC, LANGS, systemLang, t, tk, tr, useLang, type LangSetting } from "../lib/i18n";
import { ModelSettings } from "./ModelSettings";
import { ReadingSettings } from "./ReadingSettings";
import { RATES } from "./Players";
import { SettingGroup, SettingSelect, SettingsSwitch, SettingText, NO_AUTO, KeyField, KeyRow } from "./SettingRows";
import type { Settings } from "../lib/settings";

import { ReadAloudSettings } from "./ReadAloud";

/** One default model for translation and the guide; Q&A starts with it and can switch in the chat box. */
function DefaultButton({ id, isDefault }: { id: string; isDefault: boolean }) {
  const saveSettings = useStore((s) => s.saveSettings);
  const mode = useStore((s) => s.settings.translateMode);
  return isDefault
    ? <p className="default-on small"><Check size={13} /> {t("当前默认模型")}</p>
    : <button className="btn primary sm" onClick={() => void saveSettings({ translateProvider: id, chatProvider: id, chatModel: "", modelChosen: true, ...(mode === "google" ? { translateMode: "auto" } : {}) })}>{t("设为默认模型")}</button>;
}

function ProviderEditor({ p, onChange }: { p: Provider; onChange: (p: Provider) => void }) {
  const settings = useStore((s) => s.settings);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);
  const [live, setLive] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => { setKey(""); setLive(null); setAdvanced(!p.needsKey); api.hasApiKey(p.id).then(setHasKey).catch(() => setHasKey(false)); }, [p.id]);
  const fetchModels = async () => {
    setFetching(true); setTesting(null); setTestOk(false);
    try { if (key.trim()) await saveKey(); const ids = await api.listModels(p); setLive(ids); if (!ids.length) setTesting(t("这个服务没有返回模型列表，请手动填写")); }
    catch (e) { setTesting(errorText(e)); } finally { setFetching(false); }
  };
  const saveKey = async () => { await api.setApiKey(p.id, key); setHasKey(!!key.trim()); setKey(""); };
  const test = async () => {
    setTesting("…"); setTestOk(false);
    try {
      if (key.trim()) await saveKey();
      const r = await llmChat({ provider: p, system: "Reply with one short word.", messages: [{ role: "user", content: "ping" }], maxTokens: 1500 });
      setTesting(t("可用 ✓ {reply}", { reply: r.slice(0, 20) })); setTestOk(true);
    } catch (e) { setTesting(errorText(e)); }
  };
  const forTranslate = settings.translateProvider === p.id && settings.translateMode !== "google";
  const models = [...new Set([p.model, ...(p.models ?? []), ...(live ?? [])])].filter(Boolean);
  return (
    <div className="provider-form">
      {p.needsKey && (
        <div className="setup-block">
          <div className="setup-head">
            <p className="setup-title">API Key</p>
            {p.keyUrl && <button className="link-btn" onClick={() => openUrl(p.keyUrl!)}>{t("去官网申请")} <ExternalLink size={11} /></button>}
          </div>
          <KeyRow key={p.id} has={hasKey} value={key} onValue={setKey} onSave={saveKey} onDelete={async () => { await api.setApiKey(p.id, ""); setHasKey(false); }} />
        </div>
      )}
      <div className="setup-block">
        <DefaultButton id={p.id} isDefault={forTranslate} />
      </div>
      <div className="row-actions">
        <button className="btn sm" onClick={test} disabled={testing === "…"}>{testing === "…" && <Loader2 size={13} className="spin" />} {t("测试连接")}</button>
        {testing && testing !== "…" && <span className={testOk ? "ok-text small" : "error-text small"}>{testing}</span>}
        <span className="spacer" />
        <button className="adv-toggle" onClick={() => setAdvanced(!advanced)}><ChevronDown size={12} className={advanced ? "flip" : ""} /> {t("高级设置")}</button>
      </div>
      {advanced && (
        <SettingGroup>
          <SettingSelect label={t("接口类型")} value={p.protocol} options={[["openai", t("OpenAI 兼容")], ["anthropic", "Anthropic"]]}
            onChange={(protocol) => onChange({ ...p, protocol })} />
          <SettingText label={t("接口地址")} type="url" value={p.baseUrl} onCommit={(baseUrl) => onChange({ ...p, baseUrl })} placeholder="https://…/v1" />
          <SettingText label={t("模型")} value={p.model} placeholder={t("模型名")} onCommit={(model) => onChange({ ...p, model })} />
          {models.length > 1 && <SettingSelect label={t("可选模型")} value={p.model} options={models.map((model) => [model, model] as const)} onChange={(model) => onChange({ ...p, model })} />}
          <button className="ios-setting-action" onClick={fetchModels} disabled={fetching}>{fetching ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} {t("获取模型列表")}</button>
        </SettingGroup>
      )}
    </div>
  );
}

const SETTING_GROUPS = [
  [
    { id: "playback", label: tk("播放"), Icon: PlayCircle, symbol: "play.circle" },
    { id: "reading", label: tk("阅读与字幕"), Icon: Captions, symbol: "captions.bubble" },
    { id: "asr", label: tk("语音识别"), Icon: Mic, symbol: "waveform" },
    { id: "model", label: tk("AI 模型"), Icon: Sparkles, symbol: "sparkles" },
    { id: "tts", label: tk("朗读"), Icon: Volume2, symbol: "speaker.wave.2" },
  ],
  [
    { id: "general", label: tk("通用"), Icon: SlidersHorizontal, symbol: "slider.horizontal.3" },
    { id: "storage", label: tk("存储"), Icon: HardDrive, symbol: "internaldrive" },
  ],
  [
    { id: "about", label: tk("关于"), Icon: Info, symbol: "info.circle" },
  ],
] as const;
const SETTING_PAGES = SETTING_GROUPS.flat();
type Section = typeof SETTING_PAGES[number]["id"];
const LEGACY: Record<string, Section> = { overview: "reading", subtitles: "reading", ai: "model", shortcuts: "playback" };
function settingPage(id: string | undefined) {
  return id ? SETTING_PAGES.find((row) => row.id === (LEGACY[id] ?? id)) : undefined;
}

export function SettingsDialog() {
  const initial = useStore((s) => s.settingsSection);
  const [section, setSection] = useState<Section | null>(() => settingPage(initial)?.id ?? null);
  const [nativeIndex, setNativeIndex] = useState(IS_MAC);
  const presentation = useRef<Promise<string | null> | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const providerName = useStore((state) => provider ? state.settings.providers[provider]?.name : undefined);
  const lang = useLang((s) => s.lang);
  const close = () => { stopSpeaking(); useStore.setState({ settingsOpen: false }); };

  useEffect(() => {
    if (section || !nativeIndex) return;
    let active = true;
    const pending = presentation.current ??= invoke<string | null>("plugin:mobile|present_settings_index", {
      state: {
        title: t("设置"), done: t("完成"),
        groups: SETTING_GROUPS.map((group) => group.map(({ id, label, symbol }) => ({ id, title: t(label), symbol }))),
      },
    });
    void pending.then((choice) => {
      if (!active) return;
      if (choice === "") close();
      else if (choice && settingPage(choice)) setSection(settingPage(choice)!.id);
      else setNativeIndex(false);
    }).catch(() => { if (active) setNativeIndex(false); }).finally(() => {
      if (presentation.current === pending) presentation.current = null;
    });
    return () => { active = false; };
  }, [section, nativeIndex, lang]);

  const title = providerName ? tr(providerName) : t(settingPage(section ?? undefined)?.label ?? tk("设置"));
  return <Modal title={title} className="settings-modal" done wide onClose={close} head={section ? <>
    <button className="settings-back" aria-label={providerName ? t("AI 模型") : t("设置")} onClick={() => {
      if (provider) setProvider(null); else setSection(null);
    }}><ChevronLeft size={22} /><span>{providerName ? t("AI 模型") : t("设置")}</span></button>
    <h3>{title}</h3>
  </> : undefined}>
    <div className="settings">
      {!section && !nativeIndex && SETTING_GROUPS.map((group) => <nav className="settings-list" key={group[0].id} aria-label={t("设置")}>
        {group.map(({ id, label, Icon }) => <button key={id} onClick={() => setSection(id)}><Icon aria-hidden /><span>{t(label)}</span><ChevronRight size={18} aria-hidden /></button>)}
      </nav>)}
      {section && <div className="settings-body" key={section}>
        {section === "playback" && <PlaybackSettings />}
        {section === "reading" && <ReadingSettings />}
        {section === "asr" && <TranscriptionSettings />}
        {section === "model" && <ModelSettings ProviderEditor={ProviderEditor} editing={provider} setEditing={setProvider} />}
        {section === "tts" && <ReadAloudSettings />}
        {section === "general" && <GeneralSettings />}
        {section === "storage" && <Storage />}
        {section === "about" && <About />}
      </div>}
    </div>
  </Modal>;
}

function PlaybackSettings() {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const save = (patch: Partial<Settings>) => void saveSettings(patch);
  const speedOptions = [...new Set([...RATES, settings.playbackRate])].sort((a, b) => a - b).map((rate) => [rate, `${rate}×`] as const);
  const seconds = (current: number) => [...new Set([5, 10, 15, 30, 45, 60, current])].sort((a, b) => a - b).map((n) => [n, t("{n} 秒", { n })] as const);
  return <>
    <SettingGroup title={t("播放控制")}>
      <SettingSelect label={t("播放速度")} options={speedOptions} value={settings.playbackRate} onChange={(rate) => {
        useStore.getState().player?.setRate(rate);
        save({ playbackRate: rate });
      }} />
      <SettingSelect label={t("后退")} options={seconds(settings.skipBack ?? 15)} value={settings.skipBack ?? 15} onChange={(skipBack) => save({ skipBack })} />
      <SettingSelect label={t("前进")} options={seconds(settings.skipForward ?? 30)} value={settings.skipForward ?? 30} onChange={(skipForward) => save({ skipForward })} />
    </SettingGroup>
    <SettingGroup footer={t("播完后接着播放同一节目的下一集")}>
      <SettingsSwitch label={t("自动连播")} value={!!settings.autoNext} onChange={(autoNext) => save({ autoNext })} />
    </SettingGroup>
  </>;
}

function TranscriptionSettings() {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const engine = settings.cloudAsr[settings.asrEngine];
  return <>
    <SettingGroup footer={t("查不到现成字幕时，可以用云端服务生成。")}>
      <SettingSelect label={t("识别服务")} value={settings.asrEngine} options={ASR_SERVICES.map((a) => [a.id, t(a.name)] as const)}
        onChange={(asrEngine) => void saveSettings({ asrEngine })} />
    </SettingGroup>
    {engine && <CloudAsrEditor key={engine.id} a={engine} onChange={(value) => void saveSettings({ cloudAsr: { ...settings.cloudAsr, [value.id]: value } })} />}
  </>;
}

function GeneralSettings() {
  const { settings, saveSettings, set, notify } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, set: s.set, notify: s.notify })));
  const [proxy, setProxy] = useState(settings.proxy);
  const [saving, setSaving] = useState(false);
  const [proxyFeedback, setProxyFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const saveProxy = async () => {
    const previous = settings.proxy;
    setSaving(true);
    try {
      await saveSettings({ proxy: proxy.trim() });
      setProxy(proxy.trim());
      setProxyFeedback({ error: false, text: t("代理已保存") });
    } catch (error) {
      useStore.setState((state) => ({ settings: { ...state.settings, proxy: previous } }));
      setProxyFeedback({ error: true, text: errorText(error) });
    } finally { setSaving(false); }
  };
  return <>
    <SettingGroup title={t("界面")}>
      <SettingSelect<LangSetting> label={t("界面语言")} value={settings.uiLang} options={[
        ["auto", t("跟随系统（{name}）", { name: LANGS.find((l) => l.id === systemLang())?.name ?? "" })],
        ...LANGS.map((language) => [language.id, language.name] as const),
      ]} onChange={(uiLang) => void saveSettings({ uiLang })} />
      <SettingsSwitch label={t("推荐「词元之外」")} value={!settings.homeBannerHidden} onChange={(on) => void saveSettings({ homeBannerHidden: !on })} />
    </SettingGroup>
    <SettingGroup title={t("订阅")}>
      <button className="ios-setting-action" onClick={() => set({ settingsOpen: false, addOpen: true, addTab: "import" })}>{t("导入订阅…")}<ChevronRight size={18} /></button>
      <button className="ios-setting-action" onClick={async () => {
        try { await shareText(await api.exportOpml(), `SubCast-${new Date().toISOString().slice(0, 10)}.opml`); }
        catch (error) { notify(errorText(error)); }
      }}>{t("导出 OPML")}</button>
    </SettingGroup>
    <SettingGroup title={t("网络")}>
      <form className="ios-setting-field" onSubmit={(e) => { e.preventDefault(); void saveProxy(); }}>
        <label htmlFor="settings-proxy">{t("代理")}</label>
        <div className="key-row">
          <input id="settings-proxy" {...NO_AUTO} type="url" value={proxy} onChange={(e) => { setProxy(e.target.value); setProxyFeedback(null); }} placeholder={t("留空就用系统代理")} />
          <button className="btn" disabled={saving || proxy.trim() === settings.proxy}>{t("保存")}</button>
        </div>
        {proxyFeedback && <p className={proxyFeedback.error ? "error-text small" : "muted small"} role="status">{proxyFeedback.text}</p>}
      </form>
    </SettingGroup>
    <SettingGroup title={t("共享")} footer={t("只分享文字，帮别人省去等待。关掉后照样能用别人分享的。")}>
      <SettingsSwitch label={t("匿名分享我生成的字幕、译文和导读")} value={settings.shareTranscripts} onChange={(shareTranscripts) => void saveSettings({ shareTranscripts })} />
    </SettingGroup>
  </>;
}

function CloudAsrEditor({ a, onChange }: { a: CloudAsr; onChange: (a: CloudAsr) => void }) {
  return (
    <section className="setup-block provider-form">
      <p className="setup-title">{t(a.name)}</p>
      <p className="muted small">{t("{note}。识别时音频会发送到 {name}。", { note: t(a.note), name: t(a.name) })}</p>
      <SettingText label={t("接口地址")} type="url" value={a.baseUrl} onCommit={(baseUrl) => onChange({ ...a, baseUrl })} />
      <SettingText label={t("模型")} value={a.model} onCommit={(model) => onChange({ ...a, model })} />
      {a.models.length > 1 && <SettingSelect label={t("可选模型")} value={a.model}
        options={[...new Set([a.model, ...a.models])].map((model) => [model, model] as const)} onChange={(model) => onChange({ ...a, model })} />}
      {a.needsKey && <div><p className="setup-title">API Key</p><KeyField account={`asr.${a.id}`} /></div>}
      {a.protocol === "deepseek" && <p className="muted small">{t("已在「AI 模型」里填过 DeepSeek Key 的话，这里可以留空。")}</p>}
      <div className="row-actions">
        <span className="spacer" />
        {a.keyUrl && <button className="btn ghost sm" onClick={() => openUrl(a.keyUrl!)}><ExternalLink size={13} /> {t("获取 Key")}</button>}
      </div>
    </section>
  );
}

const REPO = "https://github.com/joeseesun/subcast";
function Storage() {
  const { set, go } = useStore(useShallow((s) => ({ set: s.set, go: s.go })));
  const saved = useOffline((s) => s.saved);
  const [info, setInfo] = useState<{ downloads: number; models: number; library: number; temp: number } | null>(null);
  const load = () => void api.storageInfo().then(setInfo).catch(() => {});
  useEffect(load, [saved]);
  const n = Object.keys(saved).length;
  const size = (b?: number) => (info ? (b ? bytes(b) : "0 MB") : "…");
  const clearAll = async () => {
    if (!(await ask({ title: t("清理全部离线音频？"), message: t("字幕、精读和收听进度都会保留。"), ok: t("全部删除"), danger: true }))) return;
    await clearDownloads(); load();
  };
  return (
    <>
      <div className="storage-list">
        <div className="storage-row">
          <div className="storage-row-text">
            <p className="storage-row-name">{t("离线音频")}</p>
            <p className="muted small">{n ? t("{n} 集音频，没有网络也能听", { n }) : t("缓存音频后即可离线收听")}</p>
          </div>
          <span className="storage-size">{size(info?.downloads)}</span>
          {n > 0 && <button className="btn ghost sm" onClick={() => { set({ settingsOpen: false }); go({ kind: "downloads" }); }}>{t("查看")}</button>}
          {n > 0 && <button className="icon-btn" title={t("全部删除")} onClick={clearAll}><Trash2 size={14} /></button>}
        </div>
        <div className="storage-row">
          <div className="storage-row-text">
            <p className="storage-row-name">{t("节目库")}</p>
            <p className="muted small">{t("订阅、字幕、翻译、精读和收听进度")}</p>
          </div>
          <span className="storage-size">{size(info?.library)}</span>
        </div>
        {!!info?.temp && (
          <div className="storage-row">
            <div className="storage-row-text">
              <p className="storage-row-name">{t("临时文件")}</p>
              <p className="muted small">{t("中断的识别留下的音频，可以放心清理")}</p>
            </div>
            <span className="storage-size">{size(info.temp)}</span>
            <button className="btn sm" onClick={() => void api.clearTemp().then(load)}>{t("清理")}</button>
          </div>
        )}
      </div>
    </>
  );
}

function About() {
  const [version, setVersion] = useState("0.1.0");
  const [code, setCode] = useState<"wechat" | "reward" | null>(null);
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);

  return (
    <div className="settings-about">
      <div className="settings-brand">
        <img src={logoUrl} width={72} height={72} alt="" />
        <h2>SubCast</h2>
        <p>{t("版本 {version}", { version })}</p>
      </div>
      <SettingGroup>
        <button className="ios-setting-action" onClick={() => void openUrl(`${REPO}/issues/new`)}><MessageCircle size={20} />{t("反馈问题")}<ExternalLink size={16} /></button>
        <button className="ios-setting-action" onClick={() => void openUrl(`${REPO}#readme`)}><BookOpen size={20} />{t("使用说明")}<ExternalLink size={16} /></button>
        <button className="ios-setting-action" onClick={() => void openUrl(REPO)}><Github size={20} />{t("源代码")}<ExternalLink size={16} /></button>
      </SettingGroup>
      <SettingGroup>
        <button className="ios-setting-action" onClick={() => void openUrl("https://qiaomu.ai")}>qiaomu.ai<ExternalLink size={16} /></button>
        <button className="ios-setting-action" aria-expanded={code === "wechat"} onClick={() => setCode(code === "wechat" ? null : "wechat")}>{t("关注公众号")}<ChevronDown size={16} /></button>
        {code === "wechat" && <div className="settings-qr"><img src={wechatQr} alt={t("公众号二维码")} /><p>{t("微信搜索「向阳乔木推荐看」")}</p></div>}
        <button className="ios-setting-action" aria-expanded={code === "reward"} onClick={() => setCode(code === "reward" ? null : "reward")}>{t("请我喝杯咖啡")}<ChevronDown size={16} /></button>
        {code === "reward" && <div className="settings-qr"><img src={rewardQr} alt={t("赞赏码")} /></div>}
      </SettingGroup>
      <p className="settings-footnote">{t("© {year} 向阳乔木 · AGPL-3.0", { year: new Date().getFullYear() })}</p>
    </div>
  );
}
