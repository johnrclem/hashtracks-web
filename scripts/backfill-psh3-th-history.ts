/**
 * One-shot historical backfill for Pranburi H3 (psh3-th).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so Pranburi's
 * past runs would never reach canonical Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * windowed and filtered client-side to PublicKennelId
 * e717ca00-fdc4-4e3f-a90d-7faab04adbe9 — the global feed ignores the kennel
 * param) and frozen into `scripts/data/psh3-th-history.json` — committed as
 * data, no parser, per the H7 / Asunción lesson.
 *
 * The HC archive is SHALLOW: only #4 (2026-05-10) and #5 (2026-06-07) exist —
 * the kennel adopted Harrier Central at run #4 (runs #1–#3 predate its HC
 * archive and are not reachable). Verified 2026-07-05 by windowed pulls back to
 * 2025-10 (0 rows) plus tight 2-week windows (no truncation).
 *
 * Fields are mapped to match the live adapter's output:
 *   - `title` = HC `EventName` verbatim ("Pranburi Hash #4" / "Pranburi hash #5").
 *   - #5's HC `Hares` ("Tap Thai lake") equals its `LocationOneLineDesc` —
 *     location-bleed, not a real hare name — so `hares` is dropped for #5.
 *   - `description`/`cost` omitted (the live HC adapter emits neither; also
 *     avoids any PII the shared "Moonies" crew embeds in descriptions).
 *   - Coords within the Thailand bbox (#4 real Pranburi pin; #5 has none);
 *     both start times (16:30) are inside the 06:00–20:00 gate.
 *
 * The rows bind to the live "Pranburi H3 Harrier Central" source for provenance.
 * That source sets `upcomingOnly: true`, so reconcile never false-cancels these
 * past rows when the future-only adapter stops returning them (reconcile.ts
 * timeMin guard; same contract as Bandung / h2fmh3).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-psh3-th-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-psh3-th-history.ts
 *
 * Requires the "Pranburi H3 Harrier Central" source to exist (seed first).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import psh3History from "./data/psh3-th-history.json";

const SOURCE_NAME = "Pranburi H3 Harrier Central";
const KENNEL_TIMEZONE = "Asia/Bangkok";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Pranburi H3 (PSH3-TH) Harrier Central archive",
  fetchEvents: async () => psh3History as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
