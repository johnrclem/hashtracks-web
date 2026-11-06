import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { applyDateWindow, fetchHTMLPage, MONTHS } from "../utils";

const KENNEL_TAG = "wfh3";
const DEFAULT_URL = "https://www.wyreforesthhh.org.uk/index.php";
const THURSDAY_START = "19:00";

/** Visible date `12th Nov 2026` (ordinal + abbreviated month + year). */
const DATE_RE = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9}) (\d{4})$/;
/** Archive cells carry `data-order="2008-05-01"`. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `SY83LZ` → `SY8 3LZ` (the site drops the space; geocoding wants it). */
export function formatPostcode(raw: string): string {
  const compact = raw.replaceAll(" ", "").toUpperCase();
  return /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(compact) ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : raw;
}

function clean(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

export function parseWfDate(text: string): string | null {
  const m = DATE_RE.exec(clean(text));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  const day = Number.parseInt(m[1], 10);
  const d = new Date(Date.UTC(Number.parseInt(m[3], 10), month - 1, day, 12, 0, 0));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Run rows from either page. Forward `index.php`: unclosed `<td>`s in a
 * layout table — `[Number, Date, Location, Postcode(<a>), Hare(s), Notes]`.
 * Archive `Page_on-back.php`: `[Number, Date(data-order ISO), Location, Grid
 * Ref / Postcode(<a>), Hare(s)]`. Rows are recognised by a numeric first cell
 * and a parseable date, so layout/header rows drop out.
 */
export function parseWfRows($: CheerioAPI, sourceUrl: string): RawEventData[] {
  const events: RawEventData[] = [];
  $("tr").each((_i, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 5) return;
    const runText = clean(tds.eq(0).text());
    if (!/^\d{1,4}$/.test(runText)) return;
    const iso = tds.eq(1).attr("data-order");
    const date = iso && ISO_RE.test(iso) ? iso : parseWfDate(tds.eq(1).text());
    if (!date) return;

    const location = clean(tds.eq(2).text());
    const postcodeCell = clean(tds.eq(3).text());
    const mapHref = tds.eq(3).find("a").attr("href");
    const hares = clean(tds.eq(4).text());
    const notes = tds.length > 5 ? clean(tds.eq(5).text()) : "";
    // The archive's older rows give an OS grid reference (SO744738), not a postcode.
    const isGridRef = /^[A-Z]{2}\d{6}$/.test(postcodeCell);

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: Number.parseInt(runText, 10),
      startTime: new Date(`${date}T12:00:00Z`).getUTCDay() === 4 ? THURSDAY_START : undefined,
      location: location || undefined,
      locationStreet: postcodeCell && !isGridRef ? formatPostcode(postcodeCell) : undefined,
      locationUrl: mapHref && /google\.com\/maps/.test(mapHref) ? mapHref : undefined,
      hares: hares || undefined,
      description: notes || undefined,
      sourceUrl,
    });
  });
  return events;
}

/**
 * Wyre Forest H3 (Kidderminster, Worcestershire) — weekly Thursday 19:00,
 * founded 2008. The forward hareline lives on `index.php`; completed runs move
 * to `Page_on-back.php` (feeds the one-shot backfill). The site answers HTTP
 * 406 to direct datacenter fetches, so both go through the residential proxy
 * (`config.useResidentialProxy`). Forward-only → `upcomingOnly`.
 */
export class WyreForestHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const config = (source.config ?? {}) as { useResidentialProxy?: unknown };
    const page = await fetchHTMLPage(url, { useResidentialProxy: config.useResidentialProxy === true });
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events = parseWfRows($, url);
    const errors: string[] = [];
    if (events.length === 0) {
      errors.push("Wyre Forest H3: 0 runs parsed from the hareline table — markup may have changed");
    }
    const result: ScrapeResult = {
      events,
      errors,
      structureHash,
      diagnosticContext: { fetchDurationMs, eventsParsed: events.length },
    };
    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? 90);
  }
}
