/**
 * One-shot historical backfill for NODUHHH (North of Dallas Urban H3). Issue #1767.
 *
 * The DFW calendar's recurring HTML scrape only walks monthly grid pages from
 * the current month forward, so HashTracks had just 47 past NODUH rows (back to
 * 2025-01-27). The site's search page exposes the full structured archive —
 * 376 past "NODUH Hash" runs back to 2012 — which this script pulls in one shot.
 *
 * Source page: http://www.dfwhhh.org/calendar/search.php?q=NODUH&per_page=unlimited
 * The "📜 Past Events" section lists every structured NODUH-matching run. The
 * `q=NODUH` query also returns FALSE POSITIVES where "NoDUH" appears in another
 * kennel's prose (e.g. a "Bike Hash" item mentioning the NoDUH trail), so we
 * filter strictly on `.event-kennel` starting with "NODUH Hash" (#1767 warns).
 *
 * Scope: the structured Past Events section only. The "📂 Unstructured Events
 * (2005-2012)" section (57 legacy `.html` pages with truncated snippets) is left
 * out — those pre-date the structured event.php detail format. The search items
 * carry date, run number, hares, and location; description snippets are
 * truncated ("…") so they're intentionally not stored. Start time / hash cash /
 * dog policy live only on detail pages and stay null on these historical rows —
 * the live adapter enriches current/future runs.
 *
 * Binding: events are attributed to the "DFW Hash Calendar" source (its
 * SourceKennel links include `noduhhh`, so the merge source-kennel guard
 * accepts them — same site/origin we already scrape). Reconcile is safe: the
 * recurring scrape only reconciles within its forward window, so these past
 * rows are never cancelled. Re-runs dedup via the merge fingerprint.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-noduhhh-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-noduhhh-history.ts
 *   Env:     DATABASE_URL
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { prisma } from "@/lib/db";
import { safeFetch } from "@/adapters/safe-fetch";
import { decodeEntities } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { logPerKennelTally, mergeAndReport } from "./lib/backfill-reporting";

const SEARCH_URL =
  "http://www.dfwhhh.org/calendar/search.php?q=NODUH&per_page=unlimited";
const DFW_BASE_URL = "http://www.dfwhhh.org/calendar";
const SOURCE_NAME = "DFW Hash Calendar";
const KENNEL_TAG = "noduhhh";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Scraper)";

// Search items render dates with abbreviated month names ("Mon, Apr 20, 2026").
const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

/** Parse "Mon, Apr 20, 2026" → UTC-noon ISO date "YYYY-MM-DD". */
function parseSearchDate(text: string): string | undefined {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(text);
  if (!m) return undefined;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return undefined;
  const day = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
  if (d.getUTCMonth() !== month || d.getUTCDate() !== day) return undefined;
  return d.toISOString().split("T")[0];
}

/** Extract the `.event-details` value whose <strong> label matches `re`. */
function detailByLabel(
  $item: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  re: RegExp,
): string | undefined {
  let value: string | undefined;
  $item.find(".event-details").each((_i, el) => {
    if (value) return;
    const $el = $(el);
    const label = $el.find("strong").first().text().trim();
    if (!re.test(label)) return;
    const $clone = $el.clone();
    $clone.find("strong").first().remove();
    // The site double-encodes entities ("&amp;amp;"), so decode after .text().
    const text = decodeEntities($clone.text()).replace(/\s+/g, " ").trim();
    if (text) value = text;
  });
  return value;
}

interface ParseResult {
  events: RawEventData[];
  skipped: { nonNoduh: number; unparseableDate: number; unstructured: number };
}

function parseSearchPage(html: string): ParseResult {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];
  const skipped = { nonNoduh: 0, unparseableDate: 0, unstructured: 0 };

  // Count the "📂 Unstructured Events (2005-2012)" section we deliberately skip
  // (legacy .html pages with truncated snippets) so the drop is logged, not
  // silent (no-silent-caps).
  const unstructuredSection = $("h2")
    .filter((_i, el) => /unstructured/i.test($(el).text()))
    .first()
    .closest(".results-section");
  skipped.unstructured = unstructuredSection.find(".event-item").length;

  // Locate the structured "📜 Past Events" section, then walk its event-items.
  const section = $("h2")
    .filter((_i, el) => /past events/i.test($(el).text()))
    .first()
    .closest(".results-section");
  if (section.length === 0) return { events, skipped };

  section.find(".event-item").each((_i, el) => {
    const $item = $(el);
    const kennelText = $item.find(".event-kennel").text().replace(/\s+/g, " ").trim();
    // Strict kennel filter — drop "Bike Hash"/other false positives (#1767).
    if (!/^NODUH Hash\b/i.test(kennelText)) {
      skipped.nonNoduh++;
      return;
    }

    const date = parseSearchDate($item.find(".event-date").first().text());
    if (!date) {
      skipped.unparseableDate++;
      return;
    }

    const runMatch = /Run\s*#?\s*(\d+)/i.exec(kennelText);
    const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

    const hares = detailByLabel($item, $, /hares?:/i);
    const location = detailByLabel($item, $, /location:/i);

    const href = $item.find("a.event-link").first().attr("href");
    const sourceUrl = href
      ? href.startsWith("http") ? href : `${DFW_BASE_URL}/${href}`
      : undefined;

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      title: "NODUH Hash",
      ...(runNumber !== undefined && { runNumber }),
      ...(hares && { hares }),
      ...(location && { location }),
      ...(sourceUrl && { sourceUrl }),
    });
  });

  return { events, skipped };
}

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`NODUHHH historical backfill (search.php archive)`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  const sources = await prisma.source.findMany({ where: { name: SOURCE_NAME } });
  if (sources.length === 0) throw new Error(`Source "${SOURCE_NAME}" not found in DB.`);
  if (sources.length > 1) throw new Error(`Ambiguous source name "${SOURCE_NAME}" (${sources.length} matches).`);
  const source = sources[0];

  console.log(`Fetching ${SEARCH_URL}`);
  const resp = await safeFetch(SEARCH_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!resp.ok) throw new Error(`Search page fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();

  const { events, skipped } = parseSearchPage(html);
  console.log(`Parsed ${events.length} structured past NODUH Hash events.`);
  console.log(
    `Skipped (not backfilled): ${skipped.unstructured} unstructured legacy events (2005-2012), ` +
      `${skipped.nonNoduh} non-NODUH false positives, ${skipped.unparseableDate} unparseable dates.`,
  );
  if (events.length === 0) throw new Error("No events parsed — aborting (search page shape may have changed).");

  // Sort ascending for readable logs / stable ordering.
  events.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Date range: ${events[0].date} → ${events[events.length - 1].date}`);
  console.log("First 3:");
  for (const e of events.slice(0, 3)) {
    console.log(`  ${e.date} #${e.runNumber ?? "?"} | hares=${e.hares ?? "—"} | loc=${e.location?.slice(0, 40) ?? "—"}`);
  }
  console.log("Last 3:");
  for (const e of events.slice(-3)) {
    console.log(`  ${e.date} #${e.runNumber ?? "?"} | hares=${e.hares ?? "—"} | loc=${e.location?.slice(0, 40) ?? "—"}`);
  }
  logPerKennelTally(events);

  if (!apply) {
    console.log("\nDRY RUN complete — re-run with BACKFILL_APPLY=1 to write.");
    await prisma.$disconnect();
    return;
  }

  await mergeAndReport(source.id, events);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
