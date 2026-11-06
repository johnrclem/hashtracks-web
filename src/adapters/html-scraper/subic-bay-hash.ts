/**
 * Subic Bay Hash House Harriers (SBH3-PH) — Olongapo / Subic Bay, Philippines.
 *
 * Blogspot (subicbayhash.blogspot.com), read through the Blogger API. Three
 * post types:
 *
 *   - "Hareline" — a Tableizer table `Run# | Date (M/D) | Hares | Venue | Att. | Total`.
 *     Each new Hareline post repeats recent rows and adds the next ~2 months, so the
 *     newest post that lists a run is authoritative for it.
 *   - "Run 1723" recaps — prose: "Run 1723 Trail starts 2pm at Court 4 Rizal Ext.
 *     14°52'1.27"N 120°16'32.27"E On Home: Bella Monte … Hares: Leech My Nuggets".
 *     They add the start time, the start point and its coordinates.
 *   - "Hashstats YYYY" — attendance tables with members' names; never parsed.
 *
 * Hareline dates have no year: each takes the year that puts it closest to the
 * post's publish date. Hares are split on "/" and " & " only ("F&L" is one
 * name). Rows age out of newer Hareline posts, so the source ships
 * `upcomingOnly: true`; the archive back to #1622 (Oct 2024) is loaded once by
 * scripts/backfill-sbh3-ph-history.ts.
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { filterEventsByWindow } from "../utils";
import { fetchBloggerPosts, type BloggerPost } from "../blogger-api";
import { parseDMSFromLocation } from "@/lib/geo";

const KENNEL_TAG = "sbh3-ph";
const DEFAULT_URL = "https://subicbayhash.blogspot.com";
const DAY_MS = 86_400_000;
/** Blog header: "Runs every Monday at 2:00 sharp!" */
const DEFAULT_START = "14:00";

const MD_RE = /^(\d{1,2})\/(\d{1,2})$/;
const RUN_TITLE_RE = /^run (\d{3,5})$/i;
const RUN_CELL_RE = /^\d{3,5}$/;
const STARTS_RE = /trail starts (\d{1,2})(?::(\d{2}))? ?(am|pm) at ([^°]{2,80}?)(?= \d{1,3}°| on home|$)/i;
const ON_HOME_RE = /on home: ([^°]{2,80}?)(?= \d{1,3}°| hares:|$)/i;
const HARES_RE = /hares?: (.{2,120})$/i;

/** Labels that can follow the start point when a recap has no coordinates. */
const TRAILING_LABELS = [" hares:", " hare:", " run fees:", " on home:"];

/** Cut a captured start point at the first following label ("Savers Hares: …"). */
export function cutAtLabel(text: string): string {
  const lower = text.toLowerCase();
  const cuts = TRAILING_LABELS.map((l) => lower.indexOf(l)).filter((i) => i >= 0);
  return (cuts.length > 0 ? text.slice(0, Math.min(...cuts)) : text).trim();
}

function clean(text: string): string {
  return text.replaceAll(" ", " ").replaceAll(/\s+/g, " ").trim();
}

/** "10/12" → the YYYY-MM-DD nearest to `published`; null if malformed. */
export function resolveMonthDay(text: string, published: Date): string | null {
  const m = MD_RE.exec(text.trim());
  if (!m) return null;
  const month = Number.parseInt(m[1], 10);
  const day = Number.parseInt(m[2], 10);
  let best: Date | null = null;
  for (const y of [published.getUTCFullYear() - 1, published.getUTCFullYear(), published.getUTCFullYear() + 1]) {
    const d = new Date(Date.UTC(y, month - 1, day, 12, 0, 0));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    if (!best || Math.abs(d.getTime() - published.getTime()) < Math.abs(best.getTime() - published.getTime())) best = d;
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

/** "Leech My Nuggets/Anal Receptive" → sorted; "Tiny Cunt/F&L" keeps "F&L". */
export function splitHares(text: string): string | undefined {
  const names = clean(text)
    .replaceAll(" & ", "/")
    .replaceAll(" and ", "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return undefined;
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).join(", ");
}

/** Rows of one Hareline post's table. Exported for tests. */
export function parseHarelinePost(post: BloggerPost): RawEventData[] {
  const $ = cheerio.load(post.content);
  const published = new Date(post.published);
  const events: RawEventData[] = [];
  $("table tr").each((_i, tr) => {
    const cells = $(tr).find("td").toArray().map((td) => clean($(td).text()));
    if (cells.length < 4 || !RUN_CELL_RE.test(cells[0])) return;
    const date = resolveMonthDay(cells[1], published);
    if (!date) return;
    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(cells[0], 10),
      hares: splitHares(cells[2]),
      location: cells[3] || undefined,
      startTime: DEFAULT_START,
      sourceUrl: post.url,
    });
  });
  return events;
}

export interface RecapDetail {
  runNumber: number;
  startTime?: string;
  start?: string;
  onHome?: string;
  hares?: string;
  latitude?: number;
  longitude?: number;
  url: string;
}

/** A "Run N" recap's prose. Returns null for image-only recaps. Exported for tests. */
export function parseRecapPost(post: BloggerPost): RecapDetail | null {
  const run = RUN_TITLE_RE.exec(clean(post.title));
  if (!run) return null;
  const text = clean(cheerio.load(post.content).text());
  if (!text) return null;
  const detail: RecapDetail = { runNumber: Number.parseInt(run[1], 10), url: post.url };
  const starts = STARTS_RE.exec(text);
  if (starts) {
    let h = Number.parseInt(starts[1], 10);
    if (starts[3].toLowerCase() === "pm" && h < 12) h += 12;
    detail.startTime = `${String(h).padStart(2, "0")}:${starts[2] ?? "00"}`;
    detail.start = cutAtLabel(clean(starts[4])).replace(/[.,]$/, "");
    const coords = parseDMSFromLocation(text.slice(starts.index));
    if (coords) {
      detail.latitude = coords.lat;
      detail.longitude = coords.lng;
    }
  }
  const onHome = ON_HOME_RE.exec(text);
  if (onHome) detail.onHome = clean(onHome[1]);
  const hares = HARES_RE.exec(text);
  if (hares) detail.hares = splitHares(hares[1]);
  return detail;
}

/** Merge all posts into one event per run. Exported for tests and the backfill. */
export function buildSubicBayEvents(posts: BloggerPost[]): RawEventData[] {
  const byRun = new Map<number, { event: RawEventData; published: number }>();
  for (const post of posts) {
    if (clean(post.title).toLowerCase() !== "hareline") continue;
    const published = Date.parse(post.published);
    for (const event of parseHarelinePost(post)) {
      const prev = byRun.get(event.runNumber!);
      if (!prev || published > prev.published) byRun.set(event.runNumber!, { event, published });
    }
  }
  for (const post of posts) {
    const recap = parseRecapPost(post);
    const entry = recap ? byRun.get(recap.runNumber) : undefined;
    if (!recap || !entry) continue;
    const e = entry.event;
    // A recap posted more than a month from the hareline date belongs to a
    // different run (mistitled post) — leave the row alone.
    if (Math.abs(Date.parse(post.published) - Date.parse(e.date)) > 31 * DAY_MS) continue;
    if (recap.startTime) e.startTime = recap.startTime;
    if (recap.hares) e.hares = recap.hares;
    if (recap.start) {
      e.location = recap.start;
      e.description = recap.onHome ? `On Home: ${recap.onHome}` : undefined;
    }
    if (recap.latitude !== undefined) {
      e.latitude = recap.latitude;
      e.longitude = recap.longitude;
    }
  }
  return [...byRun.values()].map((v) => v.event).sort((a, b) => a.date.localeCompare(b.date));
}

export class SubicBayHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const result = await fetchBloggerPosts(url, 25);
    if (result.error) {
      const message = `SBH3-PH: ${result.error.message}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message, status: result.error.status }] } };
    }
    const events = buildSubicBayEvents(result.posts);
    const errors: string[] = [];
    if (!result.posts.some((p) => clean(p.title).toLowerCase() === "hareline")) {
      errors.push(`SBH3-PH: no "Hareline" post among the latest ${result.posts.length} posts`);
    }
    const windowed = filterEventsByWindow(events, options?.days ?? 90);
    return {
      events: windowed,
      errors,
      diagnosticContext: {
        posts: result.posts.length,
        totalBeforeFilter: events.length,
        eventsParsed: windowed.length,
        fetchDurationMs: result.fetchDurationMs,
      },
    };
  }
}
