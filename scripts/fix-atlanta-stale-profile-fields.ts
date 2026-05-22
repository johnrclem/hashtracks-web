/**
 * Post-merge data fix for PR #1622 Atlanta cluster.
 *
 * `npx prisma db seed` only fills NULL profile fields (memory
 * `feedback_seed_fill_coverage_check`). Several profile-bundle issues
 * (#1572, #1585, #1582, #1589) required updating fields that already had
 * stale non-null values on prod — those would be silently skipped by seed.
 *
 * This script force-overwrites those specific fields. Each UPDATE is
 * idempotent: re-running is a no-op (Prisma generates a no-op SQL when
 * the desired value matches stored).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/fix-atlanta-stale-profile-fields.ts
 *   Apply:    APPLY=1 npx tsx scripts/fix-atlanta-stale-profile-fields.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

interface FieldUpdate {
  kennelCode: string;
  field: "scheduleTime" | "scheduleNotes" | "description";
  expectStale: string;
  setTo: string;
  issue: string;
}

const UPDATES: FieldUpdate[] = [
  // #1572 Black Sheep
  {
    kennelCode: "bsh3", field: "scheduleTime",
    expectStale: "1:30 PM", setTo: "1:00 PM", issue: "#1572",
  },
  {
    kennelCode: "bsh3", field: "description",
    expectStale: "Alternate Sunday runs in Atlanta.",
    setTo:
      "Alternate Sunday high-shiggy trails in Atlanta — also known as Rainbow Sheep, where any color of the rainbow is fine as long as it's black. Come for the shiggy; stay for more shiggy. Hash cash $10.",
    issue: "#1572",
  },

  // #1589 MLH4
  {
    kennelCode: "mlh4", field: "scheduleTime",
    expectStale: "7:00 PM", setTo: "7:25 PM", issue: "#1589",
  },
  {
    kennelCode: "mlh4", field: "description",
    expectStale: "Weekly Monday evening trail runs in Atlanta.",
    setTo:
      "Monday evenings under the moonlight in Atlanta. Typically an A-to-A trail of four-ish miles, ending at a bar or restaurant that will put up with us on a Monday.",
    issue: "#1589",
  },

  // #1585 HMH3
  {
    kennelCode: "hmh3", field: "scheduleNotes",
    expectStale: "1st Sunday, 1:30 PM.",
    setTo: "1st (occasionally 2nd) Sunday of the month.",
    issue: "#1585",
  },
  {
    kennelCode: "hmh3", field: "description",
    expectStale: "Monthly Sunday runs in the north Georgia foothills.",
    setTo: "Monthly Sunday trails in the north Georgia foothills outside Atlanta.",
    issue: "#1585",
  },

  // #1582 CUNT H3 ATL — only scheduleNotes needs updating; description is
  // already correct (Gemini PR #1629 review: dropped the no-op description
  // entry that was an artifact of copying the structure from other kennels).
  {
    kennelCode: "cunth3-atl", field: "scheduleNotes",
    expectStale: "1st Tuesday, 7:00 PM.",
    setTo: "1st Tuesday of the month.",
    issue: "#1582",
  },
];

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (writing to prod)" : "DRY RUN"}`);
  console.log(`Plan: ${UPDATES.length} field updates across ${new Set(UPDATES.map((u) => u.kennelCode)).size} kennels.\n`);

  for (const u of UPDATES) {
    const k = await prisma.kennel.findUnique({
      where: { kennelCode: u.kennelCode },
      select: { id: true, shortName: true, [u.field]: true } as never,
    }) as { id: string; shortName: string; [k: string]: string | null } | null;

    if (!k) {
      console.warn(`  ✗ ${u.kennelCode} not found — skipping`);
      continue;
    }
    const current = k[u.field] ?? "(null)";
    if (current === u.setTo) {
      console.log(`  · ${u.kennelCode}.${u.field} (${u.issue}): already correct — no-op`);
      continue;
    }
    if (current !== u.expectStale) {
      console.warn(
        `  ⚠ ${u.kennelCode}.${u.field} (${u.issue}): stored value diverges from expected stale value\n` +
          `      expected stale: ${JSON.stringify(u.expectStale)}\n` +
          `      stored:         ${JSON.stringify(current)}\n` +
          `      → refusing to overwrite (drift between issue body and prod). Investigate before forcing.`,
      );
      continue;
    }

    console.log(`  ${apply ? "✓" : "→"} ${u.kennelCode}.${u.field} (${u.issue}): ${JSON.stringify(current)} → ${JSON.stringify(u.setTo)}`);
    if (apply) {
      await prisma.kennel.update({
        where: { id: k.id },
        data: { [u.field]: u.setTo },
      });
    }
  }

  if (!apply) console.log("\nRe-run with APPLY=1 to write to prod.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
