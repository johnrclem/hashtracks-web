/**
 * One-shot link for issue #1681 — BAWC5 (Bay Area Weekend Camping) 2026
 * umbrella has Marin H3 #292 unlinked.
 *
 * Background (per #1681): post-merge of PR D (#1667), the BAWC5 weekend
 * June 19–21 renders as a series parent on SFH3 with SVH3 (Sat) and
 * EBH3 (Sun) children linked. Marin H3 #292 (Saturday 6/20) should
 * also be a child, but SFH3's iCal feed dropped `/runs/6449` after the
 * 2026-05-11 scrape. Marin's stale RawEvent has `seriesId: null`, the
 * trail isn't being re-emitted, so the merge pipeline's
 * `linkMultiDaySeries` never refreshes the parent link.
 *
 * Fix: find the BAWC5 umbrella Event and the Marin #292 Event; set
 * `parentEventId` on Marin to point at the umbrella.
 *
 * Safety:
 *   - Dry-run by default; pass `--apply` to actually update.
 *   - Idempotent: re-runs find Marin already linked and exit cleanly.
 *   - Exits with informative message (non-zero) if either anchor row
 *     isn't found, so the operator notices the schema/data drift
 *     instead of silently no-opping.
 *
 * Run:
 *   tsx scripts/cleanup-bawc5-marin-orphan.ts          # dry-run
 *   tsx scripts/cleanup-bawc5-marin-orphan.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const SFH3_CODE = "sfh3";
const MARIN_CODE = "marinh3";
const UMBRELLA_DATE_LO = new Date("2026-06-19T00:00:00Z");
const UMBRELLA_DATE_HI = new Date("2026-06-21T23:59:59Z");
const MARIN_RUN_NUMBER = 292;
const MARIN_DATE = new Date("2026-06-20T12:00:00Z");

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (will UPDATE parentEventId)" : "DRY-RUN"}`);

  const [sfh3Kennel, marinKennel] = await Promise.all([
    prisma.kennel.findUnique({ where: { kennelCode: SFH3_CODE }, select: { id: true } }),
    prisma.kennel.findUnique({ where: { kennelCode: MARIN_CODE }, select: { id: true } }),
  ]);
  if (!sfh3Kennel || !marinKennel) {
    console.error(`Anchor kennel(s) missing: sfh3=${!!sfh3Kennel} marinh3=${!!marinKennel}`);
    process.exitCode = 1;
    return;
  }

  // findMany + exactly-one check (instead of findFirst) — Prisma's findFirst
  // doesn't guarantee deterministic ordering without an orderBy, so on the
  // off chance the predicate matched 2+ rows we'd silently bind to whichever
  // one happened to come first. For a write script, fail closed when the
  // anchor isn't unambiguous. CodeRabbit review on this PR.
  const umbrellas = await prisma.event.findMany({
    where: {
      kennelId: sfh3Kennel.id,
      isSeriesParent: true,
      date: { gte: UMBRELLA_DATE_LO, lte: UMBRELLA_DATE_HI },
    },
    select: { id: true, title: true, date: true },
  });
  if (umbrellas.length !== 1) {
    console.error(
      `Expected exactly 1 BAWC5 umbrella Event in SFH3 between ${UMBRELLA_DATE_LO.toISOString()} and ${UMBRELLA_DATE_HI.toISOString()}, found ${umbrellas.length}. Aborting.`,
    );
    if (umbrellas.length > 1) {
      for (const u of umbrellas) {
        console.error(`  candidate: ${u.id}  ${u.date.toISOString().slice(0, 10)}  ${JSON.stringify(u.title)}`);
      }
    }
    process.exitCode = 1;
    return;
  }
  const umbrella = umbrellas[0];
  console.log(`Umbrella: ${umbrella.id}  ${umbrella.date.toISOString().slice(0, 10)}  ${JSON.stringify(umbrella.title)}`);

  // Marin #292 on 2026-06-20. Strict (kennelId + runNumber + exact date)
  // match — no date-window fallback, fail closed when not exactly one row
  // matches (a write script should never auto-pick from an ambiguous set).
  const marinDateEnd = new Date(MARIN_DATE.getTime() + 86_400_000 - 1);
  const marins = await prisma.event.findMany({
    where: {
      kennelId: marinKennel.id,
      runNumber: MARIN_RUN_NUMBER,
      date: { gte: MARIN_DATE, lte: marinDateEnd },
    },
    select: { id: true, title: true, date: true, parentEventId: true, runNumber: true },
  });
  if (marins.length !== 1) {
    console.error(
      `Expected exactly 1 Marin H3 #${MARIN_RUN_NUMBER} Event on ${MARIN_DATE.toISOString().slice(0, 10)}, found ${marins.length}. ` +
        "Refusing to auto-pick. Investigate manually (RawEvent state, possible kennel rename) and re-run with the correct anchor.",
    );
    if (marins.length > 1) {
      for (const m of marins) {
        console.error(`  candidate: ${m.id}  ${m.date.toISOString().slice(0, 10)}  ${JSON.stringify(m.title)}  parent=${m.parentEventId}`);
      }
    }
    process.exitCode = 1;
    return;
  }
  const marin = marins[0];
  console.log(`Marin:    ${marin.id}  ${marin.date.toISOString().slice(0, 10)}  runNumber=${marin.runNumber}  title=${JSON.stringify(marin.title)}  parentEventId=${marin.parentEventId}`);

  if (marin.parentEventId === umbrella.id) {
    console.log("\nMarin already linked to BAWC5 umbrella — nothing to do.");
    return;
  }
  if (marin.parentEventId && marin.parentEventId !== umbrella.id) {
    console.error(`Marin is linked to a DIFFERENT parent (${marin.parentEventId}). Refusing to overwrite — investigate manually.`);
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log(`\nDRY-RUN: would set parentEventId=${umbrella.id} on Marin Event ${marin.id}`);
    return;
  }

  await prisma.event.update({
    where: { id: marin.id },
    data: { parentEventId: umbrella.id, isSeriesParent: false },
  });
  console.log(`\nLinked Marin H3 #292 (${marin.id}) → BAWC5 umbrella (${umbrella.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
