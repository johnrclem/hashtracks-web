/**
 * One-shot historical backfill for Fengyuan H3 / FISHHH (fishhh).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so FISHHH's
 * past runs would never reach canonical Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * walked in ≤6-month windows and filtered client-side to PublicKennelId
 * b66324a8-80a1-41b6-8c78-3a86111a4de0 — the global feed ignores the kennel
 * param) and frozen into `scripts/data/fishhh-history.json` — committed as data,
 * no parser, per the H7 / Asunción lesson.
 *
 * 20 counted runs, #1 (2022-08-07) → #22 (2026-06-19). Structural gaps are
 * preserved, NOT "fixed": FISHHH has no run #13 or #16.
 *
 * Two learned quirks were scrubbed during extraction (drop, never fabricate):
 *   1. Run #19's coords were 52.3447/4.8728 (Amsterdam — a bogus geocode-fail
 *      pin). Dropped via the Taiwan bbox (lat 21.9–25.3, lng 119.3–122.1);
 *      merge re-geocodes from the venue text.
 *   2. Run #10's start time was 23:59 (a placeholder). Dropped via the
 *      06:00–20:00 gate → startTime undefined (date + venue preserved).
 *
 * Fields match the live adapter's output: `title` = HC `EventName` verbatim,
 * `hares` kept verbatim (real hash names; dropped only if they equal the venue),
 * `description`/`cost` omitted (the live HC adapter emits neither; also avoids PII).
 *
 * The rows bind to the live "Fengyuan H3 Harrier Central" source for provenance.
 * That source sets `upcomingOnly: true`, so reconcile never false-cancels these
 * past rows when the future-only adapter stops returning them (reconcile.ts
 * timeMin guard; same contract as Bandung / Asunción).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-fishhh-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-fishhh-history.ts
 *
 * Requires the "Fengyuan H3 Harrier Central" source to exist (seed first).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import fishhhHistory from "./data/fishhh-history.json";

const SOURCE_NAME = "Fengyuan H3 Harrier Central";
const KENNEL_TIMEZONE = "Asia/Taipei";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Fengyuan H3 (FISHHH) Harrier Central archive",
  fetchEvents: async () => fishhhHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
