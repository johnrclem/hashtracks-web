/**
 * One-shot canonical backfill for #766 — BFM "Bring:" list + chalk-talk timing.
 *
 * The adapter now folds the "Bring:" checklist and the gather/chalk-talk "When:"
 * line into the description. Because `description` is NOT part of the RawEvent
 * fingerprint, a plain re-scrape emits a same-fingerprint raw that the merge
 * dedupes/skips — so the current-trail canonical event never gains the new lines.
 *
 * BFM's site only exposes the CURRENT trail's rich block (past trails roll off),
 * so this script patches the live current-trail event: it re-runs the adapter,
 * and if the fresh description carries a "Bring:" or chalk-talk line the stored
 * description lacks, writes the fuller (superset) description onto the matching
 * canonical event by run number.
 *
 * Safe & idempotent: only updates when the fresh description adds the new content
 * AND differs from the stored value (optimistic updateMany guard); re-run → 0.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-bfm-766.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-bfm-766.ts --apply
 */
import { runOneShot } from "./lib/one-shot";
import { BFMAdapter } from "@/adapters/html-scraper/bfm";
import type { Source } from "@/generated/prisma/client";

/** True when a description carries the #766 additions (Bring list / chalk-talk). */
function hasNewContent(s: string | null | undefined): boolean {
  return !!s && (/^Bring:/im.test(s) || /chalk\s*talk/i.test(s));
}

void runOneShot(async ({ prisma, apply }) => {
  const src = { id: "backfill", url: "https://benfranklinmob.com", config: {} } as unknown as Source;
  const result = await new BFMAdapter().fetch(src, { days: 60 });
  // Current-trail events carry a runNumber + a description; upcoming-hares don't.
  const fresh = result.events.filter((e) => e.runNumber != null && hasNewContent(e.description));
  console.log(`Live BFM: ${result.events.length} events, ${fresh.length} current-trail event(s) with #766 content`);

  let updated = 0;
  for (const e of fresh) {
    const canon = await prisma.event.findFirst({
      where: { runNumber: e.runNumber, eventKennels: { some: { kennel: { kennelCode: "bfm" } } } },
      select: { id: true, title: true, description: true },
    });
    if (!canon) {
      console.log(`   (no canonical bfm event for run #${e.runNumber} yet — skipping)`);
      continue;
    }
    if (hasNewContent(canon.description)) {
      console.log(`   run #${e.runNumber} already has #766 content — skipping`);
      continue;
    }
    if (canon.description === e.description) continue;
    console.log(`   - run #${e.runNumber} ${canon.title}: add Bring/chalk-talk lines`);
    if (apply) {
      const r = await prisma.event.updateMany({
        where: { id: canon.id, description: canon.description },
        data: { description: e.description },
      });
      updated += r.count;
    }
  }

  if (apply) console.log(`   ✏️  updated ${updated}`);
  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
