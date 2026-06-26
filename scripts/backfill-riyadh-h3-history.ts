/**
 * One-shot historical backfill for Riyadh H3 / R3H4 — HashTracks' first Saudi
 * Arabia kennel.
 *
 * The recurring adapter (src/adapters/html-scraper/riyadh-h3.ts) fetches only
 * the forward window (`date >= today`) from the Supabase `hikes` table, so the
 * 2025+ archive (~58 rows, run #2415 2025-01-03 → present) would never reach
 * canonical Events on its own. This script fetches the PAST slice (`date < today`)
 * from the same table and routes it through the merge pipeline (via the backfill
 * runner → processRawEvents), creating both RawEvents and canonical Events in one
 * pass. The seed source sets `config.upcomingOnly: true` so reconcile clamps to
 * the future and never false-cancels these backfilled rows (ONH3 split).
 *
 * Mapping is shared with the live adapter (`mapHikeRow`) — one source of truth for
 * the column map. The `anon` JWT is publishable (role:anon, RLS-gated).
 *
 * Re-runnable: the backfill runner partitions to past-only (date < today in the
 * kennel timezone) and the merge pipeline dedupes by fingerprint.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-riyadh-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-riyadh-h3-history.ts
 *
 * Requires the "Riyadh H3 Supabase API" source to exist (run `npx prisma db seed`)
 * and, against Railway in dev, BACKFILL_ALLOW_SELF_SIGNED_CERT=1.
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import { safeFetch } from "@/adapters/safe-fetch";
import {
  HIKES_SELECT,
  RIYADH_ANON_ENV,
  mapHikeRow,
  resolveRiyadhAnonKey,
  riyadhToday,
  type HikeRow,
} from "@/adapters/html-scraper/riyadh-h3";

const SOURCE_NAME = "Riyadh H3 Supabase API";
const KENNEL_TIMEZONE = "Asia/Riyadh";
const PROJECT_REF = "uleyjftvdnpniabomdpi";
const TABLE = "hikes";

async function fetchEvents(): Promise<RawEventData[]> {
  const anonKey = resolveRiyadhAnonKey();
  if (!anonKey) {
    throw new Error(`Set the ${RIYADH_ANON_ENV} env var before running this backfill`);
  }
  // Past slice only — the recurring adapter owns `date >= today`. The runner
  // re-partitions to date < today(kennel TZ) as a safety net, but querying the
  // past directly keeps the payload small and the intent explicit. Same
  // Asia/Riyadh boundary as the adapter so the split is consistent.
  const today = riyadhToday();
  const url = `https://${PROJECT_REF}.supabase.co/rest/v1/${TABLE}?select=${HIKES_SELECT}&order=date.asc&deleted_at=is.null&date=lt.${today}`;

  const res = await safeFetch(url, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) {
    throw new Error(`Riyadh H3 Supabase API returned HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) {
    throw new TypeError("Riyadh H3 Supabase API: expected a JSON array of rows");
  }

  const rows = json as HikeRow[];
  const events = rows.map(mapHikeRow).filter((e): e is RawEventData => e !== null);
  console.log(`Fetched ${rows.length} past rows → ${events.length} mappable events`);
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Backfilling Riyadh H3 archive from the Supabase hikes table",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  // Set exitCode (not process.exit) so the runner's Prisma disconnect can drain.
  process.exitCode = 1;
});
