/**
 * Read-only fleet audit — surface other kennels likely affected by the
 * same upcoming-only mis-config that triggered #1229 (Gold Coast TablePress
 * past events stale-cancelled).
 *
 * Per Codex adversarial review (PR #1236): the simple "past + CANCELLED +
 * no admin lock" heuristic is unsafe — adapter-driven legitimate
 * cancellations (Meetup/iCal drop-on-ingest then reconcile-cancel) land
 * in exactly that state. So this script doesn't claim to find bugs.
 * Instead, it identifies a STRONGER pattern unique to stale-reconcile
 * cancellation:
 *
 *   - Event is CANCELLED, past-dated, no admin override
 *   - Event has 2+ RawEvent rows from a single source (the source
 *     definitely emitted this event multiple times before going silent —
 *     a real source-side cancellation typically drops the row entirely
 *     after one or zero scrapes)
 *   - Source's config does NOT already enable upcomingOnly
 *
 * Even that signal isn't proof — a source could legitimately re-confirm
 * an event across multiple scrapes and then mark it cancelled. The
 * output is a SHORTLIST for human review, not a directive. The operator
 * is expected to spot-check the live source URL to confirm it's
 * future-only before adding upcomingOnly: true to its row.
 *
 * Usage:
 *   npx tsx scripts/audit-stale-cancellations.ts
 *   npx tsx scripts/audit-stale-cancellations.ts --since 2025-01-01
 *
 * Read-only — never writes to the database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const MIN_COUNT_TO_REPORT = 3;
const MIN_SCRAPES_PER_EVENT = 2;

function parseSince(): Date {
  const idx = process.argv.indexOf("--since");
  if (idx === -1 || !process.argv[idx + 1]) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(process.argv[idx + 1] + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) {
    console.error(`Invalid --since date: ${process.argv[idx + 1]}`);
    process.exit(1);
  }
  return d;
}

type EligibleSource = { id: string; name: string; type: string };
type Bucket = {
  sourceName: string;
  sourceType: string;
  kennels: Set<string>;
  events: { id: string; date: string; kennel: string; scrapes: number }[];
};
type CandidateEvent = {
  id: string;
  date: Date;
  kennelId: string;
  kennel: { kennelCode: string | null; shortName: string | null } | null;
  rawEvents: { sourceId: string }[];
};

async function loadEligibleSources(prisma: PrismaClient): Promise<Map<string, EligibleSource>> {
  const allSources = await prisma.source.findMany({
    select: { id: true, name: true, type: true, config: true },
  });
  const eligible = new Map<string, EligibleSource>();
  for (const s of allSources) {
    const cfg = (s.config ?? {}) as { upcomingOnly?: boolean };
    if (cfg.upcomingOnly === true) continue;
    eligible.set(s.id, { id: s.id, name: s.name, type: s.type });
  }
  return eligible;
}

function bucketEvent(
  event: CandidateEvent,
  eligibleSources: Map<string, EligibleSource>,
  bySource: Map<string, Bucket>,
): void {
  const dateStr = event.date.toISOString().slice(0, 10);
  const kennelLabel =
    event.kennel?.shortName ?? event.kennel?.kennelCode ?? event.kennelId;
  // Per-source scrape count for this event — dedupes the rawEvents
  // append-only history (Codex finding 3) and gates each event on the
  // multi-scrape signature (Codex finding 2).
  const scrapesPerSource = new Map<string, number>();
  for (const r of event.rawEvents) {
    scrapesPerSource.set(r.sourceId, (scrapesPerSource.get(r.sourceId) ?? 0) + 1);
  }
  for (const [sourceId, scrapes] of scrapesPerSource) {
    const src = eligibleSources.get(sourceId);
    if (!src || scrapes < MIN_SCRAPES_PER_EVENT) continue;
    let bucket = bySource.get(sourceId);
    if (!bucket) {
      bucket = {
        sourceName: src.name,
        sourceType: src.type,
        kennels: new Set(),
        events: [],
      };
      bySource.set(sourceId, bucket);
    }
    bucket.kennels.add(kennelLabel);
    bucket.events.push({ id: event.id, date: dateStr, kennel: kennelLabel, scrapes });
  }
}

function printReport(reported: [string, Bucket][], since: Date): void {
  const sinceStr = since.toISOString().slice(0, 10);
  const header = `\nStale-cancellation shortlist (since ${sinceStr}): ${reported.length} suspect source(s) with ≥${MIN_COUNT_TO_REPORT} past CANCELLED events that were emitted ≥${MIN_SCRAPES_PER_EVENT}× before going silent.\n`;
  console.log(header);
  console.log(
    "NOTE: This is a shortlist for human review, not a list of bugs. The multi-scrape " +
      "signature is suggestive but not conclusive — you must spot-check each source's live URL " +
      "to confirm it's future-only before adding `config.upcomingOnly: true` in a follow-up PR.\n",
  );
  if (reported.length === 0) {
    console.log("No suspects.");
    return;
  }
  for (const [sourceId, b] of reported) {
    const kennelList = [...b.kennels].sort((a, c) => a.localeCompare(c)).join(", ");
    const count = b.events.length.toString().padStart(4);
    const type = b.sourceType.padEnd(18);
    console.log(`  ${count}  ${type}  ${b.sourceName}`);
    console.log(`         kennel(s): ${kennelList}`);
    console.log(`         sourceId:  ${sourceId}`);
    const samplesStr = b.events
      .slice(0, 5)
      .map((s) => `${s.date} ${s.id} (${s.scrapes} scrapes)`)
      .join(", ");
    console.log(`         sample(s): ${samplesStr}`);
    console.log("");
  }
}

async function main() {
  const since = parseSince();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const eligibleSources = await loadEligibleSources(prisma);
    if (eligibleSources.size === 0) {
      console.log("All sources already use upcomingOnly: true. Nothing to audit.");
      return;
    }

    const candidates = await prisma.event.findMany({
      where: {
        status: "CANCELLED",
        adminCancelledAt: null,
        date: { gte: since, lt: today },
        rawEvents: { some: { sourceId: { in: [...eligibleSources.keys()] } } },
      },
      select: {
        id: true,
        date: true,
        kennelId: true,
        kennel: { select: { kennelCode: true, shortName: true } },
        rawEvents: { select: { sourceId: true } },
      },
    });

    const bySource = new Map<string, Bucket>();
    for (const event of candidates) {
      bucketEvent(event, eligibleSources, bySource);
    }

    const reported = [...bySource.entries()]
      .filter(([, b]) => b.events.length >= MIN_COUNT_TO_REPORT)
      .sort((a, b) => b[1].events.length - a[1].events.length);

    printReport(reported, since);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
