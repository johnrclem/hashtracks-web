/**
 * Atlanta Hash Board phpBB Atom Feed Adapter
 *
 * Scrapes board.atlantahash.com for trail announcements via built-in phpBB Atom
 * feeds. Each subforum exposes a feed at:
 *   https://board.atlantahash.com/app.php/feed/forum/{forumId}
 *
 * Returns up to 15 entries per feed with full post content inline.
 * One HTTP request per kennel subforum (9 forums → 9 requests, fetched concurrently).
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { safeFetch, type ProxyEgress } from "../safe-fetch";
import { parse12HourTime, validateSourceConfig, decodeEntities, stripHtmlTags, chronoParseDate, buildDateWindow, cleanLocationName } from "../utils";

// ── Config shape ──

interface ForumConfig {
  kennelTag: string;
  hashDay: string; // e.g. "Saturday", "Monday"
}

interface AtlantaHashBoardConfig {
  forums: Record<string, ForumConfig>;
  /**
   * Route fetches through the NAS residential proxy. The origin WAF blocks
   * cloud-egress IPs entirely; this flag opts a source into proxy routing.
   * Not a guaranteed bypass — some residential IPs (including the NAS at
   * times) are also blocked. (#633) Convenience alias for `egress: "residential"`.
   */
  useResidentialProxy?: boolean;
  /**
   * Proxy-relay egress for feed fetches. board.atlantahash.com sits behind
   * OVH's anti-DDoS firewall, which drops BOTH Vercel and the home residential
   * range (so "residential" is insufficient) but lets a VPN exit through — set
   * `egress: "vpn"` to route via the VPN-relay (#2054). Omit for direct fetch.
   */
  egress?: ProxyEgress;
}

// ── Atom feed types ──

export interface AtomEntry {
  title: string;
  published: string; // ISO 8601
  author: string;
  link: string;
  category: string; // subforum label
  content: string; // raw HTML
}

// ── Exported helpers (for unit testing) ──

/** Check if an Atom entry is a reply (not a new topic). */
export function isReplyEntry(title: string): boolean {
  // phpBB reply titles contain " • Re: " (bullet + "Re:")
  return /\s[•·]\s*Re:\s/i.test(title);
}

/** Parse Atom XML feed into structured entries. */
export function parseAtomFeed(xml: string): AtomEntry[] {
  const $ = cheerio.load(xml, { xml: true });
  const entries: AtomEntry[] = [];

  $("entry").each((_, el) => {
    const entry = $(el);
    const title = decodeEntities(entry.find("title").text().trim());
    const published = entry.find("published").text().trim();
    const author = decodeEntities(entry.find("author > name").text().trim());
    const link = entry.find("link").attr("href") ?? "";
    const category = decodeEntities(entry.find("category").attr("label") ?? "");
    const content = entry.find("content").text().trim();

    if (title && published) {
      entries.push({ title, published, author, link, category, content });
    }
  });

  return entries;
}

/**
 * Extract the event date from a phpBB post title and body.
 *
 * Priority:
 * 1. Explicit date in body (e.g., "When: 3/8/26", "Date: March 8, 2026")
 * 2. Date hint in title (e.g., "Saturday March 8th", "#1638 March 2nd")
 * 3. Infer from post date + kennel's regular hash day
 */
export function extractEventDate(
  title: string,
  body: string,
  postDate: string,
  hashDay: string,
): string | null {
  const refDate = new Date(postDate);
  if (Number.isNaN(refDate.getTime())) return null;

  // 1. Check body for explicit date patterns
  const dateLinePatterns = [
    /(?:When|Date|Day)\s*:\s*([^\n<]*)(?:\n|<br|$)/i,
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  ];
  for (const pattern of dateLinePatterns) {
    const match = pattern.exec(body);
    if (match) {
      const parsed = chronoParseDate(match[1], "en-US", refDate, { forwardDate: true });
      if (parsed) return parsed;
    }
  }

  // 2. Try parsing date from title
  // Strip kennel prefix like "Atlanta Hash (Saturdays) • " or "Moonlite #1638 "
  const normalized = title.replace(/·/g, "•");
  let titleClean = normalized.includes("•") ? normalized.split("•").pop()!.trim() : title;
  // Strip run numbers (e.g., "#1638") that confuse chrono-node
  titleClean = titleClean.replace(/#\d+/g, "").trim();
  const titleParsed = chronoParseDate(titleClean, "en-US", refDate, { forwardDate: true });
  if (titleParsed) return titleParsed;

  // 3. Infer: find the next occurrence of hashDay after the post date
  return inferDateFromHashDay(refDate, hashDay);
}

/** Find the next occurrence of a named day of week on or after the reference date. */
function inferDateFromHashDay(refDate: Date, hashDay: string): string | null {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const target = dayMap[hashDay.toLowerCase()];
  if (target === undefined) return null;

  const d = new Date(refDate);
  const current = d.getUTCDay();
  const daysAhead = (target - current + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysAhead);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Strip phpBB post-banner lines (e.g. `by mtmedori » Sat Mar 28, 2026 3:19 pm`)
 * from the extracted text. These banner lines bleed into stripHtmlTags() output
 * and leak post-timestamps into start-time extraction (#1588).
 *
 * Heuristic: a banner line carries ALL THREE of:
 *   1. the U+00BB right-pointing double angle quotation mark (`»`), phpBB's
 *      signature author-vs-date separator;
 *   2. a month name (Jan…Dec);
 *   3. a 4-digit year.
 *
 * Requiring `»` keeps legitimate prose lines like
 * `Time: Saturday March 8, 2026, meet 1:30 PM` from being stripped — that's
 * event copy, not a banner (Codex review).
 *
 * Implemented as line-split + per-line predicate to keep each regex provably
 * linear (Sonar S5852).
 */
// Split into abbreviation + full-name regexes. Each has 12 alternations with
// no nested optional groups → regex complexity ~12, well under Sonar S5843's
// budget of 20. Word-boundary `\b` already prevents over-matching on words
// like "Marching" / "Maybe" / "Decoration" (Gemini + Claude-bot review on PR
// #1622), because the next char after the month token is still a word char
// and `\b` requires a word→non-word transition.
const MONTH_ABBR_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
const MONTH_FULL_RE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i;
const FOUR_DIGIT_YEAR_RE = /\b\d{4}\b/;
function isBannerLine(line: string): boolean {
  return (
    line.includes("»") &&
    (MONTH_ABBR_RE.test(line) || MONTH_FULL_RE.test(line)) &&
    FOUR_DIGIT_YEAR_RE.test(line)
  );
}
export function stripPhpBbBanners(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isBannerLine(line))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Strip phpBB markdown emphasis (`**bold**`, `*italic*`, `***both***`) from a
 * captured field value. The Pinelake H3 subforum (and others on the Atlanta
 * board) heavily use markdown-bold/italic wrapping that bleeds verbatim into
 * label captures (#1640 — haresText was `** *Debbie Does Digits*`).
 *
 * Strips every `*` character globally (any literal asterisk in a scribe-
 * authored field is collateral damage — Pinelake posts have no
 * known-good asterisk-bearing hash names, and the markdown emphasis
 * cleanup is more valuable than preserving rare in-name asterisks).
 * Trailing/leading whitespace is trimmed and internal runs collapsed.
 *
 * (#1695 review: gemini flagged a docstring claim about word-boundary
 * conservatism that the implementation never did — the blanket strip
 * was always the intent; only the doc text was misleading.)
 */
function stripMarkdownEmphasis(s: string): string {
  return s
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect a value that is purely a time pattern (e.g. "1:30 PM", "1:30 pm",
 *  "1:30 Am"). Case-insensitive on AM/PM to match `parse12HourTime`'s own
 *  contract (mixed-case scribes — the cycle-12 issue used uppercase, but
 *  lowercase "pm" is just as common in scribe-typed phpBB posts). Used to
 *  redirect a `Start: 1:30 PM` capture into `startTime` instead of
 *  `location` (#1640). */
const TIME_ONLY_RE = /^\s*(\d{1,2}:\d{2}\s*[ap]m)\s*$/i;

/**
 * Extract structured event fields from pre-parsed content.
 * Accepts pre-computed plain text (to avoid re-parsing HTML) and Cheerio instance
 * for link extraction.
 */
export function extractEventFields(
  htmlContent: string,
  precomputedText?: string,
  preloaded$?: cheerio.CheerioAPI,
): Partial<RawEventData> {
  const fields: Partial<RawEventData> = {};
  // Strip phpBB post-banner lines BEFORE label-based extraction so banner
  // timestamps like "Sat Mar 28, 2026 3:19 pm" can't leak into startTime (#1588).
  const text = stripPhpBbBanners(precomputedText ?? stripHtmlTags(htmlContent, "\n"));

  // Hares — strip markdown bold/italic asterisks the scribes wrap names in
  // (#1640: "Hares: ** *Debbie Does Digits*" → "Debbie Does Digits").
  const hareMatch = /Hares?\s*:\s*([^\n]*)(?:\n|$)/i.exec(text);
  if (hareMatch) {
    const cleaned = stripMarkdownEmphasis(hareMatch[1]);
    if (cleaned) fields.hares = cleaned;
  }

  // Location — scan ALL labeled matches (Start/Where/Location/Meeting/Meet)
  // and pick the first non-time-only value. Time-only captures like
  // "Start: 1:30 PM" (#1640 — Pinelake) get promoted to startTime so a
  // subsequent "Location: <venue>" label can fill `location` cleanly.
  //
  // Walk lines procedurally rather than `matchAll` on a regex with
  // `\s*` quantifiers adjacent to the label alternation — that shape
  // trips Sonar S5852 even though it's linear here (#1695 review).
  // Set for O(1) membership (Sonar S7776). Normalize non-breaking
  // whitespace (` `, `&nbsp;`) before comparison — phpBB editors
  // sometimes pad labels with NBSP that survives `.text()` extraction
  // (#1702 gemini medium).
  const LOC_LABELS = new Set(["start", "where", "location", "meeting", "meet"]);
  let locationCandidate: string | undefined;
  for (const rawLine of text.split("\n")) {
    const colonIdx = rawLine.indexOf(":");
    if (colonIdx <= 0) continue;
    const label = rawLine.slice(0, colonIdx).replaceAll(" ", " ").replaceAll("&nbsp;", " ").trim().toLowerCase();
    if (!LOC_LABELS.has(label)) continue;
    const value = stripMarkdownEmphasis(rawLine.slice(colonIdx + 1));
    if (!value) continue;
    const timeOnly = TIME_ONLY_RE.exec(value);
    if (timeOnly) {
      if (!fields.startTime) {
        const parsed = parse12HourTime(timeOnly[1]);
        if (parsed) fields.startTime = parsed;
      }
      continue;
    }
    if (!locationCandidate) locationCandidate = value;
  }
  if (locationCandidate) {
    let loc = locationCandidate;
    // Truncate the phpBB "Statistics: Posted by … — <timestamp>" footer that
    // bleeds onto the address line when the post body and the forum stats row
    // share a line after HTML flattening (#2045). Use indexOf, not `\b`: there
    // is no word boundary in "…30341Statistics" (digit→letter, both word chars).
    const statsIdx = loc.search(/Statistics:/i);
    if (statsIdx >= 0) loc = loc.slice(0, statsIdx).trim();
    // Strip embedded time patterns: "bankhead station at 1:30" → "bankhead station"
    loc = loc.replace(/\s+at\s+\d{1,2}:\d{2}(?:\s*[AP]M)?/i, "").trim();
    // Insert comma between venue name and street number when concatenated:
    // "Constitution Lakes 1305 S River Industrial Blvd" → "Constitution Lakes, 1305 S River Industrial Blvd"
    loc = loc.replace(/^([A-Z][A-Za-z\s']+?)\s+(\d{2,5}\s+\w)/, "$1, $2");
    // Final pass through the shared cleaner (URL/emoji/CTA/placeholder strip).
    // Preserve its null tri-state: when the source provided a location label
    // that cleans to non-venue text, emit null (explicit clear) rather than
    // `?? undefined` (preserve). cleanLocationName returns `string | null`.
    fields.location = cleanLocationName(loc);
  }

  // Google Maps URL from HTML
  const $ = preloaded$ ?? cheerio.load(htmlContent);
  const mapsLink = $('a[href*="maps"]').first().attr("href")
    ?? $('a[href*="goo.gl"]').first().attr("href");
  if (mapsLink) {
    fields.locationUrl = mapsLink;
  }

  // Time
  const timeMatch = /(?:Time|Meet|Gather|Show)\s*:?\s*[^\n]*?(\d{1,2}:\d{2}\s*[AP][Mm])/i.exec(text);
  if (timeMatch) {
    const parsed = parse12HourTime(timeMatch[1]);
    if (parsed) fields.startTime = parsed;
  }

  // Run number from body — require explicit "Run #NNN" prose marker. The
  // earlier loose `/#(\d{2,})/` regex pulled #2000 from street-address suite
  // numbers ("Kroger 8465 Holcomb Bridge Rd #2000") and #946 from cross-kennel
  // references ("Black Sheep ... all the way to #946…") (#1587). Title-extracted
  // run number is preferred at the call site; this body fallback only fires
  // when the title has no #NNN.
  //
  // `[\s#]+` between "Run" and the digits handles "Run #1638", "Run 1644",
  // and "Run#1638" with a single quantifier — avoids the nested `\s*…\s*`
  // shape Sonar S5852 flags as ReDoS-prone (Memory feedback_sonar_s5852_false_positives).
  const runMatch = /\bRun[\s#]+(\d{2,})\b/i.exec(text);
  if (runMatch) {
    const n = Number.parseInt(runMatch[1], 10);
    if (Number.isFinite(n) && n > 0) fields.runNumber = n;
  }

  // Cost
  const costMatch = /\$(\d+)/i.exec(text);
  if (costMatch) {
    const desc = fields.description ? `${fields.description} | Hash Cash: $${costMatch[1]}` : `Hash Cash: $${costMatch[1]}`;
    fields.description = desc;
  }

  return fields;
}

/** Extract run number from Atom entry title. */
function extractRunNumberFromTitle(title: string): number | undefined {
  const match = /#(\d{2,})/.exec(title);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** Extract a clean trail name from the Atom title. */
function extractTitleName(title: string): string | undefined {
  // Titles look like: "Atlanta Hash (Saturdays) • Trail Name Here" (• or · separator)
  const normalized = title.replace(/·/g, "•");
  const afterBullet = normalized.includes("•") ? normalized.split("•").pop()!.trim() : null;
  if (!afterBullet) return undefined;

  // Strip "Re: " prefix (shouldn't get here but just in case)
  const cleaned = afterBullet.replace(/^Re:\s*/i, "").trim();
  return cleaned || undefined;
}

// ── Entry processing (extracted to reduce fetch() complexity) ──

interface ProcessedEntries {
  events: RawEventData[];
  parseErrors: ParseError[];
  skippedReplies: number;
}

function processForumEntries(
  entries: AtomEntry[],
  forumId: string,
  forumConfig: ForumConfig,
  minDate: Date,
  maxDate: Date,
): ProcessedEntries {
  const events: RawEventData[] = [];
  const parseErrors: ParseError[] = [];
  let skippedReplies = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (isReplyEntry(entry.title)) {
      skippedReplies++;
      continue;
    }

    try {
      const textContent = stripHtmlTags(entry.content, "\n");
      const $content = cheerio.load(entry.content);

      const date = extractEventDate(
        entry.title, textContent, entry.published, forumConfig.hashDay,
      );

      if (!date) {
        parseErrors.push({
          row: i, section: `forum-${forumId}`, field: "date",
          error: "Could not extract event date",
          rawText: entry.title.slice(0, 200),
        });
        continue;
      }

      const eventDate = new Date(date + "T12:00:00Z");
      if (eventDate < minDate || eventDate > maxDate) continue;

      const fields = extractEventFields(entry.content, textContent, $content);
      const titleRunNumber = extractRunNumberFromTitle(entry.title);
      const titleName = extractTitleName(entry.title);

      events.push({
        date,
        kennelTags: [forumConfig.kennelTag],
        // Title is canonical when present: "Moonlite #1644 - The Wisening"
        // is ground truth; only fall back to body extraction when the title
        // carries no #NNN (#1587).
        runNumber: titleRunNumber ?? fields.runNumber,
        title: titleName,
        hares: fields.hares,
        location: fields.location,
        locationUrl: fields.locationUrl,
        startTime: fields.startTime,
        sourceUrl: entry.link,
        description: fields.description,
      });
    } catch (err) {
      parseErrors.push({
        row: i, section: `forum-${forumId}`,
        error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
        rawText: entry.title.slice(0, 200),
      });
    }
  }

  return { events, parseErrors, skippedReplies };
}

// ── Adapter class ──

/** Fetch result from a single forum feed. */
interface ForumFetchResult {
  forumId: string;
  forumConfig: ForumConfig;
  xml?: string;
  error?: { url: string; status?: number; message: string };
}

export class AtlantaHashBoardAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<AtlantaHashBoardConfig>(
      source.config,
      "AtlantaHashBoardAdapter",
      { forums: "object" },
    );

    const baseUrl = source.url || "https://board.atlantahash.com";
    const useResidentialProxy = config.useResidentialProxy;
    if (
      useResidentialProxy !== undefined &&
      typeof useResidentialProxy !== "boolean"
    ) {
      throw new Error(
        `AtlantaHashBoardAdapter: config.useResidentialProxy must be a boolean, got ${typeof useResidentialProxy}`,
      );
    }
    const egress = config.egress;
    if (egress !== undefined && egress !== "residential" && egress !== "vpn") {
      throw new Error(
        `AtlantaHashBoardAdapter: config.egress must be "residential" | "vpn", got ${JSON.stringify(egress)}`,
      );
    }
    // Forward both raw; safeFetch resolves precedence + the legacy alias
    // (explicit egress fails closed; useResidentialProxy falls back).
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const allParseErrors: ParseError[] = [];
    let totalEntries = 0;
    let skippedReplies = 0;

    // Fetch all forum feeds concurrently
    const forumEntries = Object.entries(config.forums);
    const feedResults = await Promise.allSettled(
      forumEntries.map(async ([forumId, forumConfig]): Promise<ForumFetchResult> => {
        const feedUrl = `${baseUrl}/app.php/feed/forum/${forumId}`;
        try {
          const response = await safeFetch(feedUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
            egress,
            useResidentialProxy,
          });
          if (!response.ok) {
            return {
              forumId, forumConfig,
              error: { url: feedUrl, status: response.status, message: `Forum ${forumId} (${forumConfig.kennelTag}): HTTP ${response.status}` },
            };
          }
          return { forumId, forumConfig, xml: await response.text() };
        } catch (err) {
          return {
            forumId, forumConfig,
            error: { url: feedUrl, message: `Forum ${forumId} (${forumConfig.kennelTag}): Fetch failed: ${err}` },
          };
        }
      }),
    );

    // Process results
    for (const settled of feedResults) {
      if (settled.status === "rejected") continue;
      const result = settled.value;

      if (result.error) {
        allErrors.push(result.error.message);
        errorDetails.fetch ??= [];
        errorDetails.fetch.push(result.error);
        continue;
      }
      if (!result.xml) continue;

      const entries = parseAtomFeed(result.xml);
      totalEntries += entries.length;

      const processed = processForumEntries(
        entries, result.forumId, result.forumConfig, minDate, maxDate,
      );
      allEvents.push(...processed.events);
      allParseErrors.push(...processed.parseErrors);
      skippedReplies += processed.skippedReplies;
    }

    if (allParseErrors.length > 0) {
      errorDetails.parse = allParseErrors;
    }

    return {
      events: allEvents,
      errors: allErrors,
      errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        forumsScraped: Object.keys(config.forums).length,
        totalEntries,
        skippedReplies,
        eventsParsed: allEvents.length,
        parseErrors: allParseErrors.length,
      },
    };
  }
}
