/**
 * One-shot historical backfill for Barbados H3 (barbados-h3).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so Barbados H3's
 * past runs (#2127 2023-02-04 → #2338 2026-06-27, 212 continuous rows) would never
 * reach canonical Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * walked in 6-month windows and filtered client-side to PublicKennelId
 * 78da30cc-66f5-4c9f-bd7b-ec3b0f54f8d0 — the global feed ignores the kennel
 * param) and frozen into `scripts/data/barbados-h3-history.json` — committed as
 * data, no parser, per the H7 / Asunción / Bandung lesson. Each row carries
 * date, runNumber, startTime, hares, venue (LocationOneLineDesc) and geocoded
 * coords, mapped to match the live adapter's output.
 *
 * Two deliberate normalizations (the rest of the source is preserved verbatim):
 *   1. `title` is dropped on every row. The HC EventName field is 150+ wildly
 *      inconsistent variants ("Run 2127", "Rum 2223", "BH3 Hash Run #2251",
 *      "Barbados Hash House Harriers") with no reliable theme signal — leaving
 *      title undefined lets merge.ts synthesize the uniform "Barbados H3 Trail #N"
 *      across the whole archive.
 *   2. Run #2128 was entered at 03:30 local — a clerical AM/PM typo amid 15:30
 *      neighbours (the kennel runs Saturday afternoons). Its startTime is dropped
 *      (left undefined) rather than fabricated; legit 10:00 public-holiday runs
 *      are preserved.
 *
 * The rows bind to the live "Barbados H3 Harrier Central" source for provenance.
 * That source sets `upcomingOnly: true`, so reconcile never false-cancels these
 * past rows when the future-only adapter stops returning them (reconcile.ts
 * timeMin guard; same contract as Bandung / Asunción).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-barbados-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-barbados-h3-history.ts
 *
 * Requires the "Barbados H3 Harrier Central" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import barbadosHistory from "./data/barbados-h3-history.json";

const SOURCE_NAME = "Barbados H3 Harrier Central";
const KENNEL_TIMEZONE = "America/Barbados";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Barbados H3 Harrier Central archive",
  fetchEvents: async () => barbadosHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
