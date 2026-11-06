/**
 * Warwick H3 (Warwick, England) HTML Scraper
 *
 * warwickhash.org.uk publishes exactly one run — the hero caption:
 *   <h3 class="caption">Next Run (#664): Monday, November 2<sup>nd</sup> at
 *   7:00pm from <a href="…">The Black Pug</a>, Warwick,
 *   <a href="https://maps.app.goo.gl/…">CV34 4NU</a></h3>
 * The date has no year; it is taken as the year that puts the run closest to
 * today (the block is updated weekly, so it is never more than a few weeks
 * from now in either direction). The block keeps showing the last run until
 * the club posts the next one, so the source must be upcomingOnly.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, MONTHS } from "../utils";

const KENNEL_TAG = "warwick-h3";
const DEFAULT_URL = "https://www.warwickhash.org.uk/";

const RUN_RE = /Next Run\s*\(#(\d{1,5})\)/i;
const DATE_RE = /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/;
const TIME_RE = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Year (now-1 … now+1) that puts month/day closest to `now`. */
export function closestYear(month: number, day: number, now = new Date()): number {
  const y = now.getUTCFullYear();
  const distance = (cand: number) => Math.abs(Date.UTC(cand, month - 1, day, 12) - now.getTime());
  return [y, y - 1, y + 1].reduce((best, cand) => (distance(cand) < distance(best) ? cand : best), y);
}

/** Parse the caption text + its links into a RawEventData (null if it isn't a run). */
export function parseWarwickCaption(
  text: string,
  links: { text: string; href?: string }[],
  now = new Date(),
  sourceUrl = DEFAULT_URL,
): RawEventData | null {
  const clean = text.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
  const run = RUN_RE.exec(clean);
  if (!run) return null;
  // Read the date after the "Next Run (#N):" prefix so "Run" can't be mistaken for a month.
  const afterRun = clean.slice(run.index + run[0].length);
  const d = DATE_RE.exec(afterRun.replace(/^[:\s]*[A-Za-z]+,\s*/, ""));
  const month = d ? MONTHS[d[1].toLowerCase()] : undefined;
  if (!d || !month) return null;
  const day = Number.parseInt(d[2], 10);
  const year = closestYear(month, day, now);
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  if (dt.getUTCDate() !== day || Math.abs(dt.getTime() - now.getTime()) > 200 * DAY_MS) return null;

  const t = TIME_RE.exec(afterRun);
  let startTime: string | undefined;
  if (t) {
    let h = Number.parseInt(t[1], 10) % 12;
    if (t[3].toLowerCase() === "pm") h += 12;
    startTime = `${String(h).padStart(2, "0")}:${t[2] ?? "00"}`;
  }

  const venue = links.find((l) => l.text && !UK_POSTCODE_RE.test(l.text.trim()));
  const postcodeLink = links.find((l) => UK_POSTCODE_RE.test(l.text.trim()));
  // Town = the text between the venue name and the postcode ("…</a>, Warwick, <a>CV34…").
  let town: string | undefined;
  if (venue && postcodeLink) {
    const between = clean.split(venue.text.trim())[1]?.split(postcodeLink.text.trim())[0] ?? "";
    town = between.replaceAll(",", " ").trim() || undefined;
  }
  const street = [town, postcodeLink?.text.trim().toUpperCase()].filter(Boolean).join(", ");

  return {
    date: dt.toISOString().slice(0, 10),
    kennelTags: [KENNEL_TAG],
    runNumber: Number.parseInt(run[1], 10),
    startTime,
    location: venue?.text.trim(),
    locationStreet: street || undefined,
    locationUrl: postcodeLink?.href && /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.)/.test(postcodeLink.href)
      ? postcodeLink.href
      : undefined,
    sourceUrl,
  };
}

export class WarwickHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source): Promise<ScrapeResult> {
    const sourceUrl = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const $caption = $(".hero .caption, h3.caption").first();
    const links = $caption.find("a").map((_i, a) => ({ text: $(a).text(), href: $(a).attr("href") })).get();
    const event = $caption.length > 0 ? parseWarwickCaption($caption.text(), links, new Date(), sourceUrl) : null;

    if (!event) {
      return {
        events: [],
        errors: ["Warwick H3: no 'Next Run (#N): <date>' caption found on the homepage — markup drift"],
        structureHash,
        diagnosticContext: { captionText: $caption.text().slice(0, 300), fetchDurationMs },
      };
    }
    return { events: [event], errors: [], structureHash, diagnosticContext: { fetchDurationMs } };
  }
}
