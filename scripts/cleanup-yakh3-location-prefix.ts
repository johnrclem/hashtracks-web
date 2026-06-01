/**
 * One-shot cleanup for issue #1826 — YAKH3 events with a "YAKH3," kennel-name
 * prefix leaked into locationName by the DFW Hash detail-page parser.
 *
 * The detail page renders the kennel acronym as a bare `<h1>YAKH3</h1>`. The
 * `\b`-anchored KENNEL_NAME_PATTERNS in dfw-hash.ts missed the concatenated
 * "YAKH3" (no boundary between K-H-3), so `extractVenueName` returned it and it
 * was prepended to the Start address:
 *   "YAKH3, I heard a rumor that this is at lake Ray Hubbard. Rowlett"
 *   "YakH3, One Eleven Ranch Park, 2121 E. Brand Road, Garland, TX 75044"
 *
 * The adapter fix in this PR stops new leaks. Upcoming events self-heal on the
 * next scrape (the corrected adapter overwrites locationName), but past events
 * are outside the scrape window and won't be re-fetched — this script strips
 * the prefix from their canonical Event.locationName in place.
 *
 * Safety:
 *   - Bounded to kennel `yakh3`. RawEvents are immutable and untouched.
 *   - locationName isn't a fingerprint input, so RawEvent→Event linkage holds.
 *   - Idempotent: re-runs find zero matching rows once applied.
 *
 * Run (Railway's public proxy uses a self-signed cert → allow it for the pool):
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-yakh3-location-prefix.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-yakh3-location-prefix.ts --apply
 *   Env:     DATABASE_URL
 */
import "dotenv/config";
import type { PrismaClient } from "@/generated/prisma/client";
import { runFieldPatchCleanup, resolveCleanupKennel, type FieldPatch } from "./lib/cleanup-cli";

const KENNEL_CODE = "yakh3";
// "YAKH3, " / "YakH3, " — acronym then optional space then "h3," then spaces.
const PREFIX_RE = /^yak\s*h3,\s*/i;

async function collect(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await resolveCleanupKennel(prisma, KENNEL_CODE);
  if (!kennel) return [];

  const candidates = await prisma.event.findMany({
    where: { kennelId: kennel.id, locationName: { not: null } },
    select: { id: true, locationName: true },
  });

  const patches: FieldPatch[] = [];
  for (const e of candidates) {
    const before = e.locationName ?? "";
    if (!PREFIX_RE.test(before)) continue;
    const after = before.replace(PREFIX_RE, "").trim();
    if (!after || after === before) continue;
    patches.push({ kennelLabel: kennel.shortName, eventId: e.id, field: "locationName", before, after });
  }
  return patches;
}

runFieldPatchCleanup(collect).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
