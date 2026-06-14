import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

/**
 * bangkokhash.com's WAF 403s bot-style User-Agents site-wide, so default to a
 * plain desktop-browser UA (verified against the live /thursday + /siamsunday
 * archives). Callers can override via `headers` if a sub-site needs something
 * different.
 */
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html",
};

/**
 * Shared archive walker for bangkokhash.com-style Joomla "Run Archives" backfills.
 *
 * The pattern (used by BTH3, S2H3, …): fetch a single `?limit=0` "show-all"
 * index page, regex out the per-run detail links, then fetch each detail page
 * through a bounded concurrency pool and parse it with the kennel's adapter
 * parser. Each kennel differs only in its base origin, index URL, detail-link
 * regex, request headers, and the parse closure — everything below is identical,
 * so it lives here instead of being copy-pasted per script.
 */
export interface JoomlaArchiveWalkOptions {
  /** Origin to prepend to matched relative detail paths, e.g. "https://www.bangkokhash.com". */
  baseUrl: string;
  /** Full `?limit=0` archive index URL. */
  indexUrl: string;
  /** Global (`/g`) regex matching the relative detail paths in the index HTML. */
  detailUrlRe: RegExp;
  /** Request header override. Defaults to a desktop-browser UA (see DEFAULT_HEADERS). */
  headers?: Record<string, string>;
  /** Parse one detail page's HTML into a RawEventData (or null to skip). */
  parse: (html: string, url: string) => RawEventData | null;
  /** Concurrent detail fetches. Default 4. */
  concurrency?: number;
  /** Abort after this many total fetch failures. Default 10. */
  maxFailures?: number;
}

export async function walkJoomlaArchive(
  opts: JoomlaArchiveWalkOptions,
): Promise<RawEventData[]> {
  const { baseUrl, indexUrl, detailUrlRe, parse } = opts;
  const headers = opts.headers ?? DEFAULT_HEADERS;
  const concurrency = opts.concurrency ?? 4;
  const maxFailures = opts.maxFailures ?? 10;

  async function fetchText(url: string): Promise<string | null> {
    const res = await safeFetch(url, { headers });
    if (!res.ok) {
      console.warn(`  HTTP ${res.status} for ${url}`);
      return null;
    }
    return res.text();
  }

  console.log(`  Fetching index: ${indexUrl}`);
  const indexHtml = await fetchText(indexUrl);
  if (!indexHtml) throw new Error(`Failed to fetch archive index: ${indexUrl}`);
  const matches = indexHtml.match(detailUrlRe) ?? [];
  const urls = [...new Set(matches)]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => `${baseUrl}${path}`);
  console.log(`  Discovered ${urls.length} detail URLs`);

  const events: RawEventData[] = [];
  let failures = 0;
  let nextIdx = 0;
  let processed = 0;
  let aborted = false;
  let abortReason = "";

  async function worker(): Promise<void> {
    while (!aborted) {
      const i = nextIdx++;
      if (i >= urls.length) return;
      const url = urls[i];
      const html = await fetchText(url);
      if (!html) {
        failures++;
        if (failures >= maxFailures) {
          aborted = true;
          abortReason = `${failures} total fetch failures (limit ${maxFailures})`;
        }
        continue;
      }
      const event = parse(html, url);
      if (event) {
        events.push(event);
      } else {
        console.warn(`  Skipped (no parse): ${url}`);
      }
      processed++;
      if (processed % 25 === 0) {
        console.log(`  Progress: ${processed}/${urls.length} fetched, ${events.length} parsed`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  if (aborted) throw new Error(`Aborted: ${abortReason}`);
  events.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  Final: ${processed}/${urls.length} fetched, ${events.length} parsed`);
  return events;
}
