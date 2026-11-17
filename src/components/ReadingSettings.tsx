// Settings › 阅读与字幕: how subtitles and answers look, with a live preview using a line from what is playing.
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { useJobs } from "../lib/jobs";
import { t, useLang } from "../lib/i18n";
import { SUB_FONTS } from "../lib/reading";
import { POSTER_FONTS } from "../lib/poster";
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

      <section className="setup-block">
        <p className="setup-title">{t("字幕")}</p>
        <div className="reading-row"><span>{t("字号")}</span>
          <Seg value={settings.subtitleSize ?? "m"} options={[["s", t("小")], ["m", t("标准")], ["l", t("大")], ["xl", t("特大")]]} onChange={(v) => save({ subtitleSize: v })} />
        </div>
        <div className="reading-row"><span>{t("字体")}</span>
          <Seg value={settings.subtitleFont ?? "sans"} options={(Object.keys(SUB_FONTS) as (keyof typeof SUB_FONTS)[]).map((id) => [id, fontName(id)])} onChange={(v) => save({ subtitleFont: v })} />
        </div>
        <div className="reading-row"><span>{t("视频上的字幕")}</span>
          <Seg value={settings.subtitleLook ?? "outline"} options={[["box", t("半透明底")], ["outline", t("描边，无底")]]} onChange={(v) => save({ subtitleLook: v })} />
        </div>
        <label className="check"><input type="checkbox" checked={settings.audioNextLine === true} onChange={(e) => save({ audioNextLine: e.target.checked })} /> {t("音频节目提前显示下一句")}</label>
      </section>

      <section className="setup-block">
        <p className="setup-title">{t("AI 问答与导读")}</p>
        <div className="reading-row"><span>{t("字号")}</span>
          <Seg value={settings.chatSize ?? "m"} options={[["m", t("标准")], ["l", t("大")]]} onChange={(v) => save({ chatSize: v })} />
        </div>
      </section>

      <section className="setup-block">
        <p className="setup-title">{t("播放")}</p>
        <label className="check"><input type="checkbox" checked={!!settings.autoNext} onChange={(e) => save({ autoNext: e.target.checked })} /> {t("播完一集，自动接着播同一节目的下一集")}</label>
      </section>
    </div>
  );
}
