/**
 * One-shot canonical backfill for PSH3 stale `haresText` (#2214).
 *
 * Why this is needed: PR #2202 corrected the PSH3 Google Sheets column mapping
 * (hares = col 4 "Hare(s)", was the col 3 "Day" column) and #2214 bumps the
 * sheet to trustLevel 7. But the already-stored canonical events still carry the
 * pre-#2130 leak — `haresText` = the weekday name ("Thursday"/"Saturday"/…) — and
 * a plain re-scrape does NOT fix them:
 *   - The current sheet RawEvent already carries the CORRECT col-4 hares, so its
 *     fingerprint is unchanged → the dedup table skips it → the merge UPDATE
 *     never fires.
 *   - Before the trust bump the sheet (trust 5) was out-trusted by the WA Hash
 *     GCal (trust 7), so it only hit the merge ENRICH branch (fill-NULL-only),
 *     which can never overwrite the non-null stale "Thursday".
 *
 * This script copies the correct hares from the most-recent PSH3 sheet RawEvent
 * linked to each affected event (sanitized exactly as the merge would), or clears
 * it to null when the sheet has no hares. It STICKS: haresText is not part of the
 * RawEvent fingerprint, so rewriting it never disturbs dedup, and going forward
 * the trust-7 sheet owns the field via the full-update branch.
 *
 * Scoped & safe: only psh3 events whose haresText is a bare weekday name (the
 * Day-column leak signature — never a real hash name), optimistic value guard on
 * UPDATE, idempotent (a re-run matches 0 rows).
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-psh3-hares-2214.ts
 *   Apply:   DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-psh3-hares-2214.ts --apply
 */
import { runOneShot } from "./lib/one-shot";
import { sanitizeHares } from "@/pipeline/merge";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PSH3_SHEET_NAME = "Puget Sound H3 Hareline Sheet";

void runOneShot(async ({ prisma, apply }) => {
  const source = await prisma.source.findFirst({
    where: { name: PSH3_SHEET_NAME },
    select: { id: true },
  });
  if (!source) {
    console.log(`Source "${PSH3_SHEET_NAME}" not found — nothing to do.`);
    return;
  }

  // psh3 events whose haresText is a bare weekday — the col-3 "Day" leak.
  const events = await prisma.event.findMany({
    where: {
      haresText: { in: WEEKDAYS },
      eventKennels: { some: { kennel: { kennelCode: "psh3" } } },
    },
    select: { id: true, runNumber: true, haresText: true, dateUtc: true },
    orderBy: { date: "asc" },
  });

  console.log(`\n#2214 PSH3 haresText weekday leak → correct hares: ${events.length} event(s)`);

  let cleared = 0;
  let corrected = 0;
  for (const e of events) {
    // Latest PSH3-sheet raw linked to this canonical event carries the correct
    // col-4 hares (or no hares at all, in which case the weekday is just wrong).
    const raw = await prisma.rawEvent.findFirst({
      where: { eventId: e.id, sourceId: source.id },
      orderBy: { scrapedAt: "desc" },
      select: { rawData: true },
    });
    const rawHares = (raw?.rawData as { hares?: unknown } | null)?.hares;
    const fixed = sanitizeHares(typeof rawHares === "string" ? rawHares : null); // string | null

    const date = e.dateUtc?.toISOString().slice(0, 10) ?? "?";
    console.log(`   - #${e.runNumber ?? "?"} ${date}: "${e.haresText}" → ${fixed === null ? "null" : `"${fixed}"`}`);

    if (apply) {
      // Optimistic guard: only rewrite while the stale weekday is still present.
      const res = await prisma.event.updateMany({
        where: { id: e.id, haresText: e.haresText },
        data: { haresText: fixed },
      });
      if (res.count) {
        if (fixed === null) cleared += res.count;
        else corrected += res.count;
      }
    }
  }

  if (apply) {
    console.log(`   ✏️  corrected ${corrected}, cleared ${cleared}`);
  }
  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
