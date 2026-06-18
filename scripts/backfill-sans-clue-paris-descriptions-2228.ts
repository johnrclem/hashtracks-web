/**
 * One-shot canonical backfill for #2228 (Paris H3 + Sans Clue H3 Meetup).
 *
 * Why a plain re-scrape can't fix this (the dedup-skip variant of
 * "re-scrape won't repair existing canonical"):
 *   - The `keepRepeatedDescription` fix (#2257) is correct — the adapter now
 *     keeps the full emoji body instead of collapsing it to a title-echo, and a
 *     live fetch confirms 737-char bodies.
 *   - BUT the corrective full-body RawEvent already exists from an earlier scrape
 *     (2026-06-05). A later title-echo raw (2026-06-10, pre-fix boilerplate
 *     stripping) clobbered the canonical. Today's corrective scrape re-emits the
 *     full body, but its fingerprint MATCHES the 2026-06-05 raw → deduped/skipped
 *     (`created: 0`) → the merge never re-runs → the canonical keeps the
 *     2026-06-10 title-echo. (Verified on prod: diagnosticContext
 *     `boilerplateDescriptionsDropped: 0`, so the flag IS live.)
 *
 * This script reads the live full bodies via the (fixed) MeetupAdapter and writes
 * them onto the stuck canonical Events directly. It STICKS because the merge
 * won't re-run for these events (the matching raw is deduped) until the kennel
 * themes an event — at which point the merge stores the same full body anyway.
 *
 * Safe & idempotent: only canonical Events whose description is null or a
 * title-echo (lacks the structured run markers) are touched, only when the live
 * body IS rich (carries those markers). `updateMany` guards on the old value.
 * A re-run matches 0 rows. Touching canonical Event.description never disturbs
 * RawEvent fingerprints (those are immutable and computed on RawEvent, not Event).
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-sans-clue-paris-descriptions-2228.ts
 *   Apply:   DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-sans-clue-paris-descriptions-2228.ts --apply
 */
import { runOneShot } from "./lib/one-shot";
import { MeetupAdapter } from "@/adapters/meetup/adapter";

const SOURCE_URL = "https://www.meetup.com/parish3-schhh/events/";
const KENNELS = ["sans-clue-h3", "paris-h3"];
const SAMPLE = 12;

/** A "rich" description carries the kennel's structured run markers — the body
 *  we want to keep. A title-echo ("**Sans Clue H3 R*n 1193 | TBD**") carries none. */
function isRich(s: string | null | undefined): boolean {
  return !!s && /Hash Cash|🐰|👣\s*Trail|🧭\s*Directions/i.test(s);
}

void runOneShot(async ({ prisma, apply }) => {
  const source = await prisma.source.findFirst({ where: { url: SOURCE_URL } });
  if (!source) {
    console.log(`Source "${SOURCE_URL}" not found — nothing to do.`);
    return;
  }

  // Fetch live full bodies via the fixed adapter (keepRepeatedDescription is on
  // in the seeded config). Map (kennelTag|YYYY-MM-DD) -> rich description.
  const result = await new MeetupAdapter().fetch(source, { days: 90 });
  const liveByKey = new Map<string, string>();
  for (const ev of result.events) {
    const desc = ev.description;
    if (!desc || !isRich(desc)) continue; // narrows desc to a non-empty string
    for (const tag of ev.kennelTags) {
      if (KENNELS.includes(tag)) liveByKey.set(`${tag}|${ev.date}`, desc);
    }
  }
  console.log(`Live source: ${result.events.length} events, ${liveByKey.size} rich (kennel,date) bodies`);

  let totalUpdated = 0;
  for (const code of KENNELS) {
    const events = await prisma.event.findMany({
      where: { isCanonical: true, eventKennels: { some: { kennel: { kennelCode: code } } } },
      select: { id: true, date: true, description: true, title: true },
      orderBy: { date: "asc" },
    });

    const stuck: { id: string; date: Date; title: string | null; description: string | null; live: string }[] = [];
    for (const e of events) {
      const live = liveByKey.get(`${code}|${e.date.toISOString().slice(0, 10)}`);
      if (!live) continue; // no live body for this date (narrows live to string)
      if (isRich(e.description)) continue; // canonical already rich — never clobber
      if (e.description === live) continue; // already correct — idempotent
      stuck.push({ ...e, live }); // null or title-echo → backfill
    }

    console.log(`\n${code}: ${stuck.length} stuck event(s) to backfill`);
    stuck.slice(0, SAMPLE).forEach((e) => console.log(`   - ${e.date.toISOString().slice(0, 10)}  ${e.title}`));

    if (apply) {
      for (const e of stuck) {
        // Optimistic guard: only write when the row still holds the stale value.
        const res = await prisma.event.updateMany({
          where: { id: e.id, description: e.description },
          data: { description: e.live },
        });
        totalUpdated += res.count;
      }
      if (stuck.length) console.log(`   ✏️  updated ${stuck.length}`);
    }
  }

  console.log(`\n${apply ? `Applied — ${totalUpdated} event(s) updated.` : "Dry run complete — re-run with --apply to write."}`);
});
