import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import { applyDateWindow, MONTHS } from "../utils";
import { inferYearClosestToPublish } from "../year-inference";

const KENNEL_TAG = "coeh3";
const DEFAULT_BLOG_URL = "https://cityofexeterhhh.blogspot.com/";
const SUNDAY_START_TIME = "11:00";

/** Title prefix `#1279 …` / `# 1130 - …`. */
const RUN_PREFIX_RE = /^#\s?(\d{3,4})\b/;
/**
 * Date fragment inside a title: `11 October 2026`, `4 Oct 2026`, `13 Sept`,
 * `2nnd November 2025` (typo'd ordinal), `18th Febuary`. The month word is
 * validated through MONTHS on its first three letters, so no month-name
 * alternation is needed here. The year, when present, is ignored: posts are
 * recaps published within days of the run, and the year is inferred from the
 * publish date (one title says "22 Dec 2025" for a 2024 run).
 */
const DATE_FRAGMENT_RE = /\b(\d{1,2})[a-z]{0,3}[ :]([A-Za-z]{3,9})\.?(?: \d{4})?\.?/g;
/** Month-first variant: `May 10 2026`, `April 6 2025`, `May 3rd 2026`. */
const MONTH_FIRST_RE = /\b([A-Za-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?(?: \d{4})?\b/g;

export interface ParsedCoeh3Title {
  runNumber: number;
  date: string;
  title?: string;
  location?: string;
  hares?: string;
}

function trimSegment(value: string): string {
  let out = value.trim();
  while (out.startsWith("-")) out = out.slice(1).trim();
  while (out.endsWith("-") || out.endsWith(".") || out.endsWith(",")) out = out.slice(0, -1).trim();
  return out;
}

interface DateHit {
  day: number;
  month: number;
  index: number;
  length: number;
}

/** Date hits for one regex; `dayGroup`/`monthGroup` say which capture holds which part. */
function dateHits(text: string, re: RegExp, dayGroup: number, monthGroup: number): DateHit[] {
  const hits: DateHit[] = [];
  for (const m of text.matchAll(re)) {
    const month = MONTHS[m[monthGroup].toLowerCase().slice(0, 3)];
    const day = Number.parseInt(m[dayGroup], 10);
    if (month && day >= 1 && day <= 31) hits.push({ day, month, index: m.index, length: m[0].length });
  }
  return hits;
}

/** Last date fragment in the title whose month word is real (day-first or month-first). */
function findDate(text: string): DateHit | null {
  const hits = [...dateHits(text, DATE_FRAGMENT_RE, 1, 2), ...dateHits(text, MONTH_FIRST_RE, 2, 1)];
  if (hits.length === 0) return null;
  return hits.reduce((last, hit) => (hit.index > last.index ? hit : last));
}

/**
 * Parse a City of Exeter H3 recap title:
 * `#1279 Chudleigh Knighton play park - NoButt and Mouthful - 11 October 2026`.
 * The date fragment may sit last or in the middle (`#1250 Wonford … - 15 March
 * 2026 - Happy Snapper`). After removing it, segment 1 is the venue and
 * segment 2 the hares — unless segment 1 names a hash ("25th Anniversary
 * Hash", "Spockfest hangover hash"), which makes it the event title instead.
 * Titles without a run number or a date return null (notices, dateless posts).
 */
export function parseCoeh3Title(rawTitle: string, publishedIso: string): ParsedCoeh3Title | null {
  const titleText = rawTitle.replaceAll(/\s+/g, " ").trim();
  const run = RUN_PREFIX_RE.exec(titleText);
  if (!run) return null;
  const rest = titleText.slice(run[0].length);

  const dateFound = findDate(rest);
  if (!dateFound) return null;
  const date = inferYearClosestToPublish(dateFound.day, dateFound.month, publishedIso);
  if (!date) return null;

  const withoutDate = `${rest.slice(0, dateFound.index)} - ${rest.slice(dateFound.index + dateFound.length)}`;
  const segments = withoutDate
    .split(" - ")
    .flatMap((s) => s.split("- "))
    .flatMap((s) => s.split(" -"))
    .map(trimSegment)
    .filter(Boolean);

  const first = segments[0];
  const isTheme = first !== undefined && first.toLowerCase().includes("hash");
  return {
    runNumber: Number.parseInt(run[1], 10),
    date,
    title: isTheme ? first : undefined,
    location: isTheme ? undefined : first,
    hares: segments[1],
  };
}

/**
 * City of Exeter H3 (Devon) — weekly Sunday 11:00 runs, recapped on a Blogspot
 * blog (cityofexeterhhh.blogspot.com) read via the Blogger API v3. Each recap
 * title carries run #, venue, hares and the run date. It is a recap blog
 * (posts appear on/after run day), so events are recent-past; the source sets
 * `upcomingOnly` so runs that scroll out of the fetch are never cancelled.
 */
export class CityOfExeterH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_BLOG_URL;
    const days = options?.days ?? source.scrapeDays ?? 365;
    // ~1 recap a week plus the odd notice: 25 posts ≈ 5 months.
    const bloggerResult = await fetchBloggerPosts(baseUrl, 25);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    if (bloggerResult.error) {
      const message = `Blogger API fetch failed: ${bloggerResult.error.message}`;
      errors.push(message);
      errorDetails.fetch = [{ url: baseUrl, status: bloggerResult.error.status, message }];
      return { events, errors, errorDetails };
    }

    for (const post of bloggerResult.posts) {
      const parsed = parseCoeh3Title(post.title, post.published);
      if (!parsed) continue;
      const isSunday = new Date(`${parsed.date}T12:00:00Z`).getUTCDay() === 0;
      events.push({
        date: parsed.date,
        kennelTags: [KENNEL_TAG],
        runNumber: parsed.runNumber,
        title: parsed.title,
        location: parsed.location,
        hares: parsed.hares,
        startTime: isSunday ? SUNDAY_START_TIME : undefined,
        sourceUrl: post.url,
      });
    }

    // Fail-loud: brand-new source with no fill-rate baseline.
    if (events.length === 0 && bloggerResult.posts.length > 0) {
      errors.push(
        `City of Exeter H3: fetched ${bloggerResult.posts.length} posts but parsed 0 run titles — title format may have changed`,
      );
    }

    const result: ScrapeResult = {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "blogger-api",
        blogId: bloggerResult.blogId,
        postsFound: bloggerResult.posts.length,
        eventsParsed: events.length,
        fetchDurationMs: bloggerResult.fetchDurationMs,
      },
    };
    return applyDateWindow(result, days);
  }
}
