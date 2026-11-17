import { t } from "../lib/i18n";

/** Placeholders shaped like the content they stand in for (a list row, a transcript line, an article), so the
 *  page doesn't jump when real data arrives. They shimmer unless the viewer prefers reduced motion. */
const W = [92, 78, 85, 64, 88, 71, 80, 58];
/** Each row's shimmer starts a little later than the one above, so the light rolls down the list like a wave. */
const wave = (i: number) => ({ "--d": `${i * 90}ms` }) as React.CSSProperties;

export function SkeletonFeed({ rows = 6, thumbs = true }: { rows?: number; thumbs?: boolean }) {
  return (
    <div className="ep-feed sk-wrap" aria-busy="true" aria-label={t("正在加载")}>
      <div className="sk sk-label" />
      {Array.from({ length: rows }, (_, i) => (
        <div className="ep-item sk-row" key={i} style={wave(i)}>
          {thumbs && <div className="sk sk-thumb" />}
          <div className="ep-body-col">
            <div className="sk sk-line xs" style={{ width: "34%" }} />
            <div className="sk sk-line lg" style={{ width: `${W[i % W.length]}%` }} />
            <div className="sk sk-line sm" style={{ width: `${W[(i + 3) % W.length] - 20}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonLines({ rows = 8 }: { rows?: number }) {
  return (
    <div className="lines sk-wrap" aria-busy="true" aria-label={t("正在加载字幕")}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="line sk-row" key={i} style={wave(i)}>
          <div className="sk sk-line xs" style={{ width: 34 }} />
          <div className="line-text">
            <div className="sk sk-line" style={{ width: `${W[i % W.length]}%` }} />
            <div className="sk sk-line sm" style={{ width: `${W[(i + 2) % W.length] - 10}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonArticle() {
  return (
    <div className="deep-read sk-wrap" aria-busy="true" aria-label={t("正在加载精读")}>
      <div className="sk sk-line xs" style={{ width: 120, height: 22, borderRadius: 6, marginBottom: 18 }} />
      {[0, 1, 2].map((p) => (
        <div key={p} style={{ marginBottom: 22 }}>
          {p > 0 && <div className="sk sk-line lg" style={{ width: "46%", marginBottom: 12 }} />}
          {[96, 100, 92, 98, 60].map((w, i) => <div key={i} className="sk sk-line" style={{ width: `${w - p * 3}%` }} />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonEpisode() {
  return (
    <div className="episode" aria-busy="true" aria-label={t("正在打开")}>
      <div className="ep-body sk-wrap">
        <div className="ep-leftcol">
          <div className="topbar" />
          <section className="ep-left">
            <div className="sk sk-line xs" style={{ width: 140 }} />
            <div className="sk sk-line xl" style={{ width: "72%" }} />
            <div className="sk sk-line sm" style={{ width: "48%" }} />
            <div className="sk sk-video" />
            <div className="sk" style={{ height: 64, borderRadius: 14 }} />
          </section>
        </div>
        <section className="ep-right"><div className="tabs" /><SkeletonLines /></section>
      </div>
    </div>
  );
}
