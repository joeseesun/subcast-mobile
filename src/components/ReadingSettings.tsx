// Settings › 阅读与字幕: how subtitles and answers look, with a live preview using a line from what is playing.
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { useJobs } from "../lib/jobs";
import { t, useLang } from "../lib/i18n";
import { SUB_FONTS } from "../lib/reading";
import { POSTER_FONTS } from "../lib/poster";
import { SettingGroup, SettingSelect, SettingsSwitch } from "./SettingRows";
import type { Settings } from "../lib/settings";

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg-control" role="radiogroup">
      {options.map(([k, label]) => <button key={String(k)} role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{label}</button>)}
    </div>
  );
}

export function ReadingSettings() {
  const { settings, saveSettings, current } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings, current: s.current })));
  useLang((s) => s.lang);
  const save = (p: Partial<Settings>) => void saveSettings(p);
  // A real line when something is playing, else a sample.
  const tr = useJobs((s) => (current ? s.transcripts[current.id] : undefined));
  const items = useJobs((s) => (current ? s.translations[current.id]?.items : undefined));
  const k = tr?.segments.findIndex((_, i) => !!items?.[i]) ?? -1;
  const orig = k >= 0 ? tr!.segments[k].text : "The most important thing is to keep learning faster than the world changes.";
  const zh = k >= 0 ? items![k]! : t("最重要的是，学习的速度要比世界变化的速度更快。");
  const fontName = (id: keyof typeof SUB_FONTS) => id === "system" ? t("系统字体") : t(POSTER_FONTS.find((f) => f.id === SUB_FONTS[id])?.name ?? "");

  return (
    <div className="reading">
      <div className={`reading-preview look-${settings.subtitleLook ?? "outline"}`} aria-hidden>
        <div className="subtitle-overlay">
          <div className="sub-box">
            {settings.subtitleMode !== "original" && <p className="sub-zh">{zh}</p>}
            {settings.subtitleMode !== "translation" && <p className="sub-orig">{orig}</p>}
          </div>
        </div>
      </div>

      <SettingGroup title={t("字幕")}>
        <SettingSelect label={t("字幕显示")} value={settings.subtitleMode} options={[["bilingual", t("双语")], ["translation", t("中文")], ["original", t("原文")]]} onChange={(subtitleMode) => save({ subtitleMode })} />
        <SettingSelect label={t("字号")} value={settings.subtitleSize ?? "m"} options={[["s", t("小")], ["m", t("标准")], ["l", t("大")], ["xl", t("特大")]]} onChange={(subtitleSize) => save({ subtitleSize })} />
        <SettingSelect label={t("字体")} value={settings.subtitleFont ?? "sans"} options={(Object.keys(SUB_FONTS) as (keyof typeof SUB_FONTS)[]).map((id) => [id, fontName(id)])} onChange={(subtitleFont) => save({ subtitleFont })} />
        <SettingSelect label={t("视频字幕背景")} value={settings.subtitleLook ?? "outline"} options={[["box", t("半透明底")], ["outline", t("描边，无底")]]} onChange={(subtitleLook) => save({ subtitleLook })} />
        <SettingsSwitch label={t("音频节目提前显示下一句")} value={settings.audioNextLine === true} onChange={(audioNextLine) => save({ audioNextLine })} />
      </SettingGroup>
      <SettingGroup title={t("AI 问答与导读")}>
        <SettingSelect label={t("字号")} value={settings.chatSize ?? "m"} options={[["m", t("标准")], ["l", t("大")]]} onChange={(chatSize) => save({ chatSize })} />
      </SettingGroup>
    </div>
  );
}
