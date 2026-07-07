/**
 * One-shot: suppress the `event-improbable-time` audit finding for four kennels
 * whose flagged late-night / early-morning start times are GENUINE source data,
 * not an adapter bug. Resolves audit issues #2542 (Salem), #2295 + escalation
 * #2455 (Flour City), #2537 (Toulouse), #2531 (Aberdeen).
 *
 * Why (each confirmed by live verification, 2026-07-07):
 *  - GCal sources raw-slice the API `dateTime` string only when no `timezone`
 *    config is set; a Z-slice bug would push every evening event into the
 *    22:00–01:00 band. Live histograms disprove that:
 *      • Salem (salemh3):     timed events cluster 11:00–15:00 (+ all-day); 0 improbable.
 *      • Flour City (flour-city): 42 events at 18:00, 17 at 13:00; 0 improbable.
 *    The originally-flagged events were one-off odd entries (e.g. Flour City's
 *    "3:33" gag trail) that have since aged out — the adapter stores correct
 *    local times, so there is nothing to fix in code.
 *  - Harrier Central verbatim-slices HC's naive LOCAL time (Tokyo, UTC+9, is
 *    correct with the same slice). Aberdeen's live feed is a MIX of 19:00 (9)
 *    and 23:00 (5) — a uniform TZ bug cannot produce both, so the 23:00 runs
 *    are genuine values in HC's data. Same for Toulouse's 02:30. Un-fixable
 *    from our side (upstream data-entry), so the finding can never self-resolve.
 *
 * Precedent: AuditSuppression(kwh3, event-improbable-time) #461,
 * AuditSuppression(soco-h3, …) #2060.
 *
 * Idempotent: upserts on (kennelCode, rule). Adding a row is NOT a schema
 * migration but MUST run against prod to take effect (Vercel never runs
 * scripts/). Consumed by loadSuppressions()/isSuppressed() in
 * src/pipeline/audit-runner.ts.
 *
 * Usage (worktree has no .env — supply DATABASE_URL from the main repo):
 *   DATABASE_URL=... npx tsx scripts/suppress-improbable-time-gcal-hc-bundle.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const RULE = "event-improbable-time";
const CREATED_BY = "script:suppress-improbable-time-gcal-hc-bundle (#2542/#2295/#2455/#2537/#2531)";

const TARGETS: Array<{ kennelCode: string; reason: string }> = [
  {
    kennelCode: "salemh3",
    reason:
      "GCal source. Live verification (2026-07-07) shows timed events cluster 11:00–15:00 with 0 improbable-hour events; a Z-slice bug would push evening events to 22:00–01:00. The flagged 23:00 event was a one-off entry that has aged out. Adapter stores correct local time. #2542.",
  },
  {
    kennelCode: "flour-city",
    reason:
      "GCal source. Live verification (2026-07-07): 42 events at 18:00, 17 at 13:00, 0 improbable-hour events. The flagged 03:33 'El Farge2' entry is a genuine one-off gag time, not a Z-slice bug. Adapter stores correct Eastern local time. #2295 / escalation #2455.",
  },
  {
    kennelCode: "aberdeen-h3",
    reason:
      "Harrier Central source. Live verification (2026-07-07): feed is a mix of 19:00 (9 events) and 23:00 (5 events) — a uniform timezone bug cannot produce both, so the 23:00 runs are genuine values in HC's data (upstream data entry). Adapter verbatim-slices HC's naive local time (correct, proven by Tokyo). #2531.",
  },
  {
    kennelCode: "toulouse-h3",
    reason:
      "Harrier Central source. The flagged 02:30 start is a genuine value in HC's data; the adapter verbatim-slices HC's naive local time (correct, proven by Tokyo, UTC+9). Un-fixable from our side (upstream data entry). #2537.",
  },
];

async function main(): Promise<void> {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  for (const { kennelCode, reason } of TARGETS) {
    const row = await prisma.auditSuppression.upsert({
      where: { kennelCode_rule: { kennelCode, rule: RULE } },
      // Refresh only `reason` on rerun; keep `createdBy` on the create path so a
      // pre-existing suppression retains its original creator provenance.
      update: { reason },
      create: { kennelCode, rule: RULE, reason, createdBy: CREATED_BY },
      select: { id: true, kennelCode: true, rule: true, createdAt: true },
    });
    console.log(`✅ suppressed ${row.kennelCode} / ${row.rule} (id=${row.id}, ${row.createdAt.toISOString()})`);
  }

  await prisma.$disconnect();
  pool.end();
}

void main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
