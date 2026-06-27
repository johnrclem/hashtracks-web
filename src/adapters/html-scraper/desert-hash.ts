/**
 * Desert Hash House Harriers (Dubai, UAE) — "DH3" — HTML Scraper
 *
 * HashTracks' first United Arab Emirates source. deserthash.org is a
 * WordPress/Elementor site whose events are published through a Modern Events
 * Calendar (MEC) widget. The whole WP REST surface (wp-json), The Events
 * Calendar REST, and the MEC REST endpoint are all disabled, so there is no
 * config-only path — this is a static Cheerio scrape of two SSR'd surfaces:
 *
 *   1. Home page (https://www.deserthash.org/) — the MEC "next event" card(s),
 *      i.e. the upcoming run(s). One `.mec-event-article` per run, carrying
 *      `.mec-start-date-label` (DD/MM/YYYY), `.mec-event-time` ("HH:MM - HH:MM"),
 *      and a title link `?mec-events=dh3-run-NNNN`.
 *   2. Hare Line (?page_id=5152) — a MEC "agenda" of the last ~50 runs, grouped
 *      by `.mec-month-divider` blocks that carry the YEAR (via the
 *      `mec-toggle-YYYYMM` toggle id and a `<h5>Month YYYY</h5>` heading). Each
 *      agenda day has `.mec-agenda-date` ("Month Day", no year),
 *      `.mec-start-time`/`.mec-end-time`, and the same run-link shape.
 *
 * Both surfaces are YEAR-BEARING (home: DD/MM/YYYY; Hare Line: year from the
 * month divider) — no year inference. Dates are stored UTC-noon; times "HH:MM".
 *
 * TITLE FILTER (mandatory): the same calendar also carries Moonshine H3 runs (a
 * separate Dubai kennel), and one-off non-runs ("Interhash 2026 – Indonesia").
 * Only entries whose link text matches `^DH3 – Run NNNN` are ingested under
 * `dh3-ae`. Numbered runs that happen to be virtual ("… – The War Edition –
 * ONLINE") are real DH3 runs and are kept (with their trailing theme as title).
 *
 * Each run also has a DETAIL page (?mec-events=dh3-run-NNNN) that publishes the
 * hare(s), the venue + Google Maps link, optional lat/lng, and a free-form
 * run-notes body. fetch() follows the in-window runs' detail links and enriches
 * each event with those fields (see `parseDetailPage`). The per-run contact-hare
 * phone number is PII and is deliberately NOT scraped.
 */

import type { Source } from "@/generated/prisma/client";
import * as cheerio from "cheerio";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, applyDateWindow, type FetchHTMLResult } from "../utils";

const HOME_URL = "https://www.deserthash.org/";
const HARELINE_PATH = "?page_id=5152";
const KENNEL_TAG = "dh3-ae";
const DEFAULT_SCRAPE_DAYS = 365;

const MONTHS = new Map<string, number>([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

// Title filter: "DH3 – Run NNNN" tolerating hyphen / en-dash / em-dash.
const RUN_TITLE_RE = /^DH3\s*[-–—]\s*Run\s+(\d+)/i;
// Leading separator + whitespace before a trailing theme (stripped, not split).
const LEADING_SEP_RE = /^[\s\-–—]+/;
const TIME_RE = /(\d{1,2}):(\d{2})/;
// Non-anchored: tolerate surrounding text in `.mec-event-date` (DD/MM/YYYY, UAE locale).
const DMY_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const TOGGLE_YEAR_RE = /mec-toggle-(\d{4})\d{2}/;
const YEAR_RE = /(20\d{2})/;

// ── Detail-page enrichment (issues #2323-#2326) ──────────────────────────────
// A Google-Maps link in the run-notes body, in any of the host forms MEC emits.
const MAPS_URL_RE = /maps\.app\.goo\.gl|google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.google/i;
// The event's coordinates, embedded in the gmap widget's `mecGoogleMaps({…})`
// init block. Only present when MEC carries a structured location.
const DETAIL_LAT_RE = /latitude:\s*"(-?\d+(?:\.\d+)?)"/;
const DETAIL_LNG_RE = /longitude:\s*"(-?\d+(?:\.\d+)?)"/;
// Bound the detail-page fan-out: enrich only the in-window runs, batched +
// capped so a future MEC format change can't trigger hundreds of fetches.
const DETAIL_FETCH_CONCURRENCY = 4;
const MAX_DETAIL_FETCHES = 60;

/** Per-run detail-enrichment tallies (surfaced in diagnosticContext). */
interface DetailDiagnostics {
  detailTargets: number;
  detailsEnriched: number;
  detailFetchFailures: number;
}

// ---------------------------------------------------------------------------
// Pure parse helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Normalize a single clock string ("7:05" / "19:00") to "HH:MM", or undefined. */
export function parseClock(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Split a "HH:MM - HH:MM" range into start/end. End omitted when absent. */
export function parseTimeRange(
  text: string | null | undefined,
): { startTime?: string; endTime?: string } {
  if (!text) return {};
  const parts = text.split(/[-–—]/);
  const startTime = parseClock(parts[0]);
  const endTime = parts.length > 1 ? parseClock(parts.slice(1).join("-")) : undefined;
  return { startTime, endTime };
}

/** Build a UTC-noon "YYYY-MM-DD" string from numeric components, or null. */
export function isoDate(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Title-filter + run number + optional trailing theme from a link's text.
 * Returns null when the text is not a "DH3 – Run NNNN" entry (drops Moonshine,
 * Interhash, and any non-run cards). Leaves `title` undefined unless a real
 * theme trails the run number — merge.ts then synthesizes "Desert H3 Trail #N".
 */
export function parseRunTitle(linkText: string): { runNumber: number; title?: string } | null {
  const text = linkText.replace(/\s+/g, " ").trim();
  const m = RUN_TITLE_RE.exec(text);
  if (!m) return null;
  const runNumber = Number.parseInt(m[1], 10);
  // Anything after the matched "DH3 – Run N" prefix is a trailing theme. Slice
  // (rather than a second backtracking regex) and strip the leading separator.
  const theme = text.slice(m[0].length).replace(LEADING_SEP_RE, "").trim();
  const title = theme.length > 1 ? theme : undefined;
  return { runNumber, title };
}

/** Parse "Month Day" (e.g. "June 22") into numeric month + day. */
export function parseMonthDay(text: string): { month?: number; day?: number } {
  let month: number | undefined;
  let day: number | undefined;
  for (const rawTok of text.trim().split(/\s+/)) {
    // Strip stray punctuation ("June," / "22," / "22nd") so the lookup + parse
    // are robust to minor MEC formatting variations.
    const tok = rawTok.replace(/[^a-zA-Z0-9]/g, "");
    const mm = MONTHS.get(tok.toLowerCase());
    if (mm) {
      month = mm;
      continue;
    }
    const n = Number.parseInt(tok, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 31) day = n;
  }
  return { month, day };
}

function buildEvent(
  parsed: { runNumber: number; title?: string },
  date: string,
  startTime: string | undefined,
  endTime: string | undefined,
  href: string | undefined,
): RawEventData {
  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: parsed.runNumber,
    title: parsed.title,
    startTime,
    endTime,
    sourceUrl: href || HOME_URL,
  };
}

/**
 * Parse the home-page MEC card(s) — the upcoming run(s). Each `.mec-event-article`
 * carries DD/MM/YYYY in `.mec-event-date`, a "HH:MM - HH:MM" `.mec-event-time`,
 * and a `.mec-event-title` run link.
 */
export function parseHomeUpcoming($: cheerio.CheerioAPI): RawEventData[] {
  const events: RawEventData[] = [];
  $(".mec-event-article").each((_i, el) => {
    const $card = $(el);
    const $link = $card.find(".mec-event-title a").first();
    const parsed = parseRunTitle($link.text());
    if (!parsed) return; // title filter

    const dateText = $card.find(".mec-event-date").first().text().trim();
    const dm = DMY_RE.exec(dateText);
    if (!dm) return; // year-bearing DD/MM/YYYY required
    const date = isoDate(
      Number.parseInt(dm[3], 10),
      Number.parseInt(dm[2], 10),
      Number.parseInt(dm[1], 10),
    );
    if (!date) return;

    const { startTime, endTime } = parseTimeRange($card.find(".mec-event-time").first().text());
    events.push(buildEvent(parsed, date, startTime, endTime, $link.attr("href")));
  });
  return events;
}

/** Extract the 4-digit year from a `.mec-month-divider` (toggle id, then heading). */
function dividerYear(toggleAttr: string | undefined, dividerText: string): number | undefined {
  const toggle = TOGGLE_YEAR_RE.exec(toggleAttr ?? "");
  if (toggle) return Number.parseInt(toggle[1], 10);
  const heading = YEAR_RE.exec(dividerText);
  return heading ? Number.parseInt(heading[1], 10) : undefined;
}

/**
 * Parse the Hare Line agenda — the last ~50 past runs. Month dividers carry the
 * YEAR; each agenda day block carries "Month Day" + a start/end time + run link.
 * MEC renders some rows in duplicate skins, so events are deduped by run number.
 */
export function parseHareLine($: cheerio.CheerioAPI): RawEventData[] {
  const byRun = new Map<number, RawEventData>();
  let currentYear: number | undefined;

  // Walk dividers and day-blocks in document order; a day belongs to the most
  // recent preceding divider's year.
  $(".mec-month-divider, .mec-events-agenda").each((_i, el) => {
    const $el = $(el);
    if ($el.hasClass("mec-month-divider")) {
      currentYear = dividerYear($el.attr("data-toggle-divider"), $el.text());
      return;
    }
    if (currentYear == null) return;

    const { month, day } = parseMonthDay($el.find(".mec-agenda-date").first().text());
    if (!month || !day) return;
    const date = isoDate(currentYear, month, day);
    if (!date) return;

    $el.find(".mec-agenda-event").each((_j, row) => {
      const $row = $(row);
      const $link = $row.find('a[href*="mec-events="]').first();
      if ($link.length === 0) return;
      const parsed = parseRunTitle($link.text());
      if (!parsed) return; // title filter (drops Moonshine)
      if (byRun.has(parsed.runNumber)) return; // dedup duplicate skins
      const startTime = parseClock($row.find(".mec-start-time").first().text());
      const endTime = parseClock($row.find(".mec-end-time").first().text());
      byRun.set(parsed.runNumber, buildEvent(parsed, date, startTime, endTime, $link.attr("href")));
    });
  });

  return [...byRun.values()];
}

// ---------------------------------------------------------------------------
// Detail-page parse (per-run hares / venue / maps / notes / coords)
// ---------------------------------------------------------------------------

export interface DesertDetail {
  hares?: string;
  location?: string;
  locationUrl?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
}

/** Collapse internal whitespace runs to single spaces and trim. */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract the event's coordinates from the gmap widget's `mecGoogleMaps({…})`
 * init block. Returns {} when either component is missing/non-finite, or when
 * both are 0 (MEC's no-location placeholder marker).
 */
function parseDetailCoords(html: string): { latitude?: number; longitude?: number } {
  const lat = DETAIL_LAT_RE.exec(html);
  const lng = DETAIL_LNG_RE.exec(html);
  if (!lat || !lng) return {};
  const latitude = Number.parseFloat(lat[1]);
  const longitude = Number.parseFloat(lng[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return {};
  if (latitude === 0 && longitude === 0) return {};
  return { latitude, longitude };
}

/**
 * Parse a run's MEC detail page into the enrichment fields the listing surfaces
 * lack. The body (`.mec-single-event-description`) is free-form: some runs lead
 * with the venue line (2456 "Goose Island Tap House, JVC"), others lead with a
 * note ("Note: this is a Sunday run …"). Coordinates are only emitted when MEC
 * carries a *structured* location, so their presence is the signal that the
 * first body paragraph is a trustworthy venue; without coords the body is
 * treated as notes only and no venue text is fabricated.
 *
 * The contact-hare phone number lives in a separate `dd.mec-organizer-tel` and
 * is PII — it is never read here.
 */
export function parseDetailPage(html: string): DesertDetail {
  const $ = cheerio.load(html);
  const detail: DesertDetail = {};

  // Hares — the organizer section titled "Hare(s)". Names sit in
  // `dd.mec-organizer .mec-meta-label` (the phone's `dd.mec-organizer-tel` is a
  // distinct class and is not matched here).
  const hareNames: string[] = [];
  $(".mec-single-event-organizer").each((_i, sec) => {
    const $sec = $(sec);
    const title = $sec.find(".mec-events-single-section-title").first().text().toLowerCase();
    if (!title.includes("hare")) return;
    $sec.find("dd.mec-organizer .mec-meta-label").each((_j, el) => {
      const name = collapseWs($(el).text());
      if (name && !/^phone$/i.test(name)) hareNames.push(name);
    });
  });
  if (hareNames.length > 0) detail.hares = hareNames.join(", ");

  const coords = parseDetailCoords(html);
  if (coords.latitude != null && coords.longitude != null) {
    detail.latitude = coords.latitude;
    detail.longitude = coords.longitude;
  }

  // Venue / Maps link / notes from the free-form description body.
  const $desc = $(".mec-single-event-description").first();
  if ($desc.length > 0) {
    const contentParas: string[] = [];
    $desc.find("p").each((_i, p) => {
      const $p = $(p);
      const text = collapseWs($p.text());
      if (!text) return; // image-only / empty paragraph
      const $maps = $p
        .find("a[href]")
        .filter((_j, a) => MAPS_URL_RE.test($(a).attr("href") ?? ""))
        .first();
      if ($maps.length > 0 && !detail.locationUrl) detail.locationUrl = $maps.attr("href");
      // A paragraph that is ONLY a maps anchor ("Google Map Link") is not content.
      if ($maps.length > 0 && text === collapseWs($maps.text())) return;
      contentParas.push(text);
    });
    // First body line is the venue only when MEC supplied structured coords.
    if (coords.latitude != null && contentParas.length > 0) {
      detail.location = contentParas.shift();
    }
    const body = contentParas.join("\n").trim();
    if (body) detail.description = body;
  }

  return detail;
}

/**
 * Merge one fetched surface into `byRun`, recording fetch/parse errors. Returns
 * the page's structureHash + fetch duration (0 for a failed fetch). Extracted
 * from fetch() so each surface is handled by one small, low-complexity unit.
 */
function collectSurface(
  page: FetchHTMLResult,
  parser: ($: cheerio.CheerioAPI) => RawEventData[],
  label: string,
  byRun: Map<number, RawEventData>,
  errors: string[],
  errorDetails: ErrorDetails,
): { structureHash?: string; fetchDurationMs: number } {
  if (!page.ok) {
    errors.push(...page.result.errors.map((e) => `${label}: ${e}`));
    const fetchErrs = page.result.errorDetails?.fetch;
    if (fetchErrs) {
      errorDetails.fetch ??= [];
      errorDetails.fetch.push(...fetchErrs);
    }
    return { fetchDurationMs: 0 };
  }
  try {
    for (const e of parser(page.$)) {
      if (e.runNumber != null) byRun.set(e.runNumber, e);
    }
  } catch (err) {
    errors.push(`${label} parse error: ${err}`);
    errorDetails.parse ??= [];
    errorDetails.parse.push({ row: 0, section: label.toLowerCase().replaceAll(" ", ""), error: String(err) });
  }
  return { structureHash: page.structureHash, fetchDurationMs: page.fetchDurationMs };
}

export class DesertHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    // Normalize the base URL so `new URL()` never throws on a protocol-relative
    // or relative `source.url`; fall back to the canonical host.
    let baseUrl = source.url || HOME_URL;
    if (baseUrl.startsWith("//")) baseUrl = `https:${baseUrl}`;
    else if (!/^https?:\/\//i.test(baseUrl)) baseUrl = HOME_URL;
    const harelineUrl = new URL(HARELINE_PATH, baseUrl).href;

    const [homePage, harelinePage] = await Promise.all([
      fetchHTMLPage(baseUrl),
      fetchHTMLPage(harelineUrl),
    ]);

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const byRun = new Map<number, RawEventData>();

    // Hare Line (primary, recent ~50) first; Home (upcoming) second so it wins
    // on a run-number conflict (it's the live next run).
    const hare = collectSurface(harelinePage, parseHareLine, "Hare Line", byRun, errors, errorDetails);
    const home = collectSurface(homePage, parseHomeUpcoming, "Home", byRun, errors, errorDetails);
    const structureHash = hare.structureHash ?? home.structureHash;
    const fetchDurationMs = hare.fetchDurationMs + home.fetchDurationMs;

    const events = [...byRun.values()];

    // Zero-row fail-loud guard: brand-new single source, baseline fill-rate 0.
    // Without it a silent `events: []` would let reconcile.ts proceed on partial
    // data and false-CANCEL live runs. Only fire when no fetch/parse error
    // already surfaced (those make the scrape fail loud on their own).
    if (events.length === 0 && !hasAnyErrors(errorDetails)) {
      const message =
        "Desert H3 scraper parsed 0 DH3 runs — possible MEC format drift or title-filter regression";
      errors.push(message);
      errorDetails.parse ??= [];
      errorDetails.parse.push({ row: 0, error: message });
    }

    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };

    const windowed = applyDateWindow(
      result,
      options?.days ?? source.scrapeDays ?? DEFAULT_SCRAPE_DAYS,
    );

    // Enrich the in-window runs with detail-page hares / venue / maps / notes /
    // coords (issues #2323-#2326). Best-effort: an individual detail fetch/parse
    // failure is recorded in diagnostics but never pushed to `errors[]`, so it
    // can't turn a successful listing scrape into a FAILED run (which would skip
    // reconcile of genuinely-removed runs — the listing surfaces still produced
    // valid date/run#/time for every event).
    const detailDiag: DetailDiagnostics = {
      detailTargets: 0,
      detailsEnriched: 0,
      detailFetchFailures: 0,
    };
    await this.enrichWithDetails(windowed.events, detailDiag);
    windowed.diagnosticContext = { ...windowed.diagnosticContext, ...detailDiag };

    // Surface SYSTEMIC enrichment failure (every detail fetch failed) so the
    // health/audit pipeline can flag a detail-page block or markup drift — but
    // via `errorDetails` only, NOT `errors[]`, so the healthy listing still
    // reconciles instead of leaving stale runs uncancelled (Codex review).
    if (detailDiag.detailTargets > 0 && detailDiag.detailFetchFailures === detailDiag.detailTargets) {
      const message =
        `Desert H3: detail-page enrichment failed for all ${detailDiag.detailTargets} in-window runs ` +
        `(hares/venue/notes unavailable — detail-page block or MEC markup drift?)`;
      const ed: ErrorDetails = windowed.errorDetails ?? {};
      (ed.parse ??= []).push({ row: -1, section: "detail", error: message });
      windowed.errorDetails = ed;
    }

    return windowed;
  }

  /** Follow each in-window run's detail link and merge enrichment fields. */
  private async enrichWithDetails(
    events: RawEventData[],
    diagnostics: DetailDiagnostics,
  ): Promise<void> {
    const targets = events
      .filter((e) => e.sourceUrl?.includes("mec-events="))
      .slice(0, MAX_DETAIL_FETCHES);
    diagnostics.detailTargets = targets.length;

    for (let i = 0; i < targets.length; i += DETAIL_FETCH_CONCURRENCY) {
      const batch = targets.slice(i, i + DETAIL_FETCH_CONCURRENCY);
      // Sequential by design: bounded batches keep the fan-out polite.
      await Promise.all(batch.map((e) => this.enrichOne(e, diagnostics)));
    }
  }

  private async enrichOne(
    e: RawEventData,
    diagnostics: DetailDiagnostics,
  ): Promise<void> {
    const url = e.sourceUrl;
    if (!url) return;
    const page = await fetchHTMLPage(url);
    if (!page.ok) {
      diagnostics.detailFetchFailures++;
      return;
    }
    try {
      const d = parseDetailPage(page.html);
      let enriched = false;
      if (d.hares) { e.hares = d.hares; enriched = true; }
      if (d.location) { e.location = d.location; enriched = true; }
      if (d.locationUrl) { e.locationUrl = d.locationUrl; enriched = true; }
      if (d.description) { e.description = d.description; enriched = true; }
      if (d.latitude != null && d.longitude != null) {
        e.latitude = d.latitude;
        e.longitude = d.longitude;
        enriched = true;
      }
      if (enriched) diagnostics.detailsEnriched++;
    } catch {
      diagnostics.detailFetchFailures++;
    }
  }
}
