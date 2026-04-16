/**
 * One-shot data correction script for the Berlin Full Moon (bh3fm) kennel.
 *
 * Adds profile fields from audit issues #745 (logo), #746 (facebook + mailing
 * list), and #747 (founded year + richer description). The seed's
 * "fill missing" path skips these because some of them may already be non-null
 * (description) in prod — this script updates them directly to the seed's
 * canonical values.
 *
 * Run after the PR merges:
 *   npx tsx scripts/fix-kennel-data-bh3fm-2026-04.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const pool = createScriptPool();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const bh3fm = await prisma.kennel.update({
    where: { kennelCode: "bh3fm" },
    data: {
      hashCash: "€5",
      foundedYear: 1979,
      facebookUrl: "https://de-de.facebook.com/BerlinHashHouseHarriers/",
      mailingListUrl: "https://list.berlin-h3.eu/subscription/form",
      logoUrl: "https://www.berlin-h3.eu/wp-content/uploads/2020/05/bh3Logo.png",
      description:
        "Berlin's monthly full moon hash. A drinking club with a running problem — since 1979.",
    },
    select: {
      kennelCode: true,
      hashCash: true,
      foundedYear: true,
      facebookUrl: true,
      mailingListUrl: true,
      logoUrl: true,
      description: true,
    },
  });
  console.log("Updated BH3FM:", bh3fm);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
