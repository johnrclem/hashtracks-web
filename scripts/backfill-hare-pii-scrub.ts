/**
 * One-off full-history PII scrub of canonical Event.haresText (#2227 follow-up).
 *
 * The merge pipeline's `sanitizeHares` now strips phone numbers / emails embedded
 * mid-string, so all FUTURE merges are protected. The daily audit's
 * `selfHealSanitizers` also re-sanitizes the rolling −7d…+90d window. This script
 * clears the historical backlog OUTSIDE that window in one shot.
 *
 * Scoped & safe:
 *   - Only touches rows where `containsHarePii(haresText)` is true — non-PII hares
 *     are never re-sanitized for unrelated reasons (no corpus churn).
 *   - Computes the new value with the SAME `sanitizeHares` the pipeline uses.
 *   - Optimistic-lock guard (`where: { id, haresText: <old> }`) so a concurrent
 *     scrape can't be clobbered (mirrors selfHealSanitizers in audit-runner.ts).
 *   - A null result clears the field (explicit clear).
 *   - Idempotent: once scrubbed the row no longer matches `containsHarePii`.
 *   - haresText is NOT part of the fingerprint, so rewriting it never disturbs dedup.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-hare-pii-scrub.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-hare-pii-scrub.ts --apply
 *   Env:     DATABASE_URL
 */
import { containsHarePii } from "@/adapters/hare-pii";
import { sanitizeHares } from "@/pipeline/merge";
import { runOneShot } from "./lib/one-shot";

const SAMPLE_LIMIT = 30;

void runOneShot(async ({ prisma, apply }) => {
  const events = await prisma.event.findMany({
    where: { haresText: { not: null } },
    select: { id: true, haresText: true },
    orderBy: { date: "asc" },
  });
  console.log(`Scanned ${events.length} event(s) with a non-null haresText.`);

  // haresText is non-null by the query above; narrow for the type checker.
  const withPii = events.filter(
    (e): e is { id: string; haresText: string } =>
      e.haresText !== null && containsHarePii(e.haresText),
  );
  console.log(`${withPii.length} contain a phone number or email.`);
  if (withPii.length === 0) return;

  let changed = 0;
  let cleared = 0;
  let updated = 0;
  let shown = 0;
  for (const e of withPii) {
    const next = sanitizeHares(e.haresText); // string | null
    if (next === e.haresText) continue; // no-op (shouldn't happen for PII rows)
    changed++;
    if (next === null) cleared++;
    if (shown < SAMPLE_LIMIT) {
      console.log(`  ${e.id}: ${JSON.stringify(e.haresText)} → ${JSON.stringify(next)}`);
      shown++;
    }
    if (apply) {
      const res = await prisma.event.updateMany({
        where: { id: e.id, haresText: e.haresText },
        data: { haresText: next },
      });
      updated += res.count;
    }
  }

  console.log(
    `\n${changed} row(s) would change (${cleared} cleared to null).` +
      (apply ? ` Applied ${updated} update(s).` : " Re-run with --apply to write."),
  );
});
