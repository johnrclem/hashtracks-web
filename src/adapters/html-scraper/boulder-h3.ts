import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { parse12HourTime } from "../utils";

/**
 * Boulder Hash House Harriers (BH3 Boulder) Divi/WordPress blog scraper.
 *
 * Source: https://boulderh3.com/hashes/ — index of recent + upcoming runs.
 * Each post is one trail; structured fields are inlined in the post body:
 *
 *   <h2 class="entry-title"><a href="…">BH3 #968: A Farewell to the Dark Horse</a></h2>
 *   <div class="post-content"><p>WHEN: 03/06/2026 at 07:00PM <br /> WHERE: Arrowwood Park  </p></div>
 *
 * Phase A (this adapter) reads page 1 only — recent + upcoming events.
 * Phase B (`scripts/backfill-bh3-co-history.ts`) walks pages 2–20 for the
 * archive and reuses `parseBoulderH3Article`.
 */

const HASHES_URL = "https://boulderh3.com/hashes/";
const KENNEL_TAG = "bh3-co";

/**
 * Title patterns. Recent posts use "BH3 #968: A Farewell to the Dark Horse",
 * but older posts often use a free-form title with no run-number prefix
 * (e.g. "Closest and GooSh Save the Day(light)"). We accept both.
 */
const TITLE_WITH_RUN_RE = /^BH3\s*#(\d+)\s*[:\-–]?\s*(.*)$/i;

/** Body field pattern: "WHEN: 03/06/2026 at 07:00PM" — date is required, time optional. */
const WHEN_RE = /WHEN:\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s*at\s*([\d:]+\s*(?:am|pm)))?/i;

/** Body field pattern: "WHERE: Arrowwood Park" — runs to end of paragraph or next field. */
const WHERE_RE = /WHERE:\s*([^]*?)(?=\s*(?:WHEN|HASH\s*CASH|HARES?|ON-?ON)\s*:|$)/i;

/**
 * Parse one `<article>` from the boulderh3.com/hashes index.
 * Exported for Phase B backfill reuse + unit testing.
 */
export function parseBoulderH3Article(
  $: CheerioAPI,
  article: ReturnType<CheerioAPI>[number],
): RawEventData | null {
  const $article = $(article);

  const titleLink = $article.find("h2.entry-title a").first();
  const titleText = titleLink.text().trim();
  const sourceUrl = titleLink.attr("href");
  if (!titleText || !sourceUrl) return null;

  const titleMatch = TITLE_WITH_RUN_RE.exec(titleText);
  let runNumber: number | undefined;
  let cleanTitle: string | undefined;
  if (titleMatch) {
    runNumber = Number.parseInt(titleMatch[1], 10);
    cleanTitle = titleMatch[2].trim() || undefined;
  } else {
    // Free-form title with no "BH3 #N" prefix.
    cleanTitle = titleText;
  }

  // Body text: drop the "read more" link, collapse <br> to spaces so regexes
  // can match across the WHEN/WHERE line break.
  const $body = $article.find(".post-content").first().clone();
  $body.find("a.more-link").remove();
  const bodyText = cheerio
    .load(($body.html() ?? "").replace(/<br\s*\/?>/gi, " "))
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const whenMatch = WHEN_RE.exec(bodyText);
  if (!whenMatch) return null;
  const date = parseSlashDate(whenMatch[1]);
  if (!date) return null;
  const startTime = whenMatch[2] ? parse12HourTime(whenMatch[2]) : undefined;

  const whereMatch = WHERE_RE.exec(bodyText);
  const location = whereMatch?.[1].trim() || undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber: runNumber && runNumber > 0 ? runNumber : undefined,
    title: cleanTitle,
    location,
    startTime,
    sourceUrl,
  };
}

/** Parse "MM/DD/YYYY" → "YYYY-MM-DD"; reject invalid month/day. */
function parseSlashDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const month = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Walk every `<article class="et_pb_post …">` on a hashes-index page. Exported for Phase B. */
export function parseBoulderH3IndexPage(html: string): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $("article.et_pb_post").each((_i, el) => {
    const event = parseBoulderH3Article($, el);
    if (event) events.push(event);
  });
  return events;
}

export class BoulderH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || HASHES_URL;
    const fetchStart = Date.now();
    const errors: string[] = [];

    try {
      const res = await safeFetch(url, { headers: { Accept: "text/html" } });
      if (!res.ok) {
        return { events: [], errors: [`HTTP ${res.status}`] };
      }
      const html = await res.text();
      const events = parseBoulderH3IndexPage(html);
      return {
        events,
        errors,
        diagnosticContext: {
          url,
          articlesParsed: events.length,
          fetchDurationMs: Date.now() - fetchStart,
        },
      };
    } catch (err) {
      return { events: [], errors: [`Fetch failed: ${err}`] };
    }
  }
}
