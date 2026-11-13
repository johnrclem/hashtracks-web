/**
 * Kennel Status 1 — hand-review list. READ-ONLY.
 *
 * Lists every visible kennel that TODAY's rule calls active but that would not
 * be "running" under runningKennelWhere (src/lib/kennel-status.ts). The owner
 * checks these by hand and records dated confirmations / stops in /admin/kennels.
 *
 * Today's (old) rule is inlined on purpose: src/lib/activity-status.ts is
 * deleted in PR B. Old rule = visible AND (lastEventDate >= today-89d at UTC noon
 * OR an upcoming CONFIRMED canonical event, incl. co-hosted via EventKennel).
 *
 * Refuses to run (exit 1) while no Event has isScheduleOnly=true, i.e. before
 * the first nightly evidence refresh.
 *
 * Usage:
 *   npx tsx scripts/kennel-status-review.ts [--now YYYY-MM-DD]
 * Against production add BACKFILL_ALLOW_SELF_SIGNED_CERT=1 (a read).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { runningKennelWhere } from "@/lib/kennel-status";

const DAY_MS = 24 * 60 * 60 * 1000;
const OLD_RULE_DAYS = 89;
const SITE = "https://www.hashtracks.xyz";

function parseNow(argv: string[]): Date {
  const i = argv.indexOf("--now");
  if (i === -1) return new Date();
  const raw = argv[i + 1];
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error("--now requires a YYYY-MM-DD value");
  }
  const d = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid --now date: ${raw}`);
  return d;
}

const day = (d: Date | null): string => (d ? d.toISOString().slice(0, 10) : "-");
const cell = (s: string | null | undefined): string =>
  (s ?? "-").replaceAll("|", "\\|").replaceAll("\n", " ");

async function run(prisma: PrismaClient, now: Date): Promise<void> {
  // Before the first evidence refresh no event is flagged schedule-only, so
  // generated runs still count as runs and this list would be wrong.
  const flagged = await prisma.event.findFirst({
    where: { isScheduleOnly: true },
    select: { id: true },
  });
  if (!flagged) {
    console.error(
      "No event is flagged schedule-only yet, so the evidence refresh has not run. " +
        "Wait for the first nightly refresh (the 12:00 UTC audit), then run this again.",
    );
    process.exitCode = 1;
    return;
  }

  const todayNoon = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12),
  );
  const cutoff = new Date(todayNoon.getTime() - OLD_RULE_DAYS * DAY_MS);

  console.log(`# Kennel status hand-review list\n`);
  console.log(`now used: ${now.toISOString()} (old-rule lastEventDate cutoff ${day(cutoff)})\n`);

  // Subtract in JS rather than NOT(runningKennelWhere): SQL NOT over nullable
  // evidence columns yields NULL and would silently drop kennels.
  const running = await prisma.kennel.findMany({
    where: runningKennelWhere(now),
    select: { id: true },
  });
  const runningIds = new Set(running.map((k) => k.id));

  const candidates = await prisma.kennel.findMany({
    where: {
      isHidden: false,
      OR: [
        { lastEventDate: { gte: cutoff } },
        {
          eventKennels: {
            some: {
              event: {
                isCanonical: true,
                status: "CONFIRMED",
                date: { gte: todayNoon },
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      shortName: true,
      slug: true,
      region: true,
      lastEventDate: true,
      lastRunSeenAt: true,
      website: true,
      facebookUrl: true,
      sources: { select: { source: { select: { type: true, enabled: true } } } },
    },
    orderBy: [{ region: "asc" }, { shortName: "asc" }],
  });

  const kennels = candidates.filter((k) => !runningIds.has(k.id));

  console.log(
    "| Kennel | Region | lastEventDate | lastRunSeenAt | Source types | Website | Facebook | Admin |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const k of kennels) {
    const types = [
      ...new Set(
        k.sources.map((s) => `${s.source.type}${s.source.enabled ? "" : " (disabled)"}`),
      ),
    ]
      .sort((a, b) => a.localeCompare(b))
      .join(", ");
    console.log(
      `| ${cell(k.shortName)} | ${cell(k.region)} | ${day(k.lastEventDate)} | ${day(k.lastRunSeenAt)} | ${cell(types || null)} | ${cell(k.website)} | ${cell(k.facebookUrl)} | [admin](${SITE}/admin/kennels) / [page](${SITE}/kennels/${k.slug}) |`,
    );
  }
  console.log(`\n${kennels.length} visible kennels active under today's rule but not running under the new one.`);
}

async function main(): Promise<void> {
  const now = parseNow(process.argv.slice(2));
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await run(prisma, now);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
