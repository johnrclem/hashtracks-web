import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  EMOJI_RE,
  formatAmPmTime,
  normalizeHaresField,
  parsePublishDate,
  stripHtmlTags,
  stripUrls,
} from "../utils";

/**
 * Chiang Rai Hash House Harriers (CRH3) adapter.
 *
 * chiangraihhh.blogspot.com is a Blogger-hosted blog with 364+ posts.
 * Run announcements have titles like:
 *   "CRH3#220 Saturday 26 March"
 *   "CRH3 #218 Saturday 15th February 2025"
 *   "CRH3#217 HAPPY NEW YEAR RUN"
 *
 * Bodies follow a loose emoji-labelled template:
 *   🏃‍♂️Next Run #N🏃‍♀️
 *   Saturday 28th Mar 26 (This coming Saturday)
 *   ▶️Hare: Pussy Rainbow
 *   📍Starting Location - <maps url>
 *   🕞EARLY TIME - 3 for 3:30 pm start.
 *   💲Price - All attendees 100 Baht.
 *
 * Title dates can disagree with body dates (titles sometimes off by a few
 * days). The body line "Saturday Nth Mon YY" is canonical — CRH3 runs
 * monthly on a Saturday, so we prefer the body and treat the title date
 * as a fallback only.
 */

const KENNEL_TAG = "crh3";
const DEFAULT_START_TIME = "15:00"; // 3rd Saturday monthly, 3:00 PM start per Chrome research
/** Default scrape window. CRH3 runs monthly so 12 posts/year. Bumping
 * maxResults to 100 buffers for run reports and non-run posts that
 * intersperse the announcements. */
const BLOGGER_MAX_RESULTS = 100;
/** Matches CRH3 run posts — requires at least one digit to avoid matching run reports. */
const RUN_TITLE_RE = /CRH3\s*#?\s*\d+/i;
/** Extracts the run number if present. */
const RUN_NUMBER_RE = /CRH3\s*#?\s*(\d+)/i;
/** Recap/report titles share the run number with the announcement but
 * have no future-event metadata. Skip them to avoid duplicate parse
 * errors against `seenRuns`-deduped events.
 *
 * Anchored to the start of the title so an announcement like
 * "CRH3 #230 Photo Run Saturday..." is NOT filtered. Must match a
 * compound recap phrase (e.g. "Memories of", "Photos from") rather
 * than any title containing one of those words. */
const REPORT_TITLE_RE = /^\s*(?:(?:Memories|Memory)\s+of|Photos?\s+(?:of|from)|Report\s+(?:of|on)|Write\s*-?\s*Up\s+of|Recap\s+of)\b/i;

/** Single source of truth for body field labels. Used by both the
 * label-anchored regexes (in parseCrh3Body's grab()) and the line filter
 * in extractDescription so the two can't drift. */
const LABEL_PATTERN = "Hares?|GM|Grand\\s*Master|Starting\\s*Location|Location|Run\\s*Site|Meeting|EARLY\\s*TIME|Start(?:\\s*Time)?|Time|Date|Price|Cost|Hash\\s*Cash|Parking|TIPS|On\\s*After|Circle|ON\\s*ON\\s*ON";

/**
 * Parse a CRH3 post title for run number and optional date.
 * Exported for unit testing.
 */
export function parseCrh3Title(title: string, publishDateIso: string): {
  runNumber?: number;
  date?: string;
} {
  const decoded = decodeEntities(title);
  const runMatch = RUN_NUMBER_RE.exec(decoded);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // Strip "CRH3#NNN" or "CRH3" prefix and try to parse remaining text as a date
  const stripped = decoded.replace(/CRH3\s*#?\s*\d*\s*/i, "").trim();
  const refDate = parsePublishDate(publishDateIso);
  const date = chronoParseDate(stripped, "en-GB", refDate, { forwardDate: true })
    ?? chronoParseDate(decoded, "en-GB", refDate, { forwardDate: true });

  return { runNumber, date: date ?? undefined };
}

/**
 * Extract fields from a CRH3 post body. The body is loose emoji-labelled
 * text — see top-of-file template. Exported for unit testing.
 */
export function parseCrh3Body(bodyHtml: string, publishDateIso: string): {
  date?: string;
  hares?: string;
  location?: string;
  startTime?: string;
  cost?: string;
  description?: string;
} {
  const text = decodeEntities(stripHtmlTags(bodyHtml, "\n")).replace(EMOJI_RE, " ");

  // Trailing stop: newline, end of string, or next known label, so a
  // value can't run into the next line's label even if newlines drop.
  const stop = `(?=\\n|(?:${LABEL_PATTERN})\\b|$)`;

  const grab = (label: string): string | undefined => {
    // Allow either ":", "=", or "-" as the label/value delimiter.
    const re = new RegExp(`(?:${label})\\s*[:=\\-]\\s*(.+?)${stop}`, "i");
    const m = re.exec(text);
    if (!m) return undefined;
    const value = m[1].trim().replace(/\s+/g, " ");
    return value || undefined;
  };

  const hares = grab("Hares?|GM|Grand Master");
  const location = grab("Starting\\s*Location|Location|Run\\s*Site|Meeting");
  const cost = grab("Price|Cost|Hash\\s*Cash");

  // EARLY TIME line: "3 for 3:30 pm start" — pull the LATER (run-start)
  // time when both are present, since hashers stagger arrival vs start.
  const earlyLine = grab("EARLY\\s*TIME|Start(?:\\s*Time)?|Time");
  const startTime = parseStartTime(earlyLine);

  // Strip URLs before chrono — Google Maps short-link base64 fragments
  // contain digit sequences that chrono mis-parses as dates (verified
  // live: #216 had `g_ep=EgoyMDI1MTExMi4w` decode to "20251112" and
  // chrono picked Nov 16 instead of the title's Nov 22).
  const refDate = parsePublishDate(publishDateIso);
  const date = chronoParseDate(stripUrls(text), "en-GB", refDate, { forwardDate: true }) ?? undefined;

  const description = extractDescription(text);

  return { date, hares, location, startTime, cost, description };
}

/** Parse "3 for 3:30 pm start" → "15:30". Picks the run-start time
 * (last clock pattern) and the meridiem nearest to it. */
export function parseStartTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const re = /(\d{1,2})(?:[:.](\d{2}))?/g;
  const matches = [...value.matchAll(re)];
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const hour = Number.parseInt(last[1], 10);
  const minute = last[2] ? Number.parseInt(last[2], 10) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  // Anchor meridiem detection to text near the matched time (within
  // ~12 chars) so an unrelated "PM" earlier in the input doesn't flip
  // a morning time to afternoon.
  const lastIndex = last.index ?? 0;
  const window = value.slice(lastIndex, lastIndex + last[0].length + 12);
  const ampm = /pm/i.test(window) ? "pm" : (/am/i.test(window) ? "am" : "");
  return ampm ? formatAmPmTime(hour, minute, ampm) : `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

/** Pull freeform description line(s) — anywhere in the body that isn't
 * a header line, date line, labelled line, URL line, or short noise. */
function extractDescription(text: string): string | undefined {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const labelStart = new RegExp(`^(?:${LABEL_PATTERN})\\b`, "i");
  const headerLike = /^Next\s*Run|^Saturday\b|^(?:https?:|www\.)/i;
  const desc: string[] = [];
  for (const line of lines) {
    if (headerLike.test(line)) continue;
    if (labelStart.test(line)) continue;
    if (line.length < 8) continue;
    desc.push(line);
  }
  if (desc.length === 0) return undefined;
  const joined = desc.join(" ");
  return joined.length > 240 ? `${joined.slice(0, 239)}…` : joined;
}

/** A minimal Blogger post shape for parsePost. */
export interface Crh3PostInput {
  title: string;
  content: string;
  url: string;
  published: string;
}

/** Result of parsing a CRH3 post. */
export type ParseCrh3PostResult =
  | { ok: true; event: RawEventData }
  | { ok: false; reason: "not-run-post" | "no-date"; title: string };

/**
 * Parse a single CRH3 Blogger post into RawEventData.
 * Exported for unit testing.
 */
export function parseCrh3Post(post: Crh3PostInput): ParseCrh3PostResult {
  const rawTitle = post.title;
  if (!RUN_TITLE_RE.test(rawTitle) || REPORT_TITLE_RE.test(rawTitle)) {
    return { ok: false, reason: "not-run-post", title: rawTitle };
  }

  const titleFields = parseCrh3Title(rawTitle, post.published);
  const body = parseCrh3Body(post.content, post.published);

  // Body date is canonical (matches CRH3's Saturday cadence). Title date
  // is fallback for posts where the body date didn't parse.
  const date = body.date ?? titleFields.date;
  if (!date) return { ok: false, reason: "no-date", title: rawTitle };

  return {
    ok: true,
    event: {
      date,
      kennelTags: [KENNEL_TAG],
      title: decodeEntities(rawTitle).trim(),
      description: body.description,
      runNumber: titleFields.runNumber,
      hares: normalizeHaresField(body.hares),
      location: body.location,
      startTime: body.startTime ?? DEFAULT_START_TIME,
      cost: body.cost,
      sourceUrl: post.url,
    },
  };
}

export class Crh3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://chiangraihhh.blogspot.com";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const bloggerResult = await fetchBloggerPosts(baseUrl, BLOGGER_MAX_RESULTS);
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
    let filteredOut = 0;
    // Dedupe by (date, runNumber) — Blogger returns newest-first, so the
    // first post per run# is the most recent (announcement). Later posts
    // with the same run# are typically run reports/recaps and must NOT
    // create additional events.
    const seenRuns = new Set<string>();
    let duplicatesSkipped = 0;
    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const post = bloggerResult.posts[i];
      const result = parseCrh3Post({
        title: post.title,
        content: post.content,
        url: post.url,
        published: post.published,
      });
      if (result.ok) {
        const dedupKey = `${result.event.date}|${result.event.runNumber ?? ""}`;
        if (seenRuns.has(dedupKey)) {
          duplicatesSkipped++;
          continue;
        }
        seenRuns.add(dedupKey);
        events.push(result.event);
        continue;
      }
      if (result.reason === "not-run-post") {
        filteredOut++;
        continue;
      }
      errors.push(`CRH3 post "${result.title.slice(0, 80)}" has no parseable date`);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        {
          row: i,
          section: "post",
          field: "date",
          error: "No parseable date",
          rawText: `Title: ${result.title}`.slice(0, 500),
        },
      ];
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
