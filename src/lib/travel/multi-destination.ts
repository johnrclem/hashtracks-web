/**
 * Multi-destination view bucketing helpers for Travel Mode results.
 *
 * Two views:
 *   - Day-by-day: days as the top-level axis; overlap days split into
 *     LEG sub-bands (one band per distinct destinationIndex).
 *   - By-destination: stops as the top-level axis; each stop section
 *     collects rows tagged with its index.
 *
 * Inputs are already tagged with `destinationIndex` by the search
 * service. These helpers are pure (no React, no I/O).
 */

export type MultiDestView = "day-by-day" | "by-destination";

interface TaggedRow {
  destinationIndex: number;
  destinationLabel: string | null;
  date: string | null;
}

export interface DayStopBand<C, L, P> {
  label: string | null;
  confirmed: C[];
  likely: L[];
  possible: P[];
}

export interface DayBucket<C, L, P> {
  dateKey: string | null;
  bandsByStop: Map<number, DayStopBand<C, L, P>>;
}

interface RowBundle<C extends TaggedRow, L extends TaggedRow, P extends TaggedRow> {
  confirmed: C[];
  likely: L[];
  possible: P[];
}

/**
 * Bucket rows into `Map<dateKey, Map<stopIndex, band>>` in one pass per
 * row kind. Each band collects confirmed + likely + possible for that
 * (day, stop) cell. Day-by-day rendering reads these directly — no
 * per-cell `.find()` lookups.
 *
 * Date keys are YYYY-MM-DD (sliced from ISO timestamps so event rows
 * and cadence-null possibles collapse correctly). Days sort
 * chronologically; cadence-based rows (`date === null`) sort last.
 */
export function bucketDays<C extends TaggedRow, L extends TaggedRow, P extends TaggedRow>(
  rows: RowBundle<C, L, P>,
): DayBucket<C, L, P>[] {
  const byDay = new Map<string | null, Map<number, DayStopBand<C, L, P>>>();
  const touch = (dateKey: string | null, stop: number, label: string | null) => {
    let forDay = byDay.get(dateKey);
    if (!forDay) {
      forDay = new Map();
      byDay.set(dateKey, forDay);
    }
    let band = forDay.get(stop);
    if (!band) {
      band = { label, confirmed: [], likely: [], possible: [] };
      forDay.set(stop, band);
    } else if (band.label === null && label !== null) {
      band.label = label;
    }
    return band;
  };
  for (const r of rows.confirmed) {
    touch(r.date?.slice(0, 10) ?? null, r.destinationIndex, r.destinationLabel).confirmed.push(r);
  }
  for (const r of rows.likely) {
    touch(r.date?.slice(0, 10) ?? null, r.destinationIndex, r.destinationLabel).likely.push(r);
  }
  for (const r of rows.possible) {
    const key = r.date ? r.date.slice(0, 10) : null;
    touch(key, r.destinationIndex, r.destinationLabel).possible.push(r);
  }
  return [...byDay.entries()]
    .map(([dateKey, bandsByStop]) => ({ dateKey, bandsByStop }))
    .sort((a, b) => {
      if (a.dateKey === null) return 1;
      if (b.dateKey === null) return -1;
      return a.dateKey.localeCompare(b.dateKey);
    });
}

export interface StopBucket<C, L, P> {
  confirmed: C[];
  likely: L[];
  possible: P[];
}

/**
 * Partition rows by `destinationIndex` in one pass per row kind. Caller
 * supplies stops to render (typically `results.destinations`) so the map
 * is keyed for O(1) `.get(index)` lookup — no per-stop linear scan.
 * Stops with zero rows have no entry in the map.
 */
export function bucketStops<C extends TaggedRow, L extends TaggedRow, P extends TaggedRow>(
  rows: RowBundle<C, L, P>,
): Map<number, StopBucket<C, L, P>> {
  const byStop = new Map<number, StopBucket<C, L, P>>();
  const touch = (idx: number): StopBucket<C, L, P> => {
    let b = byStop.get(idx);
    if (!b) {
      b = { confirmed: [], likely: [], possible: [] };
      byStop.set(idx, b);
    }
    return b;
  };
  for (const r of rows.confirmed) touch(r.destinationIndex).confirmed.push(r);
  for (const r of rows.likely) touch(r.destinationIndex).likely.push(r);
  for (const r of rows.possible) touch(r.destinationIndex).possible.push(r);
  return byStop;
}
