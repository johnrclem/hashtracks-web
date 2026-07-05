/**
 * One-shot historical backfill for Lune Valley H3 (lvh3-gb).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so LVH3's past
 * runs would never reach canonical Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * walked in ≤6-month windows — quarterly for the busy 2022/2023 windows that
 * time out annually — and filtered client-side to PublicKennelId
 * 400f5862-2279-416e-970f-96143165e924, the global feed ignores the kennel
 * param) and frozen into `scripts/data/lvh3-gb-history.json` — committed as data,
 * no parser, per the H7 / Asunción lesson.
 *
 * Deep archive: 215 runs, #729 (2020-01-10) → #943 (2026-06-30) — LVH3 joined
 * Harrier Central well before its ~#944 present, so most of its recent history is
 * recoverable. Run-number sequence is monotonic; no gaps were fabricated.
 *
 * Fields match the live adapter's output: `title` = HC `EventName` verbatim
 * (shortcode-form "LVH3 #N[: venue]"), `hares` verbatim, `description`/`cost`
 * omitted (the live HC adapter emits neither; also avoids PII — the frozen set
 * was PII-scrubbed).
 *
 * One coord scrub (drop, never fabricate): run #900 ("LVH3 #900: Nicky Nook",
 * venue "Applestore Cafe, Scorton" — Scorton is in Lancashire) carried a pin at
 * 56.95/-2.23 (Stonehaven, SCOTLAND) — a geocode-fail; its coords are dropped so
 * merge re-geocodes from the venue. Note the away-weekend runs #803–#805
 * ("Weekend away: Sandyhills", Dumfries & Galloway) are NOT scrubbed — their
 * Scottish coords are correct for that real away trip, not a geocode-fail. No
 * start times fell outside the 06:00–20:00 gate.
 *
 * The rows bind to the live "Lune Valley H3 Harrier Central" source for
 * provenance. That source sets `upcomingOnly: true`, so reconcile never
 * false-cancels these past rows when the future-only adapter stops returning
 * them (reconcile.ts timeMin guard; same contract as Bandung / Newcastle).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-lvh3-gb-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-lvh3-gb-history.ts
 *
 * Requires the "Lune Valley H3 Harrier Central" source to exist (seed first).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import lvh3History from "./data/lvh3-gb-history.json";

const SOURCE_NAME = "Lune Valley H3 Harrier Central";
const KENNEL_TIMEZONE = "Europe/London";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Lune Valley H3 (LVH3) Harrier Central archive",
  fetchEvents: async () => lvh3History as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
