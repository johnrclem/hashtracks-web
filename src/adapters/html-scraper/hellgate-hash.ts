/**
 * Hellgate H3 (Missoula, MT) — missoulahash.org WordPress REST posts.
 *
 * One post per run. The body is a block of labeled lines ("Hares:", "When:",
 * "Where:", "Pre-lube:", "Chalk-talk:", "Hash cash:", …) that has drifted over
 * 13 years: `When:` since ~2023, `Date:` from 2019, and a bare first line
 * ("Saturday, December 8th") before that. Recent titles also lead with the
 * date ("Oct 17th, 2026: Costumed Hash", "Aug 21-23, 2026: Campout Hash!").
 * There are no run numbers.
 *
 * Date rule (validated against all 158 posts): month + day come from the body's
 * date text (or the title prefix when the body has none); the year is the
 * body's explicit year, else the title's year when the title month agrees, else
 * the year that puts the run closest to the post's publish date. The body wins
 * when the title disagrees (a "Dec 18th, 2025: January Hash" title typo).
 * Campouts (a range of ≤4 days) get an `endDate` and no start time.
 *
 * Posts are published out of run order (a January batch pre-posts the year),
 * so the forward scrape reads the latest 30 posts, not the default 10.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchWordPressRunPosts, type WordPressPost } from "../wordpress-api";
import { applyDateWindow, cleanLocationName, formatAmPmTime, MONTHS, stripPlaceholder } from "../utils";

const DEFAULT_URL = "https://www.missoulahash.org";
const KENNEL_TAG = "hellgate-h3";
const DEFAULT_HASH_CASH = "$5";
const POSTS_TO_READ = 30;

const DATE_LABELS = ["when", "date"];
const HARE_LABELS = ["hares", "hare", "yourhares"];
const WHERE_LABELS = ["where", "location", "startlocation", "updatedwhere", "wherestheonout", "start"];
const TIME_LABELS = ["prelube", "prelubetime", "lube", "lubetime", "onout", "onouttime", "starttime", "chalktalk", "time"];
const COST_LABELS = ["hashcash"];
/** Labeled lines kept in the description, in this order. */
const DESCRIPTION_LABELS = ["what", "trail", "bring", "onafter"];
/** Labels whose values are mapped to other fields, so they never reach the description. */
const MAPPED_LABELS = new Set([...DATE_LABELS, ...HARE_LABELS, ...WHERE_LABELS, ...TIME_LABELS, ...COST_LABELS, ...DESCRIPTION_LABELS]);

const WEEKDAY_OR_MONTH_RE = /^(?:mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,]/i;
const MONTH_DAY_RE = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;
const DAY_RANGE_TAIL_RE = /^\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?\b/;
const YEAR_RE = /\b(20[1-3]\d)\b/;
const TITLE_DATE_RE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*(\d{1,2})(?:st|nd|rd|th)?)?,\s*(\d{4})\s*:\s*/;
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i;
const PHONE_RE = /(?:\(\d{3}\)\s?|\b\d{3}[-.\s]?)\d{3}[-.]\d{4}\b/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 4;

interface Labeled {
  key: string;
  value: string;
}

/** WordPress post HTML → trimmed, non-empty text lines (one per <br>/<p>/<div>/<li>). */
export function htmlToLines(html: string): string[] {
  const $ = cheerio.load(html);
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr").before("\n");
  return $.root()
    .text()
    .replaceAll(" ", " ")
    .split("\n")
    .map((line) => line.replaceAll(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** "Pre-Lube @ 2pm" / "Chalk Talk: 3:00 pm" → { key: "prelube", value }. Null for an unlabeled line. */
export function splitLabel(line: string): Labeled | null {
  const idx = line.search(/[:@]/);
  if (idx <= 0 || idx > 30) return null;
  const key = line.slice(0, idx).toLowerCase().replaceAll(/[^a-z]/g, "");
  if (!key) return null;
  return { key, value: line.slice(idx + 1).trim() };
}

/** First value for any of `keys`; an empty value takes the next unlabeled line ("When:" ⏎ "Saturday, May 11th"). */
export function labelValue(lines: string[], keys: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const labeled = splitLabel(lines[i]);
    if (!labeled || !keys.includes(labeled.key)) continue;
    if (labeled.value) return labeled.value;
    const next = lines[i + 1];
    if (next && !splitLabel(next)) return next;
  }
  return undefined;
}

const FULL_MONTHS = Object.keys(MONTHS).filter((name) => name.length > 3);

/**
 * A month word → 1–12: an exact name/abbreviation ("Aug", "August", "Sept."), or a
 * playful respelling that keeps the first five letters ("Novembeer"). "Decent" is not.
 */
function monthNumber(word: string): number | undefined {
  const lower = word.toLowerCase();
  if (lower === "sept") return 9;
  if (MONTHS[lower]) return MONTHS[lower];
  const full = lower.length >= 5 ? FULL_MONTHS.find((name) => name.startsWith(lower.slice(0, 5))) : undefined;
  return full ? MONTHS[full] : undefined;
}

interface MonthDay {
  month: number;
  day: number;
}

/** Every "Month D" mention in order, plus a trailing day range ("August 26-28" → Aug 26, Aug 28). */
export function monthDayMentions(text: string): MonthDay[] {
  const out: MonthDay[] = [];
  for (const m of text.matchAll(MONTH_DAY_RE)) {
    const month = monthNumber(m[1]); // "Sat 10th" is not a month mention
    if (!month) continue;
    const day = Number.parseInt(m[2], 10);
    if (day < 1 || day > 31) continue;
    out.push({ month, day });
    const tail = DAY_RANGE_TAIL_RE.exec(text.slice((m.index ?? 0) + m[0].length));
    if (tail) out.push({ month, day: Number.parseInt(tail[1], 10) });
  }
  return out;
}

/** The post's date text: the When/Date label, else the first top line that starts with a weekday or month. */
function bodyDateTexts(lines: string[]): string[] {
  const texts: string[] = [];
  const labeled = labelValue(lines, DATE_LABELS);
  if (labeled) texts.push(labeled);
  texts.push(...lines.slice(0, 6).filter((line) => WEEKDAY_OR_MONTH_RE.test(line) && !splitLabel(line)));
  return texts;
}

function ymd(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** The year (publish year ±1) that puts month/day closest to the publish date. */
function closestYear(month: number, day: number, published: Date): number {
  const base = published.getUTCFullYear();
  let best = base;
  let bestGap = Infinity;
  for (const year of [base - 1, base, base + 1]) {
    const gap = Math.abs(Date.UTC(year, month - 1, day, 12) - published.getTime());
    if (gap < bestGap) {
      best = year;
      bestGap = gap;
    }
  }
  return best;
}

interface TitleDate extends MonthDay {
  year: number;
  endDay?: number;
}

/** Only a leading "Mon Dth(-Dth), YYYY:" counts; "January 2019 Hash" and "July 9 Holes…" don't. */
export function parseTitleDate(title: string): TitleDate | null {
  const m = TITLE_DATE_RE.exec(title);
  if (!m) return null;
  const month = monthNumber(m[1]);
  if (!month) return null;
  return {
    month,
    day: Number.parseInt(m[2], 10),
    endDay: m[3] ? Number.parseInt(m[3], 10) : undefined,
    year: Number.parseInt(m[4], 10),
  };
}

export interface ResolvedDate {
  date: string;
  endDate?: string;
}

/** Resolve the run date (and campout end date) for a post. Null when nothing date-like is found. */
export function resolveHellgateDate(lines: string[], title: string, publishedIso: string): ResolvedDate | null {
  const titleDate = parseTitleDate(title);
  const published = new Date(publishedIso);
  let mentions: MonthDay[] = [];
  let explicitYear: number | undefined;
  for (const text of bodyDateTexts(lines)) {
    mentions = monthDayMentions(text);
    if (mentions.length > 0) {
      const y = YEAR_RE.exec(text);
      explicitYear = y ? Number.parseInt(y[1], 10) : undefined;
      break;
    }
  }
  if (mentions.length === 0 && titleDate) {
    mentions = [titleDate];
    if (titleDate.endDay) mentions.push({ month: titleDate.month, day: titleDate.endDay });
    explicitYear = titleDate.year;
  }
  if (mentions.length === 0) return null;

  const start = mentions[0];
  let year = explicitYear;
  if (year === undefined && titleDate?.month === start.month) year = titleDate.year;
  if (year === undefined) {
    if (Number.isNaN(published.getTime())) return null;
    year = closestYear(start.month, start.day, published);
  }
  const date = ymd(year, start.month, start.day);
  if (!date) return null;

  const last = mentions.at(-1)!;
  const lastYear = last.month < start.month ? year + 1 : year;
  const end = ymd(lastYear, last.month, last.day);
  if (end && end > date) {
    const span = (Date.parse(end) - Date.parse(date)) / MS_PER_DAY;
    if (span <= MAX_RANGE_DAYS) return { date, endDate: end };
  }
  return { date };
}

/** First 12-hour clock time in the text ("3:30 pm", "2 p.m.", "12:00pm"). */
export function parseMeridiemTime(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  const hour = Number.parseInt(m[1], 10);
  const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  return formatAmPmTime(hour, minute, `${m[3]}m`);
}

/** Pre-lube → on-out / start → chalk-talk → time, taking the first label whose value has a clock time. */
function pickStartTime(lines: string[]): string | undefined {
  for (const key of TIME_LABELS) {
    const time = parseMeridiemTime(labelValue(lines, [key]));
    if (time) return time;
  }
  return parseMeridiemTime(labelValue(lines, DATE_LABELS));
}

/** "Vagina Mouth & ?? (Anyone?? Beuller??)" → "Vagina Mouth". Null when the label holds only placeholders. */
export function cleanHares(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  const names = raw
    .replace(/^hares?\s+/i, "") // "Hares: Hares Hindlick Maneuver and …"
    .replaceAll(/\([^)]*\)/g, " ")
    .split(/[&,/+]/)
    .map((part) => stripPlaceholder(part.replaceAll(/\s+/g, " ")))
    .filter((part): part is string => part !== undefined);
  return names.length > 0 ? names.join(", ") : null;
}

/** Venue text, trimmed at a sentence break ("Flippers. Buy your own beer…"). Null for TBD. */
export function cleanWhere(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  let value = raw
    .replace(/^update:\s*/i, "")
    .replace(/^a to [ab]\b(?: trail)?[.;,]?\s*/i, "") // "A to B trail. Starts at Thomas Meager Bar …"
    .replace(/^(?:new start location is|starting|starts|meet)\s+at\s+(?:the\s+)?/i, "");
  if (/^contact\b/i.test(value)) return null; // "Start Location: Contact Us"
  const stop = /\b\w{4,}\. [A-Z]/.exec(value);
  if (stop) value = value.slice(0, stop.index + stop[0].length - 3);
  return cleanLocationName(value);
}

/** Emit the hash cash only when it differs from the kennel's usual $5. */
export function costIfNotDefault(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const amount = /\$\d+/.exec(raw)?.[0];
  return amount && amount !== DEFAULT_HASH_CASH ? raw : undefined;
}

export function scrubContactDetails(text: string): string {
  return text
    .replaceAll(PHONE_RE, "")
    .replaceAll(EMAIL_RE, "")
    .replaceAll(/ {2,}/g, " ")
    .replaceAll("( ", "(")
    .replaceAll(" )", ")")
    // Drop the husk a removed number leaves behind: "(msg for address)", "()".
    .replaceAll(/\((?:(?:msg|text|call) )?(?:for address)?\)/gi, "")
    .replaceAll(/ {2,}/g, " ")
    .trim();
}

/** Prose + What/Trail/Bring/On-After, without the schedule footer or fields mapped elsewhere. */
export function buildDescription(lines: string[], dateLine: string | undefined): string | undefined {
  const footer = lines.findIndex((line) => /^future hashes/i.test(line));
  const body = footer === -1 ? lines : lines.slice(0, footer);
  const prose = body.filter((line) => {
    const labeled = splitLabel(line);
    if (labeled) return !MAPPED_LABELS.has(labeled.key) && labeled.value.length > 0;
    return line !== dateLine;
  });
  const labeled = DESCRIPTION_LABELS.flatMap((key) => {
    const value = labelValue(lines, [key]);
    return value ? [`${key === "onafter" ? "On-After" : key[0].toUpperCase() + key.slice(1)}: ${value}`] : [];
  });
  const text = scrubContactDetails([...labeled, ...prose].join("\n"));
  return text ? text.slice(0, 2000) : undefined;
}

/** "Not dog friendly" → false, "Dog friendly" → true, "Dog friendly?" → undefined. */
function parseDogFriendly(trail: string | undefined): boolean | undefined {
  if (!trail) return undefined;
  if (/not dog friendly/i.test(trail)) return false;
  if (/dog friendly(?!\s*\?)/i.test(trail)) return true;
  return undefined;
}

/** Parse one post. Returns null when no run date can be resolved. */
export function parseHellgatePost(post: WordPressPost): RawEventData | null {
  const lines = htmlToLines(post.content);
  const dated = resolveHellgateDate(lines, post.title, post.date);
  if (!dated) return null;
  const title = post.title.replace(TITLE_DATE_RE, "").trim();
  const trail = labelValue(lines, ["trail"]);
  const trailTypeMatch = /\bA\s*(?:to|-)\s*([AB])\b/.exec(trail ?? "");
  const dateLine = bodyDateTexts(lines)[0];
  return {
    date: dated.date,
    ...(dated.endDate ? { endDate: dated.endDate } : {}),
    kennelTags: [KENNEL_TAG],
    title: title || undefined,
    hares: cleanHares(labelValue(lines, HARE_LABELS)),
    location: cleanWhere(labelValue(lines, WHERE_LABELS)),
    startTime: dated.endDate ? undefined : pickStartTime(lines),
    cost: costIfNotDefault(labelValue(lines, COST_LABELS)),
    trailType: trailTypeMatch ? `A to ${trailTypeMatch[1]}` : undefined,
    dogFriendly: parseDogFriendly(trail),
    description: buildDescription(lines, dateLine),
    sourceUrl: post.url || undefined,
  };
}

export class HellgateHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const wp = await fetchWordPressRunPosts(url, {
      perPage: POSTS_TO_READ,
      noPostsMessage: "Hellgate H3: WordPress returned 0 posts",
    });
    if (!wp.ok) return wp.result;

    const events: RawEventData[] = [];
    const unparsed: string[] = [];
    for (const post of wp.posts) {
      const event = parseHellgatePost(post);
      if (event) events.push(event);
      else unparsed.push(post.title);
    }

    const errors: string[] = [];
    if (events.length === 0) {
      errors.push(`Hellgate H3: 0 of ${wp.posts.length} posts yielded a date — body format drift`);
    }

    return applyDateWindow(
      {
        events,
        errors,
        diagnosticContext: {
          fetchMethod: "wordpress-api",
          postsFound: wp.posts.length,
          unparsedTitles: unparsed,
          fetchDurationMs: wp.fetchDurationMs,
        },
      },
      options?.days ?? source.scrapeDays ?? 365,
    );
  }
}
