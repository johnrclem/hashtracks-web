/**
 * One-shot HEAL for the Amsterdam H3 "NO RUN TODAY" contamination (#1799-followup).
 *
 * Unlike the Hibiscus phantom (a standalone bogus Event removed wholesale by
 * `scripts/lib/cleanup-phantom-event.ts`), this is a REAL trail whose display
 * fields were overwritten:
 *
 *   Run #1478 "Tulip Hash" (Station Almere, 2026-04-18) was scraped cleanly 4×
 *   from ah3.nl/nextruns/. On/after run-day the site flipped to a bare
 *   "NO RUN TODAY" placeholder; the adapter mis-dated it onto #1478's date, so
 *   it merged into the same canonical (same kennel+date). All raws share the
 *   source's trust (7), so the merge UPDATE path let the latest placeholder
 *   scrapes stomp the canonical's title/locationName/haresText/description.
 *
 *   The live site no longer serves #1478, so a re-scrape cannot heal it.
 *   Deleting the Event would erase the real trail — so we HEAL in place:
 *   delete the "NO RUN TODAY" raws and restore the canonical's fields from the
 *   most-complete surviving "Tulip Hash" raw.
 *
 * The seed `silentlySkipPatterns` rule (^NO RUN TODAY$ on title) prevents
 * re-ingest going forward; this script repairs the already-persisted damage.
 *
 * Safety (mirrors scripts/lib/cleanup-phantom-event.ts):
 *   - Drift guard: refuses unless the Event still shows "NO RUN TODAY" (no-op if
 *     already healed → idempotent, exit 0).
 *   - Stray guard: every "NO RUN TODAY"-titled raw on the source must be linked
 *     to the target Event; fails closed otherwise.
 *   - Hard-deletes only the placeholder raws (so they can't re-merge), patches
 *     only the stomped display fields, in one transaction. Post-check verifies.
 *   - Dry run unless CLEANUP_APPLY=1.
 *
 * Usage:
 *   Dry run: npx tsx scripts/heal-amsterdam-no-run.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/heal-amsterdam-no-run.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const LOG_PREFIX = "heal-amsterdam";
const ISSUE = 1799;
const SOURCE_NAME = "Amsterdam H3 Website";
const EVENT_ID = "cmnev4goe001a04l8lu3ml2zk";
const CONTAMINATED_TITLE = "NO RUN TODAY";

/** Matches the placeholder-titled raws: bare "NO RUN TODAY" + the run-day "AH3 #1478 — NO RUN TODAY". */
const PHANTOM_TITLE_RE = /^(?:AH3\s*#\s*\d+\s*[—–-]\s*)?NO RUN TODAY\b/i;
/** Strips the "AH3 #1478 — " run prefix so the healed title matches sibling display format. */
const RUN_PREFIX_RE = /^AH3\s*#\s*\d+\s*[—–-]\s*/i;

const log = (m: string) => console.log(`[${LOG_PREFIX}] ${m}`);

interface RawRow {
  id: string;
  eventId: string | null;
  scrapedAt: Date;
  rawData: unknown;
}

function rawField(rawData: unknown, key: string): string | null {
  if (!rawData || typeof rawData !== "object") return null;
  const v = (rawData as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isPhantomRaw(rawData: unknown): boolean {
  const title = rawField(rawData, "title");
  return title != null && PHANTOM_TITLE_RE.test(title);
}

/** Completeness rank for choosing the heal-source raw (location > hares > description, newest breaks ties). */
function completeness(r: RawRow): number {
  return (
    (rawField(r.rawData, "location") ? 1 : 0) +
    (rawField(r.rawData, "hares") ? 1 : 0) +
    (rawField(r.rawData, "description") ? 1 : 0)
  );
}

async function main(apply: boolean): Promise<void> {
  log(`${apply ? "APPLY" : "DRY-RUN"} — heal Event ${EVENT_ID} (restore "${CONTAMINATED_TITLE}" → real trail)`);

  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME }, select: { id: true } });
  if (!source) throw new Error(`Source not found: ${SOURCE_NAME}`);

  const event = await prisma.event.findUnique({
    where: { id: EVENT_ID },
    select: { id: true, title: true, locationName: true, haresText: true, status: true },
  });

  const sourceRaws: RawRow[] = await prisma.rawEvent.findMany({
    where: { sourceId: source.id },
    select: { id: true, eventId: true, scrapedAt: true, rawData: true },
  });

  // Stray guard: every placeholder raw on the source must belong to the target Event.
  const strayPhantoms = sourceRaws.filter((r) => r.eventId !== EVENT_ID && isPhantomRaw(r.rawData)).map((r) => r.id);
  if (strayPhantoms.length > 0) {
    throw new Error(
      `Found ${strayPhantoms.length} "NO RUN TODAY" raw(s) NOT linked to ${EVENT_ID}: ` +
        `[${strayPhantoms.join(", ")}]. Refusing — investigate manually.`,
    );
  }

  const linkedRaws = sourceRaws.filter((r) => r.eventId === EVENT_ID);
  const phantomRawIds = linkedRaws.filter((r) => isPhantomRaw(r.rawData)).map((r) => r.id);
  const survivors = linkedRaws.filter((r) => !isPhantomRaw(r.rawData));

  // Idempotent no-op: already healed and placeholders already gone.
  if ((!event || event.title !== CONTAMINATED_TITLE) && phantomRawIds.length === 0) {
    log("Nothing to do — Event already healed and no placeholder raws remain.");
    return;
  }

  // Drift guard: only patch a still-contaminated Event.
  if (event && event.title !== CONTAMINATED_TITLE) {
    throw new Error(
      `Refusing to patch: Event ${EVENT_ID} title is "${event.title}", expected "${CONTAMINATED_TITLE}". ` +
        `It may have drifted/already healed — investigate manually.`,
    );
  }
  if (!event) throw new Error(`Event ${EVENT_ID} not found but placeholder raws exist — investigate manually.`);

  // Pick the most-complete surviving raw as the heal source.
  const healSource = survivors
    .filter((r) => rawField(r.rawData, "location")) // must carry a real venue
    .sort((a, b) => completeness(b) - completeness(a) || b.scrapedAt.getTime() - a.scrapedAt.getTime())[0];
  if (!healSource) {
    throw new Error(`No surviving raw with a location found among ${survivors.length} survivors — cannot heal safely.`);
  }

  const rawTitle = rawField(healSource.rawData, "title") ?? "";
  const healed = {
    title: rawTitle.replace(RUN_PREFIX_RE, "").trim() || rawTitle,
    locationName: rawField(healSource.rawData, "location"),
    haresText: rawField(healSource.rawData, "hares"),
    description: rawField(healSource.rawData, "description"),
  };

  log(`Heal source raw: ${healSource.id} (completeness ${completeness(healSource)})`);
  log(`Would delete ${phantomRawIds.length} placeholder raw(s): [${phantomRawIds.join(", ")}]`);
  log(
    `Would patch Event ${EVENT_ID}: ` +
      `title="${event.title}"→"${healed.title}", ` +
      `locationName="${event.locationName}"→"${healed.locationName}", ` +
      `haresText="${event.haresText}"→"${healed.haresText}", description→${healed.description ? "(restored)" : "(unchanged/null)"}`,
  );

  if (!apply) {
    log("DRY-RUN complete. Re-run with CLEANUP_APPLY=1 to apply.");
    return;
  }

  await prisma.$transaction([
    prisma.rawEvent.deleteMany({ where: { id: { in: phantomRawIds } } }),
    prisma.event.update({
      where: { id: EVENT_ID },
      data: {
        title: healed.title,
        locationName: healed.locationName,
        haresText: healed.haresText,
        description: healed.description,
      },
    }),
  ]);

  const after = await prisma.event.findUnique({ where: { id: EVENT_ID }, select: { title: true } });
  const rawsStill = await prisma.rawEvent.count({ where: { id: { in: phantomRawIds } } });
  if (!after || after.title === CONTAMINATED_TITLE || rawsStill > 0) {
    throw new Error(`Post-heal check failed: title="${after?.title}", placeholderRawsRemaining=${rawsStill}`);
  }

  log(
    JSON.stringify({
      action: "heal_contaminated_event",
      issue: ISSUE,
      eventId: EVENT_ID,
      healSourceRawId: healSource.id,
      rawEventsDeleted: phantomRawIds.length,
      healedTitle: healed.title,
      timestamp: new Date().toISOString(),
    }),
  );
  log("Done.");
}

main(process.env.CLEANUP_APPLY === "1")
  .catch((err) => {
    console.error(`[${LOG_PREFIX}] FAILED:`, err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
