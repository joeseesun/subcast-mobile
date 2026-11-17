// Where curated shows ask listeners to follow them. Keyed by the show's feed URL; the show page,
// the episode page, Discover and About use it for the subscribe buttons (only the ones a show has).
import { PICKS, type Pick } from "./picks";

export interface ShowLinks {
  youtube?: string;
  bilibili?: string;
}

/** The author's own podcast: featured in Discover and About, preselected on first launch. */
export const HOME_SHOW_FEED = "https://rss.qiaomu.ai/sources/nexttoken";

const BY_FEED: Record<string, ShowLinks> = {
  [HOME_SHOW_FEED]: {
    youtube: "https://www.youtube.com/@nexttokentv",
    bilibili: "https://space.bilibili.com/3745066753461159",
  },
};

export const showLinks = (feedUrl?: string): ShowLinks => (feedUrl ? BY_FEED[feedUrl] : undefined) ?? {};
export const homeShow = (): Pick | undefined => PICKS.find((p) => p.input === HOME_SHOW_FEED);
/** Opens YouTube's subscribe confirmation for the channel. */
export const subscribeUrl = (channel: string) => `${channel}?sub_confirmation=1`;
