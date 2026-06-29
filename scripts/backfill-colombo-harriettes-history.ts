/**
 * One-shot historical backfill for Colombo Harriettes (colombo-harriettes).
 *
 * The recurring ColomboHarriettesAdapter scrapes hashcolombo.com, which SSRs
 * only the single current "Next run" block — so the live scrape can never see
 * the kennel's back-catalogue (HashTracks held just Run #2223). The site's
 * backing API, however, exposes the FULL run archive with structured fields:
 *
 *   GET https://api2.hashcolombo.com/noauth/runs
 *     → JSON array, run-level fields: run_number, run_date (YYYY-MM-DD),
 *       starting_time (HH:MM, varies per run), run_name (theme, often empty),
 *       run_site_name (venue), address (street), plus member/participant/income
 *       arrays that are PII and are deliberately NOT read here.
 *
 * As of the audit (#2285) the feed carried 125 runs (#2099 → #2223, spanning
 * 2023 → 2026-06-20). This script pulls them all and routes the past slice
 * through the merge pipeline so canonical Events are created inline.
 *
 * Field mapping mirrors the live adapter's conventions:
 *   - title  = run_name when present, else undefined → merge synthesizes
 *     "Colombo Harriettes Trail #N" (the feed has no hares field).
 *   - location = run_site_name (venue), locationStreet = address.
 *   - startTime kept verbatim per row (the feed stores 24h HH:MM; quirky values
 *     like a 05:00 entry are preserved faithfully, not "corrected").
 *
 * Safe + re-runnable: the source carries `config.upcomingOnly: true`, so
 * reconcile clamps its cancellation window to the future and never cancels
 * these past rows; `reportAndApplyBackfill` only loads `date < today` and
 * `processRawEvents` dedupes by fingerprint, so re-running is a no-op.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-colombo-harriettes-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-colombo-harriettes-history.ts
 *
 * Requires the "Colombo Harriettes Website" source to exist (run `prisma db seed`).
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Colombo Harriettes Website";
const KENNEL_TIMEZONE = "Asia/Colombo";
const KENNEL_TAG = "colombo-harriettes";
const API_URL = "https://api2.hashcolombo.com/noauth/runs";

/** Run-level fields read from the noauth/runs feed. Participant/member/income
 * arrays exist on each row but are PII and intentionally omitted. */
interface ColomboRun {
  run_number?: number;
  run_date?: string; // "YYYY-MM-DD"
  starting_time?: string; // "HH:MM"
  run_name?: string; // theme / event name (often empty)
  run_site_name?: string; // venue name
  address?: string; // street address
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Normalize a source time to strict zero-padded "HH:MM", or undefined when it's
 * not a valid 24h clock value (rejects "29:99" etc. that the regex alone allows). */
function normalizeTime(raw: string | undefined): string | undefined {
  const m = raw ? TIME_RE.exec(raw) : null;
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function clean(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

async function fetchEvents(): Promise<RawEventData[]> {
  const res = await safeFetch(API_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (HashTracks historical backfill)" },
  });
  if (!res.ok) throw new Error(`Colombo API returned HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new TypeError("Colombo API: expected a JSON array of runs");
  }

  const events: RawEventData[] = [];
  for (const row of data as ColomboRun[]) {
    const date = clean(row.run_date);
    if (!date || !DATE_RE.test(date)) continue;
    // Number.isInteger guards the integer runNumber column against NaN/float.
    if (!Number.isInteger(row.run_number) || (row.run_number as number) <= 0) continue;

    // Normalize to strict zero-padded "HH:MM"; reject out-of-range values.
    const startTime = normalizeTime(clean(row.starting_time));

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber: row.run_number,
      // run_name → title when present; otherwise merge synthesizes the default.
      title: clean(row.run_name),
      startTime,
      location: clean(row.run_site_name),
      locationStreet: clean(row.address),
      sourceUrl: "https://hashcolombo.com/",
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Fetching Colombo Harriettes full run archive (api2.hashcolombo.com/noauth/runs)",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
