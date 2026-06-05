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

const ASU_FACEBOOK = "https://www.facebook.com/groups/1254316384994089";
const ASU_GM = "Ban The Cock (Eric)";
const BRASILIA_FACEBOOK = "https://www.facebook.com/groups/BrasiliaH3";

// Source NAME → forward scrape window (days). Asunción is future-only with no
// upcoming events today, so its fetch returns nothing — harmless.
const FORWARD_SOURCES: { name: string; days: number }[] = [
  { name: "Brasilia H3 Blogspot Trail Posts", days: 120 },
  { name: "Asunción H3 WordPress Run Posts", days: 120 },
  { name: "Auckland H3 Website", days: 365 },
];

/**
 * Apply a kennel profile patch (only the keys present in `data` are written).
 * Logs + writes only when there's an actual change. Explicit typed fields — no
 * dynamic key access — so there's no object-injection sink to flag.
 */
async function applyProfile(kennelCode: string, data: Record<string, string>): Promise<void> {
  if (Object.keys(data).length === 0) {
    console.log(`  ${kennelCode}: already correct, no change`);
    return;
  }
  console.log(`  ${kennelCode}: ${APPLY ? "updating" : "would update"} ${JSON.stringify(data)}`);
  if (APPLY) await prisma.kennel.update({ where: { kennelCode }, data });
}

async function updateProfiles(): Promise<void> {
  console.log(`\n=== Pass 1: kennel profiles ===`);

  // asu-h3: fill facebookUrl + gm only when null (mirrors seed fill-null, #1959).
  const asu = await prisma.kennel.findUnique({ where: { kennelCode: "asu-h3" } });
  if (asu) {
    const data: Record<string, string> = {};
    if (asu.facebookUrl == null) data.facebookUrl = ASU_FACEBOOK;
    if (asu.gm == null) data.gm = ASU_GM;
    await applyProfile("asu-h3", data);
  } else {
    console.warn("  ⚠ kennel asu-h3 not found — skipping");
  }

  // brasilia-h3: overwrite the wrong facebookUrl (BrasiliaHHH → groups, #1980).
  const bra = await prisma.kennel.findUnique({ where: { kennelCode: "brasilia-h3" } });
  if (bra) {
    const data: Record<string, string> = {};
    if (bra.facebookUrl !== BRASILIA_FACEBOOK) data.facebookUrl = BRASILIA_FACEBOOK;
    await applyProfile("brasilia-h3", data);
  } else {
    console.warn("  ⚠ kennel brasilia-h3 not found — skipping");
  }
}

/**
 * Forward-refresh one source's current/future events. `name` is not unique, so
 * use findMany(take:2) + length check (mirrors mergeRawEventsForSource) — a
 * duplicate fails loud rather than silently scraping whichever row findFirst
 * picked. Pure upsert via processRawEvents (no reconcile → no cancels).
 */
async function refreshOneSource(name: string, days: number): Promise<void> {
  const sources = await prisma.source.findMany({ where: { name }, take: 2 });
  if (sources.length === 0) {
    console.warn(`  ⚠ source "${name}" not found — skipping`);
    return;
  }
  if (sources.length > 1) {
    throw new Error(`Multiple sources named "${name}" — refusing to guess which to scrape`);
  }
  const source = sources[0];
  const adapter = getAdapter(source.type, source.url, source.config as Record<string, unknown> | null);
  const result = await adapter.fetch(source, { days });
  const errNote = result.errors.length ? ` (errors: ${result.errors.length})` : "";
  console.log(`  ${name}: fetched ${result.events.length} event(s)${errNote}`);
  if (!APPLY) {
    for (const e of result.events.slice(0, 5)) {
      console.log(`     [dry] ${e.date} #${e.runNumber ?? "?"} title=${e.title ?? "—"} hares=${e.hares ?? "—"} loc=${e.location ?? "—"}`);
    }
    return;
  }
  if (result.events.length === 0) return;
  const merged = await processRawEvents(source.id, result.events);
  console.log(`     created=${merged.created} updated=${merged.updated} skipped=${merged.skipped} blocked=${merged.blocked} errors=${merged.eventErrors}`);
  if (merged.blocked > 0) console.warn(`     ⚠ blocked tags: ${merged.blockedTags.join(", ")}`);
}

async function refreshForwardEvents(): Promise<void> {
  console.log(`\n=== Pass 2: forward event refresh (current/future) ===`);
  for (const { name, days } of FORWARD_SOURCES) {
    try {
      await refreshOneSource(name, days);
    } catch (err) {
      // Failure isolation: one source's adapter/network error shouldn't abort
      // the refresh for the others.
      console.error(`  ❌ ${name}: refresh failed —`, err);
    }
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
