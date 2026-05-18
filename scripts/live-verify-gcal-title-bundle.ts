/**
 * Live verification for the GCal title-bundle fixes (#1471, #1466, #1458).
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-gcal-title-bundle.ts`
 *
 * Read-only — does not mutate the DB.
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

function formatSample(e: RawEventData): string {
  const time = e.startTime ?? "all-day";
  const titleSlice = (e.title ?? "").slice(0, 80);
  const runSuffix = e.runNumber ? ` | run=${e.runNumber}` : "";
  return `[${e.date} ${time}] title=${JSON.stringify(titleSlice)} | hares=${e.hares ?? "—"}${runSuffix}`;
}

interface Target {
  sourceName: string;
  describe: string;
  inspect: (events: RawEventData[]) => string[];
}

const TARGETS: Target[] = [
  {
    sourceName: "Dead Whores H3 Calendar",
    describe: "#1471 — no trailing '/' in title; hares still extracted",
    inspect: (events) => {
      const slashTitles = events.filter((e) => e.title && /\/\s*$/.test(e.title));
      const lines = [
        `events: ${events.length}`,
        `with hares: ${events.filter((e) => !!e.hares).length}`,
        `titles ending in '/': ${slashTitles.length} (expect 0)`,
      ];
      for (const e of events.slice(0, 10)) lines.push(`  ${formatSample(e)}`);
      return lines;
    },
  },
  {
    sourceName: "Austin H3 Calendar",
    describe: "#1466 — stub-revert preserves descriptive titles; bogus hares cleared",
    inspect: (events) => {
      // Detect both pre-fix shapes ("- AH3 #N") and any residual bare
      // "AH3 #N" stub that the prefix-cleanup might leave behind if the
      // opt-in flag isn't seeded.
      const stubTitles = events.filter((e) => e.title && /^-?\s*AH3\s*#\s*\d+\s*$/i.test(e.title));
      // After stub-revert, hares should not contain trail-title text. Look
      // for trail-vocab keywords leaking into haresText.
      const haresLeakage = events.filter((e) => e.hares && /\b(?:Run Hangover|Red Dress|Hash Trash|Mardi Hash)\b/i.test(e.hares));
      const lines = [
        `events: ${events.length}`,
        `with hares: ${events.filter((e) => !!e.hares).length}`,
        `bare 'AH3 #N' / '- AH3 #N' stub titles: ${stubTitles.length} (expect 0)`,
        `trail-vocab leakage in hares: ${haresLeakage.length} (expect 0)`,
      ];
      for (const e of events.slice(0, 12)) lines.push(`  ${formatSample(e)}`);
      return lines;
    },
  },
  {
    sourceName: "MoA2H3 Google Calendar",
    describe: "#1458 — no doubled 'MoA2H3 MoA2H3' prefix",
    inspect: (events) => {
      const doubled = events.filter((e) => e.title && /^moa2h3\s+moa2h3\b/i.test(e.title));
      const lines = [
        `events: ${events.length}`,
        `with doubled 'MoA2H3 MoA2H3' prefix: ${doubled.length} (expect 0)`,
      ];
      for (const e of events.slice(0, 10)) lines.push(`  ${formatSample(e)}`);
      return lines;
    },
  },
];

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) {
    throw new Error("GOOGLE_CALENDAR_API_KEY not set — source .env first");
  }
  const adapter = new GoogleCalendarAdapter();
  let failures = 0;
  for (const target of TARGETS) {
    const seedRow = SOURCES.find((s) => s.name === target.sourceName);
    if (!seedRow) {
      console.log(`\n## ${target.sourceName} — NOT FOUND IN SEED`);
      failures++;
      continue;
    }
    const source = {
      id: "stub",
      name: seedRow.name,
      url: seedRow.url,
      type: seedRow.type as Source["type"],
      enabled: true,
      config: (seedRow as { config?: unknown }).config ?? null,
    } as unknown as Source;
    console.log(`\n## ${target.sourceName}`);
    console.log(`   ${target.describe}`);
    try {
      const result = await adapter.fetch(source, { days: 365 });
      console.log(`   diag: ${JSON.stringify(result.diagnosticContext)}`);
      for (const line of target.inspect(result.events)) {
        console.log(`   ${line}`);
      }
    } catch (err) {
      failures++;
      console.log(`   FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(failures === 0 ? "\n✓ All targets fetched" : `\n✗ ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
