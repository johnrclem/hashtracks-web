import { SCHEDULE_DAYS } from "@/lib/days";

export type DayCode = (typeof SCHEDULE_DAYS)[number];
export type DistanceTier = "nearby" | "area" | "drive";

export const TIERS: readonly DistanceTier[] = ["nearby", "area", "drive"];

/**
 * UTC-noon date convention — getUTCDay() is correct here; getDay() would
 * localize and produce wrong DOW near midnight for users west of UTC.
 */
export function getDayCode(isoDate: string): DayCode {
  return SCHEDULE_DAYS[new Date(isoDate).getUTCDay()];
}

/**
 * Derive which DOW chips should appear and the count per day across every
 * result type the filter can hide. Dated possibles MUST be included: the
 * day filter is applied to them downstream in groupResultsByTier, so if we
 * omit their days from the chip list, users have no way to see or isolate
 * those rows — silent data loss. Cadence-based possibles (date=null) have
 * no concrete DOW and are correctly ignored.
 */
export function computeDayCounts(
  confirmed: { date: string }[],
  likely: { date: string }[],
  possible: { date: string | null }[] = [],
): { availableDays: Set<DayCode>; dayCounts: Partial<Record<DayCode, number>> } {
  const days = new Set<DayCode>();
  const counts: Partial<Record<DayCode, number>> = {};
  const bump = (dow: DayCode) => {
    days.add(dow);
    counts[dow] = (counts[dow] ?? 0) + 1;
  };
  for (const r of confirmed) bump(getDayCode(r.date));
  for (const r of likely) bump(getDayCode(r.date));
  for (const r of possible) {
    if (r.date) bump(getDayCode(r.date));
  }
  return { availableDays: days, dayCounts: counts };
}

/** Empty set = pass all. date=null is a cadence-based possible — always passes. */
export function passesDayFilter(
  dow: DayCode | null,
  selectedDays: Set<DayCode>,
): boolean {
  return selectedDays.size === 0 || dow === null || selectedDays.has(dow);
}

/**
 * Group all three result types into per-tier buckets in a single pass,
 * applying the day filter inline. Generics preserve the full result
 * shape so callers can render rich cards from the grouped output.
 */
export function groupResultsByTier<
  C extends { distanceTier: DistanceTier; date: string },
  L extends { distanceTier: DistanceTier; date: string },
  P extends { distanceTier: DistanceTier; date: string | null },
>({
  confirmed,
  likely,
  possible,
  selectedDays,
}: {
  confirmed: C[];
  likely: L[];
  possible: P[];
  selectedDays: Set<DayCode>;
}): Record<DistanceTier, { confirmed: C[]; likely: L[]; possible: P[] }> {
  const byTier: Record<DistanceTier, { confirmed: C[]; likely: L[]; possible: P[] }> = {
    nearby: { confirmed: [], likely: [], possible: [] },
    area: { confirmed: [], likely: [], possible: [] },
    drive: { confirmed: [], likely: [], possible: [] },
  };

  for (const r of confirmed) {
    if (passesDayFilter(getDayCode(r.date), selectedDays)) {
      byTier[r.distanceTier].confirmed.push(r);
    }
  }
  for (const r of likely) {
    if (passesDayFilter(getDayCode(r.date), selectedDays)) {
      byTier[r.distanceTier].likely.push(r);
    }
  }
  for (const r of possible) {
    const dow = r.date ? getDayCode(r.date) : null;
    if (passesDayFilter(dow, selectedDays)) {
      byTier[r.distanceTier].possible.push(r);
    }
  }
  return byTier;
}

/** Toggle membership of a single day in a new Set (immutable). */
export function toggleDay(prev: Set<DayCode>, day: DayCode): Set<DayCode> {
  const next = new Set(prev);
  if (next.has(day)) next.delete(day);
  else next.add(day);
  return next;
}
