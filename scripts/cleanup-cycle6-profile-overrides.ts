/**
 * One-off overrides for the cycle-6 profile bundle PR (#1380, #1392, #1393).
 *
 * Background: prisma/seed.ts performs a fill-only merge for existing kennels
 * — it never overwrites an already-populated column (seed.ts:298-303), and
 * `fullName` is set only at create time (seed.ts:265, not in PROFILE_FIELDS).
 *
 * This script applies the rewrites that can't be expressed in seed:
 *   - gynoh3.fullName  → "Gyrls Night Out Hash House Harriers"     (#1393)
 *   - gynoh3.description → expanded blurb with founding details    (#1393)
 *   - kimchi-h3.description → expanded blurb with Korean lineage   (#1380)
 *
 * Idempotent and safe to re-run. Default mode is DRY-RUN; pass --execute
 * to actually write to the DB.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-cycle6-profile-overrides.ts            # dry-run
 *   npx tsx scripts/cleanup-cycle6-profile-overrides.ts --execute  # apply
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const EXECUTE = process.argv.includes("--execute");

type OverrideField = "fullName" | "description";
interface FieldRewrite {
  expected: string;
  target: string;
}
interface Override {
  kennelCode: string;
  rewrites: Partial<Record<OverrideField, FieldRewrite>>;
}
interface RewriteEvaluation {
  updateData: Partial<Record<OverrideField, string>>;
  driftSkip: boolean;
}

// Each rewrite carries the EXPECTED current value so the script refuses to
// overwrite admin curations applied between merge and execution. `expected`
// is captured from the prod-state query in cycle-6 PR Step 0 — see PR body.
const OVERRIDES: Override[] = [
  {
    kennelCode: "gynoh3",
    rewrites: {
      fullName: {
        expected: "GyNO Hash House Harriers",
        target: "Gyrls Night Out Hash House Harriers",
      },
      description: {
        expected:
          "Memphis harriette kennel. Monthly events appearing on the Memphis H3 calendar.",
        target:
          "Women-only kennel in Memphis, TN, supported by Memphis Hash House Harriers. Founded October 20, 2025. Monthly trail on 3rd Mondays at 6:00 PM, with a Harriette Happy Hour the 1st Thursday of each month.",
      },
    },
  },
  {
    kennelCode: "kimchi-h3",
    rewrites: {
      description: {
        expected:
          "Colorado Springs biweekly Saturday afternoon hash, alternating weeks with Pikes Peak.",
        target:
          "Colorado Springs biweekly Saturday afternoon hash, alternating weeks with Pikes Peak. Founded in 2002 by Yongsan Kimchi H3 (Korea) alumni to offset PPH4 with a Saturday hash; name lineage from the original Seoul Kimchi kennel.",
      },
    },
  },
];

type KennelRow = { id: string; kennelCode: string; fullName: string; description: string | null };

function evaluateRewrites(
  kennel: KennelRow,
  rewrites: Override["rewrites"],
): RewriteEvaluation {
  const updateData: Partial<Record<OverrideField, string>> = {};
  let driftSkip = false;
  for (const field of Object.keys(rewrites) as OverrideField[]) {
    const { expected, target } = rewrites[field]!;
    const current = kennel[field];
    if (current === target) {
      console.log(`  · ${kennel.kennelCode}.${field} already correct.`);
    } else if (current === expected) {
      updateData[field] = target;
      console.log(`  ~ ${kennel.kennelCode}.${field}`);
      console.log(`      current: ${JSON.stringify(current)}`);
      console.log(`      target:  ${JSON.stringify(target)}`);
    } else {
      console.warn(`  ⚠ ${kennel.kennelCode}.${field} drifted from expected — refusing to overwrite.`);
      console.warn(`      expected: ${JSON.stringify(expected)}`);
      console.warn(`      current:  ${JSON.stringify(current)}`);
      console.warn(`      target:   ${JSON.stringify(target)}`);
      driftSkip = true;
    }
  }
  return { updateData, driftSkip };
}

async function processOverride(
  prisma: PrismaClient,
  override: Override,
): Promise<"updated" | "skipped-drift" | "noop" | "missing"> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: override.kennelCode },
    select: { id: true, kennelCode: true, fullName: true, description: true },
  });
  if (!kennel) {
    console.error(`✗ Kennel "${override.kennelCode}" not found — skipping.`);
    return "missing";
  }

  const { updateData, driftSkip } = evaluateRewrites(kennel, override.rewrites);
  if (driftSkip) return "skipped-drift";
  if (Object.keys(updateData).length === 0) return "noop";
  if (!EXECUTE) return "updated";

  await prisma.kennel.update({ where: { id: kennel.id }, data: updateData });
  console.log(`  ✓ Updated ${kennel.kennelCode} (${Object.keys(updateData).join(", ")})`);
  return "updated";
}

function summarize(plannedUpdates: number, skippedDueToDrift: number) {
  if (skippedDueToDrift > 0) {
    console.warn(`\n⚠ Skipped ${skippedDueToDrift} kennel(s) due to drift from expected values — review manually.`);
  }
  if (plannedUpdates === 0 && skippedDueToDrift === 0) {
    console.log("\nNothing to do — all overrides already applied.");
  } else if (plannedUpdates > 0 && !EXECUTE) {
    console.log(`\nDry-run complete. ${plannedUpdates} kennel(s) would be updated. Re-run with --execute to apply.`);
  } else if (plannedUpdates > 0) {
    console.log(`\nApplied overrides to ${plannedUpdates} kennel(s).`);
  }
}

async function main() {
  const mode = EXECUTE ? "EXECUTE (will update DB)" : "DRY-RUN (read-only)";
  console.log(`\n=== cleanup-cycle6-profile-overrides ===`);
  console.log(`Mode: ${mode}\n`);

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    let plannedUpdates = 0;
    let skippedDueToDrift = 0;
    for (const override of OVERRIDES) {
      const outcome = await processOverride(prisma, override);
      if (outcome === "updated") plannedUpdates++;
      else if (outcome === "skipped-drift") skippedDueToDrift++;
    }
    summarize(plannedUpdates, skippedDueToDrift);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
