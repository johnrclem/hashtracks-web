/**
 * Amsterdam Hash House Harriers (AH3) Website Adapter
 *
 * Scrapes ah3.nl for hash events from two pages:
 *   1. /nextruns/  — upcoming events
 *   2. /previous/  — historical/past events
 *
 * DOM-based parsing: each event sits between consecutive `<hr>` elements
 * inside `.entry-content`. Within each section:
 *   - `<p id="NNNN">Title</p>` carries the event title (id is usually the
 *     run number but can be a placeholder like "1" for special events)
 *   - "Run № NNNN by Hare Name" line carries the authoritative run number
 *     and optional hare(s). Not every event has this line (special events
 *     like pub crawls omit it).
 *   - "Saturday 04 April, 2026 at 14:45 hrs" line — date + time
 *   - Bold venue name followed by an address line — location
 *   - Free-text paragraphs between the header and `___good_to_know` — description
 *
 * Deduplication: upcoming events take priority over previous events when
 * the same run number appears in both.
 */

import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import * as chrono from "chrono-node";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, decodeEntities, stripHtmlTags, filterEventsByWindow } from "../utils";

// ── Constants ──

const KENNEL_TAG = "ah3-nl";

/** IDs below this threshold on `<p id="N">` elements are WordPress
 *  placeholders (e.g. id="1" for special events), not real run numbers. */
const MIN_VALID_RUN_NUMBER = 100;

// ── Regex patterns ──

/** Match run number and optional hare(s): "Run № 1476 by War 'n Piece & MiaB" */
const RUN_NUMBER_RE = /Run\s*[№#]\s*(\d{4,5})\s*(?:by\s+(.+))?/i;

/** Match date + time: "Saturday 04 April, 2026 at 14:45 hrs" */
const DATE_TIME_RE =
  /(?:Sunday|Saturday|Monday|Tuesday|Wednesday|Thursday|Friday)\s+(\d{1,2}\s+\w+,?\s+\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*hrs/i;

/** Block metadata marker — everything after this is structured metadata
 *  (Bag Drop, BeerMeister, Hash Cash, On After) not event description. */
const GOOD_TO_KNOW_RE = /___good_to_know/i;

// ── Exported helpers (for unit testing) ──

/**
 * Parse a single `<hr>`-delimited section of the .entry-content into
 * RawEventData. Returns null if the section lacks a valid date. Uses the
 * `<p[id]>` element for the title and the `id` attribute as a fallback
 * run number when the "Run №" line is absent.
 */
export function parseEventSection(
  $section: Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): RawEventData | null {
  // ── Title from <p id="NNNN"> ──
  // find() only matches descendants; filter() matches the top-level nodes
  // themselves. We need both: the real HTML wraps events in a <div> (so
  // find works), but test fixtures may have <p id> as a direct sibling
  // (so filter is the fallback).
  let titleP = $section.find("p[id]").first();
  if (titleP.length === 0) titleP = $section.filter("p[id]").first();
  const title = titleP.length > 0
    ? decodeEntities(titleP.text()).trim()
    : undefined;
  const pId = titleP.length > 0 ? titleP.attr("id") : undefined;

  // ── Convert section HTML to text with block-boundary newlines ──
  // $section is a cheerio collection of sibling nodes (text + elements).
  // .html() only returns the first node's innerHTML; we need the full
  // outer HTML of every node in the collection.
  const sectionHtml = $section.toArray().map((n) => $.html(n)).join("");
  const text = stripHtmlTags(sectionHtml, "\n").replaceAll("\u00a0", " ");

  // ── Run number + hares from "Run №" line ──
  const runMatch = RUN_NUMBER_RE.exec(text);
  let runNumber: number | undefined;
  let hares: string | undefined;
  if (runMatch) {
    runNumber = parseInt(runMatch[1], 10);
    if (runMatch[2]) {
      const hareTrimmed = runMatch[2].trim();
      if (!/Click if you want to hare/i.test(hareTrimmed)) {
        hares = hareTrimmed;
      }
    }
  }

  // Fallback: use the <p id="NNNN"> id as run number when Run № is absent
  // (special events). Skip placeholder ids like "1".
  if (runNumber == null && pId) {
    const parsed = parseInt(pId, 10);
    if (Number.isFinite(parsed) && parsed >= MIN_VALID_RUN_NUMBER) {
      runNumber = parsed;
    }
  }

  // ── Date + time ──
  const dtMatch = DATE_TIME_RE.exec(text);
  if (!dtMatch) return null;

  const dateStr = dtMatch[1];
  const hours = dtMatch[2];
  const minutes = dtMatch[3];

  const parsed = chrono.en.parse(dateStr);
  if (parsed.length === 0) return null;
  const result = parsed[0].start;
  const year = result.get("year");
  const month = result.get("month");
  const day = result.get("day");
  if (year == null || month == null || day == null) return null;

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const startTime = `${hours.padStart(2, "0")}:${minutes}`;

  // ── Location: first bold text after the date line ──
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let location: string | undefined;
  let locationStreet: string | undefined;

  const dateLineIdx = lines.findIndex((l) => DATE_TIME_RE.test(l));
  if (dateLineIdx >= 0) {
    const venueLine = lines[dateLineIdx + 1];
    if (venueLine && !/Map\s*$/.test(venueLine) && !/Let us know/.test(venueLine)) {
      location = venueLine
        .replace(/Map\s*$/, "")
        .trim();
      if (/^somewhere$/i.test(location)) {
        location = undefined;
      }
    }
    const addressLine = lines[dateLineIdx + 2];
    if (addressLine && /\d{4}\s*[A-Z]{2}/.test(addressLine)) {
      locationStreet = addressLine
        .replace(/Map\s*$/, "")
        .trim();
    }
  }

  // ── Description: text between the event header and ___good_to_know ──
  // Start scanning from dateLineIdx + 1 (after the date line) and filter
  // out structural lines (venue, address, WhatsApp, buttons, images).
  // Description is whatever free-text paragraphs remain before the
  // ___good_to_know marker. The +3 hard-coded offset from the prior
  // version was too aggressive — it skipped the description start when
  // the address line was absent.
  let description: string | undefined;
  const goodToKnowIdx = lines.findIndex((l) => GOOD_TO_KNOW_RE.test(l));
  const descStartIdx = dateLineIdx >= 0 ? dateLineIdx + 1 : -1;
  if (descStartIdx > 0) {
    const descEndIdx = goodToKnowIdx > descStartIdx ? goodToKnowIdx : lines.length;
    const descLines = lines.slice(descStartIdx, descEndIdx).filter((l) => {
      // Skip venue name (already captured as location)
      if (location && l === location) return false;
      // Skip address line (already captured as locationStreet)
      if (/^\d{4}\s*[A-Z]{2}/.test(l)) return false;
      if (locationStreet && l.includes(locationStreet)) return false;
      // Skip plus-codes (e.g. "9M5R+65, Amsterdam, 1077 XS")
      if (/^[A-Z0-9]{4}\+[A-Z0-9]+/.test(l)) return false;
      // Skip non-description noise
      if (/^Let us know/i.test(l)) return false;
      if (/^WhatsApp$/i.test(l)) return false;
      if (/^RSVP$/i.test(l)) return false;
      if (/^Map$/i.test(l)) return false;
      if (/^Contact\b/i.test(l)) return false;
      if (/^somewhere$/i.test(l)) return false;
      if (/^–\s*$/.test(l)) return false;
      if (l.length < 3) return false;
      return true;
    });
    const descText = descLines.join("\n").trim();
    if (descText.length > 5) {
      description = descText;
    }
  }

  // ── Build event title ──
  const eventTitle = title
    ? runNumber
      ? `AH3 #${runNumber} — ${title}`
      : title
    : runNumber
      ? `AH3 #${runNumber}`
      : undefined;

  if (!eventTitle) return null;

  return {
    date,
    kennelTag: KENNEL_TAG,
    title: eventTitle,
    runNumber,
    hares,
    location,
    locationStreet,
    startTime,
    description,
    sourceUrl,
  };
}

/**
 * Extract all events from a page's DOM by splitting on `<hr>` elements.
 * Each `<hr>` marks the boundary between events in the .entry-content.
 */
export function extractEventsFromDOM(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): { events: RawEventData[]; errors: ParseError[] } {
  const events: RawEventData[] = [];
  const errors: ParseError[] = [];
  const content = $(".entry-content");
  if (content.length === 0) return { events, errors };

  // Remove <style> blocks that leak CSS rules into .text()
  content.find("style").remove();

  // Split content into sections by <hr>. We wrap each section's content
  // between consecutive <hr> elements into a virtual container for parsing.
  const hrs = content.find("hr").toArray();
  if (hrs.length === 0) return { events, errors };

  for (let i = 0; i < hrs.length; i++) {
    try {
      // Collect all sibling nodes between this <hr> and the next (or end)
      const sectionNodes: AnyNode[] = [];
      let node: AnyNode | null = (hrs[i] as Element).nextSibling;
      const nextHr = i + 1 < hrs.length ? hrs[i + 1] : null;
      while (node && node !== nextHr) {
        sectionNodes.push(node);
        node = node.nextSibling;
      }
      if (sectionNodes.length === 0) continue;

      // Wrap in a cheerio object for querying
      const $section = $(sectionNodes);
      const event = parseEventSection($section, $, sourceUrl);
      if (event) events.push(event);
    } catch (err) {
      // Include the section's outer HTML in the error so the AI parse-recovery
      // pipeline can attempt re-extraction from the raw source material.
      const nextNode = (hrs[i] as Element | undefined)?.nextSibling;
      const sectionSnippet = nextNode
        ? ($.html(nextNode as AnyNode)?.slice(0, 2000) ?? "")
        : "";
      errors.push({
        row: i,
        error: String(err),
        rawText: sectionSnippet || `Section ${i} after <hr>`,
      });
    }
  }

  return { events, errors };
}

// ── Adapter class ──

export class AH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const upcomingUrl = source.url || "https://ah3.nl/nextruns/";
    const days = options?.days ?? source.scrapeDays ?? 365;
    const config = (source.config ?? {}) as Record<string, unknown>;
    const previousUrl =
      (config.previousUrl as string) ??
      upcomingUrl.replace(/nextruns\/?/, "previous/");

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const seenRunNumbers = new Set<number>();
    let totalFetchMs = 0;

    // ── 1. Fetch upcoming page ──
    const upcoming = await fetchHTMLPage(upcomingUrl);
    if (!upcoming.ok) return upcoming.result;

    const structureHash = upcoming.structureHash;
    totalFetchMs += upcoming.fetchDurationMs;

    const { events: upcomingEvents, errors: upcomingErrors } = extractEventsFromDOM(
      upcoming.$,
      upcomingUrl,
    );

    for (const ev of upcomingEvents) {
      allEvents.push(ev);
      if (ev.runNumber) seenRunNumbers.add(ev.runNumber);
    }
    if (upcomingErrors.length > 0) {
      (errorDetails.parse ??= []).push(
        ...upcomingErrors.map((e) => ({ ...e, section: "upcoming" })),
      );
    }

    // ── 2. Fetch previous page ──
    const previous = await fetchHTMLPage(previousUrl);
    if (previous.ok) {
      totalFetchMs += previous.fetchDurationMs;

      const { events: previousEvents, errors: previousErrors } = extractEventsFromDOM(
        previous.$,
        previousUrl,
      );

      for (const ev of previousEvents) {
        if (ev.runNumber && seenRunNumbers.has(ev.runNumber)) continue;
        allEvents.push(ev);
        if (ev.runNumber) seenRunNumbers.add(ev.runNumber);
      }
      if (previousErrors.length > 0) {
        (errorDetails.parse ??= []).push(
          ...previousErrors.map((e) => ({ ...e, section: "previous" })),
        );
      }
    } else {
      allErrors.push(`Previous page fetch failed: ${previous.result.errors[0]}`);
    }

    // ── 3. Filter by date window ──
    const filtered = filterEventsByWindow(allEvents, days);

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: filtered,
      errors: allErrors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        upcomingEvents: upcomingEvents.length,
        previousEvents: allEvents.length - upcomingEvents.length,
        totalBeforeFilter: allEvents.length,
        totalAfterFilter: filtered.length,
        fetchDurationMs: totalFetchMs,
      },
    };
  }
}
