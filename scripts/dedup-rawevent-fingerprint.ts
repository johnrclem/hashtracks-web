/**
 * One-shot cleanup: collapse `(sourceId, fingerprint)` duplicate groups in
 * `RawEvent` ahead of issue #1286's `@@unique([sourceId, fingerprint])`
 * migration. Without this cleanup, the migration would fail on the existing
 * dupe rows.
 *
 * Pre-flight diagnostics (run 2026-05-10 against prod):
 *   - 766 duplicate groups, 7647 doomed rows
 *   - 468 groups have NO linkage (orphan dupes — pick any survivor)
 *   - 298 groups have linkage; of the 136 multi-link groups, ALL have
 *     `distinct_event_ids = 1` (every linked row in a group points to the
 *     same canonical Event). So the "transfer eventId from doomed → survivor"
 *     path is unneeded — preferring a linked-row survivor naturally inherits
 *     the canonical Event linkage.
 *
 * Survivor selection (linkage-aware):
 *   1. If any sibling has `eventId IS NOT NULL`, pick the linked row with
 *      most-recent `scrapedAt` as survivor.
 *   2. Else (no linkage in the group), pick the OLDEST sibling by
 *      `scrapedAt` — preserves the original observation timestamp.
 *
 * Defaults to dry run. Pass `--apply` to issue the deletes.
 *
 * Writes a JSON audit log to `tmp/dedup-rawevent-{audit,dryrun}-<ts>.json`
 * with every group's survivor + deleted row IDs. The cleanup is irreversible
 * once Vercel applies the unique-constraint migration; keep the audit log
 * for forensic recovery.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/dedup-rawevent-fingerprint.ts
 *   Apply:    npx tsx scripts/dedup-rawevent-fingerprint.ts --apply
 *
 * Idempotent: a re-run sees fewer (or zero) duplicate groups.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");
const DELETE_CHUNK_SIZE = 500;

type RawEventRow = {
  id: string;
  sourceId: string;
  fingerprint: string;
  scrapedAt: Date;
  processed: boolean;
  eventId: string | null;
};

type AuditRow = Pick<RawEventRow, "id" | "scrapedAt" | "processed" | "eventId">;
type AuditEntry = {
  sourceId: string;
  fingerprint: string;
  survivor: AuditRow;
  deleted: AuditRow[];
};

function toAuditRow(r: RawEventRow): AuditRow {
  return { id: r.id, scrapedAt: r.scrapedAt, processed: r.processed, eventId: r.eventId };
}

/**
 * Pick the survivor for a duplicate group. Linked rows beat unlinked rows.
 * Tiebreakers: linked → most-recent `scrapedAt`, then `id` ASC for stability;
 * unlinked → oldest `scrapedAt`, then `id` ASC. The `id` tiebreaker makes
 * dry-run and apply produce identical survivors even when two rows share a
 * `scrapedAt` (concurrent scrapes can land within the same millisecond).
 */
export function pickSurvivor(rows: RawEventRow[]): RawEventRow {
  if (rows.length === 0) {
    throw new Error("pickSurvivor called on empty group");
  }
  const linked = rows.filter((r) => r.eventId !== null);
  if (linked.length > 0) {
    return [...linked].sort(
      (a, b) =>
        b.scrapedAt.getTime() - a.scrapedAt.getTime() ||
        a.id.localeCompare(b.id),
    )[0];
  }
  return [...rows].sort(
    (a, b) =>
      a.scrapedAt.getTime() - b.scrapedAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0];
}

function extractHost(databaseUrl: string | undefined): string {
  if (!databaseUrl) return "<unknown>";
  try {
    return new URL(databaseUrl).hostname || "<unknown>";
  } catch {
    return "<unparseable>";
  }
}

async function main() {
  // Surface the target host before the first DB write — the user has to
  // confirm the script is pointed at the intended environment.
  const host = extractHost(process.env.DATABASE_URL);
  console.log(`Target DB host: ${host}`);
  console.log(`Mode: ${APPLY ? "APPLY (will DELETE)" : "DRY RUN (no writes)"}`);

  console.log("Fetching all rows in duplicate (sourceId, fingerprint) groups…");
  const dupRows = await prisma.$queryRaw<RawEventRow[]>`
    SELECT id, "sourceId", "fingerprint", "scrapedAt", processed, "eventId"
    FROM "RawEvent"
    WHERE ("sourceId", "fingerprint") IN (
      SELECT "sourceId", "fingerprint" FROM "RawEvent"
      GROUP BY "sourceId", "fingerprint" HAVING COUNT(*) > 1
    )
    ORDER BY "sourceId", "fingerprint", "scrapedAt", id
  `;
  console.log(`Fetched ${dupRows.length} rows across duplicate groups`);

  // Group by (sourceId, fingerprint) in JS.
  const groups = new Map<string, RawEventRow[]>();
  for (const r of dupRows) {
    const key = `${r.sourceId}:${r.fingerprint}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  console.log(`Identified ${groups.size} duplicate groups`);

  if (groups.size === 0) {
    console.log("No duplicates — nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const auditEntries: AuditEntry[] = [];
  const doomedIds: string[] = [];
  let linkagePreservedSurvivors = 0;

  for (const rows of groups.values()) {
    if (rows.length < 2) continue; // race-safe
    const survivor = pickSurvivor(rows);
    const doomed = rows.filter((r) => r.id !== survivor.id);
    if (survivor.eventId !== null) linkagePreservedSurvivors++;
    auditEntries.push({
      sourceId: rows[0].sourceId,
      fingerprint: rows[0].fingerprint,
      survivor: toAuditRow(survivor),
      deleted: doomed.map(toAuditRow),
    });
    for (const d of doomed) doomedIds.push(d.id);
  }

  // Write audit log BEFORE deleting so a crash mid-delete still leaves a
  // record of intended action.
  const auditDir = path.join(process.cwd(), "tmp");
  fs.mkdirSync(auditDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logName = APPLY
    ? `dedup-rawevent-audit-${ts}.json`
    : `dedup-rawevent-dryrun-${ts}.json`;
  const logPath = path.join(auditDir, logName);
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        mode: APPLY ? "APPLY" : "DRY_RUN",
        runAt: new Date().toISOString(),
        targetHost: host,
        groupsProcessed: auditEntries.length,
        totalDeleted: doomedIds.length,
        linkagePreservedSurvivors,
        entries: auditEntries,
      },
      null,
      2,
    ),
  );
  console.log(`Audit log written to ${logPath}`);

  if (APPLY) {
    console.log(`Deleting ${doomedIds.length} rows in chunks of ${DELETE_CHUNK_SIZE}…`);
    let deleted = 0;
    for (let i = 0; i < doomedIds.length; i += DELETE_CHUNK_SIZE) {
      const chunk = doomedIds.slice(i, i + DELETE_CHUNK_SIZE);
      const res = await prisma.rawEvent.deleteMany({ where: { id: { in: chunk } } });
      deleted += res.count;
      console.log(`  deleted ${deleted}/${doomedIds.length} (chunk ${Math.floor(i / DELETE_CHUNK_SIZE) + 1})`);
    }
    console.log(`Done: ${deleted} rows deleted.`);
  } else {
    console.log("DRY RUN — no rows deleted. Pass --apply to execute.");
  }

  console.log("\nSummary:");
  console.log(`  groups processed:           ${auditEntries.length}`);
  console.log(`  rows ${APPLY ? "deleted" : "to delete"}:        ${doomedIds.length}`);
  console.log(`  survivors with eventId set: ${linkagePreservedSurvivors}`);
}

// Only auto-run main() when invoked directly (`tsx scripts/dedup-...ts`),
// not when imported from a test file. Use `fileURLToPath` + `path.resolve`
// for cross-platform safety (handles Windows backslashes and missing
// `file://` prefix on `process.argv[1]`).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
