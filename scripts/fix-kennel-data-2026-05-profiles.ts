/**
 * One-shot data correction for the May 2026 kennel profile audit sweep.
 *
 * Updates description fields that the seed's "fill missing" path cannot
 * correct because the DB already has stale or factually-wrong values set.
 * Strings here MUST stay in sync with prisma/seed-data/kennels.ts.
 *
 * Addresses: #1204 (H5 — description expansion), #1226 (Gold Coast H3 —
 * description correction: was "mixed", should be men's-only; was
 * "approaching Run #2500", already past it).
 *
 * Run after the PR merges:
 *   npx tsx scripts/fix-kennel-data-2026-05-profiles.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const pool = createScriptPool();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const h5 = await prisma.kennel.update({
    where: { kennelCode: "h5-hash" },
    data: {
      description:
        "Harrisburg/Hershey biweekly hash since March 1997. A drinking club with a running problem.",
    },
    select: { kennelCode: true, description: true },
  });
  console.log("Updated H5:", h5);

  const goldCoast = await prisma.kennel.update({
    where: { kennelCode: "gch3-au" },
    data: {
      description:
        "The Gourmet Hash — Gold Coast's men-only Hash kennel in Queensland, established 1978. Runs every Monday night, wet or fine, starting at 6:00 pm.",
    },
    select: { kennelCode: true, description: true },
  });
  console.log("Updated Gold Coast H3:", goldCoast);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
