/**
 * One-shot cleanup for issue #2025 — HHHS canonical Events whose title carries
 * the un-shortened "Hash House Harriers Singapore H3 …" prefix instead of the
 * "Singapore H3 …" form every other HHHS event uses.
 *
 * Root cause is a STALE GHOST, not a live adapter bug. The current pipeline is
 * already correct: `HHHSAdapter.buildTitle` emits "HHHS Trail #N", and
 * `merge.ts` rewrites the kennelCode prefix via
 * `friendlyKennelName("HHHS", "Hash House Harriers Singapore")` → "Singapore H3".
 * Sibling runs re-scraped in June 2026 all read "Singapore H3 Trail #N"; a
 * handful of future events (3310/3311/3314/3316/3317) were created under an
 * older title format and have not been re-merged since (last updated May 2026),
 * so they never picked up the corrected title. They sit inside the scrape
 * window but aren't being re-fetched, so they won't self-heal — this script
 * normalizes their canonical Event.title in place.
 *
 * Safety:
 *   - Bounded to kennel `hhhs`. RawEvents are immutable and untouched.
 *   - title isn't a RawEvent fingerprint input, so RawEvent→Event linkage holds.
 *     If a stuck event IS later re-scraped, merge writes the same corrected
 *     title, so this is convergent either way.
 *   - Idempotent: re-runs find zero matching rows once applied.
 *
 * Run (Railway's public proxy uses a self-signed cert → allow it for the pool):
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-hhhs-stale-title.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-hhhs-stale-title.ts --apply
 *   Env:     DATABASE_URL
 */
import "dotenv/config";
import type { PrismaClient } from "@/generated/prisma/client";
import { runFieldPatchCleanup, resolveCleanupKennel, type FieldPatch } from "./lib/cleanup-cli";

const KENNEL_CODE = "hhhs";
// The full HHH name that should have been shortened to "Singapore H3". Anchored
// at the start; the trailing "Trail #N" / "Run" suffix is left intact.
const STALE_TITLE_RE = /^Hash House Harriers Singapore H3\b/;

async function collect(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await resolveCleanupKennel(prisma, KENNEL_CODE);
  if (!kennel) return [];

  const candidates = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { not: null } },
    select: { id: true, title: true },
  });

  const patches: FieldPatch[] = [];
  for (const e of candidates) {
    const before = e.title ?? "";
    if (!STALE_TITLE_RE.test(before)) continue;
    const after = before.replace(STALE_TITLE_RE, "Singapore H3").trim();
    if (!after || after === before) continue;
    patches.push({ kennelLabel: kennel.shortName, eventId: e.id, field: "title", before, after });
  }
  return patches;
}

runFieldPatchCleanup(collect).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
