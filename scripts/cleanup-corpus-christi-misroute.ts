/**
 * One-shot cleanup for the Corpus Christi area calendar mis-attribution.
 *
 * Background:
 *   "Corpus Christi H3 Calendar" (c2h3hash@gmail.com) is actually a shared
 *   Corpus Christi-area calendar: ~70% of its events are Bay Area Larrikins
 *   (BALH3 → `balh3`) or Coastal Bend (CBH3 → `cbh3-cc`) runs, not C2H3. With no
 *   kennelPatterns, every event routed to `c2h3`, so ~233+ BALH3 trails landed
 *   on the Corpus Christi H3 kennel page. The seed fix adds kennelPatterns +
 *   includeAllDayEvents so future scrapes route correctly; this script reassigns
 *   the already-mis-routed canonical Events off `c2h3`.
 *
 * Why re-route live instead of matching titles:
 *   Bare-summary BALH3 events ("BALH3 -") had their title taken from the GCal
 *   DESCRIPTION by the pre-#2046 fallback ("Who is the Hare: …" → "Who is the"),
 *   so the canonical title is unreliable. Every c2h3 Event DOES carry a stable
 *   `sourceUrl` (the GCal htmlLink), so we re-run the adapter with the seeded
 *   config and map sourceUrl → correct kennelTag — the same routing the live
 *   scrape will use. CBH3 events were all-day and never ingested, so none exist
 *   under c2h3 to reassign (the scrape creates them fresh).
 *
 * Strategy (reassign, not delete — per the aggregator-misroute convention):
 *   - For each c2h3 Event whose sourceUrl re-routes to balh3 / cbh3-cc:
 *       · target has no Event that day → REASSIGN (Event.kennelId + its
 *         EventKennel → target). The next scrape UPDATEs it in place and
 *         refreshes the title (summaryIsCanonicalTitle).
 *       · target already has that day (a scrape beat us) → the c2h3 row is a
 *         stale dup → DELETE via the race-safe helper (zero attendances).
 *   - Recompute lastEventDate for all kennels.
 *
 * Run AFTER `npx prisma db seed` (so balh3 / cbh3-cc + the kennelPatterns exist)
 * and ideally BEFORE the next scrape (reassign-before-insert).
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-corpus-christi-misroute.ts
 *   Apply:   npx tsx scripts/cleanup-corpus-christi-misroute.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { Source } from "@/generated/prisma/client";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

function utcDayBounds(date: Date): { gte: Date; lte: Date } {
  const d = date.toISOString().slice(0, 10);
  return { gte: new Date(`${d}T00:00:00.000Z`), lte: new Date(`${d}T23:59:59.999Z`) };
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  const [c2h3, balh3, cbh3cc, source] = await Promise.all([
    prisma.kennel.findUnique({ where: { kennelCode: "c2h3" }, select: { id: true } }),
    prisma.kennel.findUnique({ where: { kennelCode: "balh3" }, select: { id: true } }),
    prisma.kennel.findUnique({ where: { kennelCode: "cbh3-cc" }, select: { id: true } }),
    prisma.source.findFirst({ where: { name: "Corpus Christi H3 Calendar" } }),
  ]);
  if (!c2h3 || !balh3 || !cbh3cc || !source) {
    console.error(`Missing anchor(s): c2h3=${!!c2h3} balh3=${!!balh3} cbh3-cc=${!!cbh3cc} source=${!!source}`);
    console.error("Run `npx prisma db seed` first so the new kennels + routing exist.");
    process.exitCode = 1;
    return;
  }
  const targetByTag: Record<string, string> = { balh3: balh3.id, "cbh3-cc": cbh3cc.id };

  // Re-route the live calendar with the SEEDED config (same routing the scrape
  // uses) → stable sourceUrl ⇒ correct kennelTag.
  const res = await new GoogleCalendarAdapter().fetch(source as Source, { days: 3650 });
  const urlToTag = new Map<string, string>();
  for (const e of res.events) {
    const tag = e.kennelTags[0];
    if (e.sourceUrl && (tag === "balh3" || tag === "cbh3-cc")) urlToTag.set(e.sourceUrl, tag);
  }
  console.log(`Live re-route: ${urlToTag.size} sourceUrls map to balh3 / cbh3-cc`);

  const events = await prisma.event.findMany({
    where: { kennelId: c2h3.id },
    select: { id: true, date: true, title: true, sourceUrl: true },
  });
  console.log(`c2h3 canonical events: ${events.length}`);

  let reassigned = 0, deleted = 0;
  const byTag: Record<string, number> = { balh3: 0, "cbh3-cc": 0 };
  for (const ev of events) {
    if (!ev.sourceUrl) continue;
    const tag = urlToTag.get(ev.sourceUrl);
    if (!tag) continue; // stays c2h3 — real C2H3, noise, or outside the fetch window
    const targetId = targetByTag[tag];
    const { gte, lte } = utcDayBounds(ev.date);
    const existing = await prisma.event.findFirst({
      where: { kennelId: targetId, date: { gte, lte }, id: { not: ev.id } },
      select: { id: true },
    });

    if (existing) {
      console.log(`  DELETE stale dup ${ev.id} (${ev.date.toISOString().slice(0, 10)} "${ev.title ?? ""}") — ${tag} ${existing.id} already canonical`);
      if (apply) await deleteLeakedEvent(prisma, ev.id, ["attendances", "kennelAttendances"]);
      deleted++;
    } else {
      console.log(`  REASSIGN ${ev.id} (${ev.date.toISOString().slice(0, 10)} "${ev.title ?? ""}") c2h3 → ${tag}`);
      if (apply) {
        await prisma.eventKennel.updateMany({ where: { eventId: ev.id, kennelId: c2h3.id }, data: { kennelId: targetId } });
        await prisma.event.update({ where: { id: ev.id }, data: { kennelId: targetId } });
      }
      reassigned++;
      byTag[tag]++;
    }
  }

  console.log(`\n${apply ? "Applied" : "Would"}: reassign ${reassigned} (balh3 ${byTag.balh3}, cbh3-cc ${byTag["cbh3-cc"]}), delete ${deleted}`);
  if (apply && (reassigned > 0 || deleted > 0)) {
    const n = await backfillLastEventDates();
    console.log(`Recomputed lastEventDate for ${n} kennel(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
