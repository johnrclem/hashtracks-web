/**
 * Live verification for the systemic GCal title/hare/theme/location fixes
 * (#1892 EWH3, #1881 SWH3, #1884 MH3-Mpls, #1882 Capital-AU, #1891 Boston,
 * #1868 Oregon, #1873 Osaka, #1401 FCMH3 endTime, #1406/#1407 HSWTF).
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-gcal-hare-theme-bundle.ts`
 *
 * Read-only — does not mutate the DB. Fetches live Google Calendar data through
 * the real adapter + the seed config, prints samples, and counts regressions.
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

interface Check {
  label: string;
  predicate: (e: RawEventData) => boolean;
}
interface Target {
  sourceName: string;
  describe: string;
  /** Restrict to events for this kennel tag (multi-kennel calendars). */
  kennelTag?: string;
  checks: Check[];
  summary?: (events: RawEventData[]) => string[];
  sampleLimit?: number;
}

function fmt(e: RawEventData): string {
  const time = e.startTime ?? "all-day";
  const end = e.endTime ? `-${e.endTime}` : "";
  return `[${e.date} ${time}${end}] run=${e.runNumber ?? "—"} title=${JSON.stringify((e.title ?? "").slice(0, 70))} hares=${JSON.stringify(e.hares ?? null)} loc=${JSON.stringify(e.location ?? null)}`;
}

// A run theme leaking into hares (the #1892 class). Heuristic for *reporting*
// only — not used by the adapter.
const THEME_IN_HARES_RE = /speaks|friends|trail$|annual|christmas|halloween|birthday/i;

const TARGETS: Target[] = [
  {
    sourceName: "EWH3 Google Calendar",
    describe: "#1892 — theme not in hares; '- Location' → locationName",
    checks: [
      { label: "theme-shaped hares", predicate: (e) => !!e.hares && THEME_IN_HARES_RE.test(e.hares) },
      { label: "title still contains ' - '", predicate: (e) => !!e.title && / - /.test(e.title) && !!e.location },
    ],
    summary: (ev) => [`with hares: ${ev.filter((e) => e.hares).length}`, `with location: ${ev.filter((e) => e.location).length}`],
    sampleLimit: 12,
  },
  {
    sourceName: "SWH3 Google Calendar",
    describe: "#1881 — hare after last dash extracted; run# kept",
    // No hard predicate: events whose hare came from the description keep a
    // theme-style title suffix ("SWH3#1588- AGM" / hares "Ex GM's"), which is
    // correct. The hares fill-rate is the signal.
    checks: [],
    summary: (ev) => [`with hares: ${ev.filter((e) => e.hares).length}/${ev.length}`],
    sampleLimit: 15,
  },
  {
    sourceName: "Minneapolis H3 Calendar",
    describe: "#1884 — hare from description; '- B Knuckles' stripped from title",
    kennelTag: "mh3-mn",
    checks: [
      { label: "title contains ' - ' (un-stripped hare)", predicate: (e) => !!e.title && / - /.test(e.title) },
    ],
    summary: (ev) => [`with hares: ${ev.filter((e) => e.hares).length}/${ev.length}`],
    sampleLimit: 12,
  },
  {
    sourceName: "Capital Hash Calendar",
    describe: "#1882 — no 'CH3'/'vacant' garbage hares/location",
    checks: [
      { label: "hares = CH3 / vacant", predicate: (e) => !!e.hares && /^(?:ch3|vacant)$/i.test(e.hares.trim()) },
      { label: "location contains 'vacant'", predicate: (e) => !!e.location && /vacant/i.test(e.location) },
    ],
    sampleLimit: 12,
  },
  {
    sourceName: "Boston Hash Calendar",
    describe: "#1891 — 'BH3:' prefix stripped; run# from description",
    kennelTag: "boh3",
    checks: [
      { label: "title still has 'BH3:' prefix", predicate: (e) => !!e.title && /^BH3:/i.test(e.title) },
    ],
    summary: (ev) => [`with runNumber: ${ev.filter((e) => e.runNumber).length}/${ev.length}`],
    sampleLimit: 12,
  },
  {
    sourceName: "Oregon Hashing Calendar",
    describe: "#1868 — hares extracted from title/description",
    kennelTag: "oh3",
    checks: [
      // Only flag genuine OH3-titled events; the Oregon aggregator also
      // mis-defaults stray EH3/OKH3 rows to oh3 whose description hares may
      // contain "w/" (a separate routing concern, out of scope here).
      { label: "OH3-title hares leak '/' or '#'", predicate: (e) => !!e.hares && /[/#]/.test(e.hares) && /^OH3\b/i.test(e.title ?? "") },
    ],
    summary: (ev) => [`with hares: ${ev.filter((e) => e.hares).length}/${ev.length}`],
    sampleLimit: 15,
  },
  {
    sourceName: "Osaka H3 Google Calendar",
    describe: "#1873 — hares from 'Hare:' description line",
    checks: [],
    summary: (ev) => [`with hares: ${ev.filter((e) => e.hares).length}/${ev.length}`],
    sampleLimit: 12,
  },
  {
    sourceName: "Chicagoland Hash Calendar",
    describe: "#1401 — First Crack (fcmh3) endTime present",
    kennelTag: "fcmh3",
    checks: [],
    summary: (ev) => [`with endTime: ${ev.filter((e) => e.endTime).length}/${ev.length}`],
    sampleLimit: 10,
  },
  {
    sourceName: "WA Hash Google Calendar",
    describe: "#1406/#1407 — HSWTF: no 'HSWTFH3' title, no run=2011",
    kennelTag: "hswtf-h3",
    checks: [
      { label: "placeholder title 'HSWTFH3'", predicate: (e) => e.title === "HSWTFH3" },
      { label: "run number = 2011", predicate: (e) => e.runNumber === 2011 },
    ],
    sampleLimit: 15,
  },
];

async function runTarget(adapter: GoogleCalendarAdapter, t: Target): Promise<number> {
  const seedRow = SOURCES.find((s) => s.name === t.sourceName);
  console.log(`\n## ${t.sourceName}\n   ${t.describe}`);
  if (!seedRow) { console.log("   NOT FOUND IN SEED"); return 1; }
  const source = {
    id: "stub", name: seedRow.name, url: seedRow.url,
    type: seedRow.type as Source["type"], enabled: true,
    config: (seedRow as { config?: unknown }).config ?? null,
  } as unknown as Source;
  try {
    const result = await adapter.fetch(source, { days: 1500 });
    let events = result.events;
    if (t.kennelTag) events = events.filter((e) => e.kennelTags?.includes(t.kennelTag!));
    const scope = t.kennelTag ? ` (filtered to ${t.kennelTag})` : "";
    console.log(`   events: ${events.length}${scope}`);
    for (const line of t.summary?.(events) ?? []) console.log(`   ${line}`);
    let failed = 0;
    for (const c of t.checks) {
      const violators = events.filter(c.predicate);
      console.log(`   ${c.label}: ${violators.length} (expect 0)`);
      failed += violators.length;
      for (const e of violators.slice(0, 5)) console.log(`     VIOLATION ${fmt(e)}`);
    }
    for (const e of events.slice(0, t.sampleLimit ?? 10)) console.log(`   ${fmt(e)}`);
    return failed;
  } catch (err) {
    console.log(`   FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) throw new Error("GOOGLE_CALENDAR_API_KEY not set — source .env first");
  const adapter = new GoogleCalendarAdapter();
  let failures = 0;
  for (const t of TARGETS) failures += await runTarget(adapter, t);
  console.log(failures === 0 ? "\n✓ All targets clean" : `\n✗ ${failures} regression(s)/fetch failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((err) => { console.error(err); process.exit(1); });
