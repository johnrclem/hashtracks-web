import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { applyDateWindow, fetchHTMLPage, normalizeHaresField, validateSourceConfig } from "../utils";

/**
 * Shared adapter for goHash.app-hosted kennel sites.
 *
 * goHash is a Vue/React SaaS platform used by several Malaysian and
 * international hashes. Every tenant is served from its own custom domain
 * but the SSR page embeds a `window.__INITIAL_STATE__ = {...}` JSON blob
 * containing the runs array. There is also a
 * `<script type="application/ld+json">` SportsEvent schema as a safety
 * net — we prefer `__INITIAL_STATE__` because it has richer fields
 * (run_number, runsite_url, runsite_links).
 *
 * Runs shape inside `__INITIAL_STATE__.runs.runs[]`:
 *
 *     {
 *       run_number: 3167,
 *       run_date: "2026-04-13",        // already ISO
 *       run_name: "..." | null,
 *       run_group: "..." | null,
 *       run_group_label: "..." | null,
 *       hare: "5 Minutes",             // string (may contain commas)
 *       runsite: "Kali Corner",
 *       runsite_url: "https://maps.app.goo.gl/...",
 *       runsite_links: [{ kind: "google", url: "...", label: "Google Maps" }, ...],
 *     }
 *
 * **Config shape** (`source.config`):
 * ```ts
 * { kennelTag: "penangh3", startTime?: "17:30", harelinePath?: "/hareline/upcoming" }
 * ```
 * If `harelinePath` is omitted the adapter defaults to `/hareline/upcoming`
 * appended to `source.url`.
 *
 * Used by: Penang H3 (penanghash3.org, 1965, 3rd-oldest in the world) and
 * Hash House Harriets Penang (hashhouseharrietspenang.com, 1972).
 */

export interface GoHashConfig {
  kennelTag: string;
  startTime?: string;
  harelinePath?: string;
}

interface GoHashRunSiteLink {
  id?: string;
  label?: string;
  kind?: string;
  url?: string;
}

interface GoHashRun {
  run_number?: number;
  run_date?: string;
  run_name?: string | null;
  run_group?: string | null;
  run_group_label?: string | null;
  hare?: string | null;
  runsite?: string | null;
  runsite_url?: string | null;
  runsite_links?: GoHashRunSiteLink[] | null;
}

interface GoHashInitialState {
  runs?: {
    runs?: GoHashRun[];
  };
}

/**
 * Extract the `__INITIAL_STATE__` JSON blob from an SSR HTML page using a
 * brace-matching scan. Returns null if the marker is missing or the JSON
 * is not balanced.
 *
 * Exported for unit testing.
 */
export function extractInitialState(html: string): GoHashInitialState | null {
  const marker = "window.__INITIAL_STATE__";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;
  const eqIdx = html.indexOf("=", markerIdx);
  if (eqIdx === -1) return null;

  // Find the first `{` after the `=`
  let start = eqIdx + 1;
  while (start < html.length && html[start] !== "{") start++;
  if (start >= html.length) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    return JSON.parse(html.slice(start, end)) as GoHashInitialState;
  } catch {
    return null;
  }
}

/**
 * Convert a single goHash `runs[]` entry into a RawEventData. Returns null
 * when `run_date` is missing or unparseable — those are always fatal
 * because the date is the minimum viable field for downstream dedup.
 *
 * Exported for unit testing.
 */
export function parseGoHashRun(
  run: GoHashRun,
  config: GoHashConfig,
  sourceUrl: string,
): RawEventData | null {
  const rawDate = run.run_date?.trim();
  if (!rawDate) return null;
  // Expect ISO date "YYYY-MM-DD" — validate strictly
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDate);
  if (!m) return null;

  const hares = normalizeHaresField(run.hare);

  const location = run.runsite?.trim() || undefined;
  const locationUrl = run.runsite_url?.trim() || undefined;

  const externalLinks: { url: string; label: string }[] = [];
  if (Array.isArray(run.runsite_links)) {
    for (const link of run.runsite_links) {
      if (!link?.url || typeof link.url !== "string") continue;
      // Skip the one that already landed in locationUrl
      if (link.url === locationUrl) continue;
      externalLinks.push({
        url: link.url,
        label: link.label?.trim() || link.kind || "Link",
      });
    }
  }

  const title = [run.run_name, run.run_group_label, run.run_group]
    .find((s) => typeof s === "string" && s.trim().length > 0)
    ?.trim();

  return {
    date: rawDate,
    kennelTag: config.kennelTag,
    runNumber: Number.isFinite(run.run_number) ? (run.run_number as number) : undefined,
    title,
    hares,
    location,
    locationUrl,
    startTime: config.startTime,
    sourceUrl,
    externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
  };
}

/** Resolve the full hareline URL the adapter should fetch. */
function resolveHarelineUrl(baseUrl: string, harelinePath: string): string {
  if (/^https?:/.test(harelinePath)) return harelinePath;
  // Trim trailing slash from base, leading slash from path
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = harelinePath.startsWith("/") ? harelinePath : `/${harelinePath}`;
  return cleanBase + cleanPath;
}

export class GoHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<GoHashConfig>(
      source.config,
      "GoHashAdapter",
      { kennelTag: "string" },
    );
    const baseUrl = source.url;
    if (!baseUrl) {
      return { events: [], errors: ["GoHashAdapter: source.url is required"] };
    }

    const url = resolveHarelineUrl(baseUrl, config.harelinePath ?? "/hareline/upcoming");
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const state = extractInitialState(page.html);
    if (!state) {
      const message = "GoHashAdapter: __INITIAL_STATE__ not found in page HTML";
      const errorDetails: ErrorDetails = {
        parse: [{ row: 0, error: message, rawText: page.html.slice(0, 500) }],
      };
      return { events: [], errors: [message], errorDetails };
    }

    const rawRuns = state.runs?.runs ?? [];
    const events: RawEventData[] = [];
    let skipped = 0;
    for (const run of rawRuns) {
      const event = parseGoHashRun(run, config, url);
      if (event) events.push(event);
      else skipped++;
    }

    const days = options?.days ?? source.scrapeDays ?? 180;
    return applyDateWindow(
      {
        events,
        errors: [],
        structureHash: page.structureHash,
        diagnosticContext: {
          fetchMethod: "gohash-initial-state",
          runsFound: rawRuns.length,
          runsSkipped: skipped,
          eventsParsed: events.length,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
