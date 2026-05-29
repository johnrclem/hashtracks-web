/**
 * Shared one-shot historical backfill helper for kennels hosted on the
 * "Melbourne New Moon Meetup" aggregator source (#1752, #1755).
 *
 * Why a one-shot from committed JSON rather than a wide-window live scrape:
 * the Meetup public API the live adapter uses only exposes UPCOMING events —
 * `/events/past/` redirects to login (see #1752/#1755 issue bodies). The
 * historical rows were captured out-of-band via the Chrome history-scrape
 * tool into `scripts/data/mel-new-moon-meetup-history-batch-*.json` (each a
 * complete JSON array of `{title,date,startTime,location,url,attendees}`).
 * This helper replays those committed batches through the merge pipeline,
 * filtered to a single sibling kennel.
 *
 * Per-kennel scripts (bike-hash, city-h3) collapse to one call into this
 * helper with their own `matcher`, sharing the read/filter/merge wiring.
 *
 * Why a per-kennel matcher (not the live source's `kennelPatterns`): the live
 * config deliberately routes only `^\s*Bike\s+hash\b` to bike-hash and leaves
 * the "Bike Ride #N" / "Ride #N" / "Beer Run#.. from Melbourne City Hash"
 * variants to the default `mel-new-moon` ("to avoid eating legit run names").
 * A dedicated historical backfill wants the inclusive form, so each wrapper
 * supplies its own matcher. See the cross-kennel collision guard below for the
 * safety implication.
 *
 * Idempotency: routes through `reportAndApplyBackfill` → `processRawEvents`
 * which dedupes by `(sourceId, fingerprint)`. The canonical `(kennelId, date)`
 * merge collapses re-imports of already-tracked events onto the existing
 * canonical (no duplicate Event), so re-runs are safe.
 */

import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/db";
import { extractHashRunNumber } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./backfill-runner";
import { utcDayBounds } from "./event-reassign";

const SOURCE_NAME = "Melbourne New Moon Meetup";
const KENNEL_TIMEZONE = "Australia/Melbourne";
const DEFAULT_KENNEL = "mel-new-moon";
const BATCH_PREFIX = "mel-new-moon-meetup-history-batch-";
const DATA_DIR = fileURLToPath(new URL("../data", import.meta.url));

/** Shape of a single row in the committed batch JSON files. */
interface MeetupHistoryRow {
  title?: string;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  location?: string | null;
  url?: string | null;
  attendees?: number | null;
}

/**
 * Placeholder titles that are not real completed events. Same shape as
 * `import-meetup-history.ts` (POSTPONED / CANCELLED / NEEDS A HARE). Kept as a
 * small literal alternation — no nested `\s*` quantifiers, so Sonar S5852 is
 * clean.
 */
const PLACEHOLDER_TITLE_RE = /\bPOSTPONED\b|\bCANCEL(?:L?ED)\b|\bNEEDS?\s+(?:A\s+)?HARE\b/i;

/**
 * Recurring-template titles emitted by Meetup's series feature
 * ("Every Wednesday @ 6:30pm from tbd"). The live adapter strips these via
 * `cleanMeetupTitle`; this backfill reads raw batch JSON and bypasses that, so
 * we guard explicitly. See `cleanup-mel-nm-historical-placeholders.ts`.
 */
function isTemplateTitle(title: string): boolean {
  return /^every\b/i.test(title.trim());
}

export function isImportablePlaceholder(title: string): boolean {
  return PLACEHOLDER_TITLE_RE.test(title) || isTemplateTitle(title);
}

/**
 * Read every committed batch file as an independent JSON array and concatenate
 * the rows. Each file is a complete `[...]`, so a plain `JSON.parse` per file
 * is correct — no need for the concatenated-stream parser used by the stdin
 * importer.
 */
export function readBatchRows(dataDir: string = DATA_DIR): MeetupHistoryRow[] {
  const files = readdirSync(dataDir)
    .filter((name) => name.startsWith(BATCH_PREFIX) && name.endsWith(".json"))
    .sort((a, b) => {
      const an = Number(a.match(/(\d+)\.json$/)?.[1] ?? 0);
      const bn = Number(b.match(/(\d+)\.json$/)?.[1] ?? 0);
      return an - bn;
    });
  if (files.length === 0) {
    throw new Error(`No batch files matching "${BATCH_PREFIX}*.json" in ${dataDir}`);
  }
  const rows: MeetupHistoryRow[] = [];
  for (const name of files) {
    const parsed = JSON.parse(readFileSync(`${dataDir}/${name}`, "utf-8"));
    if (!Array.isArray(parsed)) {
      throw new Error(`Batch file ${name} is not a JSON array.`);
    }
    rows.push(...parsed);
  }
  return rows;
}

/**
 * Turn batch rows into `RawEventData` for a single kennel. Pure (no I/O) so the
 * unit test can exercise the matcher + field mapping directly. Rows are kept
 * only when `matcher(title)` is true and the title is not a placeholder/template.
 * De-duped within the batch by `url` (the same Meetup event can appear in
 * overlapping scrape windows).
 */
export function buildKennelEvents(
  rows: readonly MeetupHistoryRow[],
  kennelCode: string,
  matcher: (title: string) => boolean,
): RawEventData[] {
  const seenUrls = new Set<string>();
  const events: RawEventData[] = [];
  for (const row of rows) {
    const title = row.title?.trim();
    if (!title || !row.date) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    if (!matcher(title)) continue;
    if (isImportablePlaceholder(title)) continue;
    if (row.url) {
      if (seenUrls.has(row.url)) continue;
      seenUrls.add(row.url);
    }
    events.push({
      date: row.date,
      kennelTags: [kennelCode],
      title,
      runNumber: extractHashRunNumber(title),
      startTime: row.startTime || undefined,
      location: row.location || undefined,
      sourceUrl: row.url || undefined,
    });
  }
  return events;
}

/**
 * Detect the cross-kennel conflation hazard: an event the inclusive matcher
 * routes to `kennelCode` may already exist as a canonical Event MISROUTED under
 * the default `mel-new-moon` kennel (the live source's `kennelPatterns` were
 * added after these historical rows were first scraped, so they all landed on
 * the default). Re-importing under `kennelCode` would fork the canonical.
 *
 * A genuine collision is a `mel-new-moon` canonical on the date whose TITLE
 * matches `matcher` (i.e. it's the misrouted sibling event itself) while the
 * target kennel holds no canonical for that date. Title-matching is essential:
 * a same-day "New Moon Run No. 144" alongside a separate City Hash is NOT a
 * collision — that's two legitimate sibling events, and the City row should
 * insert freely.
 *
 * READ-ONLY. Returns the colliding dates so the caller can fail loud and direct
 * the operator to run `scripts/cleanup-mel-cross-kennel-conflation.ts` first.
 */
async function findCrossKennelCollisions(
  events: readonly RawEventData[],
  kennelCode: string,
  matcher: (title: string) => boolean,
): Promise<string[]> {
  const target = await prisma.kennel.findUnique({ where: { kennelCode }, select: { id: true } });
  const def = await prisma.kennel.findUnique({ where: { kennelCode: DEFAULT_KENNEL }, select: { id: true } });
  if (!target || !def) return [];

  const collisions: string[] = [];
  for (const ev of events) {
    const { day, next } = utcDayBounds(ev.date);
    const onDefault = await prisma.event.findMany({
      where: { kennelId: def.id, date: { gte: day, lt: next }, isCanonical: true },
      select: { title: true },
    });
    // Only the misrouted-sibling case: a default-kennel canonical whose title
    // matches this kennel's matcher.
    const misrouted = onDefault.some((e) => e.title != null && matcher(e.title));
    if (!misrouted) continue;
    const onTarget = await prisma.event.findFirst({
      where: { kennelId: target.id, date: { gte: day, lt: next }, isCanonical: true },
      select: { id: true },
    });
    if (!onTarget) collisions.push(ev.date);
  }
  return collisions;
}

export interface MelBackfillParams {
  kennelCode: string;
  matcher: (title: string) => boolean;
  /** Short label printed by the runner. */
  label: string;
}

export async function backfillMelMeetupKennel(params: MelBackfillParams): Promise<void> {
  const { kennelCode, matcher, label } = params;
  // Delegate the apply/dry-run, logging, merge, and DB-lifecycle ceremony to
  // the shared runner; the per-kennel work (read batches, filter, collision
  // preflight) lives in fetchEvents. The outer finally disconnects the prisma
  // singleton the collision probe opens — the runner only disconnects on the
  // apply path, so the dry-run probe connection needs closing here. Calling
  // $disconnect twice on apply is a harmless no-op.
  try {
    await runBackfillScript({
      sourceName: SOURCE_NAME,
      kennelTimezone: KENNEL_TIMEZONE,
      label,
      fetchEvents: async () => {
        const rows = readBatchRows();
        const events = buildKennelEvents(rows, kennelCode, matcher);
        console.log(`  Read ${rows.length} batch rows → ${events.length} ${kennelCode} events after filter.`);

        const collisions = await findCrossKennelCollisions(events, kennelCode, matcher);
        if (collisions.length === 0) {
          console.log(`  Cross-kennel collision probe: clean (no ${DEFAULT_KENNEL} forks).`);
          return events;
        }
        console.warn(
          `  ⚠ ${collisions.length} misrouted-sibling collision(s): a "${DEFAULT_KENNEL}" canonical ` +
            `with a ${kennelCode}-matching title sits on these dates with no "${kennelCode}" counterpart:\n    ${collisions.join(", ")}`,
        );
        if (process.env.BACKFILL_APPLY === "1") {
          throw new Error(
            `Refusing to apply: ${collisions.length} date(s) would fork a canonical Event across ` +
              `${DEFAULT_KENNEL} and ${kennelCode}. Run scripts/cleanup-mel-cross-kennel-conflation.ts ` +
              `(BACKFILL_APPLY=1) to reassign the misrouted events first, then re-run this backfill.`,
          );
        }
        return events;
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
