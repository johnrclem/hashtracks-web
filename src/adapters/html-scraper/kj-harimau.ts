import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import {
  applyDateWindow,
  decodeEntities,
  normalizeHaresField,
  parse12HourTime,
  stripHtmlTags,
} from "../utils";

/**
 * Kelana Jaya Harimau Hash House Harriers (KJ Harimau) adapter.
 *
 * khhhkj.blogspot.com is a Blogger-hosted blog that mixes weekly run
 * announcements with birthday/wedding/holiday greetings. Run posts have a
 * very specific title shape:
 *
 *   "Run#:1548, 14/04/2026, Hare: Silver Hai Ho, Runsite: Radio Cafe, Botanic Klang"
 *
 * and a body that follows a consistent labeled template:
 *
 *   *Kelab Hash House Harimau Kelana Jaya*
 *   Run#: 1548
 *   Date: 14/04/26,
 *   Time: 6:00 pm
 *   Hare: Silver Hai Ho - https://shorturl.at/9SSG7
 *   Runsite: Radio Cafe, Botanic Klang
 *   GPS: 2.9874534,101.4512081
 *   Maps: https://maps.app.goo.gl/...
 *   Waze: https://waze.com/ul/...
 *   Guest Fee: RM 60
 *
 * Non-run posts (birthdays, weddings, holiday greetings) are filtered by
 * title — only posts matching `/^Run#?:?\s*\d+/i` are kept.
 *
 * Weekly Tuesday 18:00. Founded 20 August 1996.
 */

const KENNEL_TAG = "kj-harimau";
const DEFAULT_START_TIME = "18:00"; // weekly Tuesday 6 PM
const RUN_TITLE_RE = /^\s*Run\s*#?\s*:?\s*(\d+)/i;

/**
 * Parse a date token like "14/04/2026", "14/04/26", or "14-04-2026" into
 * "YYYY-MM-DD" (DD/MM/YYYY order — KJ Harimau is Malaysian, not US).
 * Exported for unit testing.
 */
export function parseKjHarimauDate(raw: string): string | null {
  const m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Extract labeled fields from a KJ Harimau post body text. Body fields can
 * be on one line or multiple lines; we use anchor-based regexes that stop
 * at the next known label to stay robust against formatting variation.
 *
 * Exported for unit testing.
 */
export function parseKjHarimauBody(bodyText: string): {
  runNumber?: number;
  date?: string;
  startTime?: string;
  hare?: string;
  runsite?: string;
  latitude?: number;
  longitude?: number;
  mapsUrl?: string;
  wazeUrl?: string;
  guestFee?: string;
} {
  const labels = "(?:Run\\s*#|Date|Time|Hare|Runsite|GPS|Maps|Waze|Guest\\s*Fee|Birthdays|Wedding)";
  const stop = `(?=\\n|${labels}\\s*:|$)`;
  const text = bodyText.replace(/\r/g, "");

  const grab = (label: string): string | undefined => {
    // Labels are hard-coded string literals above — not user input. No ReDoS risk.
    const re = new RegExp(`${label}\\s*:\\s*(.+?)${stop}`, "is");
    const m = re.exec(text);
    return m ? m[1].trim().replace(/\s+/g, " ") : undefined;
  };

  const runNumRaw = grab("Run\\s*#");
  const runNumber = runNumRaw ? Number.parseInt(runNumRaw.replace(/\D/g, ""), 10) : undefined;

  const dateRaw = grab("Date");
  const date = dateRaw ? parseKjHarimauDate(dateRaw) ?? undefined : undefined;

  const timeRaw = grab("Time");
  const startTime = timeRaw
    ? parse12HourTime(timeRaw.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm"))
    : undefined;

  let hare = grab("Hare");
  if (hare) {
    // Drop trailing " - https://..." shorturl
    hare = hare.replace(/\s*-\s*https?:\/\/\S+.*$/, "").trim();
    if (!hare) hare = undefined;
  }

  const runsite = grab("Runsite");
  const gpsRaw = grab("GPS");
  let latitude: number | undefined;
  let longitude: number | undefined;
  if (gpsRaw) {
    const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(gpsRaw);
    if (m) {
      latitude = Number.parseFloat(m[1]);
      longitude = Number.parseFloat(m[2]);
    }
  }

  const mapsRaw = grab("Maps");
  const mapsUrl = mapsRaw && /^https?:\/\//.test(mapsRaw) ? mapsRaw.split(/\s+/)[0] : undefined;

  const wazeRaw = grab("Waze");
  const wazeUrl = wazeRaw && /^https?:\/\//.test(wazeRaw) ? wazeRaw.split(/\s+/)[0] : undefined;

  const guestFee = grab("Guest\\s*Fee");

  return { runNumber, date, startTime, hare, runsite, latitude, longitude, mapsUrl, wazeUrl, guestFee };
}

/**
 * Parse an event from a raw title (fallback path when the body is
 * incomplete). Exported for unit testing.
 */
export function parseKjHarimauTitle(title: string): { runNumber?: number; date?: string; hare?: string; runsite?: string } {
  const decoded = decodeEntities(title);
  const runMatch = RUN_TITLE_RE.exec(decoded);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // "Run#:1548, 14/04/2026, Hare: X, Runsite: Y"
  const date = parseKjHarimauDate(decoded);

  const hareMatch = /Hare\s*:\s*([^,]+?)(?:,|$)/i.exec(decoded);
  const hare = hareMatch?.[1].trim();

  const runsiteMatch = /Runsite\s*:\s*(.+?)\s*$/i.exec(decoded);
  const runsite = runsiteMatch?.[1].trim();

  return { runNumber, date: date ?? undefined, hare, runsite };
}

export class KjHarimauAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://khhhkj.blogspot.com";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const bloggerResult = await fetchBloggerPosts(baseUrl);
    if (bloggerResult.error) {
      errorDetails.fetch = [
        {
          url: baseUrl,
          message: bloggerResult.error.message,
          status: bloggerResult.error.status,
        },
      ];
      return { events: [], errors: [bloggerResult.error.message], errorDetails };
    }

    const events: RawEventData[] = [];
    // KJ Harimau occasionally publishes the same run as two nearly
    // identical Blogger posts (e.g. Run 1548 with and without a URL
    // suffix). Dedupe by (date, runNumber), keeping the first post
    // encountered — Blogger returns posts newest-first, so the first
    // hit is the most recent edit and the canonical version.
    const seenRuns = new Set<string>();
    let duplicatesSkipped = 0;
    let filteredOut = 0;
    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const post = bloggerResult.posts[i];
      const titleDecoded = decodeEntities(post.title);
      if (!RUN_TITLE_RE.test(titleDecoded)) {
        filteredOut++;
        continue;
      }

      const bodyText = stripHtmlTags(post.content, "\n");
      const body = parseKjHarimauBody(bodyText);
      const titleFields = parseKjHarimauTitle(titleDecoded);

      const date = body.date ?? titleFields.date;
      if (!date) {
        errors.push(`KJ Harimau post "${titleDecoded.slice(0, 80)}" has no parseable date`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: i,
            section: "post",
            field: "date",
            error: "No parseable date",
            rawText: `Title: ${titleDecoded}`.slice(0, 500),
          },
        ];
        continue;
      }

      const runNumber = body.runNumber ?? titleFields.runNumber;

      const dedupKey = `${date}|${runNumber ?? ""}`;
      if (seenRuns.has(dedupKey)) {
        duplicatesSkipped++;
        continue;
      }
      seenRuns.add(dedupKey);

      const hares = normalizeHaresField(body.hare ?? titleFields.hare);
      const location = body.runsite ?? titleFields.runsite;

      const externalLinks: { url: string; label: string }[] = [];
      if (body.wazeUrl) externalLinks.push({ url: body.wazeUrl, label: "Waze" });

      const description = body.guestFee ? `Guest Fee: ${body.guestFee}` : undefined;

      events.push({
        date,
        kennelTags: [KENNEL_TAG],
        runNumber,
        hares,
        location,
        locationUrl: body.mapsUrl,
        latitude: body.latitude,
        longitude: body.longitude,
        startTime: body.startTime ?? DEFAULT_START_TIME,
        sourceUrl: post.url,
        description,
        externalLinks: externalLinks.length > 0 ? externalLinks : undefined,
      });
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "blogger-api",
          blogId: bloggerResult.blogId,
          postsFound: bloggerResult.posts.length,
          postsFilteredOut: filteredOut,
          duplicatesSkipped,
          eventsParsed: events.length,
          fetchDurationMs: bloggerResult.fetchDurationMs,
        },
      },
      days,
    );
  }
}
