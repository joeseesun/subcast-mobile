// Promotion for the author's own podcast (词元之外 · Next Token) and its YouTube channel.
// The slots follow the "推荐节目的 YouTube 频道" setting, except the About card; the Discover banner can also be closed for good.
import { Check, Loader2, Plus, X, Youtube } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "../lib/i18n";
import { pickName } from "../lib/picks";
import { homeShow, showLinks, subscribeUrl } from "../lib/showLinks";
import { useStore } from "../store";

export const usePromo = () => useStore((s) => s.settings.youtubePromo);

/** The red YouTube subscribe button. YouTube's own red so it reads as YouTube at a glance. */
export function YtButton({ channel, label, small }: { channel: string; label?: string; small?: boolean }) {
  return (
    <button className={`btn yt-btn ${small ? "sm" : ""}`} onClick={(e) => { e.stopPropagation(); void openUrl(subscribeUrl(channel)); }}>
      <Youtube size={small ? 14 : 16} /> {label ?? t("订阅 YouTube 频道")}
    </button>
  );
}

/** The secondary places a show lives (Bilibili), kept quiet so YouTube stays the one obvious action. */
export function AlsoOn({ feedUrl }: { feedUrl?: string }) {
  const l = showLinks(feedUrl);
  if (!l.bilibili) return null;
  return <button className="link-btn also-on" onClick={() => void openUrl(l.bilibili!)}>{t("也在 B 站")}</button>;
}

/** Discover's top banner: our own show, with subscribing in the app and on YouTube side by side. */
export function HomeShowBanner({ subscribed, busy, onSubscribe, onOpen, onHide }: { subscribed: boolean; busy: boolean; onSubscribe: () => void; onOpen: () => void; onHide: () => void }) {
  const p = homeShow();
  if (!p) return null;
  return (
    <div className="creator-row">
      <button className="creator-open" onClick={onOpen}><img src={p.cover} alt="" /><span><small>{t("主创的播客")}</small><strong>{pickName(p)}</strong></span></button>
      {subscribed ? <Check size={19} aria-label={t("已订阅")} /> :
        <button className="round-btn" onClick={onSubscribe} aria-label={t("订阅")} disabled={busy}>{busy ? <Loader2 className="spin" /> : <Plus />}</button>}
      <button className="icon-btn" aria-label={t("不再显示")} onClick={onHide}><X size={18} /></button>
    </div>
  );
}

/** About page: a short card for our own show. */
export function HomeShowCard() {
  // Always shown on the About page: it is where the author introduces himself.
  const p = homeShow();
  const yt = showLinks(p?.input).youtube;
  if (!p || !yt) return null;
  return (
    <div className="home-card">
      <img src={p.cover} alt="" />
      <div className="home-card-text">
        <p className="qr-title">{t("听听我们的播客")}</p>
        <p className="muted small">{t("{name}：乔木和朋友们聊 AI", { name: pickName(p) })}</p>
      </div>
      <YtButton channel={yt} label={t("订阅")} small />
    </div>
  );
}
