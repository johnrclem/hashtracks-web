import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { browserRender } from "@/lib/browser-render";
import { generateStructureHash } from "@/pipeline/structure-hash";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  extractHashRunNumber,
  HARE_BOILERPLATE_RE,
  normalizeHaresField,
  parse12HourTime,
  stripHtmlTags,
} from "../utils";

/**
 * Bangkok Hash (bangkokhash.com) adapter — one shared "HashWebApp" backend for
 * three kennels, each with its own Joomla front page:
 *   /thursday/   → Bangkok Thursday H3 (BTH3) — weekly Thu 18:30
 *   /fullmoon/   → Bangkok Full Moon H3 (BFMH3) — monthly Fri 18:30
 *   /siamsunday/ → Siam Sunday H3 (S2H3) — 2nd & 4th Sun 16:30
 *
 * The Nov-2026 site rebuild moved the data out of the Joomla articles into two
 * HashWebApp endpoints the front pages embed as iframes:
 *
 *   1. Hareline: `/HashWebApp/Runs/05_Hareline/ViewHL.php?a=false&b=BTH3`, whose
 *      script POSTs ViewHL_Server.php and renders `div.hl-month` headers +
 *      `div.hl-row` cards:
 *        .hl-date[title="Thursday 12 November 2026"], .hl-hare (or
 *        .hl-hare > .hl-wanted "Hare wanted!"), .hl-comment, .hl-num "#542".
 *      Note rows (`.hl-row.hl-note`) carry `.hl-notetext` instead — the BTH3
 *      feed cross-lists the Full Moon runs as "Fullmoon-262"; other notes are
 *      "Cancelled" / party markers.
 *
 *   2. Next-run directions: `/HashWebApp/Runs/05_Hareline/ViewNextRunDirections.php?b=BTH3`
 *      → `table.run` (caption "BTH3  Run #542"; th/td rows Date / Start Time /
 *      Hare / Station / Location / Restaurant / Google Maps) + `div.notes`
 *      (mis-directions, run fee). Enriches the matching hareline row.
 *
 * `parseNextRunArticle` (the pre-rebuild Joomla article parser) is kept for the
 * one-shot archive backfill scripts that still import it.
 *
 * Source config: `{ "subSite": "thursday" | "fullmoon" | "siamsunday" }`
 */

// Both pages are fetched through the NAS headless browser (`browserRender`):
// since the Nov 2026 rebuild the site hangs up on direct requests from both NAS
// relays (residential + VPN), while a real browser loads them normally. The
// render covers the page's default view; sources set `upcomingOnly` so past
// runs outside it are never reconcile-cancelled.

const HASHWEBAPP_BASE = "https://bangkokhash.com/HashWebApp/Runs/05_Hareline";

const FULLMOON_TIME = "18:30";

interface BangkokHashConfig {
  hashClub: string;    // "BTH3" | "BFMH3" | "S2H3"
  kennelTag: string;   // "bth3" | "bfmh3" | "s2h3"
  defaultTime: string; // "18:30" or "16:30"
  /** Tag for the "Fullmoon-NNN" rows this club's hareline cross-lists, if any. */
  fullmoonTag: string | null;
}

const SITE_CONFIGS: Record<string, BangkokHashConfig> = {
  thursday: { hashClub: "BTH3", kennelTag: "bth3", defaultTime: "18:30", fullmoonTag: "bfmh3" },
  fullmoon: { hashClub: "BFMH3", kennelTag: "bfmh3", defaultTime: FULLMOON_TIME, fullmoonTag: null },
  siamsunday: { hashClub: "S2H3", kennelTag: "s2h3", defaultTime: "16:30", fullmoonTag: null },
};

// #827: guard against label strings leaking as field values when the source
// emits an empty slot (e.g. "Run Site: Run Site:" → captures "Run Site:").
// Set membership beats an alternation regex for maintainability (and sidesteps
// SonarCloud's regex-complexity ceiling). Mirrors the `grab()` label list.
const FIELD_LABELS = new Set([
  "run site", "station", "restaurant", "location",
  "hare", "hares", "date", "start time",
  "when", "where",
  "google map", "google maps", "google map link", "google maps link",
]);

/** Collapse whitespace runs and trim. */
function squish(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/** Normalize a field label: "Google  Maps:" → "google maps". */
function normLabel(label: string): string {
  return squish(label).replace(/:\s*$/, "").toLowerCase();
}

function isFieldLabel(val: string): boolean {
  return FIELD_LABELS.has(normLabel(val));
}

/** Run-headline matcher ("Run #657", "Run 657"). No `g` flag → safe to reuse
 *  across `.test()` and `.exec()` (those are stateful only with `g`). The
 *  `\s*(?:#\s*)?` form avoids adjacent overlapping `\s*` quantifiers (ReDoS
 *  hygiene per the repo regex rule). */
const RUN_NUMBER_RE = /Run\s*(?:#\s*)?(\d+)/i;

/**
 * True when a "Run #NNN …" heading carries a trail name beyond the bare run
 * number (e.g. "Run #657, Suan Eden"). A bare "Run #519" returns false so the
 * caller falls back to the synthesized "<Kennel> Trail #N" instead of
 * persisting a run-number-only title — downstream consumers (e.g.
 * `calendar.ts` `buildTitle`) prepend the run number themselves and would
 * otherwise render it twice.
 */
function runHeadlineHasName(heading: string): boolean {
  const m = RUN_NUMBER_RE.exec(heading);
  if (!m) return false;
  const rest = heading.slice(0, m.index) + heading.slice(m.index + m[0].length);
  // Anything left after stripping separators is a trail name (Latin or Thai).
  return rest.replaceAll(/[\s,.:#@–—-]+/g, "").length > 0;
}

const HTTP_URL_RE = /^https?:\/\//i;

/**
 * Resolve the display location + maps URL from the candidate venue fields.
 * Prefers an explicit Location/Run Site/Station/Restaurant venue name; a
 * "Google Map" label on Run Site is dropped (it's not a venue). Some archive
 * pages put a maps URL directly in the `Location:` field — that's salvaged into
 * `locationUrl` rather than leaking as the venue label.
 */
function resolveLocation(
  locationRaw: string | undefined,
  runSite: string | undefined,
  station: string | undefined,
  restaurant: string | undefined,
  googleMap: string | undefined,
): { location: string | undefined; locationUrl: string | undefined } {
  const runSiteClean = runSite && !/^Google\s*Map/i.test(runSite) ? runSite : undefined;
  const candidate = locationRaw ?? runSiteClean ?? station ?? restaurant;
  const candidateIsUrl = !!candidate && HTTP_URL_RE.test(candidate);
  const location =
    candidate && !candidateIsUrl && candidate.length > 1 ? candidate : undefined;
  const mapUrl = googleMap && HTTP_URL_RE.test(googleMap) ? googleMap : undefined;
  const locationUrl = mapUrl ?? (candidateIsUrl ? candidate : undefined);
  return { location, locationUrl };
}

/**
 * Parse the Joomla next-run article. This has labeled fields in
 * `<strong>Label</strong>: Value` format within `.item-content`.
 *
 * Exported for unit testing.
 */
export function parseNextRunArticle(
  html: string,
  kennelTag: string,
  defaultTime: string,
  sourceUrl: string,
): RawEventData | null {
  const $ = cheerio.load(html);
  // `.item-content` is the homepage Next Run article; `.com-content-article__body`
  // is the archive detail template. Same labeled fields, different wrapper class.
  const article = $(".item-content, .com-content-article__body").first();
  if (!article.length) return null;

  const text = decodeEntities(stripHtmlTags(article.html() ?? "", "\n"));

  // #846: the post-colon whitespace class MUST NOT include `\n`; a bare `\s*`
  // consumes the newline after an empty slot and the capture group then bleeds
  // into the next labelled line (e.g. "Restaurant:\nGooglemaps: ..." captures
  // "Googlemaps: ..."). `[^\S\n]*` is horizontal whitespace only; `[^\n]+` in
  // the capture ensures we never cross a line boundary either. Also anchor at
  // start-of-line so "Date:" can't match inside a word like "Update:".
  const grab = (label: string): string | undefined => {
    const re = new RegExp(String.raw`(?:^|\n)\s*${label}\s*:[^\S\n]*([^\n]+)`, "i");
    const m = re.exec(text);
    const val = m?.[1]?.trim();
    if (!val) return undefined;
    if (isFieldLabel(val)) return undefined;
    return val;
  };

  // Pre-2022 BFMH3 archive uses "When:"/"Where:" instead of "Date:"/"Station:".
  const dateRaw = grab("Date") ?? grab("When");
  if (!dateRaw) return null;
  // Reject dateless entries (e.g. "Friday, January 1st") — chrono would default
  // to the current year and silently produce the wrong date.
  if (!/\b(19|20)\d{2}\b/.test(dateRaw)) return null;
  const date = chronoParseDate(dateRaw, "en-GB");
  if (!date) return null;

  const startTimeRaw = grab("Start\\s*Time");
  const startTime = startTimeRaw && /^\d{1,2}:\d{2}$/.test(startTimeRaw)
    ? startTimeRaw
    : defaultTime;

  // #802: the labeled `Hares:` field sometimes carries filler like "On On Q"
  // instead of a real name. Mirror the API-path boilerplate guard so we don't
  // ship "On On Q" as a hare name. #2189: fold the co-hare into the hares field
  // (the source lists `Hare:` and `Cohare:` on separate lines) so it stops
  // being dropped. `normalizeHaresField` sorts + dedupes, keeping the joined
  // value stable for fingerprinting regardless of source line order.
  const hareParts = [grab("Hares?"), grab("Cohares?")].filter(
    (v): v is string => !!v && !HARE_BOILERPLATE_RE.test(v),
  );
  const hare = hareParts.length > 0 ? hareParts.join(", ") : undefined;
  const station = grab("Station");
  const runSite = grab("Run\\s*Site");
  const restaurant = grab("Restaurant");
  const locationRaw = grab("Location") ?? grab("Where");
  const googleMap = grab("Google\\s*(?:maps?|Map)\\s*(?:Link)?");

  // #2189: the source headlines each run "Run #NNN, <Location>" in the article
  // heading. Use it as the event title instead of letting merge.ts synthesize
  // "<Kennel> Trail #N". The homepage nests `.item-title` INSIDE the parsed
  // `.item-content` article, so scope the lookup there to avoid grabbing a
  // sibling article's title on multi-article pages; archive detail pages put
  // the headline in a page-level `.page-header` OUTSIDE
  // `.com-content-article__body`, so fall back to that (one per detail page).
  // cheerio `.text()` already decodes entities, so no decodeEntities needed.
  const headingRaw = (
    article.find(".item-title").first().text() ||
    $(".page-header h1, .page-header h2").first().text()
  )
    .replaceAll(/\s+/g, " ")
    .trim();
  const title = runHeadlineHasName(headingRaw) ? headingRaw : undefined;

  // Extract the run number. On the homepage the heading lives inside
  // `.item-content` so it's in `text` too; on archive detail pages the
  // "Run #NNN" is ONLY in the page-header heading — so check the heading
  // first, then the body.
  const runMatch = RUN_NUMBER_RE.exec(headingRaw) ?? RUN_NUMBER_RE.exec(text);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  const { location, locationUrl } = resolveLocation(
    locationRaw,
    runSite,
    station,
    restaurant,
    googleMap,
  );

  return {
    date,
    kennelTags: [kennelTag],
    runNumber,
    title,
    hares: normalizeHaresField(hare),
    location,
    locationUrl,
    startTime,
    sourceUrl,
  };
}


/**
 * Normalize a hareline hare cell: "City Girl / Shaggy" → "City Girl, Shaggy";
 * filler like "On On Que" (#802) → undefined.
 */
function cleanHareCell(raw: string): string | undefined {
  const text = squish(raw);
  if (!text || HARE_BOILERPLATE_RE.test(text)) return undefined;
  return normalizeHaresField(text.split(/\s*[/&]\s*/).join(", "));
}

/** Options shared by the hareline + next-run parsers. */
export interface BangkokHashParseOptions {
  kennelTag: string;
  /** Route "Fullmoon-NNN" note rows to this tag (BTH3 feed only); null = skip. */
  fullmoonTag: string | null;
  defaultTime: string;
  sourceUrl: string;
}

/**
 * Parse the HashWebApp hareline `html` payload (`div.hl-row` cards).
 * Exported for unit testing.
 */
export function parseHarelineRows(html: string, opts: BangkokHashParseOptions): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  const seen = new Set<string>();

  $(".hl-row").each((_i, el) => {
    const $row = $(el);
    const dateTitle = $row.find(".hl-date").attr("title")?.trim();
    // "Thursday 12 November 2026" — a 4-digit year is always present.
    if (!dateTitle || !/\b(?:19|20)\d{2}\b/.test(dateTitle)) return;
    const date = chronoParseDate(dateTitle, "en-GB");
    if (!date) return;

    const note = squish($row.find(".hl-notetext").text());
    let event: RawEventData | undefined;
    if (note) {
      // Note rows: only the BTH3 feed's "Fullmoon-NNN" cross-listing is a run.
      // "Fullmoon - Cancelled", "Cancelled", "AGM & Xmas Party" are skipped.
      const fm = /^Fullmoon-(\d+)$/i.exec(note);
      if (!fm || !opts.fullmoonTag) return;
      event = {
        date,
        kennelTags: [opts.fullmoonTag],
        runNumber: Number.parseInt(fm[1], 10),
        startTime: FULLMOON_TIME,
        sourceUrl: opts.sourceUrl,
      };
    } else {
      const runNumber = extractHashRunNumber(squish($row.find(".hl-num").text()));
      const $hare = $row.find(".hl-hare").first().clone();
      const wanted = $hare.find(".hl-wanted").length > 0;
      $hare.find(".hl-wanted").remove();
      const hares = wanted ? undefined : cleanHareCell($hare.text());
      const comment = squish($row.find(".hl-comment").text());
      if (runNumber === undefined && !hares) return;
      event = {
        date,
        kennelTags: [opts.kennelTag],
        runNumber,
        hares,
        description: comment || undefined,
        startTime: opts.defaultTime,
        sourceUrl: opts.sourceUrl,
      };
    }

    const key = `${event.date}|${event.kennelTags[0]}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(event);
  });

  return events;
}

/** "6:30 pm" → "18:30"; "18:30" → "18:30"; anything else → undefined. */
function parseStartTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const twelveHour = parse12HourTime(raw);
  if (twelveHour) return twelveHour;
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw.padStart(5, "0") : undefined;
}

/**
 * Parse the HashWebApp next-run directions page (`table.run` + `div.notes`).
 * Returns null when the table has no parseable dated run.
 * Exported for unit testing.
 */
export function parseNextRunDirections(
  html: string,
  opts: Pick<BangkokHashParseOptions, "kennelTag" | "defaultTime" | "sourceUrl">,
): RawEventData | null {
  const { kennelTag, defaultTime, sourceUrl } = opts;
  const $ = cheerio.load(html);
  const $table = $("table.run").first();
  if (!$table.length) return null;

  const fields = new Map<string, string>();
  let mapsUrl: string | undefined;
  $table.find("tr").each((_i, tr) => {
    const label = normLabel($(tr).find("th").first().text());
    const $td = $(tr).find("td").first();
    if (!label || !$td.length) return;
    if ($td.find(".wanted").length > 0) return; // "Hare wanted!" placeholder
    const href = $td.find("a[href]").first().attr("href");
    if (label.startsWith("google map") && href && HTTP_URL_RE.test(href)) {
      mapsUrl = href;
      return;
    }
    const value = squish($td.text());
    if (value) fields.set(label, value);
  });

  // "Thursday 12-Nov-2026" → the D-Mon-YYYY fast-path in chronoParseDate.
  const dateRaw = fields.get("date");
  const dmy = dateRaw ? /\d{1,2}-[A-Za-z]{3}-\d{4}/.exec(dateRaw)?.[0] : undefined;
  const date = dmy ? chronoParseDate(dmy, "en-GB") : null;
  if (!date) return null;

  const startTime = parseStartTime(fields.get("start time")) ?? defaultTime;

  const caption = $table.find("caption").first().text();
  const runMatch = RUN_NUMBER_RE.exec(caption);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  const hareRaw = fields.get("hare") ?? fields.get("hares");
  const hares = hareRaw ? cleanHareCell(hareRaw) : undefined;

  const { location, locationUrl } = resolveLocation(
    fields.get("location"),
    fields.get("run site"),
    fields.get("station"),
    fields.get("restaurant"),
    mapsUrl,
  );

  // Notes: "The run directions will be posted…" (.soon) is a placeholder.
  // A "fee" line becomes `cost`; the remaining lines become the description.
  const noteLines: string[] = [];
  let cost: string | undefined;
  $("div.notes")
    .find("li, p")
    .not(".soon")
    .each((_i, el) => {
      // Skip a <p> that only wraps a list heading like "Mis-directions:".
      const line = squish($(el).text());
      if (!line || /:\s*$/.test(line)) return;
      const feeMatch = /\b(?:run\s*)?fee\s*[:-]\s*(.+)$/i.exec(line);
      if (feeMatch && !cost) {
        cost = feeMatch[1].trim();
        return;
      }
      noteLines.push(line);
    });
  // Restaurant is the on-after venue when a separate Location is given.
  const restaurant = fields.get("restaurant");
  if (restaurant && location && restaurant !== location) noteLines.push(`Restaurant: ${restaurant}`);

  return {
    date,
    kennelTags: [kennelTag],
    runNumber,
    hares,
    location,
    locationUrl,
    startTime,
    cost,
    description: noteLines.length > 0 ? noteLines.join("\n") : undefined,
    sourceUrl,
  };
}

/**
 * Render a HashWebApp page in the NAS headless browser and return its HTML.
 *
 * Since the Nov 2026 rebuild, bangkokhash.com drops direct requests from both
 * NAS relays (residential and VPN egress: "socket hang up" → proxy 502), while
 * the same pages load normally in a real browser. ViewHL.php's own script calls
 * ViewHL_Server.php from inside the page, so rendering it yields the hareline
 * markup (`div.hl-row`) that `parseHarelineRows` already parses. `waitFor`
 * makes the render wait for the script's rows / the next-run table.
 */
async function renderHashWebApp(url: string, waitFor: string): Promise<string | { error: string }> {
  try {
    return await browserRender({ url, waitFor, timeout: 45_000 });
  } catch (err) {
    return { error: `Browser render failed for ${url}: ${err}` };
  }
}

/** Overlay the next-run directions onto the matching hareline row (same date + kennel). */
function mergeNextRun(events: RawEventData[], nextRun: RawEventData): RawEventData[] {
  const idx = events.findIndex(
    (e) => e.date === nextRun.date && e.kennelTags[0] === nextRun.kennelTags[0],
  );
  if (idx === -1) return [...events, nextRun];
  const base = events[idx];
  const merged: RawEventData = {
    ...base,
    runNumber: nextRun.runNumber ?? base.runNumber,
    hares: nextRun.hares ?? base.hares,
    location: nextRun.location ?? base.location,
    locationUrl: nextRun.locationUrl ?? base.locationUrl,
    startTime: nextRun.startTime ?? base.startTime,
    cost: nextRun.cost ?? base.cost,
    description: [base.description, nextRun.description].filter(Boolean).join("\n") || undefined,
  };
  return events.map((e, i) => (i === idx ? merged : e));
}

export class BangkokHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const config = (source.config ?? {}) as Record<string, unknown>;
    const subSite = (config.subSite as string) ?? "thursday";
    const siteConfig = SITE_CONFIGS[subSite];
    if (!siteConfig) {
      return { events: [], errors: [`BangkokHash: unknown subSite "${subSite}"`] };
    }

    const { kennelTag, defaultTime, hashClub, fullmoonTag } = siteConfig;
    const sourceUrl = source.url || `https://bangkokhash.com/${subSite}/`;
    const parseOpts: BangkokHashParseOptions = { kennelTag, fullmoonTag, defaultTime, sourceUrl };
    const errors: string[] = [];
    const fetchStart = Date.now();

    const days = options?.days ?? source.scrapeDays ?? 365;

    // Both HashWebApp pages are rendered in the NAS headless browser (see
    // renderHashWebApp). The two renders are independent → run together.
    const nextRunUrl = `${HASHWEBAPP_BASE}/ViewNextRunDirections.php?b=${hashClub}`;
    const [harelineResult, nextRunResult] = await Promise.all([
      renderHashWebApp(`${HASHWEBAPP_BASE}/ViewHL.php?a=false&b=${hashClub}`, ".hl-row"),
      renderHashWebApp(nextRunUrl, "table.run"),
    ]);

    // 1. Hareline (the event list) — required.
    let events: RawEventData[] = [];
    if (typeof harelineResult === "string") {
      events = parseHarelineRows(harelineResult, parseOpts);
    } else {
      errors.push(harelineResult.error);
    }

    // 2. Next-run directions — best-effort enrichment for the upcoming run.
    let nextRunFound = false;
    let structureHash: string | undefined;
    if (typeof nextRunResult === "string") {
      structureHash = generateStructureHash(nextRunResult);
      const nextRun = parseNextRunDirections(nextRunResult, parseOpts);
      if (nextRun) {
        nextRunFound = true;
        events = mergeNextRun(events, nextRun);
      }
    } else if (events.length === 0) {
      // Only surface the enrichment failure when the hareline also produced
      // nothing; otherwise the scrape is still complete.
      errors.push(`Next-run page failed: ${nextRunResult.error}`);
    }

    if (events.length === 0 && errors.length === 0) {
      errors.push(`BangkokHash ${subSite}: zero events parsed`);
    }

    return applyDateWindow(
      {
        events,
        errors,
        structureHash,
        diagnosticContext: {
          fetchMethod: "browser-render:hashwebapp-hareline+next-run",
          subSite,
          hashClub,
          nextRunFound,
          fetchDurationMs: Date.now() - fetchStart,
        },
      },
      days,
    );
  }
}
