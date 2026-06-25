/**
 * One-shot historical backfill for Bandung H3 / BHHH2 (bandung-h3).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so BHHH2's
 * past runs (#2253 2025-06 → #2308 2026-06, 55 rows incl. two un-numbered
 * special runs) would never reach canonical Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * windowed and filtered client-side to PublicKennelId
 * 05907d91-8972-4447-8f33-fdf11f948a2e — the global feed ignores the kennel
 * param) and frozen into `scripts/data/bandung-h3-history.json` — committed as
 * data, no parser, per the H7 / Asunción lesson. Each row's fields are mapped
 * to match the live adapter's output (title verbatim, location composed from the
 * HC address parts, coords dropped on geocode-fail sentinels, HC `Hares`
 * deliberately omitted — it carries location-bleed for this kennel).
 *
 * Structural quirks are preserved, NOT "fixed": BHHH2 skips run #2273 and #2289,
 * and one title says "Run 2231" on event #2301.
 *
 * Two HC data-entry errors WERE corrected — preserving them would ship broken
 * data, not a faithful quirk:
 *   1. Runs #2283/#2286/#2288 were entered at 02:30 local — a clerical AM/PM typo
 *      (exactly 12h off, the GMT field agrees, every other row + the kennel's
 *      stated "2:30pm sharp" schedule say 14:30) — normalized to 14:30.
 *   2. Run #2292 appeared twice (2026-02-20 AND 2026-02-27, same venue). The
 *      02-20 copy collides with the real #2291 on (kennel, date, startTime), so
 *      processRawEvents folds it into #2291's canonical and mislabels that run
 *      (merge.ts same-day match). Dropped the 02-20 duplicate, leaving the true
 *      weekly schedule #2291@02-20, #2292@02-27.
 *
 * The rows bind to the live "Bandung H3 Harrier Central" source for provenance.
 * That source sets `upcomingOnly: true`, so reconcile never false-cancels these
 * past rows when the future-only adapter stops returning them (reconcile.ts
 * timeMin guard; same contract as Asunción / nth3-tw).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-bandung-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bandung-h3-history.ts
 *
 * Requires the "Bandung H3 Harrier Central" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import bandungHistory from "./data/bandung-h3-history.json";

const SOURCE_NAME = "Bandung H3 Harrier Central";
const KENNEL_TIMEZONE = "Asia/Jakarta";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Bandung H3 (BHHH2) Harrier Central archive",
  fetchEvents: async () => bandungHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
