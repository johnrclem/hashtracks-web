/**
 * WS11 one-time cleanup: far-future rows nobody posted.
 *
 * - bobbh3 / pormeh3: events more than 365 days ahead with no RawEvent at all
 *   (orphans of calendar recurrences that no longer exist).
 * - bullmoon: events more than 365 days ahead whose every RawEvent came from
 *   the Bull Moon source. The adapter now keeps only runs up to 365 days ahead,
 *   so a scrape won't recreate them.
 *
 * Rows with any check-in, RSVP, misman attendance or user-entered hare, and
 * series parents with children, are held back and listed for the owner.
 *
 * Deletes go through `deleteLeakedEvent` (row lock, required-empty guards,
 * provenance guard), then the touched (kennel, date) slots get their canonical
 * pick recomputed and every kennel's `lastEventDate` is recomputed.
 *
 * Usage:
 *   Dry run (writes the id list):
 *     npx tsx scripts/cleanup-ws11-far-future-events.ts --out <plan.json>
 *   Apply that exact list (each row is re-checked first):
 *     npx tsx scripts/cleanup-ws11-far-future-events.ts --apply --plan <plan.json>
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { getTodayUtcNoon, parseUtcNoonDate } from "@/lib/date";
import { DAY_MS } from "@/lib/kennel-status";
import { deleteLeakedEvent, recomputeCanonicalForSlots } from "@/lib/delete-leaked-event";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { parseApplyMode } from "./lib/cleanup-cli";

const ORPHAN_KENNELS = ["bobbh3", "pormeh3"];
const BULLMOON_KENNEL = "bullmoon";
const BULLMOON_SOURCE_NAME = "Bull Moon Upcoming Runs";
const HORIZON_DAYS = 365;

type Group = "orphan" | "bullmoon";

interface PlanRow {
  id: string;
  kennelCode: string;
  kennelId: string;
  date: string;
  title: string | null;
  status: string;
  group: Group;
}

interface Plan {
  createdAt: string;
  horizon: string;
  bullmoonSourceId: string;
  delete: PlanRow[];
  heldBack: Array<PlanRow & { reason: string }>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function bullmoonSourceId(): Promise<string> {
  const source = await prisma.source.findFirst({ where: { name: BULLMOON_SOURCE_NAME }, select: { id: true } });
  if (!source) throw new Error(`Source "${BULLMOON_SOURCE_NAME}" not found`);
  return source.id;
}

/** Candidate rows, each with the reason to hold it back (null = delete). */
async function candidates(horizon: Date, sourceId: string) {
  const rows = await prisma.event.findMany({
    where: {
      date: { gt: horizon },
      kennel: { kennelCode: { in: [...ORPHAN_KENNELS, BULLMOON_KENNEL] } },
    },
    select: {
      id: true,
      date: true,
      title: true,
      status: true,
      kennelId: true,
      isSeriesParent: true,
      kennel: { select: { kennelCode: true } },
      rawEvents: { select: { sourceId: true } },
      _count: { select: { attendances: true, kennelAttendances: true, childEvents: true } },
      hares: { where: { OR: [{ userId: { not: null } }, { sourceType: { not: "SCRAPED" } }] }, select: { id: true } },
    },
    orderBy: [{ kennelId: "asc" }, { date: "asc" }],
  });

  const out: Array<{ row: PlanRow; reason: string | null }> = [];
  for (const e of rows) {
    const code = e.kennel.kennelCode;
    let group: Group;
    if (code === BULLMOON_KENNEL) {
      // Only rows the Bull Moon source alone backs.
      if (e.rawEvents.length === 0 || e.rawEvents.some((r) => r.sourceId !== sourceId)) continue;
      group = "bullmoon";
    } else {
      if (e.rawEvents.length > 0) continue;
      group = "orphan";
    }
    const reasons: string[] = [];
    if (e._count.attendances > 0) reasons.push(`${e._count.attendances} check-in/RSVP`);
    if (e._count.kennelAttendances > 0) reasons.push(`${e._count.kennelAttendances} misman attendance`);
    if (e.hares.length > 0) reasons.push(`${e.hares.length} user-entered hare`);
    if (e._count.childEvents > 0) reasons.push(`series parent with ${e._count.childEvents} children`);
    out.push({
      row: {
        id: e.id,
        kennelCode: code,
        kennelId: e.kennelId,
        date: e.date.toISOString().slice(0, 10),
        title: e.title,
        status: e.status,
        group,
      },
      reason: reasons.length ? reasons.join(", ") : null,
    });
  }
  return out;
}

type KennelSummary = { count: number; first: string; last: string; byStatus: Record<string, number> };

function summarize(rows: PlanRow[]): Record<string, KennelSummary> {
  const out: Record<string, KennelSummary> = {};
  for (const r of rows) {
    const s = (out[r.kennelCode] ??= { count: 0, first: r.date, last: r.date, byStatus: {} });
    s.count++;
    if (r.date < s.first) s.first = r.date;
    if (r.date > s.last) s.last = r.date;
    s.byStatus[r.status] = (s.byStatus[r.status] ?? 0) + 1;
  }
  return out;
}

async function dryRun(outPath: string) {
  const today = new Date();
  const horizon = new Date(getTodayUtcNoon(today) + HORIZON_DAYS * DAY_MS);
  const sourceId = await bullmoonSourceId();
  const found = await candidates(horizon, sourceId);
  const plan: Plan = {
    createdAt: today.toISOString(),
    horizon: horizon.toISOString(),
    bullmoonSourceId: sourceId,
    delete: found.filter((f) => f.reason === null).map((f) => f.row),
    heldBack: found.filter((f) => f.reason !== null).map((f) => ({ ...f.row, reason: f.reason! })),
  };
  writeFileSync(outPath, JSON.stringify(plan, null, 2));
  console.log(`DRY RUN — horizon ${plan.horizon.slice(0, 10)} — plan written to ${outPath}`);
  console.log("To delete, per kennel:", JSON.stringify(summarize(plan.delete), null, 2));
  console.log(`Total to delete: ${plan.delete.length}`);
  console.log(`Held back: ${plan.heldBack.length}`);
  for (const h of plan.heldBack) console.log(`  ${h.id} ${h.kennelCode} ${h.date} ${h.title ?? ""} — ${h.reason}`);
}

async function apply(planPath: string) {
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
  // Re-check each planned row: it must still qualify (beyond the later of the
  // plan's horizon and today's, so a row the capped adapter now keeps is never
  // deleted) and not have gained attendance, RSVPs or user hares.
  const horizon = new Date(Math.max(Date.parse(plan.horizon), getTodayUtcNoon() + HORIZON_DAYS * DAY_MS));
  const current = new Map((await candidates(horizon, plan.bullmoonSourceId)).map((c) => [c.row.id, c]));
  // Every planned slot is recomputed, deleted this run or on an earlier one, so
  // a retry after a failed recompute still repairs them (recompute is idempotent).
  const slots = plan.delete.map((row) => ({ kennelId: row.kennelId, date: parseUtcNoonDate(row.date) }));
  const result = { deleted: 0, missing: 0, skipped: [] as string[], refused: [] as string[] };
  for (const row of plan.delete) {
    const now = current.get(row.id);
    if (!now || now.reason !== null) {
      result.skipped.push(`${row.id} (${now?.reason ?? "no longer qualifies"})`);
      continue;
    }
    try {
      const outcome = await deleteLeakedEvent(
        prisma,
        row.id,
        row.group === "orphan"
          ? ["attendances", "kennelAttendances", "rawEvents"]
          : ["attendances", "kennelAttendances"],
        row.group === "bullmoon" ? plan.bullmoonSourceId : undefined,
        { forbidUserHares: true, forbidChildren: true },
      );
      if (outcome === "deleted") {
        result.deleted++;
        // The row's current slot, in case its kennel or date moved since the dry run.
        slots.push({ kennelId: now.row.kennelId, date: parseUtcNoonDate(now.row.date) });
      } else {
        result.missing++;
      }
    } catch (err) {
      result.refused.push(`${row.id}: ${(err as Error).message}`);
    }
  }
  const recomputed = await recomputeCanonicalForSlots(slots);
  const lastEventUpdated = await backfillLastEventDates();
  console.log(
    JSON.stringify({ ...result, planned: plan.delete.length, slotsRecomputed: recomputed, lastEventDateRowsUpdated: lastEventUpdated }, null, 2),
  );
}

async function main() {
  if (parseApplyMode()) {
    const planPath = arg("--plan");
    if (!planPath) throw new Error("--apply needs --plan <plan.json> from a dry run");
    await apply(planPath);
  } else {
    await dryRun(arg("--out") ?? "ws11-cleanup-plan.json");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
