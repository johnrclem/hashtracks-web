/**
 * One-shot canonical backfill for #2229 — Meetup cost + trailType.
 *
 * The adapter now lifts "Hash Cash:"/"Cost:" → cost and "Trail:"/"Trail type:"
 * → trailType for every MEETUP source. A plain re-scrape only repairs events
 * still in the source's forward window; historical Meetup events carry the
 * structured labels in their already-stored (cleaned) `description` but have
 * `cost`/`trailType` NULL. This script re-runs the SAME exported extractors over
 * those stored descriptions and fills the typed fields.
 *
 * Scope: canonical events fed by a MEETUP-type source (rawEvents.some.source.type)
 * with a non-null description and at least one of cost/trailType still null.
 *
 * Safe & idempotent: each field is filled only when currently null (optimistic
 * updateMany guard); a re-run updates 0. cost/trailType are NOT in the RawEvent
 * fingerprint, so this never disturbs dedup, and the merge preserves the values.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-meetup-cost-trailtype-2229.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-meetup-cost-trailtype-2229.ts --apply
 */
import { runOneShot } from "./lib/one-shot";
import { extractMeetupCost, extractMeetupTrailType } from "@/adapters/meetup/adapter";

const SAMPLE = 12;

void runOneShot(async ({ prisma, apply }) => {
  const candidates = await prisma.event.findMany({
    where: {
      description: { not: null },
      OR: [{ cost: null }, { trailType: null }],
      rawEvents: { some: { source: { type: "MEETUP" } } },
    },
    select: { id: true, title: true, description: true, cost: true, trailType: true },
    orderBy: { date: "asc" },
  });

  const plan = candidates
    .map((e) => ({
      id: e.id,
      title: e.title,
      newCost: e.cost == null ? extractMeetupCost(e.description ?? undefined) : undefined,
      newTrailType:
        e.trailType == null ? extractMeetupTrailType(e.description ?? undefined) : undefined,
    }))
    .filter((p) => p.newCost || p.newTrailType);

  const costCount = plan.filter((p) => p.newCost).length;
  const trailCount = plan.filter((p) => p.newTrailType).length;
  console.log(
    `\n#2229 Meetup cost+trailType: ${plan.length} event(s) to patch (${costCount} cost, ${trailCount} trailType) of ${candidates.length} MEETUP candidates`,
  );
  plan
    .slice(0, SAMPLE)
    .forEach((p) =>
      console.log(`   - ${p.title}: cost=${JSON.stringify(p.newCost)} trailType=${JSON.stringify(p.newTrailType)}`),
    );

  if (apply) {
    let costUpdated = 0;
    let trailUpdated = 0;
    for (const p of plan) {
      if (p.newCost) {
        const res = await prisma.event.updateMany({
          where: { id: p.id, cost: null },
          data: { cost: p.newCost },
        });
        costUpdated += res.count;
      }
      if (p.newTrailType) {
        const res = await prisma.event.updateMany({
          where: { id: p.id, trailType: null },
          data: { trailType: p.newTrailType },
        });
        trailUpdated += res.count;
      }
    }
    console.log(`   ✏️  cost updated ${costUpdated}, trailType updated ${trailUpdated}`);
  }

  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
