/**
 * One-shot: set `Source.baselineResetAt = NOW()` on "IH3 Website Hareline" to
 * resolve the FIELD_FILL_DROP title alert (#1385).
 *
 * PR #1379 intentionally dropped the unconditional `title: "IH3 #N"` placeholder
 * so that `merge.ts` synthesizes `"Ithaca H3 Trail #N"` via `friendlyKennelName`.
 * After deploy, only 1 of 7 events carries a published source title (e.g.
 * `"RAINBOW DRESS RUN"`), and `fill-rates.ts` — which measures
 * `RawEventData.title` *before* merge — drops to 14%. User-visible `Event.title`
 * is unaffected.
 *
 * This is a textbook `baselineResetAt` case (see `prisma/schema.prisma:205-210`
 * and `src/pipeline/health.ts:397-399`). Setting the boundary to NOW cuts the
 * rolling baseline so the next scrape sees no prior rows in window and the
 * FIELD_FILL_DROP comparison short-circuits. The baseline then re-accumulates
 * around the honest post-#1379 rate.
 *
 * Usage:
 *   npx tsx scripts/reset-ih3-title-baseline.ts           # dry run (default)
 *   npx tsx scripts/reset-ih3-title-baseline.ts --apply   # apply against prod
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");
const SOURCE_NAME = "IH3 Website Hareline";

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  try {
    console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

    const source = await prisma.source.findFirst({
      where: { name: SOURCE_NAME, type: "HTML_SCRAPER" },
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

    const now = new Date();
    await prisma.source.update({
      where: { id: source.id },
      data: { baselineResetAt: now },
    });
    console.log(`\n✅ Set baselineResetAt = ${now.toISOString()} on "${SOURCE_NAME}".`);
    console.log("   Alert #1385 will auto-resolve at the next scheduled scrape.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
