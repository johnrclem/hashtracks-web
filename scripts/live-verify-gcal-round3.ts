/**
 * Live smoke for GCal polish round 3 (#2135 endTime, #2133 Aloha hares,
 * #1738 MoA2H3 sisters, #775 BJH3 timezone, #2125 Princeton title).
 * Hits each affected calendar's public API with the freshly-edited adapter +
 * seed config and reports a verification digest per source.
 *
 * Run: `set -a && source .env && set +a && npx tsx scripts/live-verify-gcal-round3.ts`
 *
 * Read-only — does not mutate the DB.
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";
import type { Source } from "@/generated/prisma/client";

function pctHares(events: RawEventData[]): string {
  if (events.length === 0) return "n/a (0 events)";
  const withHares = events.filter((e) => !!e.hares).length;
  return `${Math.round((withHares / events.length) * 100)}% (${withHares}/${events.length})`;
}

function tagCounts(events: RawEventData[]): Record<string, number> {
  // Map (not a plain object) avoids prototype-pollution / object-injection if a
  // kennel tag is ever "__proto__"/"constructor" from an uncleaned GCal summary.
  const m = new Map<string, number>();
  for (const e of events) {
    const tag = e.kennelTags[0] ?? "(none)";
    m.set(tag, (m.get(tag) ?? 0) + 1);
  }
  return Object.fromEntries(m);
}

async function fetchSource(adapter: GoogleCalendarAdapter, name: string, days: number) {
  const seedRow = SOURCES.find((s) => s.name === name);
  if (!seedRow) throw new Error(`${name} NOT FOUND IN SEED`);
  const source = {
    id: "stub",
    name: seedRow.name,
    url: seedRow.url,
    type: seedRow.type as Source["type"],
    enabled: true,
    config: (seedRow as { config?: unknown }).config ?? null,
  } as unknown as Source;
  const result = await adapter.fetch(source, { days });
  return { result, seedRow };
}

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) {
    throw new Error("GOOGLE_CALENDAR_API_KEY not set — source .env first");
  }
  const adapter = new GoogleCalendarAdapter();

  // ── #2135 QCH4 endTime ──
  console.log("\n## QCH4 Google Calendar — endTime from DTEND (#2135)");
  {
    const { result } = await fetchSource(adapter, "QCH4 Google Calendar", 365);
    const withEnd = result.events.filter((e) => !!e.endTime);
    console.log(`   events: ${result.events.length}; with endTime: ${withEnd.length}`);
    for (const e of withEnd.slice(0, 5)) {
      console.log(`   • ${e.date} ${e.startTime}–${e.endTime}  ${e.title ?? ""}`);
    }
  }

  // ── #1738 MoA2H3 sister routing ──
  console.log("\n## MoA2H3 Google Calendar — sister routing (#1738)");
  {
    const { result } = await fetchSource(adapter, "MoA2H3 Google Calendar", 800);
    console.log(`   events: ${result.events.length}; tag counts: ${JSON.stringify(tagCounts(result.events))}`);
    const sisters = result.events.filter((e) => ["demon-h3", "glh3"].includes(e.kennelTags[0] ?? ""));
    for (const e of sisters) {
      console.log(`   • ${e.date} → ${e.kennelTags[0]}  ${e.title ?? ""}`);
    }
  }

  // ── #775 BJH3 timezone ──
  console.log("\n## BJH3 Google Calendar — El Paso timezone (#775)");
  {
    const { result } = await fetchSource(adapter, "BJH3 Google Calendar", 730);
    const timed = result.events.filter((e) => !!e.startTime);
    console.log(`   events: ${result.events.length}; timed: ${timed.length}`);
    for (const e of timed.slice(0, 8)) {
      console.log(`   • ${e.date} ${e.startTime}${e.endTime ? `–${e.endTime}` : ""}  ${e.title ?? ""}`);
    }
    const turkey = result.events.find((e) => /turkey puke/i.test(e.title ?? ""));
    console.log(`   Turkey Puke: ${turkey ? `${turkey.date} ${turkey.startTime} (expect ~12:00 MST)` : "not in window"}`);
  }

  // ── #2133 Aloha hares: recurring (365) vs wide (9999) fill rate ──
  console.log("\n## Aloha H3 Google Calendar — hares fill rate (#2133)");
  {
    const recurring = await fetchSource(adapter, "Aloha H3 Google Calendar", 365);
    console.log(`   recurring 365d hares fill: ${pctHares(recurring.result.events)}`);
    const wide = await fetchSource(adapter, "Aloha H3 Google Calendar", 9999);
    console.log(`   wide 9999d hares fill:     ${pctHares(wide.result.events)} (dilution check)`);
    console.log(`   wide tag counts: ${JSON.stringify(tagCounts(wide.result.events))}`);
  }

  // ── #2125 Princeton title ──
  console.log("\n## Princeton NJ Hash Calendar — title from SUMMARY (#2125)");
  {
    const { result } = await fetchSource(adapter, "Princeton NJ Hash Calendar", 365);
    const princeton = result.events.filter((e) => e.kennelTags[0] === "princeton-h3");
    console.log(`   princeton-h3 events: ${princeton.length}`);
    for (const e of princeton.slice(0, 8)) {
      console.log(`   • ${e.date} "${e.title ?? ""}"`);
    }
  }

  console.log("\n✓ done");
}

main().catch((err) => { console.error(err); process.exit(1); });
