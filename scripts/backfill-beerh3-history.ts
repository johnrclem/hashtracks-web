/**
 * One-shot historical backfill for BEER H3 / Belgrade (beerh3).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so BEER H3's
 * past runs would never reach canonical Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * filtered client-side to PublicKennelId 3dc748a7-1d2a-4b7f-9478-8bab10817477 —
 * the global feed ignores the kennel param) and frozen into
 * `scripts/data/beerh3-history.json` — committed as data, no parser, per the
 * H7 / Asunción lesson.
 *
 * The HC archive is SHALLOW: only #550 (2026-03-01), #570 (2026-05-01) and #571
 * (2026-07-04) exist — the kennel predates its Harrier Central adoption (deep run
 * #, first logged HC run ~#550). Verified 2026-07-05: no BEER H3 rows before
 * 2026-03. (#571 was upcoming at research time on 2026-07-04 and has since become
 * a past run — included here.)
 *
 * Fields match the live adapter's output: `title` = HC `EventName` verbatim
 * ("Sausage Fest Aftermath", "Pan Jugo Hash 2026", "Libeerators of Belgrade"),
 * `hares` verbatim (loosely formatted — "and more..." kept as-is per the HC
 * caveat), `description`/`cost` omitted (the live HC adapter emits neither; also
 * avoids any PII). All three coords sit inside the Belgrade bbox and all start
 * times are inside the 06:00–20:00 gate — no scrubs were needed.
 *
 * The rows bind to the live "BEER H3 Harrier Central" source for provenance. That
 * source sets `upcomingOnly: true`, so reconcile never false-cancels these past
 * rows when the future-only adapter stops returning them (reconcile.ts timeMin
 * guard; same contract as Bandung / Barbados).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-beerh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-beerh3-history.ts
 *
 * Requires the "BEER H3 Harrier Central" source to exist (seed first).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import beerh3History from "./data/beerh3-history.json";

const SOURCE_NAME = "BEER H3 Harrier Central";
const KENNEL_TIMEZONE = "Europe/Belgrade";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen BEER H3 (Belgrade) Harrier Central archive",
  fetchEvents: async () => beerh3History as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
