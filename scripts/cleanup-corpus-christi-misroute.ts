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

interface Anchors {
  c2h3Id: string;
  source: Source;
  /** kennelTag → kennel id, for the kennels we reassign INTO. */
  targetByTag: Map<string, string>;
}

function utcDayBounds(date: Date): { gte: Date; lte: Date } {
  const d = date.toISOString().slice(0, 10);
  return { gte: new Date(`${d}T00:00:00.000Z`), lte: new Date(`${d}T23:59:59.999Z`) };
}

async function loadAnchors(): Promise<Anchors | null> {
  const [c2h3, balh3, cbh3cc, source] = await Promise.all([
    prisma.kennel.findUnique({ where: { kennelCode: "c2h3" }, select: { id: true } }),
    prisma.kennel.findUnique({ where: { kennelCode: "balh3" }, select: { id: true } }),
    prisma.kennel.findUnique({ where: { kennelCode: "cbh3-cc" }, select: { id: true } }),
    prisma.source.findFirst({ where: { name: "Corpus Christi H3 Calendar" } }),
  ]);
  if (!c2h3 || !balh3 || !cbh3cc || !source) {
    console.error(`Missing anchor(s): c2h3=${!!c2h3} balh3=${!!balh3} cbh3-cc=${!!cbh3cc} source=${!!source}`);
    console.error("Run `npx prisma db seed` first so the new kennels + routing exist.");
    return null;
  }
  return {
    c2h3Id: c2h3.id,
    source,
    targetByTag: new Map([["balh3", balh3.id], ["cbh3-cc", cbh3cc.id]]),
  };
}

/**
 * Re-route the live calendar with the seeded config (the same routing the scrape
 * uses) and map each stable sourceUrl → the kennelTag we reassign INTO. Throws on
 * a failed/empty fetch so a bad API response can't be mistaken for "nothing to do".
 */
async function buildUrlToTagMap(source: Source, targetByTag: Map<string, string>): Promise<Map<string, string>> {
  const res = await new GoogleCalendarAdapter().fetch(source, { days: 3650 });
  if (res.errors.length > 0) {
    throw new Error(`Calendar fetch returned errors; aborting: ${JSON.stringify(res.errors)}`);
  }
  if (res.events.length === 0) {
    throw new Error("Calendar fetch returned zero events; aborting (likely a failed fetch, not an empty calendar).");
  }
  const urlToTag = new Map<string, string>();
  for (const e of res.events) {
    const tag = e.kennelTags[0];
    if (e.sourceUrl && targetByTag.has(tag)) urlToTag.set(e.sourceUrl, tag);
  }
  return urlToTag;
}

async function reassignEvents(anchors: Anchors, urlToTag: Map<string, string>, apply: boolean) {
  const { c2h3Id, targetByTag } = anchors;
  const events = await prisma.event.findMany({
    where: { kennelId: c2h3Id },
    select: { id: true, date: true, title: true, sourceUrl: true },
  });
  console.log(`c2h3 canonical events: ${events.length}`);

  let reassigned = 0, deleted = 0;
  const byTag = new Map<string, number>();
  for (const ev of events) {
    const tag = ev.sourceUrl ? urlToTag.get(ev.sourceUrl) : undefined;
    const targetId = tag ? targetByTag.get(tag) : undefined;
    if (!tag || !targetId) continue; // stays c2h3 — real C2H3, noise, or outside the window
    const day = ev.date.toISOString().slice(0, 10);
    const { gte, lte } = utcDayBounds(ev.date);
    const existing = await prisma.event.findFirst({
      where: { kennelId: targetId, date: { gte, lte }, id: { not: ev.id } },
      select: { id: true },
    });
    if (existing) {
      console.log(`  DELETE stale dup ${ev.id} (${day} "${ev.title ?? ""}") — ${tag} ${existing.id} already canonical`);
      if (apply) await deleteLeakedEvent(prisma, ev.id, ["attendances", "kennelAttendances"]);
      deleted++;
    } else {
      console.log(`  REASSIGN ${ev.id} (${day} "${ev.title ?? ""}") c2h3 → ${tag}`);
      if (apply) {
        await prisma.eventKennel.updateMany({ where: { eventId: ev.id, kennelId: c2h3Id }, data: { kennelId: targetId } });
        await prisma.event.update({ where: { id: ev.id }, data: { kennelId: targetId } });
      }
      reassigned++;
      byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
    }
  }
  return { reassigned, deleted, byTag };
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  const anchors = await loadAnchors();
  if (!anchors) { process.exitCode = 1; return; }

  const urlToTag = await buildUrlToTagMap(anchors.source, anchors.targetByTag);
  console.log(`Live re-route: ${urlToTag.size} sourceUrls map to balh3 / cbh3-cc`);

  const { reassigned, deleted, byTag } = await reassignEvents(anchors, urlToTag, apply);
  console.log(`\n${apply ? "Applied" : "Would"}: reassign ${reassigned} (balh3 ${byTag.get("balh3") ?? 0}, cbh3-cc ${byTag.get("cbh3-cc") ?? 0}), delete ${deleted}`);
  if (apply && (reassigned > 0 || deleted > 0)) {
    const n = await backfillLastEventDates();
    console.log(`Recomputed lastEventDate for ${n} kennel(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
