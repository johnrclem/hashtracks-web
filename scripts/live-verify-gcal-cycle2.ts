/**
 * Live verification for the cycle-2 audit-stream adapter fixes
 * (#1199, #1208, #1209, #1210, #1212, #1221, #1222). Hits each affected
 * calendar's public Google Calendar API with the freshly-edited adapter +
 * seed config and prints a digest per source.
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-gcal-cycle2.ts`
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
  kennelTagFilter?: string;
  inspect: (events: RawEventData[], diag: Record<string, unknown> | undefined) => string[];
}

function formatSample(e: RawEventData): string {
  const time = e.startTime ?? "all-day";
  const titleSlice = (e.title ?? "").slice(0, 60);
  const locSlice = (e.location ?? "—").slice(0, 50);
  const runSuffix = e.runNumber ? ` | run=${e.runNumber}` : "";
  return `[${e.date} ${time}] ${titleSlice} | hares=${e.hares ?? "—"} | loc=${locSlice}${runSuffix}`;
}

const TARGETS: VerifyTarget[] = [
  {
    sourceName: "Capital Hash Calendar",
    describe: "#1222 — split title into hares + location; reject 'venue TBC'",
    inspect: (events) => {
      const withHares = events.filter((e) => !!e.hares);
      const withLoc = events.filter((e) => !!e.location);
      const venueTbc = events.filter((e) => /venue\s+TB[CDA]/i.test(JSON.stringify(e.hares ?? "") + JSON.stringify(e.location ?? "")));
      const lines = [
        `events: ${events.length}`,
        `with hares: ${withHares.length}`,
        `with location: ${withLoc.length}`,
        `'venue TBC' surviving in any field: ${venueTbc.length} (expect 0)`,
      ];
      for (const e of events.slice(0, 6)) lines.push(`  ${formatSample(e)}`);
      return lines;
    },
  },
  {
    sourceName: "Austin H3 Calendar",
    describe: "#1210 — no trailing ' -' on hares; tightened pattern",
    inspect: (events) => {
      const trailingDash = events.filter((e) => e.hares && /[-–—]\s*$/.test(e.hares));
      const lines = [
        `events: ${events.length}`,
        `events with trailing-dash hares: ${trailingDash.length} (expect 0)`,
      ];
      for (const e of events.slice(0, 6)) lines.push(`  ${formatSample(e)}`);
      return lines;
    },
  },
  {
    sourceName: "GLH3 Google Calendar",
    describe: "#1212 — Co-Hare merge + annotation strip",
    inspect: (events) => {
      const lines = [`events: ${events.length}`];
      for (const e of events.slice(0, 8)) lines.push(`  ${formatSample(e)}`);
      // Look for annotation leakage
      const annotations = events.filter((e) => e.hares && / - [a-z]/.test(e.hares));
      lines.push(`hares with ' - lowercase' annotation tail: ${annotations.length} (expect 0)`);
      return lines;
    },
  },
  {
    sourceName: "WA Hash Google Calendar",
    describe: "#1199 — drops Giggity all-day placeholder when timed sibling exists",
    kennelTagFilter: "giggity-h3",
    inspect: (events, diag) => {
      const giggity = events.filter((e) => e.kennelTags[0] === "giggity-h3");
      const cunth = events.filter((e) => e.kennelTags[0] === "cunth3-wa");
      const lines = [
        `total events: ${events.length}`,
        `Giggity events: ${giggity.length}`,
        `CUNTh events (all-day overrides should still survive): ${cunth.length}`,
        `diag.allDayCollapsed: ${typeof diag?.allDayCollapsed === "number" ? diag.allDayCollapsed : 0}`,
      ];
      for (const e of giggity.slice(0, 6)) lines.push(`  ${formatSample(e)}`);
      // Check: any (giggity-h3, date) with both timed + all-day? Should not exist post-dedup.
      const byKey = new Map<string, RawEventData[]>();
      for (const e of giggity) {
        const k = e.date;
        byKey.set(k, [...(byKey.get(k) ?? []), e]);
      }
      const dupDates = [...byKey.entries()].filter(([, es]) => es.length > 1);
      lines.push(`Giggity dates with multiple events surviving: ${dupDates.length} (expect 0)`);
      return lines;
    },
  },
  {
    sourceName: "Stuttgart H3 Google Calendar",
    describe: "#1208 — DST hares from 'DST # - Hare' format; SH3 still works",
    inspect: (events) => {
      const dst = events.filter((e) => e.kennelTags[0] === "dst-h3");
      const sh3 = events.filter((e) => e.kennelTags[0] === "sh3-de");
      const lines = [
        `events: ${events.length}`,
        `DST: ${dst.length} (with hares: ${dst.filter((e) => !!e.hares).length})`,
        `SH3: ${sh3.length} (with hares: ${sh3.filter((e) => !!e.hares).length})`,
      ];
      for (const e of dst.slice(0, 4)) lines.push(`  DST ${formatSample(e)}`);
      for (const e of sh3.slice(0, 4)) lines.push(`  SH3 ${formatSample(e)}`);
      return lines;
    },
  },
  {
    sourceName: "Copenhagen H3 Google Calendar",
    describe: "#1209/#1221 — CH3 third-dash-segment hare; RDH3 still works",
    inspect: (events) => {
      const ch3 = events.filter((e) => e.kennelTags[0] === "ch3-dk");
      const rdh3 = events.filter((e) => e.kennelTags[0] === "rdh3");
      const lines = [
        `events: ${events.length}`,
        `CH3: ${ch3.length} (with hares: ${ch3.filter((e) => !!e.hares).length})`,
        `RDH3: ${rdh3.length} (with hares: ${rdh3.filter((e) => !!e.hares).length})`,
      ];
      for (const e of ch3.slice(0, 4)) lines.push(`  CH3 ${formatSample(e)}`);
      for (const e of rdh3.slice(0, 3)) lines.push(`  RDH3 ${formatSample(e)}`);
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
