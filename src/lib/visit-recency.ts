/**
 * Privacy-light "is this a returning visitor?" signal for analytics.
 *
 * The browser stores only the local date of the last visit (`YYYY-MM-DD`) —
 * no identifier, no cookie — and each page load reports how long it has been
 * since then. This lets PostHog count daily unique browsers and new-vs-returning
 * visits for signed-out visitors without a persistent ID (PostHog runs with
 * `persistence: "memory"`, so its own anonymous ID resets on every page load).
 */

export const LAST_VISIT_STORAGE_KEY = "ht_last_visit";

export type VisitRecency =
  | "new"
  | "same_day"
  | "returning_1_7d"
  | "returning_8_30d"
  | "returning_31d_plus"
  | "unknown";

export interface VisitContext {
  recency: VisitRecency;
  /** True only on the first page load of the visitor's local calendar day. Undefined when storage is unavailable. */
  firstVisitToday: boolean | undefined;
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Local calendar date as `YYYY-MM-DD`. */
export function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`), or null if either is malformed. */
export function daysBetween(from: string, to: string): number | null {
  const a = DATE_KEY_RE.exec(from);
  const b = DATE_KEY_RE.exec(to);
  if (!a || !b) return null;
  const fromUtc = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const toUtc = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  if (Number.isNaN(fromUtc) || Number.isNaN(toUtc)) return null;
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

/** Classify a visit given the stored last-visit date (or null) and today's date key. */
export function classifyVisit(lastVisit: string | null, today: string): VisitContext {
  if (lastVisit === today) return { recency: "same_day", firstVisitToday: false };

  const days = lastVisit === null ? null : daysBetween(lastVisit, today);
  if (days === null) return { recency: "new", firstVisitToday: true };
  // A stored date in the future means the device clock moved; count it as a recent return.
  if (days <= 7) return { recency: "returning_1_7d", firstVisitToday: true };
  if (days <= 30) return { recency: "returning_8_30d", firstVisitToday: true };
  return { recency: "returning_31d_plus", firstVisitToday: true };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Read the stored last-visit date, classify this visit, and store today's date. Never throws. */
export function readAndRecordVisit(storage: StorageLike | null | undefined, now: Date): VisitContext {
  if (!storage) return { recency: "unknown", firstVisitToday: undefined };
  try {
    const today = localDateKey(now);
    const context = classifyVisit(storage.getItem(LAST_VISIT_STORAGE_KEY), today);
    if (context.recency !== "same_day") storage.setItem(LAST_VISIT_STORAGE_KEY, today);
    return context;
  } catch {
    // Storage blocked (privacy settings, sandboxed frames) — report unknown rather than guess.
    return { recency: "unknown", firstVisitToday: undefined };
  }
}

let cachedContext: VisitContext | null = null;

/**
 * Visit context for the current page load. Reads and updates storage once, so
 * client-side navigations within the same load don't re-count the visit.
 */
export function getVisitContext(): VisitContext {
  if (cachedContext) return cachedContext;
  let storage: StorageLike | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }
  cachedContext = readAndRecordVisit(storage, new Date());
  return cachedContext;
}

/** Test-only: clear the per-page-load cache. */
export function __resetVisitContextCache(): void {
  cachedContext = null;
}
