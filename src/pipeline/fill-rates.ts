import type { RawEventData } from "@/adapters/types";

/** Per-field population percentages (0–100) for a batch of scraped events. */
export interface FieldFillRates {
  title: number; // 0-100
  location: number;
  hares: number;
  startTime: number;
  runNumber: number;
}

/**
 * Compute field fill rates (0-100%) for a batch of scraped events.
 * Used to populate ScrapeLog quality metrics.
 */
export function computeFillRates(events: RawEventData[]): FieldFillRates {
  if (events.length === 0) {
    return { title: 0, location: 0, hares: 0, startTime: 0, runNumber: 0 };
  }

  const n = events.length;
  const pct = (count: number) => Math.round((count / n) * 100);

  return {
    title: pct(events.filter((e) => e.title).length),
    location: pct(events.filter((e) => e.location).length),
    hares: pct(events.filter((e) => e.hares).length),
    startTime: pct(events.filter((e) => e.startTime).length),
    runNumber: pct(events.filter((e) => e.runNumber != null).length),
  };
}
