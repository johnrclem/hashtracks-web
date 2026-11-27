import type { CheerioAPI, Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, filterEventsByWindow, isoDate, normalizeHaresField } from "../utils";

// Taipei Hash House Harriers (台北捷兔) — Taiwan's oldest hash (founded 1973).
// Static Cheerio scrape of the server-rendered hareline at
// taipeihash.com.tw/runs. The site was rebuilt in Nov 2026: the legacy
// run_site.php (year-less MM/DD <table.events-table> rows) now 301s to /runs,
// which renders:
//   - 本週活動 / 未來預告: <article.hm-run> cards — run number, full
//     "YYYY/MM/DD（六） Sat" date, run site, hares (+ tel links, PII), meeting
//     place with a Maps shortlink, optional <span.hm-badge> event tag.
//   - 本年度歷史足跡: <div.hm-recent-row> rows — run number, YYYY/MM/DD, run
//     site, optional badge, Maps link (no hares).
// A JSON-LD @graph carries a startDate per upcoming run; we read its HH:MM and
// fall back to the published "every Saturday at 2:30 PM".

const KENNEL_TAG = "taipei-h3";
const DEFAULT_URL = "https://www.taipeihash.com.tw/runs";
const LEGACY_PATH = "/run_site.php";
const DEFAULT_START_TIME = "14:30"; // "每星期六下午 2:30 起跑"

const DATE_RE = /(\d{4})\/(\d{1,2})\/(\d{1,2})/; // YYYY/MM/DD — ignores weekday tail
const RUN_RE = /(\d+)/;
const LD_RUN_RE = /#\s?(\d+)/;
const LD_TIME_RE = /T(\d{2}):(\d{2})/;
// Strip a phone number if a hare's tel link ever loses its <a>. Single char
// class, bounded — ReDoS-safe.
const PHONE_RE = /0\d[\d\s-]{6,15}/g;
const MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
]);

/** The rebuilt site serves the hareline at /runs; the old path only redirects. */
export function resolveRunsUrl(url: string | null | undefined): string {
  if (!url) return DEFAULT_URL;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith(LEGACY_PATH)) {
      parsed.pathname = parsed.pathname.slice(0, -LEGACY_PATH.length) + "/runs";
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Run number from a "#2803" span. */
function parseRunNumber($el: Cheerio<Element>): number | null {
  const match = RUN_RE.exec($el.text());
  return match ? Number(match[1]) : null;
}

/** "2026/11/28（六） Sat" → "2026-11-28" (round-trip validated), else null. */
export function parseTaipeiDate(text: string): string | null {
  const match = DATE_RE.exec(text);
  if (!match) return null;
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** "<span>中文</span><span class="hm-en">English</span>" → "中文 English". */
function bilingualText($: CheerioAPI, $el: Cheerio<Element>): string | undefined {
  const clone = $el.clone();
  clone.find("a").remove();
  const parts = clone
    .children("span")
    .toArray()
    .map((s) => squash($(s).text()))
    .filter(Boolean);
  const text = parts.length > 0 ? parts.join(" ") : squash(clone.text());
  return text.length > 0 ? text : undefined;
}

/** https Google Maps link only (host allowlist) — never persist a hostile href. */
function parseMapsUrl($scope: Cheerio<Element>): string | undefined {
  const href = $scope.find("a.hm-map").first().attr("href")?.trim();
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "https:") return undefined;
    return MAPS_HOSTS.has(parsed.hostname.toLowerCase()) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Hare(s), tel links (PII) dropped; normalizeHaresField dedupes + sorts. */
function parseHares($: CheerioAPI, $dd: Cheerio<Element>): string | undefined {
  const names = $dd
    .find(".hm-person")
    .toArray()
    .map((p) => {
      const clone = $(p).clone();
      clone.find("a").remove();
      return squash(clone.text().replace(PHONE_RE, ""));
    })
    .filter(Boolean);
  return normalizeHaresField(names.join(", "));
}

/** Find the <dd> that follows a <dt> whose label starts with `label`. */
function ddFor($: CheerioAPI, $dl: Cheerio<Element>, label: string): Cheerio<Element> | null {
  const dt = $dl
    .find("dt")
    .toArray()
    .find((el) => squash($(el).text()).startsWith(label));
  if (!dt) return null;
  const dd = $(dt).nextAll("dd").first();
  return dd.length > 0 ? dd : null;
}

/** "<meeting point> (<district>)", or whichever exists. */
function buildLocation(district: string | undefined, meeting: string | undefined): string | undefined {
  if (meeting && district) return `${meeting} (${district})`;
  return meeting ?? district;
}

/** Map run number → "HH:MM" from the JSON-LD Event startDates. */
function parseLdStartTimes($: CheerioAPI): Map<number, string> {
  const times = new Map<number, string>();
  $("script[type='application/ld+json']").each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).text());
    } catch {
      return;
    }
    const graph = (data as { "@graph"?: unknown })?.["@graph"];
    const nodes = Array.isArray(graph) ? graph : [data];
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const { "@type": type, name, startDate } = node as Record<string, unknown>;
      if (type !== "Event" || typeof name !== "string" || typeof startDate !== "string") continue;
      const run = LD_RUN_RE.exec(name);
      const time = LD_TIME_RE.exec(startDate);
      if (run && time) times.set(Number.parseInt(run[1], 10), `${time[1]}:${time[2]}`);
    }
  });
  return times;
}

interface ParseContext {
  $: CheerioAPI;
  sourceUrl: string;
  ldTimes: Map<number, string>;
  errors: string[];
  parseErrors: ParseError[];
}

function recordBadRow(ctx: ParseContext, i: number, section: string, $el: Cheerio<Element>): void {
  const message = `Unparseable ${section} row ${i}: missing run number or YYYY/MM/DD date`;
  ctx.errors.push(message);
  ctx.parseErrors.push({ row: i, section, error: message, rawText: squash($el.text()).slice(0, 2000) });
}

function badgeOf($el: Cheerio<Element>): string | undefined {
  const text = squash($el.find(".hm-badge").first().text());
  return text.length > 0 ? text : undefined;
}

/** 本週活動 + 未來預告 cards. */
function parseCards(ctx: ParseContext): RawEventData[] {
  const { $ } = ctx;
  const events: RawEventData[] = [];
  $("article.hm-run").each((i, el) => {
    const $card = $(el);
    const runNumber = parseRunNumber($card.find(".hm-run-no").first());
    const date = parseTaipeiDate($card.find(".hm-run-date").first().text());
    if (runNumber === null || date === null) {
      recordBadRow(ctx, i, "runs-card", $card);
      return;
    }
    const $dl = $card.find("dl").first();
    const siteDd = $dl.find("dd.hm-site").first();
    const district = siteDd.length > 0 ? bilingualText($, siteDd) : undefined;
    const hareDd = ddFor($, $dl, "兔子");
    const meetDd = ddFor($, $dl, "集合地點");
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      startTime: ctx.ldTimes.get(runNumber) ?? DEFAULT_START_TIME,
      hares: hareDd ? parseHares($, hareDd) : undefined,
      location: buildLocation(district, meetDd ? bilingualText($, meetDd) : undefined),
      locationUrl: meetDd ? parseMapsUrl(meetDd) : parseMapsUrl($card),
      description: badgeOf($card.find(".hm-run-head").first()),
      sourceUrl: ctx.sourceUrl,
    });
  });
  return events;
}

/** 本年度歷史足跡 rows (no hares or start time published). */
function parseRecentRows(ctx: ParseContext): RawEventData[] {
  const { $ } = ctx;
  const events: RawEventData[] = [];
  $("div.hm-recent-row").each((i, el) => {
    const $row = $(el);
    const runNumber = parseRunNumber($row.find(".hm-run-no").first());
    const date = parseTaipeiDate($row.find(".hm-recent-date").first().text());
    if (runNumber === null || date === null) {
      recordBadRow(ctx, i, "runs-recent", $row);
      return;
    }
    const site = $row.find(".hm-recent-site").first();
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      // No default here: the start moved from 15:00 to 14:30 at some point in
      // 2026, so a constant would rewrite older runs' times. undefined keeps
      // whatever earlier scrapes stored.
      startTime: ctx.ldTimes.get(runNumber),
      location: site.length > 0 ? bilingualText($, site) : undefined,
      locationUrl: parseMapsUrl($row),
      description: badgeOf($row),
      sourceUrl: ctx.sourceUrl,
    });
  });
  return events;
}

/** Parse the /runs page into events deduped by run number (cards win). */
export function parseTaipeiHash(
  $: CheerioAPI,
  sourceUrl: string,
): { events: RawEventData[]; rowsFound: number; errors: string[]; parseErrors: ParseError[] } {
  const ctx: ParseContext = { $, sourceUrl, ldTimes: parseLdStartTimes($), errors: [], parseErrors: [] };
  const cards = parseCards(ctx);
  const recent = parseRecentRows(ctx);
  const byRun = new Map<number, RawEventData>();
  for (const e of [...recent, ...cards]) byRun.set(e.runNumber as number, e);
  const events = [...byRun.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    events,
    rowsFound: cards.length + recent.length,
    errors: ctx.errors,
    parseErrors: ctx.parseErrors,
  };
}

export class TaipeiHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = resolveRunsUrl(source.url);

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { events, rowsFound, errors, parseErrors } = parseTaipeiHash(page.$, url);

    const errorDetails: ErrorDetails = {};
    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    // Fail loud: a clean fetch that yields zero events is almost certainly a
    // markup drift, not an empty hareline — push an error so the reconciler
    // doesn't treat the empty result as "all runs cancelled".
    if (events.length === 0) {
      const message = `Taipei Hash: parsed 0 events from ${rowsFound} rows at ${url} (markup drift?)`;
      errors.push(message);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        { row: -1, section: "runs", error: message },
      ];
    }

    const windowed = filterEventsByWindow(events, options?.days ?? 365);

    return {
      events: windowed,
      errors,
      structureHash: page.structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: { rowsFound, eventsParsed: windowed.length },
    };
  }
}
