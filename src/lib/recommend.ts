// "为你推荐": shows the listener may like, from what they already do in the app. Every signal stays on this
// machine: subscriptions, recently played episodes, favorites and downloads are mapped to the curated picks'
// topics, and unsubscribed picks are ranked by how much of that taste they share.
import type { Episode, Show } from "./api";
import { PICKS, isSubscribed, type Pick, type Topic } from "./picks";

export interface Recommendation { pick: Pick; /** The show that led here ("因为你在听…"), when there is one. */ because?: string }

const shortName = (t: string) => t.split(/[|｜:：]/)[0].trim().toLowerCase();
/** The curated pick a show corresponds to, if any. */
function pickFor(title: string, feedUrl?: string): Pick | undefined {
  const s = shortName(title);
  return PICKS.find((p) => (feedUrl && p.input.toLowerCase().includes(feedUrl.toLowerCase().replace(/^https?:\/\//, ""))) || p.title === title || shortName(p.title) === s || p.by === title || p.channel === title);
}

export function recommend(o: { shows: Show[]; recent: Episode[]; favorites: Episode[]; downloads: Episode[] }, limit = 8): Recommendation[] {
  // Weight per show title: listening counts most, then saving, then just following.
  const weight = new Map<string, number>();
  const add = (title: string | undefined, w: number) => { if (title) weight.set(title, (weight.get(title) ?? 0) + w); };
  o.shows.forEach((s) => add(s.title, 1));
  o.recent.filter((e) => e.progress > 60).slice(0, 30).forEach((e) => add(e.showTitle, 2));
  o.favorites.forEach((e) => add(e.showTitle, 2));
  o.downloads.forEach((e) => add(e.showTitle, 1.5));

  // Taste per topic, and the topics of each show behind it (to say which one a recommendation comes from).
  const topics = new Map<Topic, number>();
  const sources: { title: string; w: number; topics: Topic[] }[] = [];
  for (const [title, w] of weight) {
    const p = pickFor(title, o.shows.find((s) => s.title === title)?.feedUrl);
    if (!p) continue;
    sources.push({ title, w, topics: p.topics });
    for (const tp of p.topics) topics.set(tp, (topics.get(tp) ?? 0) + w);
  }

  const candidates = PICKS.filter((p) => !isSubscribed(p, o.shows));
  if (!topics.size) return candidates.filter((p) => p.deep).slice(0, limit).map((pick) => ({ pick }));
  const used = new Map<string, number>();
  return candidates
    .map((pick) => ({ pick, score: pick.topics.reduce((n, tp) => n + (topics.get(tp) ?? 0), 0) + (pick.deep ? 0.5 : 0) }))
    .filter((r) => r.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ pick }) => {
      // The show sharing the most topics with this pick; ties go to the one not named yet, then to the most listened.
      const because = sources
        .map((src) => ({ src, shared: src.topics.filter((tp) => pick.topics.includes(tp)).length }))
        .filter((x) => x.shared > 0)
        .sort((a, b) => b.shared - a.shared || (used.get(a.src.title) ?? 0) - (used.get(b.src.title) ?? 0) || b.src.w - a.src.w)[0]?.src.title;
      if (because) used.set(because, (used.get(because) ?? 0) + 1);
      return { pick, because };
    });
}
