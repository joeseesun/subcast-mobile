// 朗读: one button for reading Chinese text aloud (精读, 导读) with its voice and key in a small popover next to it,
// instead of a settings page. The key is the same keychain entry as Doubao speech recognition.
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown, ExternalLink, Square, Volume2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { speak, stopSpeaking } from "../lib/tts";
import { VOICES } from "../lib/settings";
import { useStore } from "../store";
import { t, tr } from "../lib/i18n";
import { KeyField, NO_AUTO } from "./SettingsDialog";

export function ReadAloud({ text, title }: { text: () => string; title?: string }) {
  const speaking = useStore((s) => s.speaking);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  const read = () => void speak(text(), (m) => { useStore.getState().notify(tr(m)); if (m.includes("Key")) setOpen(true); });
  return (
    <div className="read-aloud" ref={box}>
      {speaking
        ? <button className="btn sm" onClick={stopSpeaking}><Square size={11} /> {t("停止朗读")}</button>
        : <button className="btn sm" title={title ?? t("朗读")} onClick={read}><Volume2 size={13} /> {t("朗读")}</button>}
      <button className="icon-btn sm" aria-label={t("朗读设置")} title={t("朗读设置")} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={13} /></button>
      {open && <ReadAloudSettings />}
    </div>
  );
}

function ReadAloudSettings() {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const [custom, setCustom] = useState(!VOICES.some(([id]) => id === settings.ttsVoice));
  return (
    <div className="read-aloud-pop" role="dialog" aria-label={t("朗读设置")}>
      <p className="setup-title">{t("音色")}</p>
      <div className="model-chips">
        {VOICES.map(([id, name]) => <button key={id} className={`chip sm ${settings.ttsVoice === id ? "on" : ""}`} onClick={() => saveSettings({ ttsVoice: id, ttsResource: "seed-tts-2.0" })}>{t(name)}</button>)}
      </div>
      <p className="setup-title">{t("豆包语音 Key")}</p>
      <KeyField account="tts.doubao" placeholder={t("填过豆包语音识别的可以留空")} />
      <div className="row-actions">
        <button className="link-btn small" onClick={() => openUrl("https://console.volcengine.com/speech/new/setting/apikeys?projectName=default")}><ExternalLink size={12} /> {t("获取 Key")}</button>
        <span className="spacer" />
        <button className="link-btn small" onClick={() => setCustom(!custom)}>{t("自定义音色")}</button>
      </div>
      {custom && (
        <>
          <input {...NO_AUTO} value={settings.ttsVoice} onChange={(e) => saveSettings({ ttsVoice: e.target.value.trim() })} placeholder={t("复刻音色或其他音色的 ID")} />
          <label className="check"><input type="checkbox" checked={settings.ttsResource === "seed-icl-2.0"} onChange={(e) => saveSettings({ ttsResource: e.target.checked ? "seed-icl-2.0" : "seed-tts-2.0" })} /> {t("这是我复刻的声音")}</label>
        </>
      )}
      <p className="muted small">{t("朗读时文字会发送到豆包语音。")}</p>
    </div>
  );
}
