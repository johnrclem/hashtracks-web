import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, chronoParseDate, fetchHTMLPage, parse12HourTime } from "../utils";

/**
 * Boulder Hash House Harriers (BH3 Boulder) Divi/WordPress blog scraper.
 *
 * Source: https://boulderh3.com/hashes/. Each `<article>` is one trail:
 *
 *   <h2 class="entry-title"><a>BH3 #968: A Farewell to the Dark Horse</a></h2>
 *   <div class="post-content"><p>WHEN: 03/06/2026 at 07:00PM <br /> WHERE: Arrowwood Park</p></div>
 *
 * Older posts use free-form titles with no "BH3 #N" prefix.
 */

const HASHES_URL = "https://boulderh3.com/hashes/";
const KENNEL_TAG = "bh3-co";

const TITLE_WITH_RUN_RE = /^BH3\s*#(\d+)\s*[:\-–]?\s*(.*)$/i;
const WHEN_RE = /WHEN:\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s*at\s*([\d:]+\s*(?:am|pm)))?/i;
// `bodyText` has all whitespace collapsed to single spaces (no newlines), so
// `.` is sufficient — no `s` flag needed (which would require es2018+).
const WHERE_RE = /WHERE:\s*(.*?)(?=\s*(?:WHEN|HASH\s*CASH|HARES?|ON-?ON)\s*:|$)/i;

/** Parse one `<article>` from the boulderh3.com/hashes index. */
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
    const parsed = Number.parseInt(titleMatch[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) runNumber = parsed;
    cleanTitle = titleMatch[2].trim() || undefined;
  } else {
    cleanTitle = titleText;
  }

  const $body = $article.find(".post-content").first().clone();
  $body.find("a.more-link").remove();
  $body.find("br").replaceWith(" ");
  const bodyText = $body.text().replace(/\s+/g, " ").trim();

  const whenMatch = WHEN_RE.exec(bodyText);
  if (!whenMatch) return null;
  const date = chronoParseDate(whenMatch[1], "en-US");
  if (!date) return null;
  const startTime = whenMatch[2] ? parse12HourTime(whenMatch[2]) : undefined;

  const whereMatch = WHERE_RE.exec(bodyText);
  const location = whereMatch?.[1].trim() || undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    title: cleanTitle,
    location,
    startTime,
    sourceUrl,
  };
}

/** Walk every `<article class="et_pb_post …">` on a hashes-index page. */
export function parseBoulderH3IndexPage($: CheerioAPI): RawEventData[] {
  const events: RawEventData[] = [];
  $("article.et_pb_post").each((_i, el) => {
    const event = parseBoulderH3Article($, el);
    if (event) events.push(event);
  });
  return events;
}

export class BoulderH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || HASHES_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events = parseBoulderH3IndexPage($);

    const result: ScrapeResult = {
      events,
      errors: [],
      structureHash,
      diagnosticContext: {
        url,
        articlesParsed: events.length,
        fetchDurationMs,
      },
    };
    return applyDateWindow(result, options?.days ?? 90);
  }
}
