/**
 * Multi-destination view grouping helpers for Travel Mode results.
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

export interface LegBand<T extends TaggedRow> {
  destinationIndex: number;
  destinationLabel: string | null;
  rows: T[];
}

export interface DayGroupWithLegs<T extends TaggedRow> {
  /** YYYY-MM-DD or null for cadence-based (undated) rows. */
  dateKey: string | null;
  /** True when the day contains rows from 2+ stops — UI renders LEG sub-bands + ✈ perforation. */
  hasOverlap: boolean;
  /** One band per distinct `destinationIndex`, position-ordered. Length 1 on non-overlap days. */
  legs: LegBand<T>[];
}

/**
 * Group rows by calendar day. For each day, split rows by
 * `destinationIndex` into leg-bands (position-ordered). A day with
 * 2+ distinct stop indexes is marked `hasOverlap: true` so the UI
 * can render LEG sub-bands with a ✈ perforation; single-stop days
 * render flat.
 *
 * Rows with `date === null` (cadence-based possibles with no fixed
 * date) collapse into a single `dateKey: null` group sorted last.
 */
export function groupByDayWithLegs<T extends TaggedRow>(rows: T[]): DayGroupWithLegs<T>[] {
  const byDay = new Map<string | null, Map<number, LegBand<T>>>();

  for (const row of rows) {
    const dayKey = row.date ? row.date.slice(0, 10) : null;
    let legsForDay = byDay.get(dayKey);
    if (!legsForDay) {
      legsForDay = new Map();
      byDay.set(dayKey, legsForDay);
    }
    let band = legsForDay.get(row.destinationIndex);
    if (!band) {
      band = {
        destinationIndex: row.destinationIndex,
        destinationLabel: row.destinationLabel,
        rows: [],
      };
      legsForDay.set(row.destinationIndex, band);
    }
    band.rows.push(row);
  }

  const groups: DayGroupWithLegs<T>[] = [];
  for (const [dateKey, legsMap] of byDay.entries()) {
    const legs = [...legsMap.values()].sort(
      (a, b) => a.destinationIndex - b.destinationIndex,
    );
    groups.push({ dateKey, hasOverlap: legs.length > 1, legs });
  }

  return groups.sort((a, b) => {
    if (a.dateKey === null) return 1;
    if (b.dateKey === null) return -1;
    return a.dateKey.localeCompare(b.dateKey);
  });
}

export interface DestinationSection<T extends TaggedRow> {
  destinationIndex: number;
  destinationLabel: string | null;
  rows: T[];
}

/**
 * Partition rows by `destinationIndex` for the by-destination view.
 * Returns one section per distinct stop the rows touched,
 * position-ordered. Stops with zero rows are omitted so the UI
 * doesn't render empty columns — the caller supplies the per-stop
 * emptyState separately if it wants to render a placeholder.
 */
export function groupByDestination<T extends TaggedRow>(
  rows: T[],
): DestinationSection<T>[] {
  const byStop = new Map<number, DestinationSection<T>>();
  for (const row of rows) {
    let section = byStop.get(row.destinationIndex);
    if (!section) {
      section = {
        destinationIndex: row.destinationIndex,
        destinationLabel: row.destinationLabel,
        rows: [],
      };
      byStop.set(row.destinationIndex, section);
    }
    section.rows.push(row);
  }
  return [...byStop.values()].sort(
    (a, b) => a.destinationIndex - b.destinationIndex,
  );
}
