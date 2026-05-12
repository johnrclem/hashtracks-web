/**
 * One-shot data correction for Hockessin H3 (hockessin) schedule fields.
 *
 * The seed previously hardcoded summer cadence (Wednesday 6:30 PM) with a
 * comment requiring a manual flip each Nov/Mar to winter cadence (Saturday
 * 3 PM). That's a documented time-bomb — kennel directory shows the wrong
 * day/time for half the year unless someone remembers to patch and reseed.
 *
 * Hockessin's source page only has free-text "Saturdays in winter, Wednesdays
 * in summer" with no machine-readable indicator, so we can't pick at runtime.
 * Fix: null out scheduleDayOfWeek + scheduleTime and document both cadences
 * in scheduleNotes. The seed change won't clear existing values in prod
 * (fill-if-null semantics), so this script does it.
 *
 * Run after the PR merges:
 *   npx tsx scripts/fix-kennel-data-hockessin-2026-05.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const pool = createScriptPool();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const updated = await prisma.kennel.update({
    where: { kennelCode: "hockessin" },
    data: {
      scheduleDayOfWeek: null,
      scheduleTime: null,
      scheduleNotes:
        "Wednesdays 6:30 PM (summer, ~Mar–Oct); Saturdays 3 PM (winter, ~Nov–Feb). Runs in DE/MD/PA/NJ.",
    },
    select: {
      kennelCode: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
      scheduleNotes: true,
    },
  });
  console.log("Updated Hockessin H3:", updated);
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
