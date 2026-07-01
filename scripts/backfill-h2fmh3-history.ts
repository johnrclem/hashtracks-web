/**
 * One-shot historical backfill for Hua Hin Full Moon H3 (h2fmh3).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so Hua Hin Full
 * Moon's past runs (2025-11-07 → 2026-06-28, 12 rows) would never reach
 * canonical Events from the live scrape. This is only the HC-join-forward window
 * (the kennel joined HC ~Nov 2025), NOT its lifetime — the "4th Anniversary"
 * run (#45, Jul 2026) implies a ~2022 founding, but pre-join trails are simply
 * not on the HC feed (the recoverable depth is whatever the feed holds, per the
 * shared hc-global-runs helper; same caveat as Bandung / Algarve / Moonshine).
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * windowed and filtered client-side to PublicKennelId
 * 8f7cac29-e669-452d-8d19-218d9491567d — the global feed ignores the kennel
 * param) and frozen into `scripts/data/h2fmh3-history.json` — committed as data,
 * no parser, per the H7 / Bandung / Moonshine lesson. Each row's fields are
 * mapped to match the live adapter's output: title verbatim (EventName),
 * location from LocationOneLineDesc, coords from Latitude/Longitude, hares from
 * HC `Hares`. Cost/description are intentionally omitted to mirror the live HC
 * adapter (which emits neither); the flat ฿200 hash cash lives on the Kennel
 * record. Omitting `description` also drops the #45 anniversary flyer PII
 * (bank/payee details) that HC carries on some rows.
 *
 * Verified data-quality decisions baked into the frozen JSON:
 *   0. Two overlapping numbering schemes — the main "Hua Hin Full Moon" series
 *      (#37, #39–#44) and a restart-numbered "Pranburi Hash" sub-series (#1–#3,
 *      and #40 reused for "Pranburi Hash #1/#2"). All are genuine trails for this
 *      kennel; run numbers are NOT deduped (they sit on distinct dates and merge
 *      keys on kennel+date). HC's EventNumber is kept verbatim even where the
 *      kennel's own title numbering is offset by one (e.g. title "#40" ↔ HC #39).
 *   1. #43 (2026-05-24, "Hua Hin Full Moon Hash #44") — HC start time was 04:30,
 *      an implausible AM value for a kennel whose standard start is 16:30 (a
 *      PM→AM typo). Dropped to no-time via the 06:00–20:00 gate rather than
 *      fabricating a corrected 16:30; the event still renders (date + venue).
 *   2. All coords fell inside the Thailand bounding box (lat 5.5–20.5, lng
 *      97–106) — no HC region-default pins to scrub.
 *
 * The rows bind to the live "Hua Hin Full Moon H3 Harrier Central" source for
 * provenance. That source sets `upcomingOnly: true`, so reconcile never
 * false-cancels these past rows when the future-only adapter stops returning
 * them (reconcile.ts timeMin guard; same contract as Bandung / Moonshine).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-h2fmh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-h2fmh3-history.ts
 *
 * Requires the "Hua Hin Full Moon H3 Harrier Central" source to exist + be
 * linked to h2fmh3 (run the h2fmh3 seed subset — see the onboarding runbook).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import h2fmh3History from "./data/h2fmh3-history.json";

const SOURCE_NAME = "Hua Hin Full Moon H3 Harrier Central";
const KENNEL_TIMEZONE = "Asia/Bangkok";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Hua Hin Full Moon H3 (H2FMH3) Harrier Central archive",
  fetchEvents: async () => {
    const events = h2fmh3History as RawEventData[];
    // Fail loud on an empty/corrupt archive — a one-shot backfill that loads
    // zero rows is never correct, and the shared runner would otherwise log
    // "Total parsed: 0" and exit 0, masking the breakage.
    if (events.length === 0) {
      throw new Error(
        "h2fmh3-history.json is empty — expected 12 frozen runs (2025-11-07 → 2026-06-28). Aborting.",
      );
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
