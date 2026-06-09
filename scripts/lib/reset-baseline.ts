/**
 * Shared runner for one-shot `Source.baselineResetAt = NOW()` ops scripts.
 *
 * `baselineResetAt` is the documented escape hatch for code-led metric
 * false-positives: when an adapter PR intentionally changes what it emits and
 * trips a FIELD_FILL_DROP / EVENT_COUNT_ANOMALY alert, setting the boundary to
 * NOW cuts the rolling baseline (see `prisma/schema.prisma` `baselineResetAt`
 * and `src/pipeline/health.ts` `startedAt: { gte }`). Each incident gets its own
 * thin wrapper that documents the verdict and calls this runner — the wrappers
 * differ only in source identity + alert number, so the DB plumbing lives here.
 *
 * Behaviour (driven by `process.argv`):
 *   (default)        dry run — print the source + current boundary, no write.
 *   --apply          set baselineResetAt = NOW(), unless already set (idempotent
 *                    no-op so a rerun can't move the boundary forward and discard
 *                    re-accumulated post-fix scrape history).
 *   --apply --force  set baselineResetAt = NOW() even if already set.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type SourceType } from "@/generated/prisma/client";
import { createScriptPool } from "./db-pool";

export interface ResetBaselineOptions {
  /** Exact `Source.name` (paired with `sourceType` for the unique key). */
  sourceName: string;
  /** `Source.type` — the other half of the `@@unique([name, type])` key. */
  sourceType: SourceType;
  /** Alert/issue number for the success log line (e.g. 2033). */
  alertNumber: number;
}

export async function runBaselineReset({ sourceName, sourceType, alertNumber }: ResetBaselineOptions): Promise<void> {
  const dryRun = !process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  let pool: ReturnType<typeof createScriptPool> | undefined;
  let prisma: PrismaClient | undefined;
  try {
    pool = createScriptPool();
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

    const source = await prisma.source.findUnique({
      where: { name_type: { name: sourceName, type: sourceType } },
      select: { id: true, name: true, url: true, baselineResetAt: true },
    });

    if (!source) {
      console.error(`❌ Source "${sourceName}" not found.`);
      process.exitCode = 1;
      return;
    }

    console.log(`Source: ${source.name} (${source.id})`);
    console.log(`  URL: ${source.url}`);
    console.log(`  Current baselineResetAt: ${source.baselineResetAt?.toISOString() ?? "null"}`);

    if (dryRun) {
      console.log("\n(dry run) re-run with --apply to set baselineResetAt = NOW().");
      return;
    }

    if (source.baselineResetAt && !force) {
      console.log(
        `\n⏭️  baselineResetAt already set (${source.baselineResetAt.toISOString()}) — no-op. ` +
          "Re-run with --force to override.",
      );
      return;
    }

    const now = new Date();
    await prisma.source.update({ where: { id: source.id }, data: { baselineResetAt: now } });
    console.log(`\n✅ Set baselineResetAt = ${now.toISOString()} on "${sourceName}".`);
    console.log(`   Alert #${alertNumber} will auto-resolve at the next scheduled scrape.`);
  } finally {
    await prisma?.$disconnect();
    await pool?.end();
  }
}
