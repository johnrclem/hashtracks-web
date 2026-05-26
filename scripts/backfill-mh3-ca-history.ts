/**
 * One-shot historical backfill for MH3 Montreal (#1661).
 *
 * Premise from the issue body: kennel founded 1995, latest visible run #1688
 * (May 2026), ~1500 runs total expected. Reality after probing the source:
 *
 *   - mhhh.ca/trash/YYYY/index.html exists for 1996-2008 inclusive (1995 and
 *     2009+ both return 404). Index pages list rows of
 *     `<a href="trashNNN.htm">Run #NNN / Location</a>` + `Month YYYY`.
 *   - Per-run detail pages (`trashNNN.htm`) carry a fuller date
 *     ("Sunday, July 6th, 2008 @ 1:00PM"), the verbatim location, and the
 *     hare list ("Yogi, Little Big Man, Anon"). Not every row has all three.
 *   - Total reachable rows across 1996-2008 is ~115 — not 1500. Runs after
 *     2008 are visible only through the Meetup public API, which is the
 *     `Montreal H3 Meetup` source. A separate `scripts/backfill-meetup-history.ts`
 *     run can crawl Meetup's `?type=past` archive when the operator wants
 *     the 2009-2025 gap closed.
 *
 * This script crawls only the mhhh.ca trash archive. Per-row date precision
 * is month-only from the index, so we fetch each detail page to upgrade to
 * day precision when available (rate-limited to one request every 500ms to
 * be a good citizen on a Cloudflare-fronted hobby site). Detail-page fetch
 * failures fall back to YYYY-MM-15 (mid-month) so the row still anchors to
 * the correct month.
 *
 * Bound to source: "MH3 Montreal Website Hareline" (the HTML_SCRAPER row
 * added in the same PR). Past dates only — adapter handles `>= CURDATE()`.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-mh3-ca-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-mh3-ca-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { chronoParseDate } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "MH3 Montreal Website Hareline";
const KENNEL_TIMEZONE = "America/Montreal";
const SITE_BASE = "https://mhhh.ca";
const FIRST_YEAR = 1996;
const LAST_YEAR = 2008; // 2009+ returns 404 — archive stopped being maintained
const DETAIL_RATE_LIMIT_MS = 500;

interface IndexRow {
  runNumber: number;
  /** Location text after the slash in "Run #N / Location". */
  rowLocation?: string;
  /** Month-only fallback when the detail page is unreachable. */
  monthDate: string; // YYYY-MM-15
  /** Absolute URL of the trashNNN.htm detail page. */
  detailUrl: string;
}

interface DetailEnrichment {
  /** YYYY-MM-DD with day precision. */
  date?: string;
  /** "1:00 PM" → "13:00", normalized 24h. */
  startTime?: string;
  location?: string;
  hares?: string;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Parse a year-index page into rows. The archive's hand-edited HTML is
 * inconsistent (mixed quotes, broken nesting, multi-run "#258-#259" weekend
 * entries), so we walk anchors instead of relying on table structure: any
 * `<a href="trashNNN.htm">` is a row, and we look for a sibling `<td>`
 * carrying the "Month YYYY" string.
 *
 * Multi-run rows (e.g. "Runs #258-#259 / Apple Hill ITCH") get the leading
 * run number only; the secondary run gets its own row from `Run #259`
 * already in the archive elsewhere, so we don't synthesize duplicates here.
 */
export function parseYearIndex(html: string, year: number): IndexRow[] {
  const $ = cheerio.load(html);
  const rows: IndexRow[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const fileMatch = href.match(/^trash(\d+)\.htm$/i);
    if (!fileMatch) return;

    const text = $(el).text().replace(/\s+/g, " ").trim();
    const runMatch = text.match(/run(?:s)?\s*#\s*(\d+)/i);
    if (!runMatch) return;
    const runNumber = parseInt(runMatch[1], 10);
    if (!Number.isFinite(runNumber) || runNumber <= 0) return;

    // Location is the text after the first slash, when present.
    const slashIdx = text.indexOf("/");
    const rowLocation = slashIdx >= 0 ? text.slice(slashIdx + 1).trim() : undefined;

    // Find the "Month YYYY" sibling cell. The archive almost always places it
    // in the next <td> after the anchor's <td>, but the markup is sloppy
    // enough that we walk the row's text fallback as a safety net.
    const $row = $(el).closest("tr");
    const rowText = $row.text().replace(/\s+/g, " ").trim();
    const monthMatch = rowText.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
    );
    const month = monthMatch?.[1];
    const rowYear = monthMatch ? parseInt(monthMatch[2], 10) : year;

    if (!month) return; // Skip rows we can't anchor to a month.
    const isoMonth = new Date(`${month} 15, ${rowYear} 12:00:00 UTC`);
    if (Number.isNaN(isoMonth.getTime())) return;

    // The detail file lives under the YEAR PAGE'S directory, not the year
    // parsed from the row's "Month YYYY" cell. Some year-index pages list a
    // late-prior-year or early-next-year run (e.g. a Dec 2001 run referenced
    // from /trash/2002/index.html). Codex caught this — without using `year`
    // here, those rows would 404 silently and fall back to month-precise.
    rows.push({
      runNumber,
      rowLocation: rowLocation && rowLocation.length > 0 ? rowLocation : undefined,
      monthDate: isoMonth.toISOString().slice(0, 10),
      detailUrl: `${SITE_BASE}/trash/${year}/${fileMatch[0]}`,
    });
  });

  // De-dupe within the year — the archive sometimes lists the same row twice
  // in different table layouts. Keep the first occurrence.
  const seen = new Set<number>();
  return rows.filter((r) => {
    if (seen.has(r.runNumber)) return false;
    seen.add(r.runNumber);
    return true;
  });
}

/**
 * Pull date + hares + location out of a trashNNN.htm detail page. The format
 * is hand-edited HTML with field labels broken by `<br>` tags, e.g.
 *
 *   Date: Sunday, July 6th, 2008 @ 1:00PM<br>
 *   Location: Sainte-Anne-de-Bellevue<br>
 *   Hares: Yogi, Little Big Man, Anon
 *
 * We flatten the body to text and use anchored label regexes. Returns an
 * empty object if no labels match — the caller falls back to the index row.
 */
/**
 * Read a labelled line (e.g. `Date: …`, `Location: …`) out of a flattened
 * detail page. Procedural rather than regex per
 * `feedback_sonar_s5852_procedural_over_regex.md` — `^\s*Label\s*:\s*(...)`
 * shapes get flagged by SonarCloud S5852 even when linear in practice.
 */
function readLabelledLine(text: string, label: string): string | undefined {
  const needle = `${label.toLowerCase()}:`;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimStart();
    if (line.toLowerCase().startsWith(needle)) {
      return line.slice(label.length + 1).trim();
    }
  }
  return undefined;
}

export function parseDetailPage(html: string): DetailEnrichment {
  const $ = cheerio.load(html);
  // Replace <br> with newline so label regexes can terminate at line ends.
  $("br").replaceWith("\n");
  const text = $("body").text().replace(/&nbsp;/gi, " ").replace(/ /g, " ");

  // Label-line extraction is procedural (not regex) per
  // `feedback_sonar_s5852_procedural_over_regex.md` — `^\s*Label\s*:\s*(...)`
  // shapes get flagged by SonarCloud S5852 as backtracking-prone even when
  // linear in practice. The archive uses both "Hares:" and singular "Hare:"
  // interchangeably; readLabelledLine() probes the longer form first so the
  // "Hare:" prefix doesn't shadow real "Hares: ..." rows.
  const dateLine = readLabelledLine(text, "Date");
  const locLine = readLabelledLine(text, "Location");
  const haresLine = readLabelledLine(text, "Hares") ?? readLabelledLine(text, "Hare");

  let date: string | undefined;
  let startTime: string | undefined;
  if (dateLine) {
    // Extract "@ HH:MM[AM/PM]" before parsing — chrono handles full dates but
    // its time parsing is inconsistent across the archive's 30 years of
    // typographic variation. Strip the time fragment and parse date alone.
    const timeMatch = dateLine.match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp]\.?\s*[Mm]\.?)/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const isPm = /p/i.test(timeMatch[3]);
      if (isPm && h < 12) h += 12;
      if (!isPm && h === 12) h = 0;
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        startTime = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
      }
    }
    // Strip ordinal suffixes ("July 6th" → "July 6") which chrono handles but
    // also strip the @-time fragment to keep the parse focused on the date.
    // indexOf("@") instead of /@.*$/ — keeps Sonar S5852 clean (bare-greedy
    // anchored regex falls under the same DoS-shape rule that hit the
    // label-line regexes).
    const atIdx = dateLine.indexOf("@");
    const beforeAt = atIdx >= 0 ? dateLine.slice(0, atIdx) : dateLine;
    const dateOnly = beforeAt.replace(/(\d+)(?:st|nd|rd|th)\b/gi, "$1").trim();
    date = chronoParseDate(dateOnly) ?? undefined;
  }

  const location = locLine || undefined;

  // Hares are comma-separated on the detail page. Sort before joining for
  // fingerprint stability (feedback_fingerprint_stability.md).
  let hares: string | undefined;
  if (haresLine) {
    const parts = haresLine
      .split(",")
      // Case-insensitive strip of stray "and" connectors ("Yogi, and LBM" →
      // "Yogi, LBM"). gemini-code-assist flag on PR #1688: the original
      // `/\bAnd\b/g` only matched capitalized form.
      .map((s) => s.replace(/\band\b/gi, "").trim())
      .filter((s) => s.length > 0 && !/^(?:tbd|tba)$/i.test(s));
    if (parts.length > 0) {
      parts.sort((a, b) => a.localeCompare(b, "en"));
      hares = parts.join(", ");
    }
  }

  return { date, startTime, location, hares };
}

async function fetchEvents(): Promise<RawEventData[]> {
  const allRows: IndexRow[] = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const url = `${SITE_BASE}/trash/${year}/index.html`;
    process.stdout.write(`  Year ${year}: fetching ${url} ...`);
    const html = await fetchText(url);
    if (!html) {
      console.log(" 404 / skipped");
      continue;
    }
    const rows = parseYearIndex(html, year);
    allRows.push(...rows);
    console.log(` ${rows.length} rows`);
  }
  console.log(`\n  Total index rows: ${allRows.length}. Now enriching from detail pages...`);

  const events: RawEventData[] = [];
  let detailHits = 0;
  let detailMisses = 0;
  for (const row of allRows) {
    // Rate-limit detail-page fetches. Cloudflare can throttle aggressive
    // crawlers on small hobby sites.
    await new Promise((resolve) => setTimeout(resolve, DETAIL_RATE_LIMIT_MS));
    const detailHtml = await fetchText(row.detailUrl);
    const detail = detailHtml ? parseDetailPage(detailHtml) : {};
    // Guard: chrono can mis-parse the archive's idiosyncratic prose dates
    // (e.g. "Date:  Fri.-Mon., Oct. 5th-8th, 2001." on the trash258 weekend
    // event page resolves relative to today's reference date and returns a
    // 2026 timestamp). Trust the detail-page date only when it lands in the
    // same calendar year as the index row's "Month YYYY" cell; otherwise
    // fall back to month-precise YYYY-MM-15.
    const monthYearPrefix = row.monthDate.slice(0, 4);
    const detailYear = detail.date?.slice(0, 4);
    const dateFromDetail = detail.date && detailYear === monthYearPrefix ? detail.date : undefined;
    if (dateFromDetail) detailHits++;
    else detailMisses++;

    events.push({
      date: dateFromDetail ?? row.monthDate,
      kennelTags: ["mh3-ca"],
      runNumber: row.runNumber,
      startTime: detail.startTime,
      hares: detail.hares,
      location: detail.location ?? row.rowLocation,
      sourceUrl: row.detailUrl,
    });
  }
  console.log(
    `  Detail enrichment: ${detailHits} hits (day-precise) / ${detailMisses} misses (month-precise fallback)`,
  );
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking mhhh.ca /trash/ archive (1996-2008)",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
