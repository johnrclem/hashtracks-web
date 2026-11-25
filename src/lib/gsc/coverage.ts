/**
 * Indexed coverage of the kennel and region pages in the live sitemap (O1, "kennel + region URLs
 * in the sitemap with an indexed coverage state").
 *
 * The denominator is what the served sitemap lists, read from production, so it follows WS1's
 * sitemap changes (a plain `<urlset>` today, a sitemap index later) without a code change here.
 * Each hub URL gets one URL Inspection call. The property's quota is about 2,000 calls a day and
 * 600 a minute; this sweep makes at most {@link MAX_INSPECTIONS_PER_RUN} calls a week, paced
 * under the per-minute limit. When the sitemap lists more, consecutive weeks inspect consecutive
 * slices, so every URL is covered over a few weeks.
 */
import { DEFAULT_SITE_URL } from "@/lib/site-url";

import type { Gsc, InspectionResult } from "./client";

export const SITEMAP_URL = `${DEFAULT_SITE_URL}/sitemap.xml`;
export const MAX_INSPECTIONS_PER_RUN = 900;
const CONCURRENCY = 8;
/**
 * The sweep stops starting calls after this long, so the whole cron (route limit 300 s) still has
 * time to file its issue and email. Uninspected URLs are reported, and later weeks catch up.
 */
export const SWEEP_BUDGET_MS = 150_000;
/** ~8 calls a second at most, under the 600-a-minute quota. */
const MIN_SPACING_MS = 125;
const MAX_CHILD_SITEMAPS = 20;
/** This many failures in a row (no access, quota) end the sweep: the rest would fail the same way. */
const MAX_CONSECUTIVE_FAILURES = 5;
const FETCH_TIMEOUT_MS = 20_000;

/** `/kennels/<slug>` and `/kennels/region/<slug>`; not the `/kennels` index itself. */
export function isHubUrl(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return /^\/kennels\/(region\/)?[^/]+\/?$/.test(path) && path !== "/kennels/region" && path !== "/kennels/region/";
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

/** Every page URL in the sitemap at `url`, following one level of sitemap index. */
export async function readSitemapUrls(url = SITEMAP_URL, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const get = async (u: string) => {
    const res = await fetchImpl(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`sitemap ${u}: HTTP ${res.status}`);
    return res.text();
  };
  const root = await get(url);
  if (!/<sitemapindex/i.test(root)) return locs(root);
  const children = locs(root).slice(0, MAX_CHILD_SITEMAPS);
  const pages = await Promise.all(children.map(get));
  return pages.flatMap(locs);
}

export interface HubCoverage {
  /** Hub URLs in the sitemap: the denominator. */
  hubUrls: number;
  inspected: number;
  indexed: number;
  /** Inspection calls that failed (quota, permission); not counted as indexed or not. */
  failed: number;
  /** Count per Google coverage state among the inspected URLs. */
  byState: Record<string, number>;
  /** URLs not reached: the time budget ran out, or the sweep stopped after repeated failures. */
  skipped: number;
  /** Which slice of the hub list this run covered, when it holds more than one run's quota. */
  slice: { start: number; end: number } | null;
}

/** The slice this week inspects: consecutive weeks walk the list when it exceeds one run's quota. */
export function weeklySlice(total: number, weekIndex: number, cap = MAX_INSPECTIONS_PER_RUN): { start: number; end: number } | null {
  if (total <= cap) return null;
  const start = (weekIndex * cap) % total;
  return { start, end: Math.min(total, start + cap) };
}

export async function inspectHubCoverage(
  gsc: Gsc,
  now: Date,
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; budgetMs?: number; clock?: () => number } = {},
): Promise<HubCoverage> {
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + (deps.budgetMs ?? SWEEP_BUDGET_MS);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const hubs = [...new Set((await readSitemapUrls(SITEMAP_URL, deps.fetchImpl)).filter(isHubUrl))].sort((a, b) => a.localeCompare(b));
  const weekIndex = Math.floor(now.getTime() / (7 * 86_400_000));
  const slice = weeklySlice(hubs.length, weekIndex);
  const targets = slice ? hubs.slice(slice.start, slice.end) : hubs;

  const results: Array<InspectionResult | null> = [];
  let next = 0;
  let lastStart = 0;
  let failStreak = 0;
  const canContinue = () => next < targets.length && clock() < deadline && failStreak < MAX_CONSECUTIVE_FAILURES;
  /** One paced inspection, then the worker's next; each worker runs its calls one after another. */
  async function worker(): Promise<void> {
    if (!canContinue()) return;
    const url = targets[next++];
    const wait = lastStart + MIN_SPACING_MS - clock();
    lastStart = clock() + Math.max(0, wait);
    if (wait > 0) await sleep(wait);
    const result = await gsc.inspect(url).catch(() => null);
    results.push(result);
    failStreak = result ? 0 : failStreak + 1;
    return worker();
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r): r is InspectionResult => r !== null);
  if (ok.length === 0 && results.length > 0) {
    // Every call failed (no access to the property yet, quota): unknown, not "0 indexed".
    throw new Error(`all ${results.length} URL inspections failed`);
  }
  const byState: Record<string, number> = {};
  for (const r of ok) {
    const state = r.coverageState || r.verdict;
    byState[state] = (byState[state] ?? 0) + 1;
  }
  return {
    hubUrls: hubs.length,
    inspected: ok.length,
    indexed: ok.filter((r) => r.verdict === "PASS").length,
    failed: results.length - ok.length,
    skipped: targets.length - results.length,
    byState,
    slice,
  };
}
