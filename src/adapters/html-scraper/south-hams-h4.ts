import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, extractUkPostcode, fetchHTMLPage, parse12HourTime } from "../utils";

const KENNEL_TAG = "sh4";
const DEFAULT_URL = "https://www.sh4.org.uk/auto-draft/";
const DEFAULT_START_TIME = "19:30";

/** `DD/MM/YY` (Events Manager list + detail format). */
const DMY_RE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
/** Link text `Hash 1607 AGPU 2` / `hash 1571` / `Hash 0001`. */
const HASH_LINK_RE = /^hash (\d{1,4})\b(.*)$/i;
/** Longest theme kept as a title; longer link text (#1591's football note) goes to description. */
const MAX_TITLE_LENGTH = 60;

export function parseDmy(text: string): string | null {
  const m = DMY_RE.exec(text.trim());
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const yy = Number.parseInt(m[3], 10);
  // Two-digit years: the kennel began in 1998 (Hash 0001 = 06/05/98).
  const year = yy >= 90 ? 1900 + yy : 2000 + yy;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/** Strip decoration around a theme: "- Eclipse Hash" / "*Pre-xmas hash weekend" → "Eclipse Hash", "(Bring your own beer)" → "Bring your own beer". */
function cleanTheme(raw: string): string {
  let theme = raw.trim();
  while (theme.startsWith("-") || theme.startsWith("–") || theme.startsWith("*")) theme = theme.slice(1).trim();
  if (theme.startsWith("(") && theme.endsWith(")")) theme = theme.slice(1, -1).trim();
  if (theme.toLowerCase().startsWith("and ")) theme = theme.slice(4).trim();
  return theme;
}

/** Split `Hash NNNN <theme>` link text into run number + title/description. */
export function parseHashLink(text: string): { runNumber: number; title?: string; note?: string } | null {
  const m = HASH_LINK_RE.exec(text.replaceAll(/\s+/g, " ").trim());
  if (!m) return null;
  const runNumber = Number.parseInt(m[1], 10);
  const theme = cleanTheme(m[2]);
  if (!theme) return { runNumber };
  if (theme.length > MAX_TITLE_LENGTH) return { runNumber, note: theme };
  return { runNumber, title: theme };
}

/**
 * One list row: `DD/MM/YY - <a href=/events/slug/>Hash NNNN [theme]</a>, Venue, Address - POSTCODE`.
 * The venue is the first comma field after the link; the rest (address + postcode) is the street.
 */
export function parseListRow(rowText: string, linkText: string, href: string | undefined): RawEventData | null {
  const flat = rowText.replaceAll(/\s+/g, " ").trim();
  const date = parseDmy(flat.slice(0, 8));
  const link = parseHashLink(linkText);
  if (!date || !link) return null;

  const linkEnd = flat.indexOf(linkText.replaceAll(/\s+/g, " ").trim());
  let rest = linkEnd === -1 ? "" : flat.slice(linkEnd + linkText.replaceAll(/\s+/g, " ").trim().length);
  if (rest.startsWith(",")) rest = rest.slice(1);
  const parts = rest.split(",").map((p) => p.trim()).filter(Boolean);
  const venue = parts[0];
  let street = parts.slice(1).join(", ");
  // "Lutterburn Street - PL21 0NG" → "Lutterburn Street, PL21 0NG"
  street = street.replace(" - ", ", ");
  if (street.startsWith("- ")) street = street.slice(2);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber: link.runNumber,
    title: link.title,
    description: link.note,
    // 19:30 is the Wednesday-night start; weekend/holiday specials run at other
    // times (their detail page supplies it for upcoming runs).
    startTime: new Date(`${date}T12:00:00Z`).getUTCDay() === 3 ? DEFAULT_START_TIME : undefined,
    location: venue || undefined,
    locationStreet: street || undefined,
    sourceUrl: href,
  };
}

/** All rows of the Future + Past event lists on the "List of Hashes" page. */
export function parseListPage($: CheerioAPI): RawEventData[] {
  const events: RawEventData[] = [];
  $("li").each((_i, li) => {
    const $li = $(li);
    const $a = $li.children("a").first();
    if ($a.length === 0) return;
    const href = $a.attr("href");
    if (!href?.includes("/events/")) return;
    const event = parseListRow($li.text(), $a.text(), href);
    if (event) events.push(event);
  });
  return events;
}

export interface Sh4Detail {
  startTime?: string;
  endTime?: string;
  hares?: string;
  locationStreet?: string;
  what3words?: string;
  onDown?: string;
}

/** Value of a `<span>Label: value</span>` line in the detail page's "Where" block. */
function labelledSpan($: CheerioAPI, label: string): string | undefined {
  let value: string | undefined;
  $(".em-event-where span").each((_i, span) => {
    const text = $(span).text().replaceAll(/\s+/g, " ").trim();
    if (value === undefined && text.startsWith(label)) value = text.slice(label.length).trim();
  });
  if (!value || /^to be confirmed$/i.test(value) || /^tbc$/i.test(value)) return undefined;
  return value;
}

/** Event detail page: time range, full address, hares, what3words, on-down. */
export function parseDetailPage($: CheerioAPI): Sh4Detail {
  const timeText = $(".em-event-time").first().text().replaceAll(/\s+/g, " ").trim();
  const [startText, endText] = timeText.split(" - ");

  // Address line = the text node after the venue link inside the location block.
  const locationBlock = $(".em-event-location div").first().clone();
  locationBlock.find("a, span").remove();
  const address = locationBlock.text().replaceAll(/\s+/g, " ").replaceAll(" ,", ",").trim();

  return {
    startTime: startText ? parse12HourTime(startText) : undefined,
    endTime: endText ? parse12HourTime(endText) : undefined,
    hares: labelledSpan($, "Hares:"),
    locationStreet: extractUkPostcode(address) ? address : undefined,
    what3words: labelledSpan($, "What 3 Words:"),
    onDown: labelledSpan($, "On Down:"),
  };
}

function applyDetail(event: RawEventData, detail: Sh4Detail): RawEventData {
  const notes = [event.description];
  if (detail.what3words) {
    let words = detail.what3words;
    while (words.startsWith("/")) words = words.slice(1);
    notes.push(`what3words: ///${words}`);
  }
  if (detail.onDown) notes.push(`On Down: ${detail.onDown}`);
  const description = notes.filter(Boolean).join("\n");
  return {
    ...event,
    startTime: detail.startTime ?? event.startTime,
    endTime: detail.endTime,
    hares: detail.hares,
    locationStreet: detail.locationStreet ?? event.locationStreet,
    description: description || undefined,
  };
}

/**
 * South Hams H4 (Devon) — weekly Wednesday 19:30. Reads the Events Manager
 * "List of Hashes" page (`/auto-draft/`: Future + ~50 Past rows with run #,
 * venue, address, postcode) and enriches upcoming runs from their detail pages
 * (hares, start/end time, what3words, on-down). The homepage "Upcoming Hashes"
 * widget and the collection iCal are broken/stale and are not used.
 */
export class SouthHamsH4Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const listed = parseListPage($);
    const errors: string[] = [];
    if (listed.length === 0) {
      errors.push("South Hams H4: 0 hash rows parsed from the List of Hashes page — markup may have changed");
    }

    // Detail pages only for upcoming runs (1-3 a week): they carry the hares.
    const today = new Date().toISOString().slice(0, 10);
    const events: RawEventData[] = [];
    let detailFailures = 0;
    for (const event of listed) {
      if (event.date < today || !event.sourceUrl) {
        events.push(event);
        continue;
      }
      const detailPage = await fetchHTMLPage(event.sourceUrl);
      if (detailPage.ok) {
        events.push(applyDetail(event, parseDetailPage(detailPage.$)));
      } else {
        detailFailures++;
        events.push(event);
      }
    }

    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, rowsParsed: listed.length, detailFailures },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? 365);
  }
}
