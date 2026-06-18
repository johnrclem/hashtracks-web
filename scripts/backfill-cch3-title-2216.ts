/**
 * One-shot canonical backfill for Charm City H3 titles with an embedded
 * "~ <hares>" suffix (#2216).
 *
 * Why this is needed: the iCal adapter now strips the titleHarePattern "~ <hares>"
 * suffix from the title (opt-in `stripTitleHareSuffix`, set on the CCH3 source).
 * That fixes NEW raws and self-heals events whose stripped title is a real theme,
 * but `resolveUpdatedTitle` (merge.ts #2233) PRESERVES an existing non-placeholder
 * title — so a leaked title like "CCH3# TBD~ MoreMen Pukes Tonight" sticks even
 * after the adapter emits the clean "CCH3# TBD".
 *
 * This script clears that residual directly. It STICKS because `title` is not part
 * of the RawEvent fingerprint, so rewriting it never disturbs dedup.
 *
 * Scoped & safe: UPCOMING cch3 events only (the live window where the "~" separator
 * always introduces hares — past CCH3 events used "~" for themes too, so they are
 * deliberately left untouched), and only when the captured "~" suffix exactly
 * equals the stored haresText (proving it's the hare suffix, not an incidental
 * tilde). Optimistic value guard on UPDATE; idempotent (a re-run matches 0 rows).
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-cch3-title-2216.ts
 *   Apply:   DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-cch3-title-2216.ts --apply
 */
import { runOneShot } from "./lib/one-shot";

/**
 * Mirror the CCH3 source's titleHarePattern ("~\s*(.+)$") with plain string ops
 * (no regex — avoids the ReDoS hotspot, per the repo's `\s*`-adjacent guidance):
 * split on the FIRST tilde, the trimmed remainder is the hare suffix. Returns the
 * cleaned title only when that suffix equals `haresText` (proving it's the hare
 * suffix, not an incidental tilde); otherwise null (leave untouched).
 */
function strippedTitle(title: string, haresText: string): string | null {
  const idx = title.indexOf("~");
  if (idx < 0) return null;
  if (title.slice(idx + 1).trim() !== haresText.trim()) return null;
  // Fall back to the synthesized default if stripping leaves nothing (none of the
  // known leaks do, but stay safe rather than write an empty title).
  return title.slice(0, idx).trim() || "Charm City H3 Trail";
}

void runOneShot(async ({ prisma, apply }) => {
  const events = await prisma.event.findMany({
    where: {
      title: { contains: "~" },
      haresText: { not: null },
      dateUtc: { gte: new Date() }, // upcoming only — see scope note above
      eventKennels: { some: { kennel: { kennelCode: "cch3" } } },
    },
    select: { id: true, title: true, haresText: true, dateUtc: true },
    orderBy: { date: "asc" },
  });

  const leaked = events.flatMap((e) => {
    const newTitle = e.title && e.haresText ? strippedTitle(e.title, e.haresText) : null;
    if (e.title == null || newTitle == null) return [];
    return [{ id: e.id, oldTitle: e.title, newTitle, dateUtc: e.dateUtc }];
  });

  console.log(`\n#2216 CCH3 title "~ <hares>" suffix → stripped: ${leaked.length} event(s)`);

  let updated = 0;
  for (const e of leaked) {
    const date = e.dateUtc?.toISOString().slice(0, 10) ?? "?";
    console.log(`   - ${date}: "${e.oldTitle}" → "${e.newTitle}"`);

    if (apply) {
      const res = await prisma.event.updateMany({
        where: { id: e.id, title: e.oldTitle },
        data: { title: e.newTitle },
      });
      updated += res.count;
    }
  }

  if (apply && leaked.length) console.log(`   ✏️  updated ${updated}`);
  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
