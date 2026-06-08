/**
 * One-shot: set `Source.baselineResetAt = NOW()` on "DH4 Google Calendar" to
 * resolve the FIELD_FILL_DROP hares alert (#2033).
 *
 * Verdict B — metric false-positive, NOT a real regression. PR #2032 (#2000)
 * stopped promoting `(Run/Walk)`-style event-type parentheticals from the title
 * into `haresText`. DH4's calendar titles future placeholder runs as
 * `"DH4 #NNNN Hash Event (Run/Walk)"`; pre-#2000 each of those counted
 * `"Run/Walk"` as a filled hare, inflating the rolling baseline to 91%.
 *
 * Prod evidence (80 most-recent DH4 RawEvents): 0 `(Run/Walk)` garbage remains;
 * 44/80 = 55% carry real hare names ("Dah Gimp", "Noodle", …), all intact; the
 * 36 nulls are genuine no-hare rows (future unannounced runs + non-trail social
 * events like "Drinking Practice"). DH4's real hares come from the GCal
 * description `Hares:` label, never a title parenthetical, so the #2000 strip
 * cannot — and did not — nuke a real hare. 55% is the honest rate.
 *
 * This is a textbook `baselineResetAt` case (see `prisma/schema.prisma:217`
 * and `src/pipeline/health.ts:397-399`). Setting the boundary to NOW cuts the
 * rolling baseline so the next scrape sees no prior rows in window and the
 * FIELD_FILL_DROP comparison short-circuits. The baseline then re-accumulates
 * around the honest post-#2000 rate. We do NOT inject synthesized hare
 * fallbacks — `computeFillRates` runs on `RawEventData` pre-merge
 * (`src/pipeline/fill-rates.ts`), so padding it would permanently blind the
 * raw-layer metric to future real source regressions.
 *
 * Usage:
 *   npx tsx scripts/reset-dh4-hares-baseline.ts           # dry run (default)
 *   npx tsx scripts/reset-dh4-hares-baseline.ts --apply   # apply against prod
 *   npx tsx scripts/reset-dh4-hares-baseline.ts --apply --force  # re-set even if already set
 *
 * Idempotent: a plain `--apply` no-ops when `baselineResetAt` is already set, so
 * a rerun after the baseline has re-accumulated post-fix scrape history can't
 * move the boundary forward and discard that history. Use `--force` to override.
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, SourceType } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");
const force = process.argv.includes("--force");
const SOURCE_NAME = "DH4 Google Calendar";

async function main() {
  let pool: ReturnType<typeof createScriptPool> | undefined;
  try {
    pool = createScriptPool();
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

    const source = await prisma.source.findUnique({
      where: { name_type: { name: SOURCE_NAME, type: SourceType.GOOGLE_CALENDAR } },
      select: { id: true, name: true, url: true, baselineResetAt: true },
    });

    if (!source) {
      console.error(`❌ Source "${SOURCE_NAME}" not found.`);
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
    await prisma.source.update({
      where: { id: source.id },
      data: { baselineResetAt: now },
    });
    console.log(`\n✅ Set baselineResetAt = ${now.toISOString()} on "${SOURCE_NAME}".`);
    console.log("   Alert #2033 will auto-resolve at the next scheduled scrape.");
  } finally {
    await pool?.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
