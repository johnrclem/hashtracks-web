/**
 * One-time backfill: rewrite Kennel.description for Profile Round 11 kennels.
 *
 * The seed update branch only fills null fields (prisma/seed.ts:295-300), so
 * description rewrites on already-populated rows need an explicit UPDATE.
 * Kennels with NULL descriptions on prod (e.g. LIL) are handled by the seed
 * directly and not included here.
 *
 * Usage:
 *   npx tsx scripts/backfill-profile-r11-descriptions.ts          # dry run
 *   npx tsx scripts/backfill-profile-r11-descriptions.ts --apply  # apply
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const UPDATES: Array<{ kennelCode: string; description: string }> = [
  {
    kennelCode: "lbh-phx",
    description:
      "Phoenix weekly Monday evening hash. Part of the phoenixhhh.org collective. Hash cash is $5.",
  },
  {
    kennelCode: "lds-h3",
    description:
      "LDS H3 (Lotsa Damn Shiggy) — Salt Lake City's weekly Thursday evening hash. NOT a religious organization. Hash cash is $5.",
  },
  {
    kennelCode: "lch3",
    description:
      "Singapore's Friday hash, running every Friday since 1982. Mixed kennel that runs 50+ weeks a year, with weekly trail announcements on lioncityhhh.com — including hare, run location, nearest MRT, bus routes, and the on-on venue. Hash cash is $15 for ladies, $20 for men.",
  },
  {
    kennelCode: "mh3-tn",
    description:
      "Memphis' primary hash kennel since 1982. Saturday afternoon trails, Thursday drinking practice, and first-Friday moonlight trails. Home of the annual Dead Elvis celebration (since 1993). Hotline: 901-818-9732 option 3.",
  },
  {
    kennelCode: "madisonh3",
    description:
      "Madison's weekly Saturday hash since 1977. Run #2540+. Hash cash is $5.",
  },
];

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log(dryRun ? "DRY RUN -- no changes will be made\n" : "APPLYING changes\n");

  for (const { kennelCode, description } of UPDATES) {
    const existing = await prisma.kennel.findUnique({
      where: { kennelCode },
      select: { shortName: true, description: true },
    });
    if (!existing) {
      console.warn(`  ⚠ ${kennelCode}: not found, skipping`);
      continue;
    }
    if (existing.description === description) {
      console.log(`  = ${kennelCode} (${existing.shortName}): already current`);
      continue;
    }
    if (dryRun) {
      console.log(`  ~ ${kennelCode} (${existing.shortName}): would update`);
      console.log(`      from: ${existing.description ?? "(null)"}`);
      console.log(`      to:   ${description}`);
    } else {
      await prisma.kennel.update({ where: { kennelCode }, data: { description } });
      console.log(`  ✓ ${kennelCode} (${existing.shortName}): updated`);
    }
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
