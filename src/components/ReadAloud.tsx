// 朗读: one button for reading Chinese text aloud (精读, 导读) with its voice and key in a small popover next to it,
// instead of a settings page. The key is the same keychain entry as Doubao speech recognition.
import { useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./Chrome";
import { useShallow } from "zustand/react/shallow";
import { ExternalLink, Settings2, Square, Volume2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { speak, stopSpeaking } from "../lib/tts";
import { VOICES } from "../lib/settings";
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
  const [custom, setCustom] = useState(!VOICES.some(([id]) => id === settings.ttsVoice));
  const voices = VOICES.map(([id, name]) => [id, t(name)] as const);
  return (
    <div className="voice-settings">
      <SettingGroup title={t("音色")}>
        <SettingSelect label={t("音色")} value={custom ? "custom" : settings.ttsVoice} options={[...voices, ["custom", t("自定义音色")]]}
          onChange={(voice) => {
            setCustom(voice === "custom");
            if (voice !== "custom") void saveSettings({ ttsVoice: voice, ttsResource: "seed-tts-2.0" });
          }} />
        {custom && <>
          <SettingText label={t("自定义音色")} value={settings.ttsVoice} onCommit={(ttsVoice) => void saveSettings({ ttsVoice })} placeholder={t("复刻音色或其他音色的 ID")} />
          <SettingsSwitch label={t("这是我复刻的声音")} value={settings.ttsResource === "seed-icl-2.0"}
            onChange={(cloned) => void saveSettings({ ttsResource: cloned ? "seed-icl-2.0" : "seed-tts-2.0" })} />
        </>}
      </SettingGroup>
      <SettingGroup title={t("豆包语音 Key")} footer={t("朗读时文字会发送到豆包语音。")}>
        <div className="ios-setting-field"><KeyField account="tts.doubao" placeholder={t("填过豆包语音识别的可以留空")} /></div>
        <button className="ios-setting-action" onClick={() => void openUrl("https://console.volcengine.com/speech/new/setting/apikeys?projectName=default")}>{t("获取 Key")}<ExternalLink size={16} /></button>
      </SettingGroup>
    </div>
  );
}
