/**
 * WS3 one-shot: rebuild synthesized "<Kennel> Trail #N" titles that disagree
 * with the event's run number (#2850, #2851, #2855).
 *
 * Why the rows are stale: before #2833 (deployed 2026-11-09), a run-number
 * correction updated `Event.runNumber` but `resolveUpdatedTitle` kept the
 * existing synthesized default, so "Sydney Larrikins Trail #2521" survived on
 * run #2520. The merge now rebuilds the default, but only when a NEW RawEvent
 * arrives: every later scrape re-emits the same fingerprint, scrape.ts skips it,
 * and the merge never runs again. A re-scrape cannot repair these rows.
 *
 * What it touches: CONFIRMED, non-admin-locked events with a run number whose
 * title is a synthesized default (`isReplaceableDefaultTitle`). The new title is
 * exactly what the merge would write today: `resolveUpdatedTitle(undefined,
 * title, kennel, runNumber)`. Real, human-authored titles that merely end in
 * "Trail #N" ("Donkey Trail #2", "SWH3 Geezer Trail #25") are never touched.
 *
 * Buckets:
 *   wrong-number    title carries "#M" and M ≠ runNumber      (applied)
 *   missing-number  bare "<Kennel> Trail" / placeholder shell  (only with
 *                   --include-missing-number)
 *
 * Every write is guarded on the old title AND run number, so a row a scrape
 * changed in the meantime is left alone. Idempotent: a second run finds 0.
 * The dry run executes the same UPDATEs inside a transaction and rolls back,
 * so its counts are real row counts.
 *
 * Usage (from the worktree root, prod DATABASE_URL inline):
 *   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 DATABASE_URL=... npx tsx scripts/repair-ws3-stale-default-titles.ts
 *   ... --include-missing-number    also rebuild bare/placeholder defaults
 *   ... --apply                     commit
 */
import { runOneShot } from "./lib/one-shot";
import { isReplaceableDefaultTitle, resolveUpdatedTitle } from "@/pipeline/merge";

export type StaleTitleKind = "wrong-number" | "missing-number";

/** The kennel fields the merge's title helpers read (merge.ts's TitleKennelData). */
type KennelTitleData = Parameters<typeof resolveUpdatedTitle>[2];

const TRAILING_RUN_RE = /#(\d+)\s*$/;
/** #2833 merged 2026-11-09 02:38 UTC; its production deploy finished within minutes. */
const FIX_2833_DEPLOYED_AT = new Date("2026-11-09T02:38:00Z");

/**
 * Plan the title repair for one numbered event. Returns null when the title is
 * a real one or already matches the run number.
 */
export function planTitleRepair(
  title: string | null,
  runNumber: number,
  kennel: KennelTitleData,
): { kind: StaleTitleKind; newTitle: string } | null {
  if (!isReplaceableDefaultTitle(title, kennel)) return null;
  const newTitle = resolveUpdatedTitle(undefined, title, kennel, runNumber, kennel.kennelCode);
  if (newTitle === title) return null;
  const titleRun = TRAILING_RUN_RE.exec(title ?? "")?.[1];
  if (titleRun === undefined) return { kind: "missing-number", newTitle };
  // Same number, only the prefix differs ("psh3 Trail #5"): cosmetic, out of scope.
  if (Number(titleRun) === runNumber) return null;
  return { kind: "wrong-number", newTitle };
}

interface Candidate {
  id: string;
  kennelCode: string;
  date: Date;
  oldTitle: string | null;
  newTitle: string;
  runNumber: number;
  kind: StaleTitleKind;
}

class DryRunRollback extends Error {}

async function main(): Promise<void> {
  const includeMissing = process.argv.includes("--include-missing-number");
  await runOneShot(async ({ prisma, apply }) => {
    const kennels = await prisma.kennel.findMany({
      select: { id: true, kennelCode: true, shortName: true, fullName: true, aliases: { select: { alias: true } } },
    });
    const kennelById = new Map(
      kennels.map((k) => [k.id, {
        kennelCode: k.kennelCode,
        shortName: k.shortName,
        fullName: k.fullName,
        aliases: k.aliases.map((a) => a.alias),
      }]),
    );

    const events = await prisma.event.findMany({
      where: { status: "CONFIRMED", runNumber: { not: null }, adminCancelledAt: null },
      select: { id: true, kennelId: true, date: true, title: true, runNumber: true },
    });

    const candidates: Candidate[] = [];
    for (const e of events) {
      const kennel = kennelById.get(e.kennelId);
      if (!kennel || e.runNumber == null) continue;
      const plan = planTitleRepair(e.title, e.runNumber, kennel);
      if (!plan) continue;
      candidates.push({
        id: e.id, kennelCode: kennel.kennelCode, date: e.date, oldTitle: e.title,
        newTitle: plan.newTitle, runNumber: e.runNumber, kind: plan.kind,
      });
    }

    // A row whose latest RawEvent was merged after #2833 deployed and is still
    // stale would mean the merge still has a gap; expect 0 in both buckets.
    const lastRaw = await prisma.rawEvent.groupBy({
      by: ["eventId"],
      where: { eventId: { in: candidates.map((c) => c.id) } },
      _max: { scrapedAt: true },
    });
    const lastRawById = new Map(lastRaw.map((r) => [r.eventId, r._max.scrapedAt]));

    const today = new Date();
    for (const kind of ["wrong-number", "missing-number"] as const) {
      const rows = candidates.filter((c) => c.kind === kind);
      const upcoming = rows.filter((c) => c.date >= today).length;
      const afterFix = rows.filter((c) => {
        const last = lastRawById.get(c.id);
        return last != null && last > FIX_2833_DEPLOYED_AT;
      }).length;
      const perKennel = new Map<string, number>();
      for (const c of rows) perKennel.set(c.kennelCode, (perKennel.get(c.kennelCode) ?? 0) + 1);
      console.log(`\n== ${kind}: ${rows.length} event(s), ${upcoming} upcoming, ${perKennel.size} kennel(s), ${afterFix} merged after #2833`);
      for (const [code, n] of [...perKennel].sort((a, b) => b[1] - a[1])) console.log(`  ${code}: ${n}`);
      for (const c of rows.slice(0, kind === "wrong-number" ? rows.length : 10)) {
        console.log(`  ${c.id} ${c.kennelCode} ${c.date.toISOString().slice(0, 10)} run ${c.runNumber}: "${c.oldTitle}" → "${c.newTitle}"`);
      }
    }

    const toWrite = candidates.filter((c) => c.kind === "wrong-number" || includeMissing);
    console.log(`\nWriting ${toWrite.length} row(s)${includeMissing ? " (incl. missing-number)" : " (wrong-number only)"}`);

    let updated = 0;
    try {
      await prisma.$transaction(async (tx) => {
        for (const c of toWrite) {
          const res = await tx.event.updateMany({
            where: { id: c.id, title: c.oldTitle, runNumber: c.runNumber, status: "CONFIRMED" },
            data: { title: c.newTitle },
          });
          updated += res.count;
        }
        if (!apply) throw new DryRunRollback();
      }, { timeout: 600_000, maxWait: 60_000 });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) throw err;
    }
    console.log(`${apply ? "Updated" : "Would update (rolled back)"}: ${updated} / ${toWrite.length}`);
  });
}

const isEntrypoint =
  typeof process !== "undefined" && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntrypoint) void main();
