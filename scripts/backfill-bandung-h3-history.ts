/**
 * One-shot historical backfill for Bandung H3 / BHHH2 (bandung-h3).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so BHHH2's
 * past runs (#2253 2025-06 → #2308 2026-06, 56 rows incl. two un-numbered
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
 * Structural/identity quirks are preserved, NOT "fixed": BHHH2 reuses run# 2292
 * (two dates), skips 2273 and 2289, and one title says "Run 2231" on event #2301.
 * The ONE corrected value: runs #2283/#2286/#2288 were entered in HC at 02:30
 * local (a clerical AM/PM typo — exactly 12h off, GMT field agrees, every other
 * row + the kennel's stated "2:30pm sharp" schedule say 14:30), normalized to
 * 14:30 so the frozen archive shows the real run time, not a 2:30 AM artifact.
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
