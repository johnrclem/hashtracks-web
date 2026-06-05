/**
 * One-shot audit corrections for the Brasília / Asunción / Auckland cycle
 * (#1959, #1980, #1981, #1982, #1983, #1960, #1964 — the current/future slice).
 *
 * Two passes:
 *  1. Kennel profile fields the seed merge can't reach in prod:
 *       - asu-h3: facebookUrl + gm (seed fill-null also works, but a full
 *         `prisma db seed` would clobber sibling sessions' Source.config, so
 *         touch only these rows).
 *       - brasilia-h3: facebookUrl overwrite (BrasiliaHHH → groups/BrasiliaH3) —
 *         a non-null change the fill-null seed merge would skip.
 *  2. Forward refresh of CURRENT/FUTURE events for the three sources via the
 *     live adapter + processRawEvents (NO reconcile → pure upsert, no cancels).
 *     The PAST archives are handled by the per-kennel history backfills; this
 *     pass updates the rolling/upcoming events (e.g. Brasília #340, Auckland's
 *     upcoming list) with the new title/hares/location.
 *
 * PREREQUISITE for the PAST slice: title/hares/location are fingerprint inputs,
 * so existing archive Events keep their old synthesized titles / null hares
 * until the per-kennel history backfills are re-run with the regenerated JSON:
 *   BACKFILL_APPLY=1 npx tsx scripts/backfill-brasilia-h3-history.ts
 *   BACKFILL_APPLY=1 npx tsx scripts/backfill-asu-h3-history.ts
 * (Regenerate the JSON first via scripts/generate-{brasilia,asu}-h3-history.ts.)
 * This script only covers the current/future slice; run it after the backfills.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-audit-brasilia-asu-auckland.ts
 *   Apply:    npx tsx scripts/backfill-audit-brasilia-asu-auckland.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents } from "@/pipeline/merge";

const APPLY = process.argv.includes("--apply");

interface ProfilePatch {
  kennelCode: string;
  /** Fields to set only when the current prod value is null (mirrors seed fill-null). */
  fillNull?: Record<string, string>;
  /** Fields to overwrite unconditionally (a known-wrong existing value). */
  overwrite?: Record<string, string>;
}

const PROFILE_PATCHES: ProfilePatch[] = [
  {
    kennelCode: "asu-h3",
    fillNull: {
      facebookUrl: "https://www.facebook.com/groups/1254316384994089",
      gm: "Ban The Cock (Eric)",
    },
  },
  {
    kennelCode: "brasilia-h3",
    overwrite: { facebookUrl: "https://www.facebook.com/groups/BrasiliaH3" },
  },
];

// Source NAME → forward scrape window (days). Asunción is future-only with no
// upcoming events today, so its fetch returns nothing — harmless.
const FORWARD_SOURCES: { name: string; days: number }[] = [
  { name: "Brasilia H3 Blogspot Trail Posts", days: 120 },
  { name: "Asunción H3 WordPress Run Posts", days: 120 },
  { name: "Auckland H3 Website", days: 365 },
];

async function updateProfiles(): Promise<void> {
  console.log(`\n=== Pass 1: kennel profiles ===`);
  for (const patch of PROFILE_PATCHES) {
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: patch.kennelCode },
      select: { id: true, facebookUrl: true, gm: true },
    });
    if (!kennel) {
      console.warn(`  ⚠ kennel ${patch.kennelCode} not found — skipping`);
      continue;
    }
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.fillNull ?? {})) {
      if ((kennel as Record<string, unknown>)[k] == null) data[k] = v;
    }
    for (const [k, v] of Object.entries(patch.overwrite ?? {})) {
      if ((kennel as Record<string, unknown>)[k] !== v) data[k] = v;
    }
    if (Object.keys(data).length === 0) {
      console.log(`  ${patch.kennelCode}: already correct, no change`);
      continue;
    }
    console.log(`  ${patch.kennelCode}: ${APPLY ? "updating" : "would update"} ${JSON.stringify(data)}`);
    if (APPLY) await prisma.kennel.update({ where: { id: kennel.id }, data });
  }
}

async function refreshForwardEvents(): Promise<void> {
  console.log(`\n=== Pass 2: forward event refresh (current/future) ===`);
  for (const { name, days } of FORWARD_SOURCES) {
    const source = await prisma.source.findFirst({ where: { name } });
    if (!source) {
      console.warn(`  ⚠ source "${name}" not found — skipping`);
      continue;
    }
    const adapter = getAdapter(source.type, source.url, source.config as Record<string, unknown> | null);
    const result = await adapter.fetch(source, { days });
    console.log(`  ${name}: fetched ${result.events.length} event(s)${result.errors.length ? ` (errors: ${result.errors.length})` : ""}`);
    if (!APPLY) {
      for (const e of result.events.slice(0, 5)) {
        console.log(`     [dry] ${e.date} #${e.runNumber ?? "?"} title=${e.title ?? "—"} hares=${e.hares ?? "—"} loc=${e.location ?? "—"}`);
      }
      continue;
    }
    if (result.events.length === 0) continue;
    const merged = await processRawEvents(source.id, result.events);
    console.log(`     created=${merged.created} updated=${merged.updated} skipped=${merged.skipped} blocked=${merged.blocked} errors=${merged.eventErrors}`);
    if (merged.blocked > 0) console.warn(`     ⚠ blocked tags: ${merged.blockedTags.join(", ")}`);
  }
}

async function main(): Promise<void> {
  console.log(APPLY ? "APPLY MODE — writing to DB" : "DRY RUN — no writes (pass --apply to write)");
  await updateProfiles();
  await refreshForwardEvents();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
