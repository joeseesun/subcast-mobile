// 阅读设置 for 精读 articles, one tap from the article: typeface, size, line spacing and paper, applied live
// (the article stays visible above the sheet).
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Minus, Plus } from "lucide-react";
import { useStore } from "../store";
import { t, tk } from "../lib/i18n";
import { POSTER_FONTS } from "../lib/poster";
import { READ_SIZE } from "../lib/reading";
import { selectionFeedback } from "../lib/feedback";
import type { Settings } from "../lib/settings";
import { MobileSheet } from "./MobileSheet";

/** The classic glyph for judging a Chinese typeface. */
const SAMPLE = "永"; // i18n-ignore

const FONTS: { id: NonNullable<Settings["readFont"]>; name: string; family: string }[] = [
  { id: "system", name: tk("系统黑体"), family: "var(--font, system-ui)" },
  ...POSTER_FONTS.map((f) => ({ id: f.id as NonNullable<Settings["readFont"]>, name: f.name, family: f.family })),
];

export function ReadPrefsButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="aa-btn" aria-label={t("阅读设置")} aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden>Aa</span></button>
    {open && <ReadPrefsSheet onClose={() => setOpen(false)} />}
  </>;
}

function ReadPrefsSheet({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings } = useStore(useShallow((s) => ({ settings: s.settings, saveSettings: s.saveSettings })));
  const save = (p: Partial<Settings>) => { selectionFeedback(); void saveSettings(p); };
  const size = settings.readSize ?? READ_SIZE.base;
  const font = settings.readFont ?? "system";
  const leading = settings.readLeading ?? "normal";
  const paper = settings.readPaper ?? "plain";
  return <MobileSheet title={t("阅读设置")} doneLabel={t("完成")} onClose={onClose} className="read-sheet">
    <div className="read-prefs">
      <div className="rp-row">
        <span className="rp-label">{t("字号")}</span>
        <div className="rp-size">
          <button aria-label={t("缩小字号")} disabled={size <= READ_SIZE.min} onClick={() => save({ readSize: size - 1 })}><Minus size={18} /><span className="rp-a small" aria-hidden>A</span></button>
          <output aria-live="polite">{size}</output>
          <button aria-label={t("放大字号")} disabled={size >= READ_SIZE.max} onClick={() => save({ readSize: size + 1 })}><span className="rp-a big" aria-hidden>A</span><Plus size={18} /></button>
        </div>
      </div>
      <div className="rp-row">
        <span className="rp-label">{t("行距")}</span>
        <div className="rp-seg" role="radiogroup" aria-label={t("行距")}>
          {([["tight", t("紧凑")], ["normal", t("标准")], ["loose", t("宽松")]] as const).map(([id, label]) =>
            <button key={id} role="radio" aria-checked={leading === id} onClick={() => save({ readLeading: id })}>
              <span className={`rp-lines ${id}`} aria-hidden><i /><i /><i /></span>{label}
            </button>)}
        </div>
      </div>
      <div className="rp-row">
        <span className="rp-label">{t("背景")}</span>
        <div className="rp-seg" role="radiogroup" aria-label={t("背景")}>
          <button role="radio" aria-checked={paper === "plain"} onClick={() => save({ readPaper: "plain" })}><span className="rp-swatch plain" aria-hidden />{t("默认")}</button>
          <button role="radio" aria-checked={paper === "paper"} onClick={() => save({ readPaper: "paper" })}><span className="rp-swatch paper" aria-hidden />{t("纸张")}</button>
        </div>
      </div>
      <div className="rp-block">
        <span className="rp-label">{t("字体")}</span>
        <div className="rp-fonts" role="radiogroup" aria-label={t("字体")}>
          {FONTS.map((f) => <button key={f.id} role="radio" aria-checked={font === f.id} onClick={() => save({ readFont: f.id })} style={{ fontFamily: f.family }}>
            <span className="rp-font-sample" aria-hidden>{SAMPLE}</span><span>{t(f.name)}</span>
          </button>)}
        </div>
        <p className="rp-note">{t("思源宋体、霞鹜文楷、京华老宋体第一次使用时需要联网下载字体。")}</p>
      </div>
    </div>
  </MobileSheet>;
}
