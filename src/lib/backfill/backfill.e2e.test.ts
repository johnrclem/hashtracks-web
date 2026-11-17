/**
 * End-to-end tests of plan, apply, crash-resume, verify and undo against a real
 * Postgres (docs/onboarding-backfill-automation-design.md section 13, Phase 0 exit).
 *
 * They run only when BACKFILL_E2E_DATABASE_URL points at a LOCAL database (a
 * copy of prod, see .claude/rules/local-dev-db.md), and never in CI:
 *
 *   BACKFILL_E2E_DATABASE_URL=postgresql://<you>@localhost:5432/hashtracks_bf npx vitest run src/lib/backfill/backfill.e2e.test.ts
 *
 * Every row they create is under a random kennel code and is deleted afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { RawEventData } from "@/adapters/types";
import { Prisma } from "@/generated/prisma/client";

const URL_ = process.env.BACKFILL_E2E_DATABASE_URL ?? "";
const LOCAL = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(URL_);
if (LOCAL) process.env.DATABASE_URL = URL_;

const suffix = Math.random().toString(36).slice(2, 8);
const CODE = `bf-e2e-${suffix}`;
const SHEET = `https://docs.google.com/spreadsheets/d/bfe2e${suffix}000000000000000`;
const MANIFEST_PATH = `scripts/data/${CODE}-history.manifest.json`;
const ARCHIVE_PATH = `scripts/data/${CODE}-history.json`;

/** Weekly Saturdays from 2023-06-03: runs #1..#140; the live feed has #120..#140 (from 2026-?). */
function saturday(n: number): string {
  return new Date(Date.UTC(2023, 5, 3 + 7 * (n - 1), 12)).toISOString().slice(0, 10);
}
const LAST_RUN = 140;
const FIRST_LIVE = 120;
const row = (n: number): RawEventData => ({
  date: saturday(n),
  kennelTags: [CODE],
  runNumber: n,
  title: `Weekly trail ${n}`,
  hares: `Hare ${String.fromCharCode(65 + (n % 26))}`,
  startTime: "11:00",
  sourceUrl: SHEET,
});

describe.skipIf(!LOCAL)("backfill end to end (local database)", () => {
  // Loaded after DATABASE_URL is set.
  let prisma: typeof import("@/lib/db").prisma;
  let merge: typeof import("@/pipeline/merge");
  let plan: typeof import("./plan");
  let apply: typeof import("./apply");
  let undo: typeof import("./undo");
  let manifestLib: typeof import("./manifest");
  const ids = { region: "", kennel: "", origin: "", archive: "" };
  let archiveBytes = "";
  let manifestBytes = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    merge = await import("@/pipeline/merge");
    plan = await import("./plan");
    apply = await import("./apply");
    undo = await import("./undo");
    manifestLib = await import("./manifest");

    const region = await prisma.region.create({
      data: { name: `BF E2E ${suffix}`, slug: `bf-e2e-${suffix}`, country: "Croatia", level: "METRO", timezone: "Europe/Zagreb", abbrev: "BFE", colorClasses: "bg-blue-200 text-blue-800", pinColor: "#2563eb" },
    });
    const kennel = await prisma.kennel.create({
      data: { kennelCode: CODE, shortName: `BFE2E ${suffix}`, slug: CODE, fullName: `Backfill E2E ${suffix}`, region: region.name, regionId: region.id, country: "Croatia" },
    });
    const origin = await prisma.source.create({
      data: { name: `BF E2E ${suffix} sheet`, url: SHEET, type: "GOOGLE_SHEETS", trustLevel: 7, kennels: { create: { kennelId: kennel.id } } },
    });
    const archive = await prisma.source.create({
      data: { name: `BF E2E ${suffix} run history`, url: SHEET, type: "GOOGLE_SHEETS", trustLevel: 7, enabled: false, archiveOnly: true, config: { upcomingOnly: true }, kennels: { create: { kennelId: kennel.id } } },
    });
    Object.assign(ids, { region: region.id, kennel: kennel.id, origin: origin.id, archive: archive.id });

    // The live feed's stretch, through the ordinary merge.
    const live = [];
    for (let n = FIRST_LIVE; n <= LAST_RUN; n++) live.push(row(n));
    const r = await merge.processRawEvents(origin.id, live);
    expect(r.created).toBe(LAST_RUN - FIRST_LIVE + 1);

    const rows = [];
    for (let n = 1; n <= LAST_RUN; n++) rows.push(row(n));
    archiveBytes = JSON.stringify(rows, null, 2);
    const manifest = manifestLib.buildManifest(archiveBytes, {
      archivePath: ARCHIVE_PATH,
      sourceName: archive.name,
      originSourceName: origin.name,
      binding: "archive-source",
      kennelTimezone: "Europe/Zagreb",
      frozenAt: "2026-02-01",
      expectedKennelCodes: [CODE],
      expectedGaps: [],
      curatedCorrections: [],
    });
    manifestBytes = JSON.stringify(manifest, null, 2);
  }, 120_000);

  afterAll(async () => {
    if (!prisma || !ids.kennel) return;
    await prisma.kennel.update({ where: { id: ids.kennel }, data: { archiveCutoffDate: null, archiveCutoffRunId: null } });
    const runs = await prisma.backfillRun.findMany({ where: { kennelId: ids.kennel }, select: { id: true } });
    await prisma.backfillRunItem.deleteMany({ where: { runId: { in: runs.map((r) => r.id) } } });
    await prisma.backfillRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
    const events = await prisma.event.findMany({ where: { kennelId: ids.kennel }, select: { id: true } });
    const eventIds = events.map((e) => e.id);
    await prisma.rawEvent.deleteMany({ where: { OR: [{ sourceId: { in: [ids.origin, ids.archive] } }, { eventId: { in: eventIds } }] } });
    await prisma.eventKennel.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.sourceKennel.deleteMany({ where: { kennelId: ids.kennel } });
    await prisma.scrapeLog.deleteMany({ where: { sourceId: { in: [ids.origin, ids.archive] } } });
    await prisma.source.deleteMany({ where: { id: { in: [ids.origin, ids.archive] } } });
    await prisma.kennel.delete({ where: { id: ids.kennel } });
    await prisma.region.delete({ where: { id: ids.region } });
  }, 120_000);

  const planInput = (overrides: Partial<import("./plan").PlanInput> = {}): import("./plan").PlanInput => ({
    prNumber: 999_001,
    manifestPath: MANIFEST_PATH,
    manifestBytes,
    archiveBytes,
    changedFiles: [MANIFEST_PATH, ARCHIVE_PATH, "prisma/migrations/20990101000000_onboard_bf_e2e/migration.sql"],
    migrationSql: [],
    mergeSha: "s".repeat(40),
    stampedSha: "h".repeat(40),
    mergedHeadSha: "h".repeat(40),
    deployedSha: "d".repeat(40),
    preview: false,
    startedBy: "backfill-agent",
    ...overrides,
  });

  it("a preview plans without blocking the manifest", async () => {
    const preview = await plan.planBackfill(planInput({ preview: true }));
    expect(preview.run.status).toBe("PREVIEW");
    expect(preview.reasons).toEqual([]);
  }, 120_000);

  it("undo mid-run removes rows a crashed batch wrote without items, and clears the cutoff", async () => {
    const r1Bytes = JSON.stringify((JSON.parse(archiveBytes) as RawEventData[]).map((r) => ({ ...r, title: `${r.title} (first)` })));
    const m1 = manifestLib.buildManifest(r1Bytes, { ...JSON.parse(manifestBytes), archivePath: ARCHIVE_PATH.replace(".json", "-r1.json") });
    const r1Path = MANIFEST_PATH.replace(".manifest", "-r1.manifest");
    const planned = await plan.planBackfill(planInput({ manifestBytes: JSON.stringify(m1), manifestPath: r1Path, changedFiles: [r1Path], archiveBytes: r1Bytes, prNumber: 999_003 }));
    expect(planned.reasons).toEqual([]);
    const opts = { by: "backfill-agent", archiveBytes: r1Bytes, deployedSha: "d".repeat(40) };

    // A run halted before its cutoff resumes through the cutoff step, never straight to writing.
    await prisma.backfillRun.update({ where: { id: planned.run.id }, data: { status: "HALTED" } });
    expect((await apply.advanceRun(planned.run.id, { ...opts, resume: true })).status).toBe("CUTOFF_SET");

    expect((await apply.advanceRun(planned.run.id, opts)).status).toBe("BATCH_WRITTEN");
    const stored = planned.run.plan as unknown as import("./plan").StoredPlan;
    const crashed = stored.toWrite.slice(plan.FIRST_BATCH_ROWS, plan.FIRST_BATCH_ROWS + 20).map((r) => r.index);
    const rows = JSON.parse(r1Bytes) as RawEventData[];
    await merge.processRawEvents(ids.archive, crashed.slice(0, 5).map((i) => plan.normalizeArchiveRow(rows[i])), { backfill: {} });
    await prisma.backfillRun.update({ where: { id: planned.run.id }, data: { inFlightBatch: crashed, leaseToken: "dead", leaseExpiresAt: new Date(Date.now() - 1000) } });

    const { plan: undoPlan, hash } = await undo.buildUndoPlan(planned.run.id);
    expect(undoPlan.deleteEventIds).toHaveLength(plan.FIRST_BATCH_ROWS + 5);
    let u = await undo.applyUndo(planned.run.id, { confirmedHash: hash, by: "admin" });
    for (let i = 0; i < 5 && u.status === "UNDOING"; i++) u = await undo.applyUndo(planned.run.id, { by: "admin" });
    expect(u.status).toBe("UNDONE");
    expect(await prisma.rawEvent.count({ where: { sourceId: ids.archive } })).toBe(0);
    expect(await prisma.event.count({ where: { kennelId: ids.kennel } })).toBe(LAST_RUN - FIRST_LIVE + 1);
    expect((await prisma.kennel.findUniqueOrThrow({ where: { id: ids.kennel } })).archiveCutoffDate).toBeNull();
  }, 300_000);

  it("plans, applies across batches, survives a crash mid-batch, verifies, and undoes", async () => {
    const planned = await plan.planBackfill(planInput());
    expect(planned.reasons).toEqual([]);
    expect(planned.run.status).toBe("PLANNED");
    const stored = planned.run.plan as unknown as import("./plan").StoredPlan;
    expect(stored.splitDate).toBe(saturday(FIRST_LIVE));
    expect(stored.toWrite).toHaveLength(FIRST_LIVE - 1);
    expect(stored.liveOwned).toHaveLength(LAST_RUN - FIRST_LIVE + 1);
    // Planning again returns the same run (10.1).
    expect((await plan.planBackfill(planInput())).run.id).toBe(planned.run.id);

    const opts = { by: "backfill-agent", archiveBytes, deployedSha: "d".repeat(40) };
    const cutoff = await apply.advanceRun(planned.run.id, opts);
    expect(cutoff.status).toBe("CUTOFF_SET");
    expect((await prisma.kennel.findUniqueOrThrow({ where: { id: ids.kennel } })).archiveCutoffDate?.toISOString().slice(0, 10)).toBe(saturday(FIRST_LIVE));

    const first = await apply.advanceRun(planned.run.id, opts);
    expect(first.status).toBe("BATCH_WRITTEN");
    expect((await prisma.backfillRun.findUniqueOrThrow({ where: { id: planned.run.id } })).cursor).toBe(plan.FIRST_BATCH_ROWS);

    // Crash: the next batch's merge writes 5 rows and dies before bookkeeping.
    const crashed = stored.toWrite.slice(plan.FIRST_BATCH_ROWS, plan.FIRST_BATCH_ROWS + 20).map((r) => r.index);
    const rows = JSON.parse(archiveBytes) as RawEventData[];
    const written = crashed.slice(0, 5).map((i) => plan.normalizeArchiveRow(rows[i]));
    await merge.processRawEvents(ids.archive, written, { backfill: {} });
    await prisma.backfillRun.update({
      where: { id: planned.run.id },
      data: { inFlightBatch: crashed, leaseToken: "dead", leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    let result = await apply.advanceRun(planned.run.id, opts);
    for (let i = 0; i < 20 && result.status !== "VERIFIED" && result.status !== "VERIFY_FAILED" && result.status !== "HALTED"; i++) {
      result = await apply.advanceRun(planned.run.id, opts);
    }
    expect(result.status).toBe("VERIFIED");

    const items = await prisma.backfillRunItem.findMany({ where: { runId: planned.run.id } });
    expect(items.filter((i) => i.outcome === "CREATED")).toHaveLength(FIRST_LIVE - 1);
    expect(items.filter((i) => i.outcome === "LIVE_OWNED")).toHaveLength(LAST_RUN - FIRST_LIVE + 1);
    expect(await prisma.event.count({ where: { kennelId: ids.kennel } })).toBe(LAST_RUN);
    expect(await prisma.rawEvent.count({ where: { sourceId: ids.archive, processed: true } })).toBe(FIRST_LIVE - 1);
    const done = await prisma.backfillRun.findUniqueOrThrow({ where: { id: planned.run.id } });
    expect(done.statusLines).toMatchObject({ before: expect.anything(), after: expect.anything() });

    // The cutoff now drops any other source's row before C.
    const wide = await merge.processRawEvents(ids.origin, [{ ...row(5), title: "Rewritten history" }]);
    expect(wide.archiveCutoffDropped).toBe(1);
    expect(await prisma.event.count({ where: { kennelId: ids.kennel, title: "Rewritten history" } })).toBe(0);

    // A misman hare on one written event: undo keeps that event and the cutoff.
    const keptItem = items.find((i) => i.outcome === "CREATED")!;
    await prisma.eventHare.create({ data: { eventId: keptItem.eventId!, hareName: "Misman pick", sourceType: "MISMAN_SYNC" } });

    // Undo: plan, confirm with its hash, then batches until UNDONE.
    const { plan: undoPlan, hash } = await undo.buildUndoPlan(planned.run.id);
    expect(undoPlan.deleteEventIds).toHaveLength(FIRST_LIVE - 2);
    expect(undoPlan.keep).toEqual([{ eventId: keptItem.eventId, reason: "hare entered by a user or misman" }]);
    expect((await undo.applyUndo(planned.run.id, { confirmedHash: "wrong", by: "admin" })).status).toBe("PLAN_CHANGED");
    let u = await undo.applyUndo(planned.run.id, { confirmedHash: hash, by: "admin" });
    for (let i = 0; i < 5 && u.status === "UNDOING"; i++) u = await undo.applyUndo(planned.run.id, { by: "admin" });
    expect(u.status).toBe("UNDONE");
    expect(u.status === "UNDONE" && [u.deleted, u.kept]).toEqual([FIRST_LIVE - 2, 1]);
    expect(await prisma.event.count({ where: { kennelId: ids.kennel } })).toBe(LAST_RUN - FIRST_LIVE + 2);
    // The kept event keeps its RawEvent; every other archive RawEvent is hard-deleted.
    expect(await prisma.rawEvent.count({ where: { sourceId: ids.archive } })).toBe(1);
    // Something was kept, so the cutoff stays for the owner (10.3).
    expect((await prisma.kennel.findUniqueOrThrow({ where: { id: ids.kennel } })).archiveCutoffDate).not.toBeNull();
    await prisma.eventHare.deleteMany({ where: { eventId: keptItem.eventId! } });
  }, 300_000);

  it.each([
    ["G12: an archive source that is replaced", async () => prisma.source.update({ where: { id: ids.archive }, data: { replacedById: ids.origin } }), async () => prisma.source.update({ where: { id: ids.archive }, data: { replacedById: null } })],
    ["G12: an archive source that out-trusts the origin", async () => prisma.source.update({ where: { id: ids.archive }, data: { trustLevel: 9 } }), async () => prisma.source.update({ where: { id: ids.archive }, data: { trustLevel: 7 } })],
    ["G5: the origin routes to another kennel", async () => prisma.source.update({ where: { id: ids.origin }, data: { config: { defaultKennelTag: "nych3" } } }), async () => prisma.source.update({ where: { id: ids.origin }, data: { config: Prisma.DbNull } })],
    ["G19: the kennel already has a cutoff", async () => prisma.kennel.update({ where: { id: ids.kennel }, data: { archiveCutoffDate: new Date("2020-01-01T12:00:00Z") } }), async () => prisma.kennel.update({ where: { id: ids.kennel }, data: { archiveCutoffDate: null } })],
  ] as const)("a preview reports %s", async (label, breakIt, restore) => {
    await breakIt();
    try {
      const preview = await plan.planBackfill(planInput({ preview: true }));
      expect(preview.run.status).toBe("PREVIEW");
      expect(preview.reasons.join(" ")).toContain(label.split(":")[0]);
    } finally {
      await restore();
    }
  }, 120_000);

  it("a preview reports G18 when the kennel gains a second enabled source", async () => {
    const second = await prisma.source.create({ data: { name: `BF E2E ${suffix} second`, url: "https://example.org/x", type: "HTML_SCRAPER", kennels: { create: { kennelId: ids.kennel } } } });
    try {
      const preview = await plan.planBackfill(planInput({ preview: true }));
      expect(preview.reasons.join(" ")).toMatch(/G18/);
    } finally {
      await prisma.sourceKennel.deleteMany({ where: { sourceId: second.id } });
      await prisma.source.delete({ where: { id: second.id } });
    }
  }, 120_000);

  it("blocks a fresh manifest when an event already sits on an archive date (G9)", async () => {
    const rows = JSON.parse(archiveBytes) as RawEventData[];
    const extra = rows.map((r) => ({ ...r, title: `${r.title}.` }));
    const bytes = JSON.stringify(extra);
    const manifest = manifestLib.buildManifest(bytes, { ...JSON.parse(manifestBytes), archivePath: ARCHIVE_PATH.replace(".json", "-r2.json") });
    const event = await prisma.event.create({
      data: { kennelId: ids.kennel, date: new Date(`${saturday(3)}T12:00:00Z`), title: "Hand entry", trustLevel: 5, eventKennels: { create: { kennelId: ids.kennel, isPrimary: true } } },
    });
    try {
      const blocked = await plan.planBackfill(planInput({
        manifestBytes: JSON.stringify(manifest),
        manifestPath: MANIFEST_PATH.replace(".manifest", "-r2.manifest"),
        changedFiles: [MANIFEST_PATH.replace(".manifest", "-r2.manifest")],
        archiveBytes: bytes,
        prNumber: 999_002,
      }));
      expect(blocked.run.status).toBe("BLOCKED");
      expect(blocked.reasons.join(" ")).toMatch(/G9/);
    } finally {
      await prisma.eventKennel.deleteMany({ where: { eventId: event.id } });
      await prisma.event.delete({ where: { id: event.id } });
    }
  }, 120_000);

  it("applies a sample onboarding migration that creates an archive source, with the CHECK in place", async () => {
    const { SAMPLE_ARCHIVE_ONBOARDING } = await import("./migration-check.test-fixtures");
    const { Client } = await import("pg");
    const client = new Client({ connectionString: URL_ });
    await client.connect();
    try {
      await client.query(SAMPLE_ARCHIVE_ONBOARDING);
      const src = await client.query(`SELECT enabled, "archiveOnly" FROM "Source" WHERE id = 'src_g17_archive'`);
      expect(src.rows[0]).toEqual({ enabled: false, archiveOnly: true });
      await expect(client.query(`UPDATE "Source" SET enabled = true WHERE id = 'src_g17_archive'`)).rejects.toThrow(/Source_archiveOnly_not_enabled/);
      await expect(client.query(SAMPLE_ARCHIVE_ONBOARDING)).resolves.toBeDefined(); // idempotent re-run
    } finally {
      await client.query("ROLLBACK"); // in case a statement above left the transaction aborted
      await client.query(`DELETE FROM "SourceKennel" WHERE "sourceId" IN ('src_g17_archive', 'src_g17_live')`);
      await client.query(`DELETE FROM "Source" WHERE id IN ('src_g17_archive', 'src_g17_live')`);
      await client.query(`DELETE FROM "Kennel" WHERE id = 'knl_g17_test'`);
      await client.query(`DELETE FROM "Region" WHERE id = 'rgn_g17_test'`);
      await client.end();
    }
  }, 60_000);
});
