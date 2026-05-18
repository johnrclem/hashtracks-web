/**
 * Live verification for the GCal title-bundle fixes (#1471, #1466, #1458).
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-gcal-title-bundle.ts`
 *
 * Exits non-zero when any check detects a regression OR when a fetch
 * fails — usable as a CI gate.
 *
 * Read-only — does not mutate the DB.
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

interface Check {
  /** Label shown next to the count; the "(expect 0)" suffix is added automatically. */
  label: string;
  /** Predicate over a single event; events matching count toward `failedChecks`. */
  predicate: (e: RawEventData) => boolean;
}

interface Target {
  sourceName: string;
  describe: string;
  /** Per-event regression predicates. Any non-zero count fails the script. */
  checks: Check[];
  /** Optional summary lines (counts, etc.) appended before samples. */
  summary?: (events: RawEventData[]) => string[];
  /** How many sample events to print after the checks/summary lines. */
  sampleLimit?: number;
}

function formatSample(e: RawEventData): string {
  const time = e.startTime ?? "all-day";
  const titleSlice = (e.title ?? "").slice(0, 80);
  const runSuffix = e.runNumber ? ` | run=${e.runNumber}` : "";
  return `[${e.date} ${time}] title=${JSON.stringify(titleSlice)} | hares=${e.hares ?? "—"}${runSuffix}`;
}

/** Trail-vocab keywords that should never appear in a `hares` value. Used
 *  by the Austin H3 check to detect title-text leaking into haresText. */
const TRAIL_VOCAB_RE = /\b(?:Run Hangover|Red Dress|Hash Trash|Mardi Hash)\b/i;

const TARGETS: Target[] = [
  {
    sourceName: "Dead Whores H3 Calendar",
    describe: "#1471 — no trailing '/' in title; hares still extracted",
    checks: [
      { label: "titles ending in '/'", predicate: (e) => !!e.title && /\/\s*$/.test(e.title) },
    ],
    summary: (events) => [`with hares: ${events.filter((e) => !!e.hares).length}`],
  },
  {
    sourceName: "Austin H3 Calendar",
    describe: "#1466 — descriptive titles preserved; bogus hares cleared",
    checks: [
      // Both pre-fix shape "- AH3 #N" and bare "AH3 #N" stub.
      { label: "bare 'AH3 #N' / '- AH3 #N' stub titles", predicate: (e) => !!e.title && /^-?\s*AH3\s*#\s*\d+\s*$/i.test(e.title) },
      { label: "trail-vocab leakage in hares", predicate: (e) => !!e.hares && TRAIL_VOCAB_RE.test(e.hares) },
    ],
    summary: (events) => [`with hares: ${events.filter((e) => !!e.hares).length}`],
    sampleLimit: 12,
  },
  {
    sourceName: "MoA2H3 Google Calendar",
    describe: "#1458 — no doubled 'MoA2H3 MoA2H3' prefix",
    checks: [
      { label: "doubled 'MoA2H3 MoA2H3' prefix", predicate: (e) => !!e.title && /^moa2h3\s+moa2h3\b/i.test(e.title) },
    ],
  },
];

async function runTarget(adapter: GoogleCalendarAdapter, target: Target): Promise<number> {
  const seedRow = SOURCES.find((s) => s.name === target.sourceName);
  console.log(`\n## ${target.sourceName}`);
  console.log(`   ${target.describe}`);
  if (!seedRow) {
    console.log(`   NOT FOUND IN SEED`);
    return 1;
  }
  const source = {
    id: "stub",
    name: seedRow.name,
    url: seedRow.url,
    type: seedRow.type as Source["type"],
    enabled: true,
    config: (seedRow as { config?: unknown }).config ?? null,
  } as unknown as Source;
  try {
    const result = await adapter.fetch(source, { days: 365 });
    console.log(`   diag: ${JSON.stringify(result.diagnosticContext)}`);
    console.log(`   events: ${result.events.length}`);
    for (const line of target.summary?.(result.events) ?? []) console.log(`   ${line}`);
    let failedChecks = 0;
    for (const check of target.checks) {
      const violators = result.events.filter(check.predicate);
      console.log(`   ${check.label}: ${violators.length} (expect 0)`);
      if (violators.length > 0) {
        failedChecks += violators.length;
        for (const e of violators.slice(0, 5)) console.log(`     VIOLATION ${formatSample(e)}`);
      }
    }
    for (const e of result.events.slice(0, target.sampleLimit ?? 10)) console.log(`   ${formatSample(e)}`);
    if (failedChecks > 0) console.log(`   ✗ ${failedChecks} regression(s) detected`);
    return failedChecks;
  } catch (err) {
    console.log(`   FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) {
    throw new Error("GOOGLE_CALENDAR_API_KEY not set — source .env first");
  }
  const adapter = new GoogleCalendarAdapter();
  let failures = 0;
  for (const target of TARGETS) failures += await runTarget(adapter, target);
  console.log(failures === 0 ? "\n✓ All targets clean" : `\n✗ ${failures} regression(s) / fetch failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
