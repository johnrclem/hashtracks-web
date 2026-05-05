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

/** Filter to events whose primary kennel tag is `tag`. */
function byKennelTag(events: RawEventData[], tag: string): RawEventData[] {
  return events.filter((e) => e.kennelTags[0] === tag);
}

/** Append up to `limit` formatted samples to `lines`, prefixed with `prefix`. */
function appendSamples(lines: string[], events: RawEventData[], limit: number, prefix = ""): void {
  for (const e of events.slice(0, limit)) lines.push(`  ${prefix}${formatSample(e)}`);
}

/** Group events by date and return only dates that have more than one event. */
function datesWithMultiple(events: RawEventData[]): [string, RawEventData[]][] {
  const byKey = new Map<string, RawEventData[]>();
  for (const e of events) byKey.set(e.date, [...(byKey.get(e.date) ?? []), e]);
  return [...byKey.entries()].filter(([, es]) => es.length > 1);
}

/** Common per-kennel-bucket summary line: "Tag: total (with hares: N)". */
function bucketSummary(label: string, bucket: RawEventData[]): string {
  return `${label}: ${bucket.length} (with hares: ${bucket.filter((e) => !!e.hares).length})`;
}

const TARGETS: VerifyTarget[] = [
  {
    sourceName: "Capital Hash Calendar",
    describe: "#1222 — split title into hares + location; reject 'venue TBC'",
    inspect: (events) => {
      const venueTbc = events.filter((e) => /venue\s+TB[CDA]/i.test(`${e.hares ?? ""} ${e.location ?? ""}`));
      const lines = [
        `events: ${events.length}`,
        `with hares: ${events.filter((e) => !!e.hares).length}`,
        `with location: ${events.filter((e) => !!e.location).length}`,
        `'venue TBC' surviving in any field: ${venueTbc.length} (expect 0)`,
      ];
      appendSamples(lines, events, 6);
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
      appendSamples(lines, events, 6);
      return lines;
    },
  },
  {
    sourceName: "GLH3 Google Calendar",
    describe: "#1212 — Co-Hare merge + annotation strip",
    inspect: (events) => {
      const annotations = events.filter((e) => e.hares && / - [a-z]/.test(e.hares));
      const lines = [`events: ${events.length}`];
      appendSamples(lines, events, 8);
      lines.push(`hares with ' - lowercase' annotation tail: ${annotations.length} (expect 0)`);
      return lines;
    },
  },
  {
    sourceName: "WA Hash Google Calendar",
    describe: "#1199 — drops Giggity all-day placeholder when timed sibling exists",
    kennelTagFilter: "giggity-h3",
    inspect: (events, diag) => {
      const giggity = byKennelTag(events, "giggity-h3");
      const cunth = byKennelTag(events, "cunth3-wa");
      const collapsedRaw = diag?.allDayCollapsed;
      const collapsed = typeof collapsedRaw === "number" ? collapsedRaw : 0;
      const lines = [
        `total events: ${events.length}`,
        `Giggity events: ${giggity.length}`,
        `CUNTh events (all-day overrides should still survive): ${cunth.length}`,
        `diag.allDayCollapsed: ${collapsed}`,
      ];
      appendSamples(lines, giggity, 6);
      lines.push(`Giggity dates with multiple events surviving: ${datesWithMultiple(giggity).length} (expect 0)`);
      return lines;
    },
  },
  {
    sourceName: "Stuttgart H3 Google Calendar",
    describe: "#1208 — DST hares from 'DST # - Hare' format; SH3 still works",
    inspect: (events) => {
      const dst = byKennelTag(events, "dst-h3");
      const sh3 = byKennelTag(events, "sh3-de");
      const lines = [`events: ${events.length}`, bucketSummary("DST", dst), bucketSummary("SH3", sh3)];
      appendSamples(lines, dst, 4, "DST ");
      appendSamples(lines, sh3, 4, "SH3 ");
      return lines;
    },
  },
  {
    sourceName: "Copenhagen H3 Google Calendar",
    describe: "#1209/#1221 — CH3 third-dash-segment hare; RDH3 still works",
    inspect: (events) => {
      const ch3 = byKennelTag(events, "ch3-dk");
      const rdh3 = byKennelTag(events, "rdh3");
      const lines = [`events: ${events.length}`, bucketSummary("CH3", ch3), bucketSummary("RDH3", rdh3)];
      appendSamples(lines, ch3, 4, "CH3 ");
      appendSamples(lines, rdh3, 3, "RDH3 ");
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
