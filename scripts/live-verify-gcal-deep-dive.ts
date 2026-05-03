/**
 * Live smoke for the GCal-adapter deep-dive PR (#981/#1101/#1127/#1129/#1147/
 * #1149/#1154/#1188/#1189/#1194/#1195). Hits each affected calendar's public
 * API with the freshly-edited adapter + seed config and reports a verification
 * digest per source.
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-gcal-deep-dive.ts`
 *
 * Read-only — does not mutate the DB.
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

interface VerifyTarget {
  sourceName: string;
  describe: string;
  inspect: (events: RawEventData[], diag: Record<string, unknown> | undefined) => string[];
}

const TARGETS: VerifyTarget[] = [
  {
    sourceName: "Central Oregon H3 Calendar",
    describe: "#981 — extracts hares from `with X` titles",
    inspect: (events) => {
      const withW = events.filter((e) => / with /i.test(e.title ?? ""));
      const harePop = withW.filter((e) => !!e.hares).length;
      return [
        `events: ${events.length}`,
        `events with " with " in title: ${withW.length}`,
        `… of those, hares populated: ${harePop}`,
      ];
    },
  },
  {
    sourceName: "Eugene H3 Calendar",
    describe: "#1188/#1189 — admits all-day; strips emoji; 👣 hares",
    inspect: (events) => {
      const stillEmoji = events.filter((e) => /🌲|🍺/u.test(e.title ?? ""));
      const leadingDash = events.filter((e) => /^[-–—]/.test(e.hares ?? ""));
      return [
        `events: ${events.length}`,
        `titles still containing 🌲/🍺: ${stillEmoji.length} (target: 0 from canonical pattern)`,
        `hares with leading dash: ${leadingDash.length} (target: 0)`,
      ];
    },
  },
  {
    sourceName: "Fort Collins H3 Google Calendar",
    describe: "#1147/#1149 — `#30X?` rejected; Rex Manning Day admitted",
    inspect: (events) => {
      const x30 = events.filter((e) => /#30X/.test(e.title ?? ""));
      const rex = events.find((e) => /Rex Manning/i.test(e.title ?? ""));
      return [
        `events: ${events.length}`,
        `#30X? events: ${x30.length}`,
        ...x30.map((e) => `  #30X? runNumber=${JSON.stringify(e.runNumber)}`),
        `Rex Manning Day: ${rex ? "FOUND ✓" : "not found"}`,
      ];
    },
  },
  {
    sourceName: "GAL Google Calendar",
    describe: "#1194/#1195 — title isn't BYOB; coord-only locations preserved",
    inspect: (events) => {
      const byob = events.filter((e) => e.title === "BYOB");
      const coordLocs = events.filter((e) => {
        const loc = e.location ?? "";
        return /^\s*-?\d{1,3}\.\d/.test(loc) || /°/.test(loc);
      });
      return [
        `events: ${events.length}`,
        `title === "BYOB": ${byob.length} (target: 0)`,
        `coord-string locations preserved: ${coordLocs.length}`,
        ...coordLocs.slice(0, 2).map((e) => `  ${JSON.stringify(e.location)} → lat=${e.latitude} lng=${e.longitude}`),
      ];
    },
  },
  {
    sourceName: "Chicagoland Hash Calendar",
    describe: "#1101 — duplicate Full Moon H3 series collapsed (field-merge)",
    inspect: (events, diag) => {
      const cfmh3 = events.filter((e) => e.kennelTags[0] === "cfmh3");
      const buckets = new Map<string, number>();
      for (const e of cfmh3) {
        const k = `${e.date}|${e.startTime ?? ""}|${e.title ?? ""}`;
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      const collisions = [...buckets.entries()].filter(([, n]) => n > 1);
      return [
        `total: ${events.length}`,
        `cfmh3: ${cfmh3.length}`,
        `cfmh3 duplicate-key buckets: ${collisions.length} (target: 0)`,
        `compositeDeduped diagnostic: ${JSON.stringify(diag?.compositeDeduped ?? "absent")}`,
      ];
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
      for (const line of target.inspect(result.events, result.diagnosticContext)) {
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
