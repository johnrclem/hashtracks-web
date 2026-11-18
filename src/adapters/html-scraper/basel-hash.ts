/**
 * Basel-Stadt H3 (Basel, Switzerland) HTML Scraper
 *
 * basel.harrier.eu.org is a static PHP site. `hareline.php` lists every run since
 * 1996 in one `<ul>`:
 *   <li><a title="Run #396" href="runs.php?run=396">Run #396: 15/11/2026
 *       Münchenstein Train Station (Chunder Woman/Against Nature)</a>
 * Time, coordinates and notes live on `runs.php?run=N`. The next run (a
 * "TBD / Who knows... maybe you?" placeholder) is absent from the list until a
 * venue is posted, so it is picked up from `rss.php`.
 *
 * Only a recent + future window is emitted (detail GETs are bounded to ~15 per
 * scrape); the older archive arrives through the one-shot history backfill, so
 * the source must be upcomingOnly.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { buildDateWindow, fetchHTMLPage, MONTHS } from "../utils";

const KENNEL_TAG = "bsh3-ch";
const BASE_URL = "https://basel.harrier.eu.org/";
const DEFAULT_URL = `${BASE_URL}hareline.php`;
const RSS_URL = `${BASE_URL}rss.php`;
const MIN_LIST_ROWS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_CAP_DAYS = 90;

const ROW_RE = /^Run #(\d{1,5}):\s*(\d{2})\/(\d{2})\/(\d{4})\s*(.*)$/;
const COORD_RE = /var lat\s*=\s*(-?\d+(?:\.\d+)?);\s*var lng\s*=\s*(-?\d+(?:\.\d+)?);/;
const RSS_TITLE_RE = /Run #(\d{1,5}):\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const URL_RE = /https?:\/\/\S+/g;
// Also catches the site's anti-spam "name @ harrier.ch" / "name@ harrier.ch" spacing.
const EMAIL_RE = /[\w.+-]+\s?@\s?[\w-]+(?:\.[\w-]+)+/g;
// 7+ digits, optionally grouped by spaces / dashes / dots / parentheses, with an optional +.
const PHONE_RE = /(?:\+\d[\d ]{0,3})?\(?\d[\d ().-]{5,}\d/g;
const NO_DETAILS = "no run details available.";

export interface BaselRow {
  runNumber: number;
  date: string; // YYYY-MM-DD
  location?: string;
  hares?: string;
}

export interface BaselDetail {
  startTime?: string;
  hares?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  return v === "" || v === "tbd" || v.startsWith("who knows");
}

function cleanText(value: string | undefined): string | undefined {
  const v = value?.replaceAll(" ", " ").replace(/\s+/g, " ").trim();
  return isPlaceholder(v) ? undefined : v;
}

/** Remove URLs (map links embed coordinates), phone numbers and e-mail addresses from free text. */
export function scrubContacts(text: string): string {
  return text.replace(URL_RE, "").replace(EMAIL_RE, "").replace(PHONE_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

/** Split "Venue (Hare A/Hare B)" at the LAST parenthesised group (venues may contain parentheses). */
function splitTrailingParen(rest: string): { venue: string; paren?: string } {
  const text = rest.trim();
  if (!text.endsWith(")")) return { venue: text };
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(") {
      depth--;
      if (depth === 0) return { venue: text.slice(0, i).trim(), paren: text.slice(i + 1, -1).trim() };
    }
  }
  return { venue: text };
}

/** "A/B" → "A, B"; a slash with a space beside it is part of one name ("Out of Africa / Mausi"). */
export function splitListHares(paren: string | undefined): string | undefined {
  const v = cleanText(paren);
  if (!v) return undefined;
  const names = v
    .split(/(?<! )\/(?! )/)
    .map((n) => cleanText(n))
    .filter((n): n is string => !!n);
  return names.length > 0 ? names.join(", ") : undefined;
}

/** Parse one hareline anchor text ("Run #N: DD/MM/YYYY venue (hares)"). */
export function parseHarelineRow(text: string): BaselRow | null {
  const m = ROW_RE.exec(text.replaceAll(" ", " ").replace(/\s+/g, " ").trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[2]), Number(m[3]), Number(m[4])];
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const { venue, paren } = splitTrailingParen(m[5]);
  return {
    runNumber: Number.parseInt(m[1], 10),
    date: dt.toISOString().slice(0, 10),
    location: cleanText(venue),
    hares: splitListHares(paren),
  };
}

/** Pull startTime / hares / description / coordinates out of a `runs.php?run=N` page. */
export function parseDetailPage(html: string, $: import("cheerio").CheerioAPI): BaselDetail {
  const labelCell = (label: RegExp) =>
    $("td")
      .filter((_i, el) => $(el).children("b").length > 0 && label.test($(el).text().trim()))
      .first()
      .next("td");

  const timeText = labelCell(/^Time:/).text().trim();
  const t = TIME_RE.exec(timeText);
  const startTime = t ? `${t[1].padStart(2, "0")}:${t[2]}` : undefined;

  // Hares: "<script>write_mail(...)</script><noscript>Name</noscript> and Other" — drop the script call.
  const hareCell = labelCell(/^Hares?:/).clone();
  hareCell.find("script").remove();
  const hareNames = hareCell
    .text()
    .replaceAll(" ", " ")
    .split(/\s+and\s+|,/)
    .map((n) => cleanText(n))
    .filter((n): n is string => !!n);
  const hares = hareNames.length > 0 ? hareNames.join(", ") : undefined;

  const paragraphs = labelCell(/^Details:/)
    .find("p")
    .map((_i, p) => $(p).text().replaceAll(" ", " ").replace(/\s+/g, " ").trim())
    .get()
    .filter((p) => p && p.toLowerCase() !== NO_DETAILS && !/^Hares?:/i.test(p));
  const description = paragraphs.length > 0 ? scrubContacts(paragraphs.join("\n")) || undefined : undefined;

  const c = COORD_RE.exec(html);
  const latitude = c ? Number.parseFloat(c[1]) : undefined;
  const longitude = c ? Number.parseFloat(c[2]) : undefined;
  const hasCoords = latitude !== undefined && longitude !== undefined && !(latitude === 0 && longitude === 0);

  return {
    startTime,
    hares,
    description,
    latitude: hasCoords ? latitude : undefined,
    longitude: hasCoords ? longitude : undefined,
  };
}

/** Merge a list row and (optionally) its detail page into a RawEventData. */
export function buildBaselEvent(row: BaselRow, detail?: BaselDetail): RawEventData {
  return {
    date: row.date,
    kennelTags: [KENNEL_TAG],
    runNumber: row.runNumber,
    startTime: detail?.startTime,
    location: row.location,
    hares: detail?.hares ?? row.hares,
    description: detail?.description,
    latitude: detail?.latitude,
    longitude: detail?.longitude,
    sourceUrl: `${BASE_URL}runs.php?run=${row.runNumber}`,
  };
}

/** "Run #397: December 13th 2026" → { runNumber, date }. */
export function parseRssNextRun(xml: string): { runNumber: number; date: string } | null {
  const item = /<item>([\s\S]*?)<\/item>/.exec(xml);
  const title = item ? /<title>([^<]*)<\/title>/.exec(item[1]) : null;
  const m = title ? RSS_TITLE_RE.exec(title[1]) : null;
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  const day = Number.parseInt(m[3], 10);
  const year = Number.parseInt(m[4], 10);
  if (!month) return null;
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (dt.getUTCDate() !== day) return null;
  return { runNumber: Number.parseInt(m[1], 10), date: dt.toISOString().slice(0, 10) };
}

async function fetchWithRetry(url: string) {
  const first = await fetchHTMLPage(url);
  if (first.ok) return first;
  return fetchHTMLPage(url); // the site occasionally resets HTTP/2 streams
}

export class BaselHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchWithRetry(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const rows: BaselRow[] = $('li > a[title^="Run #"]')
      .map((_i, a) => parseHarelineRow($(a).text()))
      .get()
      .filter((r): r is BaselRow => r !== null);

    if (rows.length < MIN_LIST_ROWS) {
      return {
        events: [],
        errors: [
          `Basel-Stadt H3: only ${rows.length} hareline rows parsed (expected the full 390+ run archive) — markup drift`,
        ],
        structureHash,
        diagnosticContext: { rowCount: rows.length, fetchDurationMs },
      };
    }

    const days = options?.days ?? 365;
    const { maxDate } = buildDateWindow(days);
    const minDate = new Date(Date.now() - Math.min(days, LOOKBACK_CAP_DAYS) * DAY_MS);
    const inWindow = rows.filter((r) => {
      const d = new Date(`${r.date}T12:00:00Z`);
      return d >= minDate && d <= maxDate;
    });

    const events: RawEventData[] = [];
    const errors: string[] = [];
    for (const row of inWindow) {
      const detailPage = await fetchWithRetry(`${BASE_URL}runs.php?run=${row.runNumber}`);
      if (detailPage.ok) {
        events.push(buildBaselEvent(row, parseDetailPage(detailPage.html, detailPage.$)));
      } else {
        // The list row alone is still a valid event; a missing detail page only loses time/notes.
        events.push(buildBaselEvent(row));
      }
    }

    // Next-run placeholder: only on the RSS feed until a venue is posted. A bonus, never an error.
    const maxRow = Math.max(...rows.map((r) => r.runNumber));
    let nextRun: number | undefined;
    try {
      const rss = await fetchWithRetry(RSS_URL);
      if (rss.ok) {
        const next = parseRssNextRun(rss.html);
        const today = new Date().toISOString().slice(0, 10);
        if (next && next.runNumber > maxRow && next.date >= today) {
          const detailPage = await fetchWithRetry(`${BASE_URL}runs.php?run=${next.runNumber}`);
          const detail = detailPage.ok ? parseDetailPage(detailPage.html, detailPage.$) : undefined;
          events.push(buildBaselEvent({ runNumber: next.runNumber, date: next.date }, detail));
          nextRun = next.runNumber;
        }
      }
    } catch {
      // ignore — RSS is optional
    }

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: { rowCount: rows.length, emitted: events.length, nextRun, fetchDurationMs },
    };
  }
}
