/**
 * Live verification for the WS5 source-mismatch bundle.
 *
 *   #1547 ABQ H3              — GCal: no date-range haresText
 *   #1549 RVA (Richmond)      — GCal: no "CLAIM THIS TRAIL" titles
 *   #1551 Wasatch H3          — GCal: hares stops at first sentence
 *   #1557 Memphis FB          — FB: no trailing " -" / " :" in titles
 *   #1548 Sydney Thirsty H3   — HTML: no "at the map location below" in location
 *   #1550 BH4 (Big Hump)      — HTML: no haresText "Open" + h4 subtitle preserved
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-ws5-bundle.ts`
 *
 * Exits non-zero when any check detects a regression OR when a fetch
 * fails — usable as a CI gate. Read-only.
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import { FacebookHostedEventsAdapter } from "@/adapters/facebook-hosted-events/adapter";
import { SydneyThirstyH3Adapter } from "@/adapters/html-scraper/sydney-thirsty-h3";
import { BigHumpAdapter } from "@/adapters/html-scraper/big-hump";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

type AnyAdapter = { fetch: (source: Source, options?: { days?: number }) => Promise<{ events: RawEventData[]; diagnosticContext?: unknown }> };
type Predicate = (e: RawEventData) => boolean;

interface Target {
  sourceName: string;
  describe: string;
  adapter: AnyAdapter;
  checks: { label: string; predicate: Predicate }[];
  countField?: "hares" | "location";
  sampleLimit?: number;
}

function formatSample(e: RawEventData): string {
  const time = e.startTime ?? "all-day";
  const titleSlice = (e.title ?? "").slice(0, 80);
  const runSuffix = e.runNumber ? ` | run=${e.runNumber}` : "";
  const locSuffix = e.location ? ` | loc=${JSON.stringify(e.location.slice(0, 60))}` : "";
  return `[${e.date} ${time}] title=${JSON.stringify(titleSlice)} | hares=${e.hares ?? "—"}${runSuffix}${locSuffix}`;
}

const DATE_RANGE_RE = /\b\d{1,2}\s*\/\s*\d{1,2}\b/;

const gcal = new GoogleCalendarAdapter();
const TARGETS: Target[] = [
  {
    sourceName: "ABQ H3 Google Calendar",
    describe: "#1547 — no slash-date date-range strings in haresText",
    adapter: gcal,
    checks: [{ label: "haresText with M/D date tokens", predicate: (e) => !!e.hares && DATE_RANGE_RE.test(e.hares) }],
    countField: "hares",
  },
  {
    sourceName: "Richmond H3 Google Calendar",
    describe: "#1549 — no 'CLAIM THIS TRAIL' placeholder events ingested",
    adapter: gcal,
    checks: [{ label: "titles containing 'CLAIM THIS TRAIL'", predicate: (e) => !!e.title && /\bclaim\s+this\s+trail\b/i.test(e.title) }],
  },
  {
    sourceName: "Whoreman H3 Calendar",
    describe: "#1551 — haresText truncated at first sentence boundary",
    adapter: gcal,
    // Description leak signal: hare text containing a period followed by 3+ words.
    checks: [{ label: "haresText with sentence trailer", predicate: (e) => !!e.hares && /\.\s+\S+(?:\s+\S+){2,}/.test(e.hares) }],
    countField: "hares",
  },
  {
    sourceName: "Memphis H3 Facebook Hosted Events",
    describe: "#1557 — no titles ending in ' -' / ' —' / ' :'",
    adapter: new FacebookHostedEventsAdapter(),
    checks: [{ label: "titles ending in trailing delimiter", predicate: (e) => !!e.title && /\s+[-–—:]\s*$/.test(e.title) }],
  },
  {
    sourceName: "Sydney Thirsty H3 Upcoming Runs",
    describe: "#1548 — 'at the map location below' boilerplate stripped",
    adapter: new SydneyThirstyH3Adapter(),
    checks: [{ label: "location containing 'at the map location below'", predicate: (e) => !!e.location && /at the map location below/i.test(e.location) }],
    countField: "location",
  },
  {
    sourceName: "Big Hump H3 Hareline",
    describe: "#1550 — no haresText 'Open' placeholder",
    adapter: new BigHumpAdapter(),
    checks: [{ label: "haresText literal 'Open'", predicate: (e) => !!e.hares && /^open$/i.test(e.hares) }],
    countField: "hares",
    sampleLimit: 12,
  },
];

function countWith(events: RawEventData[], field: "hares" | "location"): number {
  return events.filter((e) => !!e[field]).length;
}

async function runTarget(target: Target): Promise<number> {
  const seedRow = SOURCES.find((s) => s.name === target.sourceName);
  console.log(`\n## ${target.sourceName}\n   ${target.describe}`);
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
    scrapeDays: (seedRow as { scrapeDays?: number }).scrapeDays ?? 365,
  } as unknown as Source;
  try {
    const result = await target.adapter.fetch(source, { days: 365 });
    console.log(`   events: ${result.events.length}`);
    if (target.countField) console.log(`   with ${target.countField}: ${countWith(result.events, target.countField)}`);
    let failed = 0;
    for (const { label, predicate } of target.checks) {
      const violators = result.events.filter(predicate);
      console.log(`   ${label}: ${violators.length} (expect 0)`);
      if (violators.length > 0) {
        failed += violators.length;
        for (const e of violators.slice(0, 5)) console.log(`     VIOLATION ${formatSample(e)}`);
      }
    }
    for (const e of result.events.slice(0, target.sampleLimit ?? 6)) console.log(`   ${formatSample(e)}`);
    if (failed > 0) console.log(`   ✗ ${failed} regression(s) detected`);
    return failed;
  } catch (err) {
    console.log(`   FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) {
    throw new Error("GOOGLE_CALENDAR_API_KEY not set — source .env first");
  }
  let failures = 0;
  for (const target of TARGETS) failures += await runTarget(target);
  console.log(failures === 0 ? "\n✓ All targets clean" : `\n✗ ${failures} regression(s) / fetch failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
