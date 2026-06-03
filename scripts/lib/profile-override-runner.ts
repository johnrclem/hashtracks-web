import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { createScriptPool } from "./db-pool";

/**
 * Shared engine for one-shot kennel-profile override scripts.
 *
 * `prisma/seed.ts` does a fill-only merge for existing kennels — it never
 * overwrites an already-populated column (seed.ts:296-301). When a field is
 * already non-null in prod with the wrong value, the seed can't correct it, so
 * a one-shot override script is the only path. Several such scripts ship over
 * time (cycle-6 #1380/#1392/#1393, the new-kennel bundle #1839/#1849, …); this
 * runner holds the shared dry-run / drift-guard / update boilerplate so each
 * wrapper collapses to a list of overrides + one call — the same factoring as
 * `backfill-runner.ts` (avoids the Sonar new-code duplication that ships when
 * two near-identical wrappers land together).
 *
 * Each rewrite carries the EXPECTED current value, so the runner refuses to
 * clobber an admin edit applied between merge and execution (drift guard).
 * Idempotent: a field already at `target` is a no-op.
 */

export interface FieldRewrite {
  /** The value the field is expected to currently hold (captured at authoring). */
  expected: string;
  /** The value to write. `null` clears the column (e.g. a dead website URL). */
  target: string | null;
}

export interface ProfileOverride {
  kennelCode: string;
  /** Map of Kennel column name → rewrite. */
  rewrites: Record<string, FieldRewrite>;
}

export interface RunProfileOverridesOptions {
  /** When false (default), prints the plan without writing. */
  execute: boolean;
  /** Script name printed in the header banner. */
  scriptName: string;
}

type KennelRow = Record<string, unknown> & { id: string; kennelCode: string };

interface RewriteEvaluation {
  updateData: Record<string, string | null>;
  driftSkip: boolean;
}

function evaluateRewrites(kennel: KennelRow, rewrites: ProfileOverride["rewrites"]): RewriteEvaluation {
  const updateData: Record<string, string | null> = {};
  let driftSkip = false;
  for (const [field, { expected, target }] of Object.entries(rewrites)) {
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
  override: ProfileOverride,
  execute: boolean,
): Promise<"updated" | "skipped-drift" | "noop" | "missing"> {
  // Select only the columns this override touches (plus id/kennelCode), built
  // dynamically so the runner stays field-agnostic across wrapper scripts.
  const select = {
    id: true,
    kennelCode: true,
    ...Object.fromEntries(Object.keys(override.rewrites).map((f) => [f, true])),
  } as Prisma.KennelSelect;

  const kennel = (await prisma.kennel.findUnique({
    where: { kennelCode: override.kennelCode },
    select,
  })) as KennelRow | null;
  if (!kennel) {
    console.error(`✗ Kennel "${override.kennelCode}" not found — skipping.`);
    return "missing";
  }

  const { updateData, driftSkip } = evaluateRewrites(kennel, override.rewrites);
  if (driftSkip) return "skipped-drift";
  if (Object.keys(updateData).length === 0) return "noop";
  if (!execute) return "updated";

  await prisma.kennel.update({ where: { id: kennel.id }, data: updateData });
  console.log(`  ✓ Updated ${kennel.kennelCode} (${Object.keys(updateData).join(", ")})`);
  return "updated";
}

function summarize(plannedUpdates: number, skippedDueToDrift: number, execute: boolean): void {
  if (skippedDueToDrift > 0) {
    console.warn(`\n⚠ Skipped ${skippedDueToDrift} kennel(s) due to drift from expected values — review manually.`);
  }
  if (plannedUpdates === 0 && skippedDueToDrift === 0) {
    console.log("\nNothing to do — all overrides already applied.");
  } else if (plannedUpdates > 0 && !execute) {
    console.log(`\nDry-run complete. ${plannedUpdates} kennel(s) would be updated. Re-run with --execute to apply.`);
  } else if (plannedUpdates > 0) {
    console.log(`\nApplied overrides to ${plannedUpdates} kennel(s).`);
  }
}

/** One-call entry point: prints mode, applies each override, summarizes. */
export async function runProfileOverrides(
  overrides: ProfileOverride[],
  { execute, scriptName }: RunProfileOverridesOptions,
): Promise<void> {
  console.log(`\n=== ${scriptName} ===`);
  console.log(`Mode: ${execute ? "EXECUTE (will update DB)" : "DRY-RUN (read-only)"}\n`);

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    let plannedUpdates = 0;
    let skippedDueToDrift = 0;
    for (const override of overrides) {
      const outcome = await processOverride(prisma, override, execute);
      if (outcome === "updated") plannedUpdates++;
      else if (outcome === "skipped-drift") skippedDueToDrift++;
    }
    summarize(plannedUpdates, skippedDueToDrift, execute);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
