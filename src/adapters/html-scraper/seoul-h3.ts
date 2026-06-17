import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage } from "../utils";
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
 * `archive.php` carries deep history in the SAME `.event` markup — the exported
 * `parseSeoulH3Events` is reused by the one-shot historical backfill.
 *
 * Single current-run page → `config.upcomingOnly: true` protects reconcile as
 * the run ages off, and a mandatory fail-loud guard surfaces markup drift
 * instead of silently emitting `events: []` (the zero-event health alert can't
 * catch that on a brand-new source whose baseline is already 0).
 */

const KENNEL_TAG = "sh3-kr";
// Kennel default carried on Kennel.hashCash → only set Event.cost when a run differs.
const DEFAULT_HASH_CASH = "W10,000";
// "2026/06/13 16:00" (optionally trailed by " (Sunset: 19:53)") → date + time.
// Anchored at start, so the trailing parenthetical is ignored.
const MEETING_TIME_RE = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/;
// A bare "…/maps/place/" link with no place id/coords → not worth storing.
const BARE_MAPS_RE = /\/maps\/place\/?$/i;

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

/**
 * Seoul H3 HTML scraper. Fetches index.php (static SSR — no browser render),
 * parses the single current run, and fails loud on markup/format drift.
 */
export class SeoulH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  // `options.days` is intentionally ignored: index.php renders exactly one
  // event (the current week's run) with no date-range concept to filter.
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

    // index.php exposes only the current run; take the first defensively.
    return {
      events: [events[0]],
      errors: [],
      structureHash,
      diagnosticContext: { eventsParsed: 1, fetchDurationMs },
    };
  }
}
