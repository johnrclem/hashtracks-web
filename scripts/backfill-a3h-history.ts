/**
 * One-shot historical backfill for Algarve H3 / A3H (a3h).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so A3H's past
 * runs (#2155 2025-07-14 → #2177 2026-06-28, 23 rows) would never reach
 * canonical Events from the live scrape. This is only the HC-join-forward
 * window, NOT the kennel's lifetime (A3H has run since 1984 / run #1; pre-#2155
 * trails are not on the HC feed — same caveat as Lisbon H3 / Bandung).
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * windowed and filtered client-side to PublicKennelId
 * 0d70e48a-1bd5-42ba-996f-2654a35bc3f6 — the global feed ignores the kennel
 * param) and frozen into `scripts/data/a3h-history.json` — committed as data,
 * no parser, per the H7 / Asunción / Bandung lesson. Each row's fields are
 * mapped to match the live adapter's output:
 *   - title: verbatim EventName with trailing separators stripped
 *     (mirrors applyTitleFallback / stripTrailingTitleSeparators). A3H uses
 *     real names ("Run NNNN - <hare> - <village>"), so defaultTitle never fires.
 *   - hares: HC `Hares`, with "Placeholder user" / "TBA" / "TBC" placeholders
 *     dropped (mirrors stripPlaceholderHares).
 *   - location: HC `LocationOneLineDesc`, with geocode sentinels ("Tbc") and
 *     bare coordinate-pair text dropped (mirrors composeHcLocation). A3H stores
 *     coords in the venue field for most runs, so `location` is usually empty
 *     while the village survives in the title.
 *   - latitude/longitude: HC `Latitude`/`Longitude`, dropped + `dropCachedCoords`
 *     when the venue is a sentinel (HC's region-default fallback pin —
 *     mirrors hcGeocodeFailed).
 *   - cost: kennel default "€5" (EventPriceForMembers=5; feed has no currency
 *     field → EUR inferred from Portugal).
 *   - description: deliberately OMITTED — HC `EventDescription` on this kennel
 *     is a free-text blob carrying hare emails / phone numbers (PII), and the
 *     live adapter never emits description anyway.
 *
 * One structural fix (not a preserved quirk): run #2167 appeared twice in the
 * feed — 2025-12-28 titled "HASH CANCELLED" (IsCountedRun=0, venue "Tbc") and
 * 2026-01-11 "Run 2167 - Methane - Fuseta" (the real, counted trail). The
 * cancelled slot was DROPPED (it is not a trail that happened), leaving a clean
 * monotonic sequence with a single #2167. Cf. the Bandung backfill dropping its
 * mis-dated #2292 duplicate.
 *
 * The rows bind to the live "Algarve H3 Harrier Central" source for provenance.
 * That source sets `upcomingOnly: true`, so reconcile never false-cancels these
 * past rows when the future-only adapter stops returning them (reconcile.ts
 * timeMin guard; same contract as Bandung / Asunción / nth3-tw).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-a3h-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-a3h-history.ts
 *
 * Requires the "Algarve H3 Harrier Central" source to exist (run the a3h seed
 * subset — see the onboarding post-merge runbook).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import a3hHistory from "./data/a3h-history.json";

const SOURCE_NAME = "Algarve H3 Harrier Central";
const KENNEL_TIMEZONE = "Europe/Lisbon";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Algarve H3 (A3H) Harrier Central archive",
  fetchEvents: async () => a3hHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
