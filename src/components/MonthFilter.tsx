import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { Episode } from "../lib/api";
import { monthLabel } from "../lib/format";
import { t } from "../lib/i18n";

const key = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

/** Month filter state for an episode list. */
export function useMonthFilter(eps: Episode[] | null) {
  const [month, setMonth] = useState<string | null>(null);
  const filtered = useMemo(() => (month && eps ? eps.filter((e) => e.published && key(e.published) === month) : eps), [eps, month]);
  return { month, setMonth, filtered };
}

/** System picker for months with available episodes, newest first. */
export function MonthFilter({ episodes, month, onChange }: { episodes: Episode[] | null; month: string | null; onChange: (m: string | null) => void }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of episodes ?? []) if (e.published) m.set(key(e.published), (m.get(key(e.published)) ?? 0) + 1);
    return m;
  }, [episodes]);
  if (counts.size < 2) return null;
  return <label className="month-picker"><CalendarDays size={20} /><select aria-label={t("按月份筛选")} value={month ?? ""} onChange={(e) => onChange(e.target.value || null)}>
    <option value="">{t("全部月份")}</option>
    {[...counts].sort(([a], [b]) => b.localeCompare(a)).map(([key, n]) => <option key={key} value={key}>
      {t("{month} · {n} 期", { month: monthLabel(Number(key.slice(5)), Number(key.slice(0, 4))), n })}
    </option>)}
  </select></label>;
}
