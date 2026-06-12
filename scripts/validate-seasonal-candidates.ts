/**
 * Read-only seasonal-switcher validation for candidate kennels (Travel Mode prediction quality).
 *
 * For each kennel code, pulls ~2yr of INDEPENDENT (non-STATIC_SCHEDULE) confirmed events from prod
 * and reports the dominant weekday in CORE summer (May–Aug) vs CORE winter (Nov–Feb), skipping the
 * shoulder months where the switch blurs. A clear summer≠winter dominant (both ≥60% share, ≥3 ev)
 * confirms a seasonal switch worth a two-slot scheduleRules[].
 *
 * Usage: npx tsx scripts/validate-seasonal-candidates.ts <kennelCode> [<kennelCode> ...]
 *   e.g. npx tsx scripts/validate-seasonal-candidates.ts boh3 ch3-dk swh3
 *
 * Run it on any kennel the weekly rule-drift check flags before authoring a seasonal
 * scheduleRules[] — confirms the summer/winter weekday split with real data.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import { EVENT_ELIGIBILITY_SELECT, isEligibleActual } from "@/lib/event-eligibility";

const CANDIDATES = process.argv.slice(2);
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 24 * 60 * 60 * 1000;
const CORE_SUMMER = [4, 5, 6, 7]; // May–Aug
const CORE_WINTER = [10, 11, 0, 1]; // Nov–Feb

function dominant(dates: Date[]): { day: number; share: number; n: number } {
  if (dates.length === 0) return { day: -1, share: 0, n: 0 };
  const hist = new Array(7).fill(0);
  for (const d of dates) hist[d.getUTCDay()]++;
  let day = 0;
  for (let i = 1; i < 7; i++) if (hist[i] > hist[day]) day = i;
  return { day, share: hist[day] / dates.length, n: dates.length };
}

async function run(prisma: PrismaClient): Promise<void> {
  const since = new Date(Date.now() - 730 * DAY_MS);
  for (const code of CANDIDATES) {
    const kennel = await prisma.kennel.findFirst({ where: { kennelCode: code }, select: { id: true, shortName: true } });
    if (!kennel) {
      console.log(`\n${code}: NOT FOUND`);
      continue;
    }
    const events = await prisma.event.findMany({
      where: {
        ...CANONICAL_EVENT_WHERE,
        status: "CONFIRMED",
        date: { gte: since },
        OR: [{ kennelId: kennel.id }, { eventKennels: { some: { kennelId: kennel.id } } }],
      },
      select: { date: true, ...EVENT_ELIGIBILITY_SELECT },
      orderBy: { date: "asc" },
    });
    const indep = events.filter((e) => isEligibleActual(e)).map((e) => e.date);
    const summer = indep.filter((d) => CORE_SUMMER.includes(d.getUTCMonth()));
    const winter = indep.filter((d) => CORE_WINTER.includes(d.getUTCMonth()));
    const s = dominant(summer);
    const w = dominant(winter);
    const seasonal = s.day !== w.day && s.share >= 0.6 && w.share >= 0.6 && s.n >= 3 && w.n >= 3;
    const fmt = (x: { day: number; share: number; n: number }) =>
      x.n === 0 ? "—" : `${DAY[x.day]} ${Math.round(x.share * 100)}% (${x.n}ev)`;
    console.log(
      `\n${code} (${kennel.shortName}) — ${indep.length} indep events / 2yr` +
        `\n  core-summer: ${fmt(s)}   core-winter: ${fmt(w)}   → ${seasonal ? "SEASONAL ✓" : "not a clear switch"}`,
    );
  }
}

async function main(): Promise<void> {
  if (CANDIDATES.length === 0) {
    console.error("Usage: npx tsx scripts/validate-seasonal-candidates.ts <kennelCode> [<kennelCode> ...]");
    process.exitCode = 1;
    return;
  }
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    await run(prisma);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

void main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
