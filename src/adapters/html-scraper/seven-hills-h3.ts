import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime, decodeEntities } from "../utils";

/**
 * Seven Hills Hash House Harriers (7H4) Google Sites adapter.
 *
 * sites.google.com/view/7h4/home renders exactly one trail at a time — the
 * current/upcoming one, with labeled fields (TRAIL #N, Hares:, Start:, etc.).
 * This adapter complements the STATIC_SCHEDULE source (which generates
 * synthetic weekly Wednesday events) by emitting a single enriched event per
 * scrape. The merge pipeline will prefer this source's values whenever the
 * dates match.
 *
 * Page structure (trimmed): all the data lives in body text once the Google
 * Sites chrome is stripped, so we flatten the body to a single string and
 * run labeled-field regexes against it. The surface is small and stable.
 *
 * Issues: #508 (stale titles), #509 (missing fields), #510 (source gap),
 * #511 (Saturday specials via the current-trail slot).
 */

/** "TRAIL #2005" */
const TRAIL_NUMBER_RE = /TRAIL\s*#\s*(\d+)/i;
/** Day names used for injecting a split before the date phrase. */
const DATE_SPLIT_RE = /(?<!\n)(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/g;
/** Known field labels on the 7H4 page that need a preceding newline so value regexes don't run past them. */
const FIELD_LABEL_SPLIT_RE = /(?<!\n)(Start:|Hares?:|Beer\s*Meister:|Cost:|Shiggy\s*Level:|Special\s*Instructions:|On[\s-]*On)/g;
/** "Saturday April 4, 2026 @ 2pm" — captures the leading date phrase. */
const DATE_PHRASE_RE = /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i;
/** "@ 2pm" / "@ 2:30 PM" — minutes optional. Captured time is normalized into `HH:MM am/pm` before parsing. */
const TIME_AT_RE = /@\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i;
/** "Hares: Frodo & Snatch" — up to the next line / label / EOD. */
const HARES_RE = /Hares?:\s*([^\n]+)/i;
/** "Start: 442 S Five Forks Road Monroe, VA" — up to the next line / label / EOD. */
const START_RE = /Start:\s*([^\n]+)/i;

interface ParsedTrail {
  runNumber?: number;
  title?: string;
  date: string;
  startTime?: string;
  hares?: string;
  location?: string;
}

/**
 * Extract the one upcoming trail from the 7H4 Google Sites HTML. Returns null
 * if the page doesn't contain a recognizable trail block (e.g., during a
 * between-trails lull or a page redesign).
 */
export function parseSevenHillsPage(html: string): ParsedTrail | null {
  const $ = cheerio.load(html);
  // Collapse the whole body to a single space-normalized string, then inject
  // newlines before known field labels and day-of-week tokens so field values
  // don't run into each other (the live page glues them with no separator).
  const bodyText = decodeEntities($("body").text())
    .replaceAll(/\s+/g, " ")
    .replaceAll(FIELD_LABEL_SPLIT_RE, "\n$1")
    .replaceAll(DATE_SPLIT_RE, "\n$1")
    .trim();

  const trailMatch = TRAIL_NUMBER_RE.exec(bodyText);
  if (!trailMatch) return null;
  const runNumber = parseInt(trailMatch[1], 10);

  const dateMatch = DATE_PHRASE_RE.exec(bodyText);
  if (!dateMatch) return null;
  const date = chronoParseDate(dateMatch[1], "en-US", new Date(), { forwardDate: true });
  if (!date) return null;

  // Normalize @-time captures into "H:MM am/pm" form so parse12HourTime's
  // stricter colon-required regex accepts them ("2pm" → "2:00pm").
  const timeMatch = TIME_AT_RE.exec(bodyText);
  let startTime: string | undefined;
  if (timeMatch) {
    const hour = timeMatch[1];
    const minutes = timeMatch[2] ?? "00";
    const ampm = timeMatch[3];
    startTime = parse12HourTime(`${hour}:${minutes} ${ampm}`);
  }

  const haresMatch = HARES_RE.exec(bodyText);
  const hares = haresMatch?.[1]?.trim() || undefined;

  const startMatch = START_RE.exec(bodyText);
  const location = startMatch?.[1]?.trim() || undefined;

  // Trail name lives between "TRAIL #N" and the date phrase. It's decorated
  // with emoji on the live page (e.g., "🍻 ~🌷 🐰 Peter CottonTrail 🐰") and
  // we strip those along with any leading/trailing punctuation.
  let title: string | undefined;
  const nameStart = trailMatch.index + trailMatch[0].length;
  const nameEnd = dateMatch.index;
  if (nameEnd > nameStart) {
    const rawName = bodyText.slice(nameStart, nameEnd);
    title = rawName
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .replace(/[~\-!]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim() || undefined;
  }

  return { runNumber, title, date, startTime, hares, location };
}

/**
 * 7H4 Google Sites HTML scraper. Emits at most one event per scrape (the
 * current/upcoming trail from the homepage).
 */
export class SevenHillsH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source): Promise<ScrapeResult> {
    const url = source.url || "https://sites.google.com/view/7h4/home";
    const errorDetails: ErrorDetails = {};
    const errors: string[] = [];

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const parsed = parseSevenHillsPage(html);

    if (!parsed) {
      errors.push("No trail block found on the 7H4 Google Sites page");
      errorDetails.parse = [{
        row: 0,
        section: "homepage",
        error: "No TRAIL #N / date phrase on page",
        rawText: html.slice(0, 500),
      }];
    } else {
      events.push({
        date: parsed.date,
        kennelTag: "7h4",
        runNumber: parsed.runNumber,
        title: parsed.title,
        hares: parsed.hares,
        location: parsed.location,
        startTime: parsed.startTime,
        sourceUrl: url,
      });
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        url,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
