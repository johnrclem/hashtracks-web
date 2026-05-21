/**
 * One-shot data correction for KLFMH3 (#1538) + KFMH3 (#1528) profile fields
 * that seed-merge won't fix (seed only fills NULL fields, not overrides).
 *
 * - klfmh3: description and scheduleNotes both said "night closest to the
 *   full moon" — the kennel's About page explicitly says "Sunday closest
 *   to the Full Moon", and every event on the hareline lands on a Sunday.
 * - kfmh3: website pointed at `https://kfmh3.github.io/Home` (no trailing
 *   slash) which GitHub Pages serves OK in browsers but is the form the
 *   audit issue flagged as inconsistent with the working canonical URL
 *   (`/Home/`).
 *
 * The companion seed change adds new NULL fields (klfmh3.founder,
 * klfmh3.logoUrl, kfmh3.logoUrl) which seed-merge will handle on its own.
 *
 * Run after the PR merges:
 *   npx tsx scripts/fix-kennel-data-klfmh3-kfmh3-2026-05.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const pool = createScriptPool();
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const klfmh3 = await prisma.kennel.update({
    where: { kennelCode: "klfmh3" },
    data: {
      founder: "Chuck 'Titanic' Pollock",
      logoUrl: "https://klfullmoonhash.com/klfm_images/icon-klfm.png",
      // "Varies" rendered as "Variess" via formatSchedule's blind +"s" and
      // also leaked into the day filter via collectKennelWeekdays. The
      // kennel's own About page says runs are on the Sunday closest to the
      // full moon, and every hareline row lands on a Sunday.
      scheduleDayOfWeek: "Sunday",
      scheduleNotes:
        "Runs once per lunar month on the Sunday closest to the full moon. Hareline at klfullmoonhash.com/index.php?r=site/hareline.",
      description:
        "Founded 11 September 1992 in Kuala Lumpur by Chuck 'Titanic' Pollock. A monthly full-moon hash — runs are scheduled on the Sunday closest to the full moon rather than a fixed weekday. Approximately 144 runs since founding.",
    },
    select: {
      kennelCode: true,
      founder: true,
      logoUrl: true,
      scheduleDayOfWeek: true,
      scheduleNotes: true,
      description: true,
    },
  });
  console.log("Updated KLFMH3:", klfmh3);

  const kfmh3 = await prisma.kennel.update({
    where: { kennelCode: "kfmh3" },
    data: {
      website: "https://kfmh3.github.io/Home/",
      logoUrl: "https://kfmh3.github.io/Home/KFMH3.GIF",
    },
    select: { kennelCode: true, website: true, logoUrl: true },
  });
  console.log("Updated KFMH3:", kfmh3);
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
