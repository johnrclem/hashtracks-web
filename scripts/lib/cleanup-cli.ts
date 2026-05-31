import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./db-pool";

/**
 * Shared CLI scaffolding for the one-shot `cleanup-*.ts` scripts: the
 * `--apply` dry-run gate and the kennel lookup + targeting log that every
 * script opens with. Extracted so the boilerplate lives once instead of being
 * copy-pasted per script (SonarCloud CPD).
 */

/** Parse the `--apply` flag and log the resulting mode. */
export function parseApplyMode(): boolean {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (will hard-delete)" : "DRY-RUN"}`);
  return apply;
}

/**
 * Resolve the target kennel by code, or log + return null when it's absent so
 * the caller can bail early.
 */
export async function resolveCleanupKennel(
  prisma: PrismaClient,
  kennelCode: string,
): Promise<{ id: string; shortName: string } | null> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.log(`Kennel "${kennelCode}" not found — nothing to do.`);
    return null;
  }
  console.log(`Targeting kennel: ${kennel.shortName} (${kennel.id})`);
  return kennel;
}

/**
 * A single canonical-`Event` field patch produced by a cleanup collector.
 * `after === null` clears the field; a string overwrites it.
 */
export interface FieldPatch {
  kennelLabel: string;
  eventId: string;
  field: "haresText" | "title" | "locationName" | "description";
  before: string | null;
  after: string | null;
}

/** Print a grouped, truncated before/after diff of the collected patches. */
export function summarizeFieldPatches(patches: FieldPatch[], sampleSize = 8): void {
  const byKennel = new Map<string, FieldPatch[]>();
  for (const p of patches) {
    const list = byKennel.get(p.kennelLabel) ?? [];
    list.push(p);
    byKennel.set(p.kennelLabel, list);
  }
  for (const [label, list] of [...byKennel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n${label}: ${list.length} event(s)`);
    for (const p of list.slice(0, sampleSize)) {
      console.log(`  ${p.eventId} ${p.field}:`);
      console.log(`    - before: ${JSON.stringify(p.before)}`);
      console.log(`    + after:  ${JSON.stringify(p.after)}`);
    }
    if (list.length > sampleSize) console.log(`  … (${list.length - sampleSize} more)`);
  }
}

/** Apply each field patch with a per-row `event.update`. */
export async function applyFieldPatches(prisma: PrismaClient, patches: FieldPatch[]): Promise<void> {
  for (const p of patches) {
    await prisma.event.update({ where: { id: p.eventId }, data: { [p.field]: p.after } });
  }
}

/**
 * Full harness for a field-patch cleanup script: opens a pooled Prisma client,
 * runs the collector, prints the diff, applies it unless `--apply` is absent
 * (dry-run default), and always releases the pool. Sets `process.exitCode` on
 * failure rather than calling `process.exit()` so the event loop drains. Both
 * `cleanup-locationname-systemic.ts` and `cleanup-ws5-canonical-ghosts.ts`
 * share this rather than copy-pasting the boilerplate (SonarCloud CPD).
 */
export async function runFieldPatchCleanup(
  collect: (prisma: PrismaClient) => Promise<FieldPatch[]>,
  sampleSize = 8,
): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const dryRun = !process.argv.includes("--apply");
  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    console.log(dryRun ? "🔍 DRY RUN — no changes will be made" : "✏️  APPLYING changes");
    console.log(`DATABASE_URL host: ${new URL(databaseUrl).host}\n`);

    const patches = await collect(prisma);
    summarizeFieldPatches(patches, sampleSize);
    console.log(`\nTotal: ${patches.length} event field(s) to patch.`);

    if (patches.length > 0 && !dryRun) {
      console.log("\nApplying patches...");
      await applyFieldPatches(prisma, patches);
      console.log(`✓ Applied ${patches.length} patch(es).`);
    } else if (dryRun) {
      console.log("\nRun with --apply to commit changes.");
    }
  } finally {
    await pool.end();
  }
}
