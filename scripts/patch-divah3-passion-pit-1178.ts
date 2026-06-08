/**
 * One-shot patch for issue #1178 — DivaH3 Mar 13 2026 missing hares.
 *
 * The DivaH3 page labels the hare row "Hostess and hare: Passion Pit", which
 * the EH3 adapter's hare matcher didn't recognize (it only matched "Hare(s):"),
 * so the Friday March 13, 2026 event ("Divas jump into Spring a bit early")
 * stored no hares. The adapter fix in this PR adds the hostess/host variants,
 * but March 13 is now in the past and won't be re-scraped — this patches the
 * stored row in place.
 *
 * Signature-pinned (re-runnable): kennel divah3-eh3, the March 13/14 2026 event
 * with an empty haresText. Once haresText is set the row no longer matches.
 *
 * Run:
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/patch-divah3-passion-pit-1178.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/patch-divah3-passion-pit-1178.ts --apply
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const HARE = "Passion Pit";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "✏️  APPLYING changes" : "🔍 DRY RUN — no changes will be made");

  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: "divah3-eh3" },
      select: { id: true },
    });
    if (!kennel) {
      console.log('Kennel "divah3-eh3" not found — nothing to do.');
      return;
    }

    // The event is stored as UTC noon-ish for the Mar 13 local date; match the
    // calendar window Mar 13–14 to be robust to the stored TZ offset.
    const events = await prisma.event.findMany({
      where: {
        kennelId: kennel.id,
        date: { gte: new Date("2026-03-13T00:00:00Z"), lt: new Date("2026-03-15T00:00:00Z") },
        OR: [{ haresText: null }, { haresText: "" }],
      },
      select: { id: true, date: true, title: true, haresText: true },
    });
    console.log(`Matched ${events.length} DivaH3 event(s) with empty hares in the Mar 13 window.`);
    for (const e of events) {
      console.log(`  PATCH  ${e.id}  ${e.date.toISOString().slice(0, 10)}  ${JSON.stringify(e.title)}  haresText → ${JSON.stringify(HARE)}`);
    }

    if (apply && events.length > 0) {
      for (const e of events) {
        await prisma.event.update({ where: { id: e.id }, data: { haresText: HARE } });
      }
      console.log(`\n✓ Patched ${events.length} event(s).`);
    } else if (!apply) {
      console.log("\nRun with --apply to commit changes.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
