import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchWordPressComPosts, type WordPressComPage } from "../wordpress-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchHTMLPage,
  type FetchHTMLResult,
  MONTHS,
  normalizeHaresField,
  parse12HourTime,
  parsePublishDate,
  stripPlaceholder,
} from "../utils";

/**
 * Bangkok Harriettes Hash House Harriers adapter.
 *
 * bangkokharriettes.wordpress.com is a WordPress.com hosted blog. The kennel
 * publishes its schedule in TWO places:
 *
 *   1. A "Next Run" post (reused — only ~3 posts total exist; they overwrite a
 *      single post with updated details) fetched via the WordPress.com API.
 *      Body fields use `<strong>`-labeled format (`Run no. NNNN on ...`).
 *
 *   2. Two HTML hareline tables (4-col Run/Date/Hare/Location):
 *        - homepage near-term preview (~8 rows)
 *        - /hareline-in-full/ extended schedule (~28 rows)
 *
 * Until #1321 the adapter only consumed the post (1 event). This module now
 * also parses both tables and dedupes by runNumber so the post-derived event
 * (with its canonical sourceUrl + parsed time) wins when both surfaces list
 * the same run.
 *
 * Weekly Wednesday runs.
 */

const SITE_DOMAIN = "bangkokharriettes.wordpress.com";
const SITE_BASE = "https://bangkokharriettes.wordpress.com";
const FULL_HARELINE_URL = `${SITE_BASE}/hareline-in-full/`;
const KENNEL_TAG = "bkk-harriettes";
const DEFAULT_START_TIME = "17:30"; // typical Wednesday afternoon

/**
 * Parse a Bangkok Harriettes "Next Run" post into RawEventData.
 *
 * The blog reuses a single post with body content like:
 *   `<strong>Run no. 2259 on Wednesday 15 April at 17:30</strong><br />
 *    <strong>Hare:-</strong> Hazukashii<br />
 *    <strong>Location:- </strong>TBA`
 *
 * Exported for unit testing.
 */
export function parseBkkHarriettesPost(
  post: WordPressComPage,
): RawEventData | null {
  const $ = cheerio.load(post.content);
  const bodyText = decodeEntities($("body").text().trim());

  // Bangkok Harriettes hardcode publish dates to 2000-01-01, so prefer
  // post.modified (reflects when the "Next Run" post was last updated).
  const refDate = parsePublishDate(post.modified) ?? parsePublishDate(post.date);

  // Pattern 1: "Run no. NNNN on Wednesday 15 April at 17:30"
  const runLineMatch = /Run\s*no\.?\s*(\d+)\s+on\s+(.+?)(?:\s+at\s+(\d{1,2}:\d{2}))?[.,]?\s*$/im.exec(bodyText);

  let date: string | null = null;
  let runNumber: number | undefined;
  let startTime = DEFAULT_START_TIME;

  if (runLineMatch) {
    runNumber = Number.parseInt(runLineMatch[1], 10);
    const dateStr = runLineMatch[2].trim();
    date = chronoParseDate(dateStr, "en-GB", refDate, { forwardDate: true });
    if (runLineMatch[3]) {
      const parsed = parse12HourTime(runLineMatch[3]);
      if (parsed) startTime = parsed;
      else if (/^\d{1,2}:\d{2}$/.test(runLineMatch[3].trim())) startTime = runLineMatch[3].trim();
    }
  }

  // Pattern 2: labeled "Date:" field (fallback for alternate format)
  if (!date) {
    const dateMatch = /(?:^|\b)Date\s*[:-]+\s*(.+?)(?:\n|$)/im.exec(bodyText);
    if (dateMatch) {
      date = chronoParseDate(dateMatch[1], "en-GB", refDate, { forwardDate: true });
    }
  }

  // Pattern 3: labeled "Run Number:" field (fallback)
  if (!runNumber) {
    const numMatch = /Run\s*(?:Number|No|#)\s*[:-]+\s*(\d+)/i.exec(bodyText);
    if (numMatch) runNumber = Number.parseInt(numMatch[1], 10);
  }

  // Fallback: scan full body for any date — still anchor to refDate
  if (!date) {
    date = chronoParseDate(bodyText, "en-GB", refDate, { forwardDate: true });
  }
  if (!date) return null;

  // Extract labeled fields: "Hare:-" and "Location:-"
  const hareMatch = /Hares?\s*[:-]+\s*(.+?)(?=\n|Location|$)/i.exec(bodyText);
  const hares = hareMatch?.[1].trim() || undefined;

  const locationMatch = /Location\s*[:-]+\s*(.+?)(?=\n|Hare|$)/i.exec(bodyText);
  const location = stripPlaceholder(locationMatch?.[1]);

  // Time from labeled field (fallback if not in run line)
  if (startTime === DEFAULT_START_TIME) {
    const timeMatch = /Time\s*[:-]+\s*(.+?)(?:\n|$)/i.exec(bodyText);
    if (timeMatch) {
      const timeStr = timeMatch[1].replaceAll(".", "").trim();
      const parsed = parse12HourTime(timeStr);
      if (parsed) startTime = parsed;
      else if (/^\d{1,2}:\d{2}$/.test(timeStr)) startTime = timeStr;
    }
  }

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares: normalizeHaresField(hares),
    location,
    startTime,
    sourceUrl: post.URL,
  };
}

const DAY_MONTH_RE = /^(\d{1,2})\s+([A-Za-z]{3,})\.?$/;

/**
 * Resolve a year-less `D MMM` cell (e.g. "24 Jun") into "YYYY-MM-DD".
 *
 * The hareline interleaves recent-past rows (e.g. "29 Apr" on a May
 * homepage) with far-future ones (~8 months ahead, ending in late December).
 * Default to refDate's year; if that lands the date more than 90 days
 * behind refDate, the table has rolled into next year — bump to year + 1.
 * The 90-day window is wide enough to cover the small back-window of
 * recent-past rows BKK keeps on the homepage.
 */
export function resolveTableDate(dateRaw: string, refDate: Date): string | null {
  const m = DAY_MONTH_RE.exec(dateRaw.trim());
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;

  const buildIso = (year: number): string | null => {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const baseYear = refDate.getUTCFullYear();
  const baseIso = buildIso(baseYear);
  if (!baseIso) return null;

  const baseMs = new Date(`${baseIso}T12:00:00Z`).getTime();
  if (baseMs < refDate.getTime() - 90 * 86_400_000) {
    return buildIso(baseYear + 1);
  }
  return baseIso;
}

/**
 * Parse a 4-column hareline `<table>` into RawEventData rows.
 *
 * Both the homepage preview and `/hareline-in-full/` use the same shape:
 *
 *   <tr>
 *     <td>2269</td>
 *     <td>24 Jun</td>
 *     <td>Tiradej &#8216;Porkfinder&#8217; S</td>
 *     <td>TBA</td>
 *   </tr>
 *
 * The date cell omits the year; we infer it relative to `refDate` and rely on
 * `chronoParseDate(..., { forwardDate: true })` to bump past months into the
 * next year.
 *
 * Exported for unit testing.
 */
export function parseBkkHarrietteHarelineTable(
  html: string,
  refDate: Date,
  sourceUrl: string,
): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("tr").each((_i, tr) => {
    const cells = $(tr).find("td");
    if (cells.length !== 4) return;

    const [runRaw, dateRaw, hareRaw, locationRaw] = cells
      .toArray()
      .map((cell) => decodeEntities($(cell).text()).trim());

    // Skip header / legend rows (e.g. "Run", "* To be confirmed").
    if (!/^\d+$/.test(runRaw)) return;
    const runNumber = Number.parseInt(runRaw, 10);

    const date = resolveTableDate(dateRaw, refDate);
    if (!date) return;

    // Strip trailing `*` "to be confirmed" marker before placeholder filter
    // so "TBA *" collapses to undefined rather than the literal "TBA *".
    const hareCleaned = hareRaw.replace(/\s*\*\s*$/, "").trim();
    const hares = normalizeHaresField(stripPlaceholder(hareCleaned));

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      hares,
      location: stripPlaceholder(locationRaw),
      startTime: DEFAULT_START_TIME,
      sourceUrl,
    });
  });

  return events;
}

type PostsResult = Awaited<ReturnType<typeof fetchWordPressComPosts>>;

const RUN_TITLE_RE = /run\s*(?:no|#|number)?\s*\.?\s*\d/i;
const POSTS_API_URL = `public-api.wordpress.com/.../sites/${SITE_DOMAIN}/posts/`;

function collectPostEvents(
  postsResult: PostsResult,
  errors: string[],
  errorDetails: ErrorDetails,
): RawEventData[] {
  if (postsResult.error) {
    errorDetails.fetch = [
      ...(errorDetails.fetch ?? []),
      { url: POSTS_API_URL, message: postsResult.error.message, status: postsResult.error.status },
    ];
    errors.push(postsResult.error.message);
    return [];
  }
  const events: RawEventData[] = [];
  const filtered = postsResult.posts.filter((p) =>
    RUN_TITLE_RE.test(`${p.title} ${p.content}`),
  );
  for (const post of filtered) {
    try {
      const event = parseBkkHarriettesPost(post);
      if (event) events.push(event);
    } catch (err) {
      errors.push(`Error parsing post "${post.title}": ${err}`);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row: post.ID, error: String(err), rawText: post.title.slice(0, 200) },
      ];
    }
  }
  return events;
}

function consumeTablePage(
  result: FetchHTMLResult,
  sourceUrl: string,
  section: string,
  refDate: Date,
  out: RawEventData[],
  errors: string[],
  errorDetails: ErrorDetails,
): void {
  if (!result.ok) {
    if (result.result.errorDetails?.fetch) {
      errorDetails.fetch = [...(errorDetails.fetch ?? []), ...result.result.errorDetails.fetch];
    }
    errors.push(...result.result.errors);
    return;
  }
  try {
    out.push(...parseBkkHarrietteHarelineTable(result.html, refDate, sourceUrl));
  } catch (err) {
    errors.push(`Error parsing ${section}: ${err}`);
    errorDetails.parse = [
      ...(errorDetails.parse ?? []),
      { row: 0, section, error: String(err) },
    ];
  }
}

export class BkkHarriettesAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const fetchStart = Date.now();
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Three fetches in parallel:
    //   1. WP.com posts (the canonical "Next Run" post)
    //   2. Homepage HTML (~8-row preview hareline table)
    //   3. /hareline-in-full/ HTML (~28-row extended hareline table)
    const [postsResult, homepageResult, fullResult] = await Promise.all([
      fetchWordPressComPosts(SITE_DOMAIN, { number: 5, search: "Run" }),
      fetchHTMLPage(SITE_BASE),
      fetchHTMLPage(FULL_HARELINE_URL),
    ]);

    const postEvents = collectPostEvents(postsResult, errors, errorDetails);

    const refDate = new Date();
    const tableEvents: RawEventData[] = [];
    consumeTablePage(homepageResult, SITE_BASE, "homepage", refDate, tableEvents, errors, errorDetails);
    consumeTablePage(fullResult, FULL_HARELINE_URL, "hareline-in-full", refDate, tableEvents, errors, errorDetails);

    // Dedupe by runNumber; post events come last so they override table rows
    // (post events carry the permalink sourceUrl and a parsed startTime).
    const byRun = new Map<number, RawEventData>();
    for (const e of [...tableEvents, ...postEvents]) {
      if (typeof e.runNumber === "number") byRun.set(e.runNumber, e);
    }
    const events: RawEventData[] = [
      ...postEvents.filter((e) => typeof e.runNumber !== "number"),
      ...byRun.values(),
    ];

    const fetchDurationMs = Date.now() - fetchStart;
    const days = options?.days ?? source.scrapeDays ?? 90;

    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "wordpress-com-api+html",
          postEventCount: postEvents.length,
          tableEventCount: tableEvents.length,
          mergedEventCount: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
