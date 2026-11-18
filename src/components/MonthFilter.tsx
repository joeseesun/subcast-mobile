import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { Episode } from "../lib/api";
import { monthLabel } from "../lib/format";
import { t } from "../lib/i18n";

export const episodeMonth = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function episodeMonthLabel(key: string) {
  return monthLabel(Number(key.slice(5)), Number(key.slice(0, 4)));
}

export function availableEpisodeMonths(episodes: Episode[] | null) {
  const counts = new Map<string, number>();
  for (const episode of episodes ?? []) {
    if (!episode.published) continue;
    const month = episodeMonth(episode.published);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => b.localeCompare(a));
}

/** Month filter state for an episode list. */
export function useMonthFilter(eps: Episode[] | null) {
  const [month, setMonth] = useState<string | null>(null);
  const filtered = useMemo(() => (month && eps ? eps.filter((e) => e.published && episodeMonth(e.published) === month) : eps), [eps, month]);
  return { month, setMonth, filtered };
}

/** System picker for months with available episodes, newest first. */
export function MonthFilter({ episodes, month, onChange }: { episodes: Episode[] | null; month: string | null; onChange: (m: string | null) => void }) {
  const months = useMemo(() => availableEpisodeMonths(episodes), [episodes]);
  if (months.length < 2 && !month) return null;
  return <label className="month-picker"><CalendarDays size={20} /><select aria-label={t("按月份筛选")} value={month ?? ""} onChange={(e) => onChange(e.target.value || null)}>
    <option value="">{t("全部月份")}</option>
    {months.map(([month, n]) => <option key={month} value={month}>
      {t("{month} · {n} 期", { month: episodeMonthLabel(month), n })}
    </option>)}
  </select></label>;
}
