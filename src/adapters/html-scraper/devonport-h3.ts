import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import { applyDateWindow, MONTHS, parse12HourTime, stripHtmlTags } from "../utils";
import { inferYearClosestToPublish } from "../year-inference";

const KENNEL_TAG = "devonport-h3";
const DEFAULT_BLOG_URL = "https://www.dhash.com/";
const DEFAULT_START_TIME = "18:45";

/** Post title `Run 2331`. */
const TITLE_RUN_RE = /^Run (\d{3,5})$/i;
/** `When:` value `Monday, 31 August 2026, 6.30pm for 6.45pm Sharp START (AEST)`. */
const WHEN_DATE_RE = /(\d{1,2}) ([A-Za-z]+),? (\d{4})/;
/** A clock time written `6.45pm` / `6:45 pm`. */
const CLOCK_RE = /(\d{1,2})[.:](\d{2}) ?([ap]m)/gi;
/** Receding hareline row `Run 2332 – 7/9 Jinx` (en dash or hyphen). */
const HARELINE_RE = /^Run (\d{3,5}) [–-] (\d{1,2})\/(\d{1,2})\b ?(.*)$/;
const MAX_HARE_LENGTH = 40;

export interface DevonportPost {
  title: string;
  content: string;
  url: string;
  published: string;
}

/** `Label: value` lines from the flattened post body. */
function labelledLines(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0 || colon > 10) continue;
    const label = line.slice(0, colon).trim().toLowerCase();
    if (!fields.has(label)) fields.set(label, line.slice(colon + 1).trim());
  }
  return fields;
}

/** "6.30pm for 6.45pm Sharp START" → 18:45 (the "for" time is the start); single time → that time. */
export function parseWhenTime(when: string): string {
  const times = [...when.matchAll(CLOCK_RE)].map((m) => parse12HourTime(`${m[1]}:${m[2]} ${m[3]}`));
  const pick = when.toLowerCase().includes(" for ") && times.length > 1 ? times[1] : times[0];
  return pick ?? DEFAULT_START_TIME;
}

function cleanHare(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let hare = raw.trim();
  const note = hare.indexOf(" Please ");
  if (note !== -1) hare = hare.slice(0, note).trim();
  if (!hare || hare.length > MAX_HARE_LENGTH) return undefined;
  return hare;
}

/** The labelled announcement (`Hare:` / `Where:` / `When:` / `Cost:`) of a `Run NNNN` post. */
export function parseAnnouncement(post: DevonportPost, lines: string[]): RawEventData | null {
  const titleMatch = TITLE_RUN_RE.exec(post.title.trim());
  if (!titleMatch) return null;
  const fields = labelledLines(lines);
  const when = fields.get("when");
  const dateMatch = when ? WHEN_DATE_RE.exec(when) : null;
  if (!when || !dateMatch) return null;
  const month = MONTHS[dateMatch[2].toLowerCase()];
  if (!month) return null;
  const year = Number.parseInt(dateMatch[3], 10);
  const day = Number.parseInt(dateMatch[1], 10);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCDate() !== day) return null;

  const notes = fields.get("notes");
  return {
    date: d.toISOString().slice(0, 10),
    kennelTags: [KENNEL_TAG],
    runNumber: Number.parseInt(titleMatch[1], 10),
    startTime: parseWhenTime(when),
    hares: cleanHare(fields.get("hare") ?? fields.get("hares")),
    location: fields.get("where") || undefined,
    cost: fields.get("cost") || undefined,
    description: notes ? notes : undefined,
    sourceUrl: post.url,
  };
}

/** Rows of the embedded "Receding Hareline" (`Run NNNN – D/M Hare`); year from the publish date. */
export function parseHareline(lines: string[], publishedIso: string, sourceUrl: string): RawEventData[] {
  const start = lines.findIndex((l) => l.toLowerCase().startsWith("receding hareline"));
  if (start === -1) return [];
  const events: RawEventData[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = HARELINE_RE.exec(line);
    if (!m) continue;
    const date = inferYearClosestToPublish(Number.parseInt(m[2], 10), Number.parseInt(m[3], 10), publishedIso);
    if (!date) continue;
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(m[1], 10),
      startTime: DEFAULT_START_TIME,
      hares: cleanHare(m[4]),
      sourceUrl,
    });
  }
  return events;
}

/** Flatten a Blogger post body into trimmed non-empty lines. */
export function postLines(content: string): string[] {
  return stripHtmlTags(content, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Devonport H3 ("The Odd Sock Hash", NW Tasmania) — weekly Monday 18:45. The
 * custom-domain Blogger blog (dhash.com, read via the Blogger API v3) has one
 * `Run NNNN` post per run with labelled Hare/Where/When/Cost lines, and the
 * newest post carries a "Receding Hareline" of forward runs (run #, D/M,
 * hare) that the committee keeps editing. Only the newest post's hareline is
 * used — older posts carry superseded numbering. Announcement rows win over
 * hareline rows for the same run date.
 */
export class DevonportH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_BLOG_URL;
    const days = options?.days ?? source.scrapeDays ?? 365;
    const bloggerResult = await fetchBloggerPosts(baseUrl, 15);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    if (bloggerResult.error) {
      const message = `Blogger API fetch failed: ${bloggerResult.error.message}`;
      errors.push(message);
      errorDetails.fetch = [{ url: baseUrl, status: bloggerResult.error.status, message }];
      return { events, errors, errorDetails };
    }

    const posts = [...bloggerResult.posts].sort((a, b) => b.published.localeCompare(a.published));
    for (const post of posts) {
      const announcement = parseAnnouncement(post, postLines(post.content));
      if (announcement) events.push(announcement);
    }
    const announcedDates = new Set(events.map((e) => e.date));
    if (posts[0]) {
      for (const row of parseHareline(postLines(posts[0].content), posts[0].published, posts[0].url)) {
        if (!announcedDates.has(row.date)) events.push(row);
      }
    }

    if (events.length === 0 && posts.length > 0) {
      errors.push(`Devonport H3: fetched ${posts.length} posts but parsed 0 runs — post format may have changed`);
    }

    const result: ScrapeResult = {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "blogger-api",
        blogId: bloggerResult.blogId,
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs: bloggerResult.fetchDurationMs,
      },
    };
    return applyDateWindow(result, days);
  }
}
