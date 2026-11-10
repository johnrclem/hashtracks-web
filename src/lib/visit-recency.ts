/**
 * Privacy-light "is this a returning visitor?" signal for analytics.
 *
 * The browser stores only the local date of the last visit (`YYYY-MM-DD`) —
 * no identifier, no cookie — and each page load reports how long it has been
 * since then. This lets PostHog count daily unique browsers and new-vs-returning
 * visits for signed-out visitors without a persistent ID (PostHog runs with
 * `persistence: "memory"`, so its own anonymous ID resets on every page load).
 */

import { daysBetweenIsoDates } from "@/lib/travel/format";
import { localYmd } from "@/lib/travel/url";

export const LAST_VISIT_STORAGE_KEY = "ht_last_visit";

export type VisitRecency =
  | "new"
  | "same_day"
  | "returning_1_7d"
  | "returning_8_30d"
  | "returning_31d_plus"
  | "unknown";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Classify a visit given the stored last-visit date (or null) and today's `YYYY-MM-DD`. */
export function classifyVisit(lastVisit: string | null, today: string): VisitRecency {
  if (lastVisit === today) return "same_day";
  const days = lastVisit && DATE_KEY_RE.test(lastVisit) ? daysBetweenIsoDates(lastVisit, today) : Number.NaN;
  if (Number.isNaN(days)) return "new";
  // A stored date in the future means the device clock moved; count it as a recent return.
  if (days <= 7) return "returning_1_7d";
  if (days <= 30) return "returning_8_30d";
  return "returning_31d_plus";
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Read the stored last-visit date, classify this visit, and store today's date. Never throws. */
export function readAndRecordVisit(storage: StorageLike | null | undefined, now: Date): VisitRecency {
  if (!storage) return "unknown";
  try {
    const today = localYmd(now);
    const recency = classifyVisit(storage.getItem(LAST_VISIT_STORAGE_KEY), today);
    if (recency !== "same_day") storage.setItem(LAST_VISIT_STORAGE_KEY, today);
    return recency;
  } catch {
    // Storage blocked (privacy settings, sandboxed frames) — report unknown rather than guess.
    return "unknown";
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Per page load, but keyed by local date: a tab left open overnight
// re-classifies on the next day's first navigation.
let cached: { day: string; recency: VisitRecency } | null = null;
let firstMarkedDay: string | null = null;

/** Visit recency for today. Reads and updates storage once per local day per page load. */
export function getVisitRecency(now: Date = new Date()): VisitRecency {
  const today = localYmd(now);
  if (cached?.day !== today) {
    cached = { day: today, recency: readAndRecordVisit(browserStorage(), now) };
  }
  return cached.recency;
}

/**
 * Visit properties for the next `$pageview`. `first_visit_today` is true only
 * on the first pageview of the visitor's local day (once per page load, and
 * not when an earlier page load already counted today). Omitted when storage
 * is unavailable rather than guessed.
 */
export function nextPageviewVisitProperties(now: Date = new Date()): { first_visit_today?: boolean } {
  const recency = getVisitRecency(now);
  if (recency === "unknown") return {};
  const today = localYmd(now);
  const isFirst = firstMarkedDay !== today && recency !== "same_day";
  firstMarkedDay = today;
  return { first_visit_today: isFirst };
}
