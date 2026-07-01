/**
 * One-shot historical backfill for Moonshine H3 Dubai (mh3-dxb).
 *
 * The Harrier Central adapter (src/adapters/harrier-central/adapter.ts) is
 * future-only — HC's getEvents API returns only upcoming runs — so Moonshine's
 * past runs (#347 2025-02 → #363 2026-05, 17 rows) would never reach canonical
 * Events from the live scrape.
 *
 * The archive was extracted once from the HC public front-end
 * (`hashruns.org/api/global-runs?isFuture=0&minEventDate=…&maxEventDate=…`,
 * windowed and filtered client-side to PublicKennelId
 * d5f74649-a19c-4ffb-b55c-bcbc7caeb09e — the global feed ignores the kennel
 * param) and frozen into `scripts/data/mh3-dxb-history.json` — committed as
 * data, no parser, per the H7 / Bandung lesson. Each row's fields are mapped
 * to match the live adapter's output: title verbatim (EventName), location from
 * LocationOneLineDesc, coords from Latitude/Longitude (dropped where HC has
 * none), hares from HC `Hares`. Cost/description are intentionally omitted to
 * mirror the live HC adapter (which emits neither); the flat 10 AED hash cash
 * lives on the Kennel record.
 *
 * Four verified data-quality decisions are baked into the frozen JSON:
 *   0. #351 (2025-06-13) — HC location was the literal placeholder "TBD" with no
 *      hares/coords. Location omitted (the live adapter's stripPlaceholderLocation
 *      drops "TBD" the same way); the event renders unlocated → Dubai centroid.
 *   1. #360 (2026-03-06) — an online/Zoom run (HC location "Online due to current
 *      security climate in Dubai…", fee 0, no coords). The note is moved to
 *      `description` (which merge never geocodes) and `location` is omitted
 *      entirely — otherwise merge's resolveCoords would geocode the "…Dubai…"
 *      sentence and pin a virtual run to a real Dubai location (Codex P2). Kept
 *      for run-# continuity; renders unlocated → Dubai centroid fallback.
 *   2. #361 (2026-04-03) — an outlier 08:00 morning run. The GMT field agrees
 *      (04:00Z), so this is internally consistent, NOT a 12h AM/PM typo — the
 *      "20:00" it does NOT collide with any other row. Preserved verbatim.
 *   3. #363 (2026-05-29) — HC `Hares` byte-equals the venue string (HC
 *      location-bleed). Hares dropped (the live adapter's haresEqualsRawPlace
 *      guard does the same); the venue still populates `location`.
 *
 * The rows bind to the live "Moonshine H3 Dubai Harrier Central" source for
 * provenance. That source sets `upcomingOnly: true`, so reconcile never
 * false-cancels these past rows when the future-only adapter stops returning
 * them (reconcile.ts timeMin guard; same contract as Bandung / nth3-tw).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-mh3-dxb-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-mh3-dxb-history.ts
 *
 * Requires the "Moonshine H3 Dubai Harrier Central" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import mh3DxbHistory from "./data/mh3-dxb-history.json";

const SOURCE_NAME = "Moonshine H3 Dubai Harrier Central";
const KENNEL_TIMEZONE = "Asia/Dubai";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Moonshine H3 Dubai (MH3D) Harrier Central archive",
  fetchEvents: async () => {
    const events = mh3DxbHistory as RawEventData[];
    // Fail loud on an empty/corrupt archive — a one-shot backfill that loads
    // zero rows is never correct, and the shared runner would otherwise log
    // "Total parsed: 0" and exit 0, masking the breakage.
    if (events.length === 0) {
      throw new Error(
        "mh3-dxb-history.json is empty — expected 17 frozen runs (#347–#363). Aborting.",
      );
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
