/**
 * One-shot canonical backfill for #1046 — EH3 (Edmonton family) Scribe fold.
 *
 * The adapter now folds a "Scribe: <name>" credit into the description. Because
 * `description` is NOT part of the RawEvent fingerprint, a plain re-scrape emits
 * a same-fingerprint raw that the merge dedupes/skips — so existing canonical
 * events never gain the scribe line ("re-scrape won't fix existing canonical").
 *
 * This script re-runs the EH3 adapter live, and for any event whose fresh
 * description now carries a "Scribe:" line, writes that fuller description onto
 * the matching canonical event (by kennel + date) when the stored description
 * lacks a scribe. The fresh description is a superset (On On + Scribe + notes),
 * so this only ever adds information.
 *
 * Safe & idempotent: only updates events whose stored description lacks
 * "Scribe:" (optimistic updateMany guard on the old value); a re-run updates 0.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-eh3-scribe-1046.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-eh3-scribe-1046.ts --apply
 */
import { runOneShot } from "./lib/one-shot";
import { Eh3EdmontonAdapter } from "@/adapters/html-scraper/eh3-edmonton";
import type { Source } from "@/generated/prisma/client";

const EH3_KENNELS = ["eh3-ab", "osh3-ab", "efmh3", "bash-eh3", "snash-eh3", "divah3-eh3", "rash-eh3"];
const SAMPLE = 12;

void runOneShot(async ({ prisma, apply }) => {
  // 1) Fresh descriptions from the live source.
  const src = { id: "backfill", url: "https://www.eh3.org", scrapeDays: 365, config: {} } as unknown as Source;
  const result = await new Eh3EdmontonAdapter().fetch(src, { days: 365 });
  const liveByKey = new Map<string, string>();
  for (const e of result.events) {
    if (!e.description || !/Scribe:/i.test(e.description)) continue;
    for (const tag of e.kennelTags) liveByKey.set(`${tag}|${e.date}`, e.description);
  }
  console.log(`Live source: ${result.events.length} events, ${liveByKey.size} carry a Scribe line`);

  // 2) Match against canonical events lacking a scribe in their description.
  let updated = 0;
  const samples: string[] = [];
  for (const code of EH3_KENNELS) {
    const events = await prisma.event.findMany({
      where: { eventKennels: { some: { kennel: { kennelCode: code } } } },
      select: { id: true, date: true, title: true, description: true },
    });
    for (const e of events) {
      const key = `${code}|${e.date.toISOString().slice(0, 10)}`;
      const live = liveByKey.get(key);
      if (!live) continue; // no fresh scribe-bearing description for this date
      if (e.description && /Scribe:/i.test(e.description)) continue; // already has one
      if (e.description === live) continue; // already correct
      if (samples.length < SAMPLE) samples.push(`   - ${code} ${key.split("|")[1]}  ${e.title}`);
      if (apply) {
        const r = await prisma.event.updateMany({
          where: { id: e.id, description: e.description },
          data: { description: live },
        });
        updated += r.count;
      }
    }
  }

  console.log(`#1046 EH3 Scribe fold: ${samples.length}${apply ? "" : "+"} event(s) to patch`);
  samples.forEach((s) => console.log(s));
  if (apply) console.log(`   ✏️  updated ${updated}`);
  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
