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

/**
 * Properties for a `$pageview`. Only the first pageview of a page load can be
 * the visitor's first of the day; later client-side navigations report false.
 * When storage was unavailable the property is omitted rather than guessed.
 */
export function pageviewVisitProperties(
  recency: VisitRecency,
  isFirstPageviewOfLoad: boolean,
): { first_visit_today?: boolean } {
  if (recency === "unknown") return {};
  return { first_visit_today: isFirstPageviewOfLoad && recency !== "same_day" };
}

let cachedRecency: VisitRecency | null = null;

/**
 * Visit recency for the current page load. Reads and updates storage once, so
 * client-side navigations within the same load don't re-count the visit.
 */
export function getVisitRecency(): VisitRecency {
  if (cachedRecency) return cachedRecency;
  let storage: StorageLike | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }
  cachedRecency = readAndRecordVisit(storage, new Date());
  return cachedRecency;
}
