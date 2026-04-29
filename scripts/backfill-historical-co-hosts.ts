/**
 * Historical co-host backfill (#1023 step 6).
 *
 * Scans for known multi-kennel co-hosted events whose `EventKennel` set
 * only contains the primary kennel (missing the secondary). Inserts the
 * missing EventKennel(eventId, kennelId, isPrimary=false) rows so the
 * event surfaces on BOTH kennels' pages.
 *
 * The list of (titlePattern, requiredKennelCodes) tuples is curated by
 * hand — no fuzzy adapter heuristics. Each entry is a real-world co-host
 * relationship that's been verified to exist in production.
 *
 * Idempotent: safe to re-run. Existing EventKennel rows are kept.
 *
 * Run modes:
 *   - Dry run (default): `npx tsx scripts/backfill-historical-co-hosts.ts`
 *   - Apply:             `npx tsx scripts/backfill-historical-co-hosts.ts --apply`
 *
 * Refuses to run against any DATABASE_URL that isn't on the local-safe
 * allowlist UNLESS `--prod` is passed (production runs require explicit
 * opt-in to avoid accidentally mutating prod from a wrong shell).
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const LOCAL_DB_HOSTS = new Set([
  "localhost", "127.0.0.1", "::1", "0.0.0.0",
  "host.docker.internal", "postgres", "db",
]);

/**
 * Curated list of historical multi-kennel events. Each entry says
 * "for events on `eventDate` whose title matches `titlePattern` and primary
 * kennel is `primaryKennelCode`, add EventKennel rows for the listed
 * `coHostKennelCodes`".
 *
 * `titlePattern` is a case-insensitive substring match (NOT regex) so the
 * curation is unambiguous; if a future event needs different matching, add
 * a new entry rather than expanding this one.
 *
 * `eventDate` (YYYY-MM-DD) is REQUIRED so re-runs months from now don't
 * accidentally over-match similarly-titled future events. Per Codex review.
 *
 * `kennelCode` lookups are exact (Kennel.kennelCode is immutable).
 */
interface CoHostBackfillEntry {
  eventDate: string;             // YYYY-MM-DD — date-scopes the title match
  titlePattern: string;
  primaryKennelCode: string;
  coHostKennelCodes: string[];
  /** Free-form note for the dry-run log — explains why this entry was added. */
  note: string;
}

const BACKFILL_ENTRIES: CoHostBackfillEntry[] = [
  // ── Cherry City H3 × OH3 inaugural (#991) ──
  // The canonical case. Both kennels' calendars surfaced the trail, so prod
  // has TWO Event rows (one per primary). Each is missing the other as a
  // co-host EventKennel row; this backfill adds both. (Cross-kennel dedup
  // — collapsing the two Events into one canonical — is intentionally out
  // of scope; tracked separately in docs/roadmap.md.)
  {
    eventDate: "2025-07-12",
    titlePattern: "Cherry City H3 #1 / OH3",
    primaryKennelCode: "cch3-or",
    coHostKennelCodes: ["oh3"],
    note: "#991 Cherry City × OH3 inaugural (cch3-or primary row)",
  },
  {
    eventDate: "2025-07-12",
    titlePattern: "Cherry City H3 #1 / OH3",
    primaryKennelCode: "oh3",
    coHostKennelCodes: ["cch3-or"],
    note: "#991 Cherry City × OH3 inaugural (oh3 primary row)",
  },

  // ── Space City × Galveston H3 (recurring joint hashes) ──
  {
    eventDate: "2025-10-28",
    titlePattern: "Space City H3 #313 - Joint Trail with Galveston H3",
    primaryKennelCode: "galh3",
    coHostKennelCodes: ["space-city-h3"],
    note: "Space City × Galveston joint trail (2025-10-28)",
  },
  {
    eventDate: "2025-12-30",
    titlePattern: "Galveston H3 #297 - Joint Hash with Space City H3",
    primaryKennelCode: "galh3",
    coHostKennelCodes: ["space-city-h3"],
    note: "Galveston × Space City joint hash (2025-12-30)",
  },

  // ── Cleveland H4 × Rubber City H3 (5th-Saturday recurring tradition) ──
  // Rubber City primary, Cleveland H4 co-host
  {
    eventDate: "2026-05-30",
    titlePattern: "5th Saturday with Cleveland H4",
    primaryKennelCode: "rch3",
    coHostKennelCodes: ["cleh4"],
    note: "RCH3 × CH4 5th-Saturday joint trail (2026-05-30)",
  },
  {
    eventDate: "2023-07-29",
    titlePattern: "5th Saturday of July Trail with Cleveland H4",
    primaryKennelCode: "rch3",
    coHostKennelCodes: ["cleh4"],
    note: "RCH3 × CH4 5th-Saturday joint trail (2023-07-29)",
  },
  {
    eventDate: "2019-03-30",
    titlePattern: "Joint Cleveland Hash",
    primaryKennelCode: "rch3",
    coHostKennelCodes: ["cleh4"],
    note: "RCH3 × CH4 joint Cleveland hash (2019-03-30)",
  },
  // Cleveland H4 primary, Rubber City co-host
  {
    eventDate: "2025-12-13",
    titlePattern: "CH4 and Rubber City Christmas Trail",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 Christmas trail (2025-12-13)",
  },
  {
    eventDate: "2024-06-29",
    titlePattern: "CH4 5th Saturday with Rubber City",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 5th-Saturday (2024-06-29)",
  },
  {
    eventDate: "2023-07-29",
    titlePattern: "CH4's 5th Saturday with Rubber City",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 5th-Saturday (2023-07-29)",
  },
  {
    eventDate: "2022-07-30",
    titlePattern: "Joint Trail with Rubber City H3",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 joint trail (2022-07-30)",
  },
  {
    eventDate: "2018-09-29",
    titlePattern: "CH4 Trail #790/ Rubber City",
    primaryKennelCode: "cleh4",
    coHostKennelCodes: ["rch3"],
    note: "CH4 × RCH3 trail #790 5th-Saturday (2018-09-29)",
  },

  // ── SSH3 × SWH3 (joint trail) ──
  // SSH3 (Seattle) — kennelCode is `ssh3-wa` in the DB.
  {
    eventDate: "2026-05-16",
    titlePattern: "SSH3 #236 with SWH3",
    primaryKennelCode: "ssh3-wa",
    coHostKennelCodes: ["swh3"],
    note: "SSH3 × SWH3 joint trail (2026-05-16)",
  },
];

interface PlannedAction {
  eventId: string;
  eventDate: string;
  eventTitle: string;
  primaryKennelCode: string;
  coHostKennelCode: string;
  coHostKennelId: string;
  alreadyExists: boolean;
}

function assertLocalDbOrProdFlag(args: string[]): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  if (LOCAL_DB_HOSTS.has(host)) return;
  if (!args.includes("--prod")) {
    throw new Error(
      `Refusing to run against non-local host ${host}. Pass --prod to override (production runs).`,
    );
  }
  console.warn(`⚠️  Running against PRODUCTION host ${host} (--prod flag set).`);
}

async function planActions(): Promise<PlannedAction[]> {
  const planned: PlannedAction[] = [];

  for (const entry of BACKFILL_ENTRIES) {
    const primaryKennel = await prisma.kennel.findFirst({
      where: { kennelCode: { equals: entry.primaryKennelCode, mode: "insensitive" } },
      select: { id: true },
    });
    if (!primaryKennel) {
      console.warn(`SKIP entry ${entry.note} — primary kennel "${entry.primaryKennelCode}" not in DB`);
      continue;
    }

    // Resolve every co-host once; bail with a clear error rather than
    // silently dropping the row (curation bugs should be loud).
    const coHosts: { kennelCode: string; kennelId: string }[] = [];
    for (const coHostCode of entry.coHostKennelCodes) {
      const k = await prisma.kennel.findFirst({
        where: { kennelCode: { equals: coHostCode, mode: "insensitive" } },
        select: { id: true },
      });
      if (!k) {
        console.warn(`SKIP entry ${entry.note} — co-host kennel "${coHostCode}" not in DB`);
        coHosts.length = 0;
        break;
      }
      coHosts.push({ kennelCode: coHostCode, kennelId: k.id });
    }
    if (coHosts.length === 0) continue;

    // Events are stored at UTC noon — match the day window so a date-only
    // entry catches the row regardless of its dateUtc time-of-day.
    const dayStart = new Date(`${entry.eventDate}T00:00:00Z`);
    const dayEnd = new Date(`${entry.eventDate}T23:59:59.999Z`);
    const events = await prisma.event.findMany({
      where: {
        kennelId: primaryKennel.id,
        title: { contains: entry.titlePattern, mode: "insensitive" },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true, date: true, title: true },
    });

    for (const event of events) {
      for (const coHost of coHosts) {
        const existing = await prisma.eventKennel.findUnique({
          where: { eventId_kennelId: { eventId: event.id, kennelId: coHost.kennelId } },
          select: { isPrimary: true },
        });
        planned.push({
          eventId: event.id,
          eventDate: event.date.toISOString().slice(0, 10),
          eventTitle: event.title ?? "",
          primaryKennelCode: entry.primaryKennelCode,
          coHostKennelCode: coHost.kennelCode,
          coHostKennelId: coHost.kennelId,
          alreadyExists: existing !== null,
        });
      }
    }
  }

  return planned;
}

async function applyActions(planned: PlannedAction[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const action of planned) {
    if (action.alreadyExists) {
      skipped++;
      continue;
    }
    // Use upsert defensively in case the row appeared between plan + apply
    // (long-running script, concurrent dual-write from a fresh scrape).
    await prisma.eventKennel.upsert({
      where: { eventId_kennelId: { eventId: action.eventId, kennelId: action.coHostKennelId } },
      create: {
        eventId: action.eventId,
        kennelId: action.coHostKennelId,
        isPrimary: false,
      },
      update: {}, // keep existing isPrimary state if any (won't demote a primary)
    });
    inserted++;
  }
  return { inserted, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  assertLocalDbOrProdFlag(args);
  const apply = args.includes("--apply");

  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN (pass --apply to write)"}`);
  console.log(`Curated entries: ${BACKFILL_ENTRIES.length}`);

  const planned = await planActions();
  console.log(`\nPlanned actions: ${planned.length}`);
  for (const p of planned) {
    const tag = p.alreadyExists ? "EXISTS" : "INSERT";
    console.log(
      `  [${tag}] ${p.eventDate} ${p.eventId} (${p.primaryKennelCode} primary) +co-host ${p.coHostKennelCode}`,
    );
    console.log(`           "${p.eventTitle}"`);
  }

  if (!apply) {
    const insertCount = planned.filter((p) => !p.alreadyExists).length;
    const existsCount = planned.length - insertCount;
    console.log(`\nDry-run summary: would insert ${insertCount}, ${existsCount} already exist.`);
    return;
  }

  const { inserted, skipped } = await applyActions(planned);
  console.log(`\nApplied: inserted ${inserted}, skipped ${skipped} (already existed).`);
}

main()
  .catch((err) => {
    console.error("\nBackfill failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
