/**
 * One-shot: suppress the `event-improbable-time` audit finding for SoCo (soco-h3).
 *
 * Why: SoCo is fed solely by the Atlanta Hash Board scraper (board.atlantahash.com),
 * which is dead — see #2054. The audit flags a future event with a `03:48` start
 * (a stale parse artifact), but there is no live recurring source to re-scrape and
 * correct it, so the finding can never self-resolve via a fresh scrape. This is the
 * documented, reviewable form of the "Suppress" remediation path for the recurring
 * escalation #2060 (base issues #1893/#1914/#1935/#1956). Mirrors the existing
 * precedent row AuditSuppression(kwh3, event-improbable-time) from #461.
 *
 * Idempotent: upserts on the (kennelCode, rule) composite unique, so it is safe to
 * re-run. Adding an AuditSuppression row is NOT a schema migration, but it must be
 * run against prod to take effect (Vercel never runs scripts/). Suppressions are
 * consumed by loadSuppressions()/isSuppressed() in src/pipeline/audit-runner.ts.
 *
 * Usage (worktree has no .env — supply DATABASE_URL from the main repo):
 *   DATABASE_URL=... npx tsx scripts/suppress-soco-improbable-time.ts
 *
 * Remove this suppression if/when a live recurring SoCo source is onboarded (#2054).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const KENNEL_CODE = "soco-h3";
const RULE = "event-improbable-time";
const REASON =
  "SoCo's only source is the Atlanta Hash Board scraper (board.atlantahash.com), " +
  "which is dead — see #2054. The flagged 03:48 start is a stale parse artifact on " +
  "an un-rescrapeable event with no live source to correct it. Remove this " +
  "suppression if a live recurring SoCo source is onboarded.";
const CREATED_BY = "script:suppress-soco-improbable-time (#2060)";

async function main(): Promise<void> {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  const row = await prisma.auditSuppression.upsert({
    where: { kennelCode_rule: { kennelCode: KENNEL_CODE, rule: RULE } },
    update: { reason: REASON, createdBy: CREATED_BY },
    create: { kennelCode: KENNEL_CODE, rule: RULE, reason: REASON, createdBy: CREATED_BY },
    select: { id: true, kennelCode: true, rule: true, reason: true, createdBy: true, createdAt: true },
  });

  console.log("✅ AuditSuppression upserted:");
  console.log(`   id:         ${row.id}`);
  console.log(`   kennelCode: ${row.kennelCode}`);
  console.log(`   rule:       ${row.rule}`);
  console.log(`   createdBy:  ${row.createdBy}`);
  console.log(`   createdAt:  ${row.createdAt.toISOString()}`);
  console.log(`   reason:     ${row.reason}`);

  await prisma.$disconnect();
  pool.end();
}

void main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
