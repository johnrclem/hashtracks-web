/**
 * One-shot data correction script for April 2026 kennel audit findings.
 *
 * Fixes wrong-value fields that the seed's "fill missing" path cannot correct
 * because the DB already has stale values set.
 *
 * Addresses: #694, #692, #635
 *
 * Run: npx tsx scripts/fix-kennel-data-2026-04.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const pool = createScriptPool();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  // BCH3: fix schedule (Thursday biweekly → Friday weekly) and dead Facebook link
  const bch3 = await prisma.kennel.update({
    where: { kennelCode: "bch3" },
    data: {
      scheduleDayOfWeek: "Friday",
      scheduleFrequency: "Weekly",
      facebookUrl: "https://www.facebook.com/groups/BrewCityH3/",
      description: "Milwaukee's weekly Friday evening hash. Trail #359+.",
    },
    select: { kennelCode: true, scheduleDayOfWeek: true, scheduleFrequency: true, facebookUrl: true },
  });
  console.log("Updated BCH3:", bch3);

  // Atlanta H4: remove dead Facebook link and clean description
  const ah4 = await prisma.kennel.update({
    where: { kennelCode: "ah4" },
    data: {
      facebookUrl: null,
      description: "Atlanta's original hash. Weekly Saturday runs.",
    },
    select: { kennelCode: true, facebookUrl: true, description: true },
  });
  console.log("Updated AH4:", ah4);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
