import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, MONTHS } from "../utils";
import { scrubHarePii } from "./sh3-pii";

/**
 * Seoul Hash House Harriers (SH3) — Seoul, South Korea.
 *
 * HashTracks' first 🇰🇷 kennel: "Korea's Mother Hash", men-only, est. 1972.
 * seoulhash.com is a plain-PHP SSR site (no JS render needed). `index.php`
 * server-renders exactly ONE block — the current week's run — inside a clean,
 * semantically-classed structure:
 *
 *   <div class="event">
 *     <div class="number">2897</div>            ← run number (bare integer)
 *     <div class="title">Anti-Celibacy Day</div> ← run theme
 *     <div class="section">
 *       <div class="label_value">
 *         <div class="label">Meeting Time:</div>
 *         <div class="value">2026/06/13 16:00</div>   ← full date + time
 *       </div>
 *       …Title / Location / Geo Coordinates / Hares / Apres Trail / Hash Cash…
 *     </div>
 *     <div class="section"><div class="subsection"><p>…prose…</p></div></div>
 *   </div>
 *
 * Because the classes are stable and descriptive, parsing keys on the visible
 * `.label` text via a `Map` (`.get()` avoids object-injection sinks) rather than
 * on the rotating-class flattened-text approach used by manila-h3.ts.
 *
 * The featured run's final `.subsection` is the forward "Hareline" schedule
 * (`<p>Hareline</p>` + year-less "<Month> <Day> - <hare>" lines). `fetch` emits
 * those as separate upcoming events (#2239), year-resolved off the featured run;
 * each carries only date + (optional) hares — the authoritative run number,
 * title, and time arrive when it later becomes the featured run.
 *
 * `archive.php` carries deep history in the SAME `.event` markup — the exported
 * `parseSeoulH3Events` is reused by the one-shot historical backfill (which does
 * not emit Hareline events).
 *
 * Forward-only page → `config.upcomingOnly: true` protects reconcile as runs
 * age off, and a mandatory fail-loud guard surfaces markup drift instead of
 * silently emitting `events: []` (the zero-event health alert can't catch that
 * on a brand-new source whose baseline is already 0).
 */

const KENNEL_TAG = "sh3-kr";
// Kennel default carried on Kennel.hashCash → only set Event.cost when a run differs.
const DEFAULT_HASH_CASH = "W10,000";
// "2026/06/13 16:00" (optionally trailed by " (Sunset: 19:53)") → date + time.
// Anchored at start, so the trailing parenthetical is ignored.
const MEETING_TIME_RE = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/;
// A bare "…/maps/place/" link with no place id/coords → not worth storing.
const BARE_MAPS_RE = /\/maps\/place\/?$/i;

// Homepage "Hareline" forward schedule (#2239): a `.subsection` whose first
// paragraph is "Hareline", followed by year-less "<Month> <Day> - <hare>" lines.
// `\b` (not `$`) tolerates a future "Hareline:" / "Hareline (…)" header variant
// rather than silently emitting zero forward events.
const HARELINE_HEADER_RE = /^hareline\b/i;
const HARELINE_DATE_RE = /^([A-Za-z]+)\s+(\d{1,2})\b/;
// "Hare needed" / "Hares needed" / "TBD" / "TBA" → no hare assigned yet.
const HARELINE_NO_HARE_RE = /^(?:hares?\s+needed|tb[ad])$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "Meeting Time:" / "Location: " → "meeting time" (lowercased, colon stripped). */
function labelKey(label: string): string {
  return label.replace(/:\s*$/, "").trim().toLowerCase();
}

/** Date (UTC noon) + "HH:MM" from "2026/06/13 16:00", or null on drift. */
function parseMeetingTime(value: string): { date: string; startTime: string } | null {
  const m = MEETING_TIME_RE.exec(value.trim());
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  const hour = Number.parseInt(m[4], 10);
  const minute = Number.parseInt(m[5], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Round-trip rejects impossible dates (e.g. 31 in a 30-day month).
  if (utc.getUTCDate() !== day || utc.getUTCMonth() !== month - 1) return null;
  return {
    date: utc.toISOString().slice(0, 10),
    startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** The first non-empty `<p>` text inside a subsection (its header line). */
function firstSubsectionText($: CheerioAPI, sub: Element): string {
  for (const p of $(sub).find("p").toArray()) {
    const text = $(p).text().trim();
    if (text) return text;
  }
  return "";
}

/** A subsection is the forward "Hareline" schedule when its header is "Hareline". */
function isHarelineSubsection($: CheerioAPI, sub: Element): boolean {
  return HARELINE_HEADER_RE.test(firstSubsectionText($, sub));
}

/** Parse one `.event` block into a RawEventData, or null on unparseable date. */
function parseEventBlock($: CheerioAPI, el: Element, sourceUrl: string): RawEventData | null {
  const $ev = $(el);

  // label → value map; Geo Coordinates href captured separately in the same pass.
  const labels = new Map<string, string>();
  let geoHref: string | undefined;
  $ev.find(".label_value").each((_i, lv) => {
    const label = labelKey($(lv).find(".label").first().text());
    if (!label) return;
    labels.set(label, $(lv).find(".value").first().text().trim());
    if (label === "geo coordinates") {
      geoHref = $(lv).find(".value a").first().attr("href")?.trim();
    }
  });

  const meeting = labels.get("meeting time");
  const dt = meeting ? parseMeetingTime(meeting) : null;
  if (!dt) return null; // caller fails loud

  const runText = $ev.find(".number").first().text().trim();
  const runNumber = /^\d+$/.test(runText) ? Number.parseInt(runText, 10) : undefined;

  // `.title` is the run theme; left undefined when blank → merge synthesizes
  // "Seoul H3 Trail #N".
  const title = $ev.find(".title").first().text().trim() || undefined;

  const location = labels.get("location") || undefined;
  // Scrub phone numbers / emails the live page may embed in hare names — the
  // merge pipeline's sanitizeHares does not strip mid-string PII (#2227).
  const hares = scrubHarePii(labels.get("hares"));

  const hashCash = labels.get("hash cash");
  const cost = hashCash && hashCash !== DEFAULT_HASH_CASH ? hashCash : undefined;

  // Store the Maps URL only if it carries a real place (not the bare stub).
  const locationUrl = geoHref && !BARE_MAPS_RE.test(geoHref) ? geoHref : undefined;

  // Prose subsections (theme/notes/directions) → description; on-after first.
  const proseParts: string[] = [];
  const apres = labels.get("apres trail");
  if (apres) proseParts.push(`Apres: ${apres}`);
  $ev.find(".section .subsection").each((_i, sub) => {
    // The forward "Hareline" schedule is emitted as its own events (#2239),
    // not folded into this run's description.
    if (isHarelineSubsection($, sub)) return;
    const text = $(sub).text().trim().replace(/\s+/g, " ");
    if (text) proseParts.push(text);
  });
  const description = proseParts.join("\n\n") || undefined;

  return {
    date: dt.date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    title,
    startTime: dt.startTime,
    location,
    hares,
    cost,
    description,
    locationUrl,
    sourceUrl,
  };
}

/**
 * Parse every `.event` block in a Seoul H3 page (index.php OR archive.php).
 * Blocks with an unparseable Meeting Time are skipped. Reused by the backfill.
 */
export function parseSeoulH3Events(html: string, sourceUrl: string): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $(".content .event").each((_i, el) => {
    const event = parseEventBlock($, el, sourceUrl);
    if (event) events.push(event);
  });
  return events;
}

/** Resolve a year-less month/day to `YYYY-MM-DD`, choosing the year that keeps
 *  the date on/after the anchor (handles the Dec→Jan wrap). Returns null for an
 *  impossible calendar date (e.g. Feb 30). */
function resolveForwardFromAnchor(
  month1: number,
  day: number,
  anchorMs: number,
): string | null {
  const anchorYear = new Date(anchorMs).getUTCFullYear();
  let ms = Date.UTC(anchorYear, month1 - 1, day, 12, 0, 0);
  let d = new Date(ms);
  // Roll to next year when the date is INVALID in the anchor year (e.g. Feb 29
  // off a non-leap anchor, which Date.UTC silently rolls to Mar 1) OR already
  // safely in the past — validate-first so a leap day resolves to the next leap
  // year instead of being dropped (Gemini review).
  const validInAnchorYear =
    d.getUTCMonth() === month1 - 1 && d.getUTCDate() === day;
  if (!validInAnchorYear || ms < anchorMs - DAY_MS) {
    ms = Date.UTC(anchorYear + 1, month1 - 1, day, 12, 0, 0);
    d = new Date(ms);
  }
  if (d.getUTCMonth() !== month1 - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Parse one "<Month> <Day> - <hare>" hareline line into a RawEventData, or null. */
function parseHarelineLine(
  line: string,
  anchorMs: number,
  sourceUrl: string,
): RawEventData | null {
  const sepIdx = line.indexOf(" - ");
  const datePart = sepIdx >= 0 ? line.slice(0, sepIdx).trim() : line.trim();
  const harePart = sepIdx >= 0 ? line.slice(sepIdx + 3).trim() : "";
  const dm = HARELINE_DATE_RE.exec(datePart);
  if (!dm) return null;
  const month1 = MONTHS[dm[1].toLowerCase()]; // 1-indexed; undefined when not a month
  if (month1 === undefined) return null;
  const date = resolveForwardFromAnchor(month1, Number.parseInt(dm[2], 10), anchorMs);
  if (!date) return null;
  // A real name is scrubbed for PII; a placeholder ("Hare needed" / "TBD")
  // emits null (explicit clear) — NOT undefined — so a hare previously assigned
  // to this forward date is wiped rather than preserved by the merge tri-state
  // when the assignment reverts to "Hare needed" (Codex review, #2239).
  const hares =
    harePart && !HARELINE_NO_HARE_RE.test(harePart)
      ? scrubHarePii(harePart)
      : null;
  // title / runNumber / startTime are left undefined: they arrive when the run
  // becomes the featured run, and the merge pipeline keys on kennel + date.
  return { date, kennelTags: [KENNEL_TAG], hares, sourceUrl };
}

/**
 * Parse the homepage "Hareline" forward schedule (index.php) into upcoming
 * RawEvents. The Hareline is a `.subsection` whose first paragraph is "Hareline"
 * followed by year-less "<Month> <Day> - <hare>" lines; the year is resolved
 * forward off `anchorDate` (the featured run's date). Returns [] when absent.
 */
export function parseSeoulHareline(
  html: string,
  anchorDate: string,
  sourceUrl: string,
): RawEventData[] {
  const anchorMs = Date.parse(`${anchorDate}T12:00:00Z`);
  if (Number.isNaN(anchorMs)) return [];
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  $(".content .event .section .subsection").each((_i, sub) => {
    if (!isHarelineSubsection($, sub)) return;
    $(sub)
      .find("p")
      .each((_j, p) => {
        const line = $(p).text().trim();
        if (!line || HARELINE_HEADER_RE.test(line)) return;
        const event = parseHarelineLine(line, anchorMs, sourceUrl);
        if (event) events.push(event);
      });
  });
  return events;
}

/**
 * Seoul H3 HTML scraper. Fetches index.php (static SSR — no browser render),
 * parses the single current run, and fails loud on markup/format drift.
 */
export class SeoulH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  // `options.days` is intentionally ignored: index.php renders the current run
  // plus a short forward "Hareline" — both already within any sane window.
  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || "https://seoulhash.com/index.php";
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const events = parseSeoulH3Events(html, url);

    if (events.length === 0) {
      return {
        events: [],
        errors: ["Seoul H3: no current run parsed"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    // index.php exposes the current featured run plus a forward "Hareline"
    // schedule (#2239). Emit the featured run + the upcoming Hareline entries,
    // year-resolved off the featured run's date.
    const featured = events[0];
    const hareline = parseSeoulHareline(html, featured.date, url);
    const all = [featured, ...hareline];

    return {
      events: all,
      errors: [],
      structureHash,
      diagnosticContext: {
        eventsParsed: all.length,
        harelineEvents: hareline.length,
        fetchDurationMs,
      },
    };
  }
}
