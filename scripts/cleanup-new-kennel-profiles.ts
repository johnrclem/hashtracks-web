/**
 * One-off profile overrides for the new-kennel hardening bundle (#1839, #1849).
 *
 * Background: prisma/seed.ts performs a fill-only merge for existing kennels —
 * it never overwrites an already-populated column (seed.ts:296-301). These two
 * fields are already non-null in prod with the wrong value, so the seed cannot
 * correct them; this script applies the rewrites:
 *   - bali-hash-2.facebookUrl → https://www.facebook.com/groups/balihash2/  (#1839)
 *       (was the bare page handle /BaliHash2; the site only links the group)
 *   - mijash3.contactEmail    → info@mijash3.com                            (#1849)
 *       (was the 5ksmh3 hareraiser mailbox; info@ is the site's canonical inbox)
 *
 * Each rewrite carries the EXPECTED current value, so the script refuses to
 * clobber an admin edit applied between merge and execution (drift guard).
 *
 * Idempotent and safe to re-run. Default mode is DRY-RUN; pass --execute to
 * write to the DB.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-new-kennel-profiles.ts            # dry-run
 *   npx tsx scripts/cleanup-new-kennel-profiles.ts --execute  # apply
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const EXECUTE = process.argv.includes("--execute");

type OverrideField = "facebookUrl" | "contactEmail";
interface FieldRewrite {
  expected: string;
  target: string;
}
interface Override {
  kennelCode: string;
  rewrites: Partial<Record<OverrideField, FieldRewrite>>;
}

// `expected` captured from the prod-state query at planning time (2026-05-30).
const OVERRIDES: Override[] = [
  {
    kennelCode: "bali-hash-2",
    rewrites: {
      facebookUrl: {
        expected: "https://www.facebook.com/BaliHash2",
        target: "https://www.facebook.com/groups/balihash2/",
      },
    },
  },
  {
    kennelCode: "mijash3",
    rewrites: {
      contactEmail: {
        expected: "5ksmh3@gmail.com",
        target: "info@mijash3.com",
      },
    },
  },
];

type KennelRow = {
  id: string;
  kennelCode: string;
  facebookUrl: string | null;
  contactEmail: string | null;
};

interface RewriteEvaluation {
  updateData: Partial<Record<OverrideField, string>>;
  driftSkip: boolean;
}

function evaluateRewrites(kennel: KennelRow, rewrites: Override["rewrites"]): RewriteEvaluation {
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
    select: { id: true, kennelCode: true, facebookUrl: true, contactEmail: true },
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
  console.log(`\n=== cleanup-new-kennel-profiles ===`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will update DB)" : "DRY-RUN (read-only)"}\n`);

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
