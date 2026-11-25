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
import type { Gsc, InspectionResult } from "./client";

export const SITEMAP_URL = "https://www.hashtracks.xyz/sitemap.xml";
export const MAX_INSPECTIONS_PER_RUN = 900;
const CONCURRENCY = 4;
/** ~8 calls a second at most, under the 600-a-minute quota. */
const MIN_SPACING_MS = 125;
const MAX_CHILD_SITEMAPS = 20;
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
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<HubCoverage> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const hubs = [...new Set((await readSitemapUrls(SITEMAP_URL, deps.fetchImpl)).filter(isHubUrl))].sort();
  const weekIndex = Math.floor(now.getTime() / (7 * 86_400_000));
  const slice = weeklySlice(hubs.length, weekIndex);
  const targets = slice ? hubs.slice(slice.start, slice.end) : hubs;

  const results: Array<InspectionResult | null> = [];
  let next = 0;
  let lastStart = 0;
  async function worker() {
    while (next < targets.length) {
      const url = targets[next++];
      const wait = lastStart + MIN_SPACING_MS - Date.now();
      lastStart = Date.now() + Math.max(0, wait);
      if (wait > 0) await sleep(wait);
      try {
        results.push(await gsc.inspect(url));
      } catch {
        results.push(null);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r): r is InspectionResult => r !== null);
  const byState: Record<string, number> = {};
  for (const r of ok) byState[r.coverageState || r.verdict] = (byState[r.coverageState || r.verdict] ?? 0) + 1;
  return {
    hubUrls: hubs.length,
    inspected: ok.length,
    indexed: ok.filter((r) => r.verdict === "PASS").length,
    failed: results.length - ok.length,
    byState,
    slice,
  };
}
