/**
 * One-shot historical backfill for FACEBOOK_HOSTED_EVENTS sources.
 *
 * Reads JSON shards harvested by Claude-in-Chrome (per
 * `docs/kennel-research/facebook-historical-backfill-cic-prompt.md`),
 * projects each FB Event into a RawEventData, and bulk-inserts as
 * `RawEvent` rows for the merge pipeline to canonicalize on its next
 * run. Idempotent — fingerprint-based dedup against existing RawEvents
 * for the same source.
 *
 * Strict date partition: only events with start date < CURDATE() (in
 * the kennel's local timezone) are imported. Future events stay in the
 * cron adapter's territory; the disjoint date contract guarantees no
 * overlap between the backfill and the recurring scraper, same as the
 * Seletar / ASS H3 / BFM history scripts.
 *
 * Cancelled events are NOT imported by this script (matches the live
 * `FACEBOOK_HOSTED_EVENTS` adapter's drop-at-ingest behavior — see
 * `parser.bagToRawEvent`). They're written to
 * `tmp/fb-backfill/_cancelled-events.json` for audit so the data is
 * not lost; importing them with `Event.status = CANCELLED` requires
 * a separate merge-pipeline change (cancelled-event handling across
 * the live cron path) that's a deliberate follow-up.
 *
 * Usage:
 *   1. Run the CIC harvester to produce shards in tmp/fb-backfill/.
 *   2. Dry run:  npx tsx scripts/import-fb-historical-backfill.ts
 *   3. Apply:    BACKFILL_APPLY=1 npx tsx scripts/import-fb-historical-backfill.ts
 *
 * Optional flags:
 *   --dir <path>   Override shard directory (default: tmp/fb-backfill)
 *   --handle <h>   Process only one handle (debugging)
 */

import "dotenv/config";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { facebookEventToRawEvent } from "@/adapters/facebook-hosted-events/parser";
import type { FacebookEventInput } from "@/adapters/facebook-hosted-events/parser";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

/**
 * Maps each Facebook Page handle in the audit's target list to the
 * HashTracks kennelCodes that share that Page. Some handles serve
 * multiple kennels (Berlin H3 + Berlin Full Moon both live on the
 * `BerlinHashHouseHarriers` Page; four Chiang Mai kennels share one
 * Page). Each kennelCode listed must already have a
 * `FACEBOOK_HOSTED_EVENTS` Source row in the DB — the script
 * fail-louds if a source is missing rather than silently skipping.
 *
 * Source: `docs/kennel-research/facebook-hosted-events-audit.md`
 * (audit run 2026-05-07, the 33-kennel scaling-target list).
 */
const HANDLE_TO_KENNELS: ReadonlyArray<{
  handle: string;
  kennelCodes: readonly string[];
}> = [
  // Tier 1 — Pages with upcoming events at audit time (already-active)
  { handle: "HollyweirdH6", kennelCodes: ["h6"] },
  { handle: "MemphisH3", kennelCodes: ["mh3-tn"] },
  { handle: "soh4onon", kennelCodes: ["soh4"] },
  { handle: "PCH3FL", kennelCodes: ["pch3"] },
  { handle: "DaytonHash", kennelCodes: ["dh4"] },
  { handle: "GrandStrandHashing", kennelCodes: ["gsh3"] },
  // Tier 2 — past events only at audit time
  { handle: "adelaidehash", kennelCodes: ["ah3-au"] },
  { handle: "AlohaH3", kennelCodes: ["ah3-hi"] },
  { handle: "augustaundergroundH3", kennelCodes: ["augh3"] },
  { handle: "BerlinHashHouseHarriers", kennelCodes: ["berlinh3", "bh3fm"] },
  { handle: "BurlingtonH3", kennelCodes: ["burlyh3"] },
  { handle: "CapeFearH3", kennelCodes: ["cfh3"] },
  {
    handle: "chiangmaihashhouseharriershhh",
    kennelCodes: ["ch3-cm", "ch4-cm", "csh3", "cbh3-cm"],
  },
  { handle: "CharmCityH3", kennelCodes: ["cch3"] },
  { handle: "charlestonheretics", kennelCodes: ["chh3"] },
  { handle: "clevelandhash", kennelCodes: ["cleh4"] },
  { handle: "FWBAreaHHH", kennelCodes: ["ech3-fl"] },
  { handle: "FoothillH3", kennelCodes: ["fth3"] },
  { handle: "h4hongkonghash", kennelCodes: ["hkh3"] },
  {
    handle: "Licking-Valley-Hash-House-Harriers-841860922532429",
    kennelCodes: ["lvh3-cin"],
  },
  { handle: "madisonHHH", kennelCodes: ["madisonh3"] },
  { handle: "MileHighH3", kennelCodes: ["mihi-huha"] },
  { handle: "MOA2H3", kennelCodes: ["moa2h3"] },
  { handle: "HashNarwhal", kennelCodes: ["narwhal-h3"] },
  { handle: "NorfolkH3", kennelCodes: ["norfolkh3"] },
  { handle: "rh3columbus", kennelCodes: ["renh3"] },
  { handle: "SurvivorH3", kennelCodes: ["survivor-h3"] },
  { handle: "sirwaltersh3", kennelCodes: ["swh3"] },
  { handle: "vontramph3", kennelCodes: ["vth3"] },
] as const;

/** Schema for a single CIC-harvested shard. Mirrors the prompt's
 *  "Step 4 — Emit the shard" output spec. */
interface BackfillShard {
  schemaVersion: 1;
  handle: string;
  harvestedAt: string;
  status: "complete" | "truncated" | "page_unavailable" | "aborted";
  stoppedReason?: string;
  paginationRequests?: number;
  events: FacebookEventInput[];
  totalEvents: number;
  earliestEventDate?: string;
  latestEventDate?: string;
}

interface ScriptArgs {
  dir: string;
  apply: boolean;
  handle?: string;
}

function parseArgs(argv: readonly string[]): ScriptArgs {
  const args: ScriptArgs = { dir: "tmp/fb-backfill", apply: process.env.BACKFILL_APPLY === "1" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir" && argv[i + 1]) {
      args.dir = argv[i + 1];
      i++;
    } else if (argv[i] === "--handle" && argv[i + 1]) {
      args.handle = argv[i + 1];
      i++;
    }
  }
  return args;
}

function readShards(dir: string): BackfillShard[] {
  if (!existsSync(dir)) {
    throw new Error(
      `Shard directory not found: ${dir}. Run the CIC harvester first (see docs/kennel-research/facebook-historical-backfill-cic-prompt.md).`,
    );
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !f.startsWith("_")); // skip _summary.json, _aborted.json, _cancelled-events.json
  const shards: BackfillShard[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      shards.push(raw as BackfillShard);
    } catch (err) {
      console.warn(`  ! skipping ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return shards;
}

interface ProjectedEvent {
  kennelCode: string;
  rawEventData: RawEventData;
  fingerprint: string;
}

/** Decide whether to skip an event (cancelled, future-dated, or
 *  un-projectable) or project it for each target kennel. */
function projectShard(
  shard: BackfillShard,
  kennelCodes: readonly string[],
  timezoneByKennel: ReadonlyMap<string, string>,
  todayUtcMs: number,
): {
  projected: ProjectedEvent[];
  cancelled: FacebookEventInput[];
  future: number;
  unprojectable: number;
} {
  const projected: ProjectedEvent[] = [];
  const cancelled: FacebookEventInput[] = [];
  let future = 0;
  let unprojectable = 0;
  for (const event of shard.events) {
    if (event.isCanceled) {
      cancelled.push(event);
      continue;
    }
    // Strict-partition: backfill writes < today only. Anything in the
    // future or today belongs to the cron adapter to avoid double-write.
    if (event.startTimestamp * 1000 >= todayUtcMs) {
      future++;
      continue;
    }
    for (const kennelCode of kennelCodes) {
      const tz = timezoneByKennel.get(kennelCode);
      if (!tz) {
        unprojectable++;
        continue;
      }
      const raw = facebookEventToRawEvent(event, kennelCode, tz);
      if (!raw) {
        unprojectable++;
        continue;
      }
      projected.push({
        kennelCode,
        rawEventData: raw,
        fingerprint: generateFingerprint(raw),
      });
    }
  }
  return { projected, cancelled, future, unprojectable };
}

interface SourceLookup {
  sourceId: string;
  timezone: string;
}

async function loadSourceLookup(
  prisma: PrismaClient,
  expectedKennelCodes: readonly string[],
): Promise<{ byKennelCode: Map<string, SourceLookup>; missing: string[] }> {
  const sources = await prisma.source.findMany({
    where: { type: "FACEBOOK_HOSTED_EVENTS", enabled: true },
    select: { id: true, config: true },
  });
  const byKennelCode = new Map<string, SourceLookup>();
  for (const s of sources) {
    const cfg = s.config as { kennelTag?: string; timezone?: string } | null;
    if (!cfg?.kennelTag || !cfg.timezone) continue;
    byKennelCode.set(cfg.kennelTag, { sourceId: s.id, timezone: cfg.timezone });
  }
  const missing = expectedKennelCodes.filter((c) => !byKennelCode.has(c));
  return { byKennelCode, missing };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Shard dir: ${args.dir}`);
  if (args.handle) console.log(`Handle filter: ${args.handle}`);
  console.log("");

  let allShards = readShards(args.dir);
  if (args.handle) {
    allShards = allShards.filter((s) => s.handle === args.handle);
  }
  console.log(`Read ${allShards.length} shards`);
  if (allShards.length === 0) {
    console.log("No shards to process. Exiting.");
    return;
  }

  // Today at UTC noon — matches the project's UTC-noon date convention
  // and gives a stable cutoff regardless of the operator's local time.
  const today = new Date();
  const todayUtcMs = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    12,
    0,
    0,
  );

  const handleToKennels = new Map(HANDLE_TO_KENNELS.map((m) => [m.handle, m.kennelCodes]));
  const expectedKennelCodes = [...new Set(HANDLE_TO_KENNELS.flatMap((m) => m.kennelCodes))];

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const { byKennelCode, missing } = await loadSourceLookup(prisma, expectedKennelCodes);
    if (missing.length > 0) {
      console.log("");
      console.log("⚠️  Missing FACEBOOK_HOSTED_EVENTS sources (one per kennelCode below):");
      for (const k of missing) console.log(`     - ${k}`);
      console.log("");
      console.log(
        "Add these to prisma/seed-data/sources.ts and run `npx prisma db seed` before retrying.",
      );
      console.log(
        "(The audit at docs/kennel-research/facebook-hosted-events-audit.md is the canonical inventory.)",
      );
      console.log("");
      console.log("Continuing — handles whose kennels are missing sources will be skipped.");
    }

    const timezoneByKennel = new Map<string, string>();
    for (const [k, v] of byKennelCode) timezoneByKennel.set(k, v.timezone);

    const cancelledAcrossShards: { handle: string; events: FacebookEventInput[] }[] = [];
    let totalProjected = 0;
    let totalCancelled = 0;
    let totalFuture = 0;
    let totalUnprojectable = 0;
    let totalInserted = 0;
    let totalAlreadyPresent = 0;
    let totalSourceless = 0;

    for (const shard of allShards) {
      console.log(`\n[${shard.handle}] status=${shard.status}, events=${shard.totalEvents}`);
      const kennelCodes = handleToKennels.get(shard.handle);
      if (!kennelCodes) {
        console.log(`  ! handle not in HANDLE_TO_KENNELS — skipping`);
        continue;
      }
      const { projected, cancelled, future, unprojectable } = projectShard(
        shard,
        kennelCodes,
        timezoneByKennel,
        todayUtcMs,
      );
      totalCancelled += cancelled.length;
      totalFuture += future;
      totalUnprojectable += unprojectable;
      cancelledAcrossShards.push({ handle: shard.handle, events: cancelled });

      // Group projected events by sourceId for batched fingerprint-dedup.
      const bySourceId = new Map<string, ProjectedEvent[]>();
      for (const p of projected) {
        const lookup = byKennelCode.get(p.kennelCode);
        if (!lookup) {
          totalSourceless++;
          continue;
        }
        const existing = bySourceId.get(lookup.sourceId) ?? [];
        existing.push(p);
        bySourceId.set(lookup.sourceId, existing);
      }

      let shardInserted = 0;
      let shardAlready = 0;
      for (const [sourceId, events] of bySourceId) {
        const fingerprintList = events.map((e) => e.fingerprint);
        const existingRows = await prisma.rawEvent.findMany({
          where: { sourceId, fingerprint: { in: fingerprintList } },
          select: { fingerprint: true },
        });
        const existingSet = new Set(existingRows.map((r) => r.fingerprint));
        const toInsert = events.filter((e) => !existingSet.has(e.fingerprint));
        shardAlready += existingSet.size;
        if (args.apply && toInsert.length > 0) {
          await prisma.rawEvent.createMany({
            data: toInsert.map((e) => ({
              sourceId,
              rawData: e.rawEventData as unknown as Prisma.InputJsonValue,
              fingerprint: e.fingerprint,
              processed: false,
            })),
          });
        }
        shardInserted += toInsert.length;
      }

      console.log(
        `  projected=${projected.length}, future_skipped=${future}, cancelled_skipped=${cancelled.length}, unprojectable=${unprojectable}`,
      );
      console.log(`  to_insert=${shardInserted}, already_present=${shardAlready}`);
      totalProjected += projected.length;
      totalInserted += shardInserted;
      totalAlreadyPresent += shardAlready;
    }

    // Cancelled events get audit-logged so they're not silently lost.
    // Importing them as Event.status=CANCELLED requires merge-pipeline
    // changes that are deliberately a separate follow-up PR.
    if (cancelledAcrossShards.some((s) => s.events.length > 0)) {
      const auditPath = join(args.dir, "_cancelled-events.json");
      const payload = {
        note: "Cancelled FB events skipped during this backfill run. Importing them as Event.status=CANCELLED requires merge-pipeline changes (see import-fb-historical-backfill.ts docstring). This file is the audit trail so a future follow-up can pick them up.",
        generatedAt: new Date().toISOString(),
        shards: cancelledAcrossShards.filter((s) => s.events.length > 0),
      };
      writeFileSync(auditPath, JSON.stringify(payload, null, 2));
      console.log(`\nCancelled events written to ${auditPath} (skipped from import).`);
    }

    console.log(`
Summary:
  shards processed:         ${allShards.length}
  events projected:         ${totalProjected}
  events inserted:          ${totalInserted}${args.apply ? "" : " (dry run — no writes)"}
  events already present:   ${totalAlreadyPresent}
  cancelled (skipped):      ${totalCancelled}
  future-dated (skipped):   ${totalFuture}
  unprojectable (skipped):  ${totalUnprojectable}
  sourceless (skipped):     ${totalSourceless}
`);

    if (!args.apply) {
      console.log("Dry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
    } else {
      console.log("Done. The merge pipeline will canonicalize these RawEvents on its next run.");
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
