import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  decodeEntities,
  MONTHS,
  stripPlaceholder,
  validateSourceConfig,
} from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

const DEFAULT_BASE = "https://indyhhh.com";
const DEFAULT_PAGE_ID = 1792; // "Upcumming Hashes" WordPress page
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Source config for IndyScent adapter. */
interface IndyH3Config {
  /** Base site URL (default: https://indyhhh.com). */
  baseUrl?: string;
  /** WordPress page ID hosting the Upcumming Hashes blocks (default: 1792). */
  pageId?: number;
  /** [[regex, kennelTag], ...] — first match wins. Used to route events to THICC. */
  kennelPatterns?: [string, string][];
  /** Fallback kennel tag when no pattern matches. */
  defaultKennelTag: string;
}

function matchKennelTag(
  title: string,
  compiled: [RegExp, string][],
  defaultTag: string,
): string {
  for (const [re, tag] of compiled) {
    if (re.test(title)) return tag;
  }
  return defaultTag;
}

/**
 * Parse a human date like "Friday, April 10, 2026" into "YYYY-MM-DD".
 * Returns null on unknown formats.
 */
export function parseIndyDate(raw: string): string | null {
  const cleaned = raw.replaceAll("\u00a0", " ").trim();
  // Pattern: "Friday, April 10, 2026" — day-of-week optional
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(cleaned);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a human time like "5:00 PM" or "7 PM" into "HH:MM" (24-hour).
 * Returns null on unknown formats.
 */
export function parseIndyTime(raw: string): string | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(raw.trim());
  if (!m) return null;
  let hour = Number.parseInt(m[1], 10);
  const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Parse one ht-upcoming-card block into a RawEventData.
 * Returns null if required fields (date, title) are missing.
 */
export function parseIndyCard(
  $card: cheerio.Cheerio<never>,
  $: cheerio.CheerioAPI,
  compiledPatterns: [RegExp, string][],
  defaultTag: string,
  sourceUrl: string,
): RawEventData | null {
  // Title: "Hash #1119: IndyScent Prom - Spy vs Spy 2026 - Initial Contact"
  const h3 = $card.find("h3").first().text().trim();
  if (!h3) return null;
  const runMatch = /Hash\s*#?(\d+)\s*:\s*(.+)/i.exec(h3);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;
  const title = decodeEntities((runMatch ? runMatch[2] : h3).trim());

  // Extract label:value pairs. Labels are inside <strong> tags preceded by an
  // emoji; the value is whatever follows "Label:" in the containing <div>.
  // We match anywhere in the text so the emoji prefix doesn't throw off the slice.
  const getField = (labelRegex: RegExp): string | undefined => {
    let value: string | undefined;
    $card.find("div").each((_i, el) => {
      const text = $(el).text().trim();
      const match = labelRegex.exec(text);
      if (match?.[1]) {
        value = match[1].trim();
        return false; // stop on first match
      }
    });
    return value;
  };

  const dateRaw = getField(/Date:\s*(.+)/i);
  const timeRaw = getField(/Time:\s*(.+)/i);
  const haresRaw = getField(/Hares?:\s*(.+)/i);
  const locationRaw = getField(/(?:Location|Start|Where):\s*(.+)/i);

  if (!dateRaw) return null;
  const date = parseIndyDate(dateRaw);
  if (!date) return null;

  const startTime = timeRaw ? parseIndyTime(timeRaw) ?? undefined : undefined;
  const hares = stripPlaceholder(haresRaw);
  const location = stripPlaceholder(locationRaw);

  // Detail link for sourceUrl
  const detailHref = $card.find("a[href]").first().attr("href")?.trim();

  const kennelTag = matchKennelTag(title, compiledPatterns, defaultTag);

  return {
    date,
    kennelTags: [kennelTag],    runNumber,
    title,
    hares,
    location,
    startTime,
    sourceUrl: detailHref || sourceUrl,
  };
}

/**
 * IndyScent H3 (Indianapolis) adapter.
 *
 * Fetches the "Upcumming Hashes" WordPress page (default id 1792) and parses
 * the `.ht-upcoming-card` blocks. The same page aggregates THICC H3 events;
 * `kennelPatterns` can route those to the `thicch3` kennel.
 */
export class IndyH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<IndyH3Config>(source.config, "IndyH3Adapter", {
      defaultKennelTag: "string",
    });

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    const pageId = config.pageId ?? DEFAULT_PAGE_ID;
    const apiUrl = `${baseUrl}/wp-json/wp/v2/pages/${pageId}`;

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let json: { content?: { rendered?: string } };
    try {
      const res = await safeFetch(apiUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        errorDetails.fetch = [{ url: apiUrl, status: res.status, message: `HTTP ${res.status}` }];
        return { events: [], errors: [`WordPress API fetch failed: HTTP ${res.status}`], errorDetails };
      }
      json = (await res.json()) as { content?: { rendered?: string } };
    } catch (err) {
      const msg = `WordPress API fetch error: ${err instanceof Error ? err.message : String(err)}`;
      errorDetails.fetch = [{ url: apiUrl, message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    const html = json.content?.rendered ?? "";
    if (!html) {
      errors.push("Empty content.rendered from WordPress page");
      return { events: [], errors };
    }

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // Zip-safe compile: keep each pattern paired with its tag even if some
    // regexes are malformed. Using compilePatterns() + index mapping risks
    // desync when a pattern fails to compile.
    const compiled: [RegExp, string][] = (config.kennelPatterns ?? []).flatMap(
      ([pattern, tag]) => {
        try {
          return [[new RegExp(pattern, "im"), tag] as [RegExp, string]];
        } catch {
          return [];
        }
      },
    );

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    const rawEvents: RawEventData[] = [];
    let cardIndex = 0;
    $(".ht-upcoming-card").each((_i, el) => {
      cardIndex++;
      try {
        const event = parseIndyCard(
          $(el) as cheerio.Cheerio<never>,
          $,
          compiled,
          config.defaultKennelTag,
          baseUrl,
        );
        if (event) rawEvents.push(event);
      } catch (err) {
        errors.push(`Error parsing card ${cardIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: cardIndex, error: String(err) },
        ];
      }
    });

    const events = rawEvents.filter((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        cardsFound: cardIndex,
        eventsParsed: events.length,
      },
    };
  }
}
