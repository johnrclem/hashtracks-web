/**
 * One-shot historical backfill for Summit Full Moon H3 (sfm) — FM #1–#157.
 *
 * Summit's Full Moon runs are NOT a separate sheet tab: each is a regular Summit
 * hareline row whose "SFM #" column carries the Full-Moon number. The live
 * "Summit H3 Spreadsheet" adapter (GOOGLE_SHEETS) only parses the modern,
 * consistently-laid-out season tabs, so it captured FM #158–#321 but dropped the
 * pre-2013 tabs whose columns are shifted — leaving the entire earlier series
 * (#1, 1980 → #157, 2011) missing. Downstream this truncated the kennel's
 * "years active" stat.
 *
 * This script walks EVERY tab of the workbook
 * (1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk), detects each tab's header row
 * and column layout by header NAME (the "SFM"/"SFMH3"/"SFMH3 Run #" column, plus
 * Date/When, Hare, Location) — because the older tabs shift these columns and even
 * change their labels — and emits every row whose FM# is numeric and < 158. The
 * modern tabs (FM# ≥ 158) are already covered by the live adapter and are skipped.
 *
 * Recovers 156 of 157 runs (#1–#157; #60 is genuinely absent from the sheet).
 *
 * Data-quality handling:
 *   - Dates span "6/5/2011", "Saturday, July 16, 2011", "Sunday, June 6, 10"
 *     (2-digit year), and "Saturday, November 29, 1980". chrono handles all but the
 *     2-digit-year form, so a trailing ", YY" is expanded to a full year first
 *     (YY < 50 → 20YY, else 19YY — the series is 1980–2011).
 *   - Location cells sometimes hold a bare Google-Maps URL or "Venue <url>"; the URL
 *     is split into `locationUrl` and stripped from the venue text so the card shows
 *     a clean venue, not a raw link.
 *   - `runNumber` is the FM# (the sfm sequence), NOT the paired Summit SH3 run#.
 *   - Rows whose Date cell won't parse (e.g. a stray photo URL where the date should
 *     be) are dropped and counted, never date-guessed.
 *
 * Reconcile safety — rows bind to the dedicated "Summit Full Moon H3 Archive"
 * source, NOT the live "Summit H3 Spreadsheet". The live Summit source runs with
 * scrapeDays:9999 and no upcomingOnly, so its reconcile window reaches back to 1999
 * and would CANCEL these sole-source 1999–2013 events on the next daily scrape (the
 * live adapter only returns modern tabs, so it never re-emits #1–#157). Binding to a
 * separate, disabled, upcomingOnly source gives each event an "other source"
 * RawEvent, so the Summit reconcile's other-source guard spares them
 * (src/pipeline/reconcile.ts). The archive source is `enabled: false` → never
 * scraped → runs no reconcile of its own.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint and loads only past
 * events (date < today in America/New_York).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-sfm-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sfm-history.ts
 *
 * Requires GOOGLE_CALENDAR_API_KEY (tab enumeration) and the "Summit Full Moon H3
 * Archive" source (seed it / targeted-upsert it into prod first — it must be linked
 * to sfm).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseCSV } from "@/adapters/google-sheets/adapter";
import { chronoParseDate } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Summit Full Moon H3 Archive";
const KENNEL_TIMEZONE = "America/New_York";
const SHEET_ID = "1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk";
const MAX_FM = 157; // FM# >= 158 already covered by the live adapter

interface TabMeta {
  title: string;
  gid: number;
}

async function listTabs(): Promise<TabMeta[]> {
  const key = process.env.GOOGLE_CALENDAR_API_KEY;
  if (!key) throw new Error("GOOGLE_CALENDAR_API_KEY is required to enumerate sheet tabs.");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties(title,sheetId)&key=${key}`;
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`Sheets metadata API: HTTP ${res.status}`);
  const body = (await res.json()) as { sheets?: { properties: { title: string; sheetId: number } }[] };
  const tabs = (body.sheets ?? []).map((s) => ({ title: s.properties.title, gid: s.properties.sheetId }));
  if (tabs.length === 0) throw new Error("Sheets metadata returned 0 tabs — unexpected.");
  return tabs;
}

async function fetchTabCsv(gid: number): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await safeFetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
  });
  if (!res.ok) throw new Error(`tab gid=${gid}: HTTP ${res.status}`);
  return parseCSV(await res.text());
}

/** Expand a trailing 2-digit year ("…, 10" → "…, 2010") before chrono. */
function expandTwoDigitYear(raw: string): string {
  const m = /,\s*(\d{2})\s*$/.exec(raw);
  if (!m) return raw;
  const yy = Number.parseInt(m[1], 10);
  const full = yy < 50 ? 2000 + yy : 1900 + yy;
  return raw.replace(/,\s*\d{2}\s*$/, `, ${full}`);
}

/** Split a location cell into clean venue text + an optional maps URL. */
function splitLocation(cell: string): { location?: string; locationUrl?: string } {
  const raw = cell.replace(/\s+/g, " ").trim();
  if (!raw) return {};
  const urlMatch = /https?:\/\/\S+/.exec(raw);
  const locationUrl = urlMatch?.[0];
  const text = raw.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().replace(/[,\s]+$/, "");
  return { location: text || undefined, locationUrl };
}

function findHeaderRow(rows: string[][]): { hi: number; hdr: string[] } | null {
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    if (rows[i].some((c) => /sfm/i.test(c))) return { hi: i, hdr: rows[i] };
  }
  return null;
}

function colByHeader(hdr: string[], re: RegExp): number | null {
  for (let j = 0; j < hdr.length; j++) if (re.test(hdr[j])) return j;
  return null;
}

async function fetchArchive(): Promise<RawEventData[]> {
  const tabs = await listTabs();
  const byFm = new Map<number, RawEventData>();
  let droppedNoDate = 0;

  for (const tab of tabs) {
    if (tab.title === "Form_Responses_1") continue;
    const rows = await fetchTabCsv(tab.gid);
    const header = findHeaderRow(rows);
    if (!header) continue; // tab has no SFM column (e.g. 1980s Hash-only tab)
    const { hi, hdr } = header;
    const cFm = colByHeader(hdr, /sfm/i);
    const cDate = colByHeader(hdr, /\bdate\b|when/i);
    const cHare = colByHeader(hdr, /hare/i);
    const cLoc = colByHeader(hdr, /location/i);
    if (cFm == null || cDate == null) continue;

    for (const r of rows.slice(hi + 1)) {
      const fmCell = r[cFm]?.trim() ?? "";
      if (!/^\d{1,3}$/.test(fmCell)) continue;
      const fm = Number.parseInt(fmCell, 10);
      if (fm >= 158 || fm < 1) continue; // modern range already covered
      if (byFm.has(fm)) continue; // first occurrence wins

      const date = chronoParseDate(expandTwoDigitYear((r[cDate] ?? "").trim()), "en-US");
      if (!date) {
        droppedNoDate++;
        continue;
      }
      const hareCell = cHare != null ? (r[cHare] ?? "").trim() : "";
      const hares = hareCell && hareCell !== "?" ? hareCell : undefined;
      const { location, locationUrl } = cLoc != null ? splitLocation(r[cLoc] ?? "") : {};

      byFm.set(fm, {
        date,
        kennelTags: ["sfm"],
        runNumber: fm,
        hares,
        location,
        locationUrl,
        sourceUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
      });
    }
  }

  const events = [...byFm.values()];
  console.log(
    `  Parsed ${events.length} FM runs (#1–#${MAX_FM}); dropped ${droppedNoDate} rows with an unparseable date`,
  );
  if (events.length === 0) {
    throw new Error("0 FM rows parsed — the workbook layout likely changed. Aborting.");
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Fetching Summit Full Moon (SFM) history #1–#157 from the Summit hareline workbook",
  fetchEvents: fetchArchive,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
