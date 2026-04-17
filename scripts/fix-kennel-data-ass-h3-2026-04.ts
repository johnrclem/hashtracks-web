/**
 * One-shot data correction script for the ASS H3 (ass-h3) kennel.
 *
 * Adds profile fields from audit issues #728 (foundedYear), #729 (facebookUrl),
 * #730 (hashCash), and #731 (logoUrl). The seed's "fill missing" path skips
 * these when existing values are non-null in prod — this script updates them
 * directly to the seed's canonical values.
 *
 * Run after the PR merges:
 *   npx tsx scripts/fix-kennel-data-ass-h3-2026-04.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const pool = createScriptPool();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const assh3 = await prisma.kennel.update({
    where: { kennelCode: "ass-h3" },
    data: {
      foundedYear: 2018,
      hashCash: "$7",
      facebookUrl: "https://www.facebook.com/groups/ASSH3",
      logoUrl: "https://lvh3.org/wp-content/uploads/2019/03/assh3.jpg",
      website: "https://lvh3.org/vegas-hashes/atomic-shit-show-hash-house-harriers/",
    },
    select: {
      kennelCode: true,
      foundedYear: true,
      hashCash: true,
      facebookUrl: true,
      logoUrl: true,
      website: true,
    },
  });
  console.log("Updated ASS H3:", assh3);
}

async function run() {
  try {
    await main();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([prisma.$disconnect(), pool.end()]);
  }
}

void run();
