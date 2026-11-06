/**
 * One-shot historical backfill for the HC batch (Nov 2026) — 13 config-only
 * HARRIER_CENTRAL kennels onboarded together.
 *
 * The Harrier Central adapter is future-only (getEvents never returns past runs),
 * and 10 of the 13 kennels had nothing posted ahead at build time, so without
 * this backfill their pages would be empty. The archive was pulled once from
 * hashruns.org/api/global-runs?isFuture=0 (4-month windows back to 2015,
 * filtered client-side by PublicKennelId — the feed ignores the kennel param),
 * mapped through the shared `mapRunToRawEvent` (same title-fallback /
 * titleStripPatterns / location rules as the live source configs), and frozen
 * into `scripts/data/hc-batch-nov-history.json` (158 rows, keyed by kennelCode).
 * The recoverable depth is whatever HC holds — it starts when each kennel began
 * using HC, not at its founding.
 *
 * Scrubs baked into the frozen JSON:
 *  - `description` omitted on every row — HC EventDescription can carry hare PII.
 *  - Pins outside the kennel's country bbox (incl. HC's 0,0 "no pin") dropped,
 *    as are pins on rows whose venue text was dropped.
 *  - Implausible start times outside 06:00–20:00 (HC "00:00"/"00:30" = unset)
 *    dropped rather than guessed.
 *  - Coordinate-only, what3words and prose "location" text dropped (DA2B's
 *    mystery-tour blurbs, YH3 "///…").
 *  - Titles that are hare/venue notes ("Hares: …") → "<defaultTitle> #N".
 *  - Abuja's "The Hare Raiser and his hares" placeholder hares dropped.
 *  - Two mis-dated duplicates dropped: abujah3 #814 on Tue 2026-10-13 (the real
 *    run is Sat 2026-10-17) and da2b #205 on 2025-05-03 (the real #205 is
 *    2025-10-04, same venue text).
 *  - Uncounted socials keep their date/title but no run number (SUNH3's
 *    2026-09-22 equinox social shared #9 with the 09-26 trail).
 *
 * Each kennel binds to its live "<Kennel> Harrier Central" source, which sets
 * `upcomingOnly: true`, so reconcile never cancels these past rows.
 *
 *   Dry run (all kennels):  npx tsx scripts/backfill-hc-batch-nov-history.ts
 *   Dry run (one kennel):   npx tsx scripts/backfill-hc-batch-nov-history.ts yh3
 *   Apply (one kennel):     BACKFILL_APPLY=1 npx tsx scripts/backfill-hc-batch-nov-history.ts yh3
 *
 * Apply takes exactly one kennel per invocation: the shared runner disconnects
 * Prisma after each merge.
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/hc-batch-nov-history.json";

const KENNELS: Record<string, { sourceName: string; timezone: string }> = {
  yh3: { sourceName: "Yorkshire H3 Harrier Central", timezone: "Europe/London" },
  oph3: { sourceName: "Okinawa Poofters Harrier Central", timezone: "Asia/Tokyo" },
  "bdh3-uk": { sourceName: "Black Death H3 Harrier Central", timezone: "Europe/London" },
  da2b: { sourceName: "Devon A2B Harrier Central", timezone: "Europe/London" },
  bbch3: { sourceName: "Brum and Black Country H3 Harrier Central", timezone: "Europe/London" },
  cernh3: { sourceName: "CERN H3 Harrier Central", timezone: "Europe/Zurich" },
  "ph3-sr": { sourceName: "Paramaribo H3 Harrier Central", timezone: "America/Paramaribo" },
  abujah3: { sourceName: "Abuja H3 Harrier Central", timezone: "Africa/Lagos" },
  blhhh: { sourceName: "Big Lik H3 Harrier Central", timezone: "Europe/Istanbul" },
  "hannover-h3": { sourceName: "Hannover H3 Harrier Central", timezone: "Europe/Berlin" },
  mobh3: { sourceName: "Moon Over Barbados H3 Harrier Central", timezone: "America/Barbados" },
  bbh3: { sourceName: "Barbados Bike H3 Harrier Central", timezone: "America/Barbados" },
  sunh3: { sourceName: "Shenanagains Under Nightfall Harrier Central", timezone: "America/New_York" },
};

async function main(): Promise<void> {
  const archive = history as Record<string, RawEventData[]>;
  const only = process.argv[2];
  if (only && !KENNELS[only]) throw new Error(`Unknown kennel "${only}". Expected one of: ${Object.keys(KENNELS).join(", ")}`);
  if (process.env.BACKFILL_APPLY === "1" && !only) {
    throw new Error("Apply mode needs exactly one kennelCode argument (the runner disconnects Prisma after each merge).");
  }
  for (const code of only ? [only] : Object.keys(KENNELS)) {
    const events = archive[code] ?? [];
    if (events.length === 0) throw new Error(`No frozen rows for ${code} — the archive file is corrupt. Aborting.`);
    console.log(`\n========== ${code} ==========`);
    // Sequential by design: one kennel's merge at a time (shared Prisma client).
    await runBackfillScript({ // NOSONAR S7735 — intentional sequential await
      sourceName: KENNELS[code].sourceName,
      kennelTimezone: KENNELS[code].timezone,
      label: `Loading frozen ${code} Harrier Central archive`,
      fetchEvents: () => Promise.resolve(events),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
