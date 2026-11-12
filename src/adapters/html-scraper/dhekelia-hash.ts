/**
 * Dhekelia Hash House Harriers (DH3-CY) — Cyprus, founded 30 Jan 1967 at
 * Dhekelia Garrison ("Europe's oldest hash").
 *
 * The kennel publishes only its next run, hand-edited weekly into the Elementor
 * "Next Run Location" block on its WordPress `/info/` page. We read the page via
 * the WP REST API (`/wp-json/wp/v2/pages?slug=info`), which returns the same
 * rendered markup as JSON. The block is a two-column layout: a labels column
 * (`<p>Hash Number:</p><p>Date:</p>…<p>Directions:</p>`) and a values column with
 * one `<p>` per value in the same order, directions spilling over several `<p>`s
 * and closing with the setter's sign-off ("Alan" / "On On").
 *
 * Output is a single event per scrape. Dates are `D/M/YYYY`, times `16.00`. There
 * is no title, so merge synthesizes "Dhekelia H3 Trail #N". The block is
 * overwritten weekly, so the source ships `upcomingOnly: true`.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { decodeEntities, filterEventsByWindow } from "../utils";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";

const KENNEL_TAG = "dh3-cy";
const DEFAULT_URL = "https://dhekelia-h3.com/wp-json/wp/v2/pages?slug=info";
const PAGE_URL = "https://dhekelia-h3.com/info/";
const FIRST_LABEL = "hash number:";

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ONE_SEPARATOR_RE = /^(\d{1,4})\/(\d{4,6})$/;
const TIME_RE = /^(\d{1,2})[.:](\d{2})$/;

function clean(text: string): string {
  return decodeEntities(text).replaceAll(/\s+/g, " ").trim();
}

/** Valid calendar date → "YYYY-MM-DD"; null for day/month overflow. */
function toIsoDate(day: number, month: number, year: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Readings of a date typed with one separator missing: "11/112026" (no slash
 * before the year) or "1111/2026" (none between day and month). The year is
 * always the last four digits; the day and month are 1–2 digits each.
 */
function oneSeparatorCandidates(head: string, tail: string): string[] {
  const out: string[] = [];
  if (tail.length > 4) {
    // "D/MYYYY": the year is the tail's last four digits, the month the rest.
    const date = toIsoDate(Number(head), Number(tail.slice(0, -4)), Number(tail.slice(-4)));
    if (head.length <= 2 && date) out.push(date);
  } else if (head.length >= 3) {
    // "DM/YYYY": split the head into a 1–2 digit day and month every way it fits.
    // A 2-digit head ("12/2026") reads as month/year, so it is never split.
    for (let dayLen = 1; dayLen <= 2; dayLen++) {
      const monthLen = head.length - dayLen;
      if (monthLen < 1 || monthLen > 2) continue;
      const date = toIsoDate(Number(head.slice(0, dayLen)), Number(head.slice(dayLen)), Number(tail));
      if (date) out.push(date);
    }
  }
  return out;
}

/**
 * "4/11/2026" (D/M/YYYY) → "2026-11-04"; null if malformed. A date with one
 * missing separator ("11/112026", seen 2026-11) is accepted only when exactly
 * one reading is a valid date: "111/2026" (1/11 or 11/1) stays null.
 */
export function parseDhekeliaDate(text: string): string | null {
  const trimmed = text.trim();
  const m = DATE_RE.exec(trimmed);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  const partial = ONE_SEPARATOR_RE.exec(trimmed);
  if (!partial) return null;
  const candidates = new Set(oneSeparatorCandidates(partial[1], partial[2]));
  return candidates.size === 1 ? [...candidates][0] : null;
}

/** "16.00" → "16:00"; undefined if malformed. */
export function parseDhekeliaTime(text: string): string | undefined {
  const m = TIME_RE.exec(text.trim());
  if (!m) return undefined;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/** Drop the trailing sign-off ("On On", and the one-word setter name before it). */
function stripSignOff(lines: string[]): string[] {
  const out = [...lines];
  if (out.at(-1)?.toLowerCase() === "on on") {
    out.pop();
    const last = out.at(-1);
    if (last && !last.includes(" ")) out.pop();
  }
  return out;
}

/** Find the labels column and return the sibling values column's `<p>` texts. */
function findValues($: CheerioAPI): string[] | null {
  const labelBlock = $(".elementor-text-editor")
    .toArray()
    .find((el) => clean($(el).find("p").first().text()).toLowerCase() === FIRST_LABEL);
  if (!labelBlock) return null;
  const column = $(labelBlock).closest(".elementor-column");
  const valueBlock = column.nextAll(".elementor-column").find(".elementor-text-editor").first();
  if (valueBlock.length === 0) return null;
  return valueBlock
    .find("p")
    .toArray()
    .map((p) => clean($(p).text()));
}

/** Parse the rendered `/info/` content. Exported for tests. */
export function parseDhekeliaInfo(
  rendered: string,
): { event: RawEventData | null; foundBlock: boolean; error?: string } {
  const values = findValues(cheerio.load(rendered));
  if (!values) return { event: null, foundBlock: false };
  const [num, dateText, timeText, haresText, location, ...rest] = values;
  const date = parseDhekeliaDate(dateText ?? "");
  if (!date) return { event: null, foundBlock: true, error: `unparseable date "${dateText ?? ""}"` };
  const runNumber = Number.parseInt(num ?? "", 10);
  const directions = stripSignOff(rest.filter(Boolean)).join(" ");
  return {
    foundBlock: true,
    event: {
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
      startTime: parseDhekeliaTime(timeText ?? ""),
      hares: haresText || undefined,
      location: location || undefined,
      description: directions ? `Directions: ${directions}` : undefined,
      sourceUrl: PAGE_URL,
    },
  };
}

interface WpPage {
  content?: { rendered?: unknown };
}

export class DhekeliaHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let rendered: string;
    try {
      const res = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const first = Array.isArray(body) ? (body[0] as WpPage | undefined) : undefined;
      if (typeof first?.content?.rendered !== "string") throw new Error("unexpected WP REST payload");
      rendered = first.content.rendered;
    } catch (err) {
      const message = `DH3-CY: fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }

    const { event, foundBlock, error } = parseDhekeliaInfo(rendered);
    const errors: string[] = [];
    // A single-block page: a missing block or unparseable date is drift, never
    // "no run this week", so fail loud and keep reconcile off.
    if (!foundBlock) errors.push(`DH3-CY: "Hash Number:" block not found at ${url}`);
    if (error) errors.push(`DH3-CY: ${error}`);
    const events = filterEventsByWindow(event ? [event] : [], options?.days ?? 90);

    return {
      events,
      errors,
      structureHash: generateStructureHash(rendered),
      diagnosticContext: { foundBlock, eventsParsed: events.length, fetchDurationMs: Date.now() - fetchStart },
    };
  }
}
