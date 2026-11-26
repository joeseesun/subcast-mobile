// 朗读: one button for reading text aloud (精读, 导读), and the voice settings: which service (the phone's own voices,
// Edge, Doubao, DeepSeek, MiMo, Qwen, OpenAI-compatible, MiniMax, ElevenLabs), its voice, speed and key, with a preview.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Chrome";
import { useShallow } from "zustand/react/shallow";
import { ExternalLink, Settings2, Square, Volume2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { speak, stopSpeaking } from "../lib/tts";
import { keyAccount, SERVICES, serviceOf, systemVoices, type TtsService } from "../lib/voices";
import { useStore } from "../store";
import { t, tr } from "../lib/i18n";
import { KeyField, SettingGroup, SettingSelect, SettingsSwitch, SettingText } from "./SettingRows";

export function ReadAloud({ text, title }: { text: () => string; title?: string }) {
  const speaking = useStore((s) => s.speaking);
  const [open, setOpen] = useState(false);
  const read = () => void speak(text(), (m) => { useStore.getState().notify(tr(m)); if (m.includes("Key")) setOpen(true); });
  return (
    <div className="read-along">
      {speaking
        ? <button className="ra-start on" onClick={stopSpeaking}><Square size={13} fill="currentColor" aria-hidden /> {t("停止朗读")}</button>
        : <button className="ra-start" title={title ?? t("朗读")} onClick={read}><Volume2 size={16} aria-hidden /> {t("朗读")}</button>}
      <button className="ra-icon" aria-label={t("朗读设置")} onClick={() => setOpen(true)}><Settings2 size={18} /></button>
      {open && createPortal(<Modal title={t("朗读设置")} className="settings-modal" done onClose={() => setOpen(false)}><ReadAloudSettings /></Modal>, document.body)}
    </div>
  );
}

export function ReadAloudSettings() {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const speaking = useStore((s) => s.speaking);
  const svc = serviceOf(settings);
  const own = settings.ttsServices?.[svc.id] ?? {};
  const patch = (p: { voice?: string; model?: string; baseUrl?: string; resource?: string }) =>
    void saveSettings({ ttsServices: { ...settings.ttsServices, [svc.id]: { ...own, ...p } } });
  // The phone's voices arrive a moment after the page loads.
  const [sysVoices, setSysVoices] = useState(systemVoices);
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const update = () => setSysVoices(systemVoices());
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  const known = svc.voices.some((v) => v.id === svc.voice);
  const [custom, setCustom] = useState(svc.protocol !== "system" && !!svc.voice && !known);
  useEffect(() => { setCustom(svc.protocol !== "system" && !!svc.voice && !svc.voices.some((v) => v.id === svc.voice)); }, [svc.id]);
  const voiceOptions: [string, string][] = svc.protocol === "system"
    ? [["", t("自动（推荐）")], ...sysVoices.map((v) => [v.voiceURI, `${v.name} · ${v.lang}`] as [string, string])]
    : [...svc.voices.map((v) => [v.id, t(v.name)] as [string, string]), ["custom", t("自定义音色")]];
  const free = (x: TtsService) => !x.needsKey;
  const preview = () => {
    if (speaking) { stopSpeaking(); return; }
    void speak(t("你好，这是朗读的声音。Hello, this is how I sound."), (m) => useStore.getState().notify(tr(m)));
  };
  return (
    <div className="voice-settings">
      <SettingGroup title={t("朗读服务")} footer={t(svc.note)}>
        <SettingSelect label={t("服务")} value={svc.id} options={SERVICES.map((x) => [x.id, free(x) ? `${t(x.name)} · ${t("免费")}` : t(x.name)] as const)}
          onChange={(ttsEngine) => { stopSpeaking(); void saveSettings({ ttsEngine }); }} />
        {(svc.voices.length > 0 || svc.protocol === "system") && (
          <SettingSelect label={t("音色")} value={custom ? "custom" : svc.voice} options={voiceOptions}
            onChange={(voice) => { setCustom(voice === "custom"); if (voice !== "custom") patch({ voice }); }} />
        )}
        {(custom || (svc.voices.length === 0 && svc.protocol !== "system")) && (
          <SettingText label={t("自定义音色")} value={svc.voice} onCommit={(voice) => patch({ voice })} placeholder={t("音色 ID")} />
        )}
        {svc.id === "doubao" && custom && (
          <SettingsSwitch label={t("这是我复刻的声音")} value={svc.resource === "seed-icl-2.0"} onChange={(cloned) => patch({ resource: cloned ? "seed-icl-2.0" : "seed-tts-2.0" })} />
        )}
        {svc.models.length > 1 && (
          <SettingSelect label={t("模型")} value={svc.model} options={svc.models.map((m) => [m, m] as const)} onChange={(model) => patch({ model })} />
        )}
        {svc.id === "custom" && <>
          <SettingText label={t("接口地址")} value={svc.baseUrl} onCommit={(baseUrl) => patch({ baseUrl })} placeholder="https://…/v1" />
          <SettingText label={t("模型")} value={svc.model} onCommit={(model) => patch({ model })} placeholder="tts-1" />
        </>}
        <SettingSelect label={t("语速")} value={settings.ttsRate || 1} options={RATES.map((r) => [r, r === 1 ? t("正常") : `${r}×`] as const)}
          onChange={(ttsRate) => void saveSettings({ ttsRate })} />
        <button className="ios-setting-action" onClick={preview}>{speaking ? t("停止试听") : t("试听")}{speaking ? <Square size={14} fill="currentColor" /> : <Volume2 size={16} />}</button>
      </SettingGroup>
      {svc.needsKey && (
        <SettingGroup title={t("{name} Key", { name: t(svc.name) })} footer={keyAccount(svc.id).startsWith("tts.") ? t("朗读时文字会发送到{name}。Key 只保存在本机钥匙串。", { name: t(svc.name) }) : t("和「AI 模型」里的 {name} 是同一个 Key，填一处两边都能用。朗读时文字会发送到{name}。", { name: t(svc.name) })}>
          <div className="ios-setting-field"><KeyField account={keyAccount(svc.id)} placeholder={svc.id === "doubao" && svc.sharedKeyHint ? t(svc.sharedKeyHint) : t("粘贴 API Key")} /></div>
          {svc.keyUrl && <button className="ios-setting-action" onClick={() => void openUrl(svc.keyUrl!)}>{t("获取 Key")}<ExternalLink size={16} /></button>}
        </SettingGroup>
      )}
    </div>
  );
}

const RATES = [0.8, 1, 1.15, 1.25, 1.5];
