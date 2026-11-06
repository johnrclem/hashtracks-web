/**
 * One-shot GAP FILL for every single-kennel Harrier Central source: past runs that
 * hashruns.org `/api/global-runs?isFuture=0` holds but HashTracks never ingested.
 *
 * Why: the live HC adapter reads `getEvents`, which is future-only, so past runs
 * reach canonical Events only through the per-kennel frozen archive backfills
 * (scripts/data/<code>-history.json). Those snapshots missed runs that HC posted
 * late, or after the run date, e.g. KRASH #4/#20 (#2638), TITs #1525/#1582 (#2640),
 * Heraultics' Sept-2025 #10 (#2637), Brazil Nuts #268 (#2567).
 *
 * Gap rule (deliberately conservative): a global-runs row is a candidate only when
 *   - its date is in the past (kennel-local, enforced by reportAndApplyBackfill), and
 *   - the kennel has NO Event on that date (any status: never resurrect a cancelled
 *     or deleted-then-cancelled row), and
 *   - the kennel has no Event with the same run number at ANY date (a reschedule,
 *     or a run already held from a curated non-HC archive such as Hamburg's blog), and
 *   - it is not a numbered-but-uncounted row (`IsCountedRun=0`, `EventNumber>0`):
 *     HC uses that for slots that did not happen and whose number was reused, e.g.
 *     Heraultics' 2025-09-07 #10. Uncounted #0 socials are kept.
 * Rows are mapped with the live adapter's own `hcEventToRawEvent`, so titles, hares,
 * locations and coords follow exactly the rules upcoming runs get. Like the frozen
 * backfills, start times outside 06:00–21:59 are dropped (HC AM/PM data-entry).
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-hc-global-runs-gaps.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-hc-global-runs-gaps.ts
 *   One kennel: append  --kennel krashh3
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import {
  globalRunMatchesSource,
  globalRunToHcEvent,
  hcEventToRawEvent,
  type HCGlobalRun,
  type HarrierCentralConfig,
} from "@/adapters/harrier-central/adapter";
import type { RawEventData } from "@/adapters/types";

const GLOBAL_RUNS_URL = "https://www.hashruns.org/api/global-runs";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const FIRST_YEAR = 2010;
const EXCLUDED_KENNELS = new Set(["h7"]);

async function fetchYear(year: number): Promise<HCGlobalRun[]> {
  const url =
    `${GLOBAL_RUNS_URL}?isFuture=0&pageSize=20000` +
    `&minEventDate=${year}-01-01&maxEventDate=${year}-12-31`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`global-runs ${year}: HTTP ${res.status}`);
  const json = (await res.json()) as { totalMatchingEvents?: number; runs?: HCGlobalRun[] };
  if (!Array.isArray(json.runs)) throw new Error(`global-runs ${year}: unexpected shape`);
  if (json.totalMatchingEvents != null && json.totalMatchingEvents > json.runs.length) {
    throw new Error(`global-runs ${year}: page truncated (${json.runs.length}/${json.totalMatchingEvents})`);
  }
  return json.runs;
}

/** Same 06:00–21:59 sanity gate the frozen per-kennel archives applied. */
function gateStartTime(e: RawEventData): RawEventData {
  if (!e.startTime) return e;
  const hour = Number(e.startTime.slice(0, 2));
  return hour >= 6 && hour <= 21 ? e : { ...e, startTime: undefined };
}

interface HcSource {
  name: string;
  config: HarrierCentralConfig;
}

async function main(): Promise<void> {
  const onlyKennel = process.argv.includes("--kennel")
    ? process.argv[process.argv.indexOf("--kennel") + 1]
    : undefined;

  const rows = await prisma.source.findMany({
    where: { type: "HARRIER_CENTRAL", enabled: true },
    select: { name: true, config: true },
  });
  const sources: HcSource[] = rows
    .map((s) => ({ name: s.name, config: (s.config ?? {}) as HarrierCentralConfig }))
    // Multi-kennel city filters (Tokyo) route by pattern; out of scope here.
    .filter((s) => !s.config.cityNames && !s.config.kennelPatterns?.length)
    // Hamburg H7's pre-2026 history is a hand-curated blog archive with its own
    // run numbering (scripts/backfill-h7-history.ts); HC's back-filled rows for
    // that era would duplicate it under different dates.
    .filter((s) => !EXCLUDED_KENNELS.has(s.config.defaultKennelTag ?? ""))
    .filter((s) => !!s.config.defaultKennelTag && (!!s.config.publicKennelId || !!s.config.kennelUniqueShortName))
    .filter((s) => !onlyKennel || s.config.defaultKennelTag === onlyKennel);

  console.log(`Fetching hashruns.org global-runs past archive ${FIRST_YEAR}→now…`);
  const thisYear = new Date().getUTCFullYear();
  const runs: HCGlobalRun[] = [];
  for (let y = FIRST_YEAR; y <= thisYear; y++) runs.push(...(await fetchYear(y)));
  console.log(`  ${runs.length} past rows across all HC kennels`);

  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: sources.map((s) => s.config.defaultKennelTag!) } },
    select: { id: true, kennelCode: true },
  });
  const kennelIdByCode = new Map(kennels.map((k) => [k.kennelCode, k.id]));

  const summary: string[] = [];
  for (const source of sources) {
    const code = source.config.defaultKennelTag!;
    const kennelId = kennelIdByCode.get(code);
    if (!kennelId) continue;
    const mine = runs.filter((r) => globalRunMatchesSource(r, source.config));
    if (mine.length === 0) continue;

    const existing = await prisma.event.findMany({
      where: { kennelId },
      select: { date: true, runNumber: true },
    });
    const existingDates = new Set(existing.map((e) => e.date.toISOString().slice(0, 10)));
    const existingRuns = new Set(existing.map((e) => e.runNumber).filter((n): n is number => n != null));

    const descriptionsById = new Map(mine.map((r) => [r.PublicEventId, r.EventDescription?.trim() ?? ""]));
    const tz = mine[0].KennelIANATimezone ?? "UTC";
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    const gaps: RawEventData[] = [];
    let runNumberSkips = 0;
    let uncountedSkips = 0;
    for (const r of mine) {
      if (r.IsCountedRun === 0 && (r.EventNumber ?? 0) > 0) {
        uncountedSkips++;
        continue;
      }
      const raw = hcEventToRawEvent(globalRunToHcEvent(r), source.config, { descriptionsById });
      if (!raw || raw.date >= today || existingDates.has(raw.date) || seen.has(raw.date)) continue;
      if (raw.runNumber != null && existingRuns.has(raw.runNumber)) {
        runNumberSkips++;
        continue;
      }
      seen.add(raw.date);
      gaps.push(gateStartTime(raw));
    }
    if (gaps.length === 0) continue;

    gaps.sort((a, b) => a.date.localeCompare(b.date));
    summary.push(
      `${code.padEnd(16)} ${String(gaps.length).padStart(4)} new  ${gaps[0].date} → ${gaps.at(-1)!.date}` +
        `  (HC rows ${mine.length}; skipped: run# already held ${runNumberSkips}, uncounted ${uncountedSkips})  runs: ` +
        gaps.map((g) => (g.runNumber == null ? "—" : `#${g.runNumber}`)).join(" "),
    );
    console.log(`\n=== ${source.name} (${code}) ===`);
    await reportAndApplyBackfill({
      apply: process.env.BACKFILL_APPLY === "1",
      sourceName: source.name,
      events: gaps,
      kennelTimezone: tz,
    });
  }

  console.log("\n================ SUMMARY ================");
  console.log(summary.length ? summary.join("\n") : "No gaps found.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
