import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRaw: vi.fn().mockResolvedValue(3),
  },
}));

import { prisma } from "@/lib/db";
import { refreshKennelEvidence, refreshScheduleOnlyFlags } from "./kennel-evidence";

beforeEach(() => {
  vi.clearAllMocks();
});

/** The single Prisma.Sql the function handed to `$executeRaw`. */
function lastQuery(): Prisma.Sql {
  const calls = vi.mocked(prisma.$executeRaw).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0] as unknown as Prisma.Sql;
}

/** SQL text with whitespace collapsed, so assertions don't depend on indentation. */
function sqlText(query: Prisma.Sql): string {
  return query.sql.replaceAll(/\s+/g, " ");
}

describe("refreshScheduleOnlyFlags", () => {
  it("treats STATIC_SCHEDULE and detail-less repeating instances as schedule", async () => {
    await refreshScheduleOnlyFlags("all");
    const sql = sqlText(lastQuery());
    expect(sql).toContain(`'STATIC_SCHEDULE'`);
    expect(sql).toContain(`'recurringSeriesId'`);
    expect(sql).toContain(`'hares'`);
    expect(sql).toContain(`'runNumber'`);
    expect(sql).toContain(`UPDATE "Event"`);
    expect(sql).toContain(`"isScheduleOnly"`);
  });

  it("counts blank and placeholder hares as no hares, matching isPlaceholderText", async () => {
    await refreshScheduleOnlyFlags("all");
    const query = lastQuery();
    const sql = sqlText(query);
    // Trims tabs and newlines too, not only spaces.
    const trimmed = `regexp_replace(r."rawData"->>'hares', '^[[:space:]]+|[[:space:]]+$', '', 'g')`;
    expect(sql).toContain(`COALESCE(${trimmed}, '') = ''`);
    // One case-insensitive anchored pattern per isPlaceholderText regex (src/adapters/utils.ts).
    expect(sql).toContain(`${trimmed} ~* '^(venue[[:space:]-]+)?(tbd|tba|tbc)$'`);
    expect(sql).toContain(
      `${trimmed} ~* '^(n/a|none|null|needed|required|registration|sign[[:space:]_-]*up!?|volunteer|vacant|[?]{1,3})$'`,
    );
    expect(sql).toContain(
      `${trimmed} ~* '^(hares?[[:space:]]+(needed|required|wanted)|needs?[[:space:]]+(a[[:space:]]+)?hares?)[[:>:]]'`,
    );
    // The patterns are SQL constants, not bind parameters.
    expect(query.values).toEqual([]);
  });

  it("counts only each source's newest RawEvent per sourceUrl as a posted run", async () => {
    await refreshScheduleOnlyFlags("all");
    const sql = sqlText(lastQuery());
    const postedRuns = sql.slice(sql.indexOf("AND NOT EXISTS ("), sql.indexOf(`AS "isScheduleOnly"`));
    // An older RawEvent from the same source, for the same instance, is superseded:
    // RawEvents are immutable and merge never unlinks the old ones (Ruling 11).
    expect(postedRuns).toContain(
      `NOT EXISTS ( SELECT 1 FROM "RawEvent" newer WHERE newer."eventId" = r."eventId" AND newer."sourceId" = r."sourceId" AND (newer."rawData"->>'sourceUrl') IS NOT DISTINCT FROM (r."rawData"->>'sourceUrl') AND newer."scrapedAt" > r."scrapedAt" )`,
    );
    // The guard sits inside the posted-run lookup, not the "has a RawEvent" check.
    expect(sql).toContain(`EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = ev.id) AND NOT EXISTS (`);
  });

  it("never flags an event with no RawEvent", async () => {
    await refreshScheduleOnlyFlags("all");
    const sql = sqlText(lastQuery());
    // Schedule-only needs at least one RawEvent AND no posted-run RawEvent.
    expect(sql).toContain(
      `EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = ev.id) AND NOT EXISTS (`,
    );
  });

  it("writes only events whose flag changes", async () => {
    await refreshScheduleOnlyFlags("all");
    expect(sqlText(lastQuery())).toContain(`"isScheduleOnly" IS DISTINCT FROM`);
  });

  it("refreshes every event, with no parameters, for the all scope", async () => {
    await refreshScheduleOnlyFlags("all");
    const query = lastQuery();
    expect(query.values).toEqual([]);
    expect(sqlText(query)).not.toContain(`r."scrapedAt" >=`);
  });

  it("scopes to one source's rows scraped since a time", async () => {
    const since = new Date("2026-11-12T06:00:00Z");
    await refreshScheduleOnlyFlags({ sourceId: "src_123", since });
    const query = lastQuery();
    expect(query.values).toEqual(["src_123", since]);
    const sql = sqlText(query);
    expect(sql).toContain(`r."sourceId" = ?`);
    expect(sql).toContain(`r."scrapedAt" >= ?`);
    // Never interpolated into the SQL text.
    expect(sql).not.toContain("src_123");
  });
});

describe("refreshKennelEvidence", () => {
  const NOW = new Date("2026-08-11T03:30:00Z");

  it("counts co-hosted runs and attendance", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const sql = sqlText(lastQuery());
    expect(sql).toContain(`"EventKennel"`);
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain(`"Attendance"`);
    expect(sql).toContain(`status = 'CONFIRMED'`);
    expect(sql).toContain(`"KennelAttendance"`);
  });

  it("excludes schedule-only, cancelled and manual events from runs", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const sql = sqlText(lastQuery());
    expect(sql).toContain(`e."isCanonical" = true`);
    expect(sql).toContain(`e.status <> 'CANCELLED'`);
    expect(sql).toContain(`a."isScheduleOnly" = false`);
    expect(sql).toContain(`a."isManualEntry" = false`);
  });

  it("requires a RawEvent behind a posted upcoming run", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const sql = sqlText(lastQuery());
    const nextRuns = sql.slice(sql.indexOf("next_runs AS ("), sql.indexOf("attended AS ("));
    expect(nextRuns).toContain("MIN(a.date)");
    expect(nextRuns).toContain(`EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = a.id)`);
    // Past runs don't need one: events with no RawEvent (historical imports) still count.
    const pastRuns = sql.slice(sql.indexOf("past_runs AS ("), sql.indexOf("next_runs AS ("));
    expect(pastRuns).toContain("MAX(a.date)");
    expect(pastRuns).not.toContain(`"RawEvent"`);
  });

  it("splits past and upcoming on the UTC day of now", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const values = lastQuery().values;
    // today's UTC midnight (upcoming = on or after) and tomorrow's (past = before).
    expect(values).toContainEqual(new Date("2026-08-11T00:00:00Z"));
    expect(values).toContainEqual(new Date("2026-08-12T00:00:00Z"));
  });

  it("reads RUNNING and un-reverted STOPPED confirmations", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const sql = sqlText(lastQuery());
    expect(sql).toContain(`"KennelConfirmation"`);
    expect(sql).toContain(`kind = 'RUNNING'`);
    expect(sql).toContain(`kind = 'STOPPED'`);
  });

  it("clears stoppedAt when newer evidence exists", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const sql = sqlText(lastQuery());
    expect(sql).toContain(`c."revertedAt" IS NULL`);
    expect(sql).toContain(`MAX(c."observedAt") FILTER (WHERE c.kind = 'STOPPED')`);
    // The stop survives only while no evidence date is later than it.
    expect(sql).toContain(
      `CASE WHEN ev."lastStopped" >= COALESCE(GREATEST(ev."lastRunSeenAt", ev."lastConfirmedAt", ev."nextRunPostedAt"), ev."lastStopped") THEN ev."lastStopped" END AS "stoppedAt"`,
    );
  });

  it("writes only kennels whose evidence changes", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const sql = sqlText(lastQuery());
    for (const col of ["lastRunSeenAt", "nextRunPostedAt", "lastConfirmedAt", "stoppedAt"]) {
      expect(sql).toContain(`k."${col}" IS DISTINCT FROM c."${col}"`);
    }
  });

  it("refreshes every kennel when no ids are given", async () => {
    await refreshKennelEvidence(undefined, NOW);
    const query = lastQuery();
    expect(sqlText(query)).not.toContain("k.id IN");
    expect(query.values.every((v) => v instanceof Date)).toBe(true);
  });

  it("passes kennel ids when given", async () => {
    await refreshKennelEvidence(["k1", "k2"], NOW);
    const query = lastQuery();
    expect(sqlText(query)).toContain(`k.id IN (?,?)`);
    expect(query.values).toEqual(expect.arrayContaining(["k1", "k2"]));
    expect(sqlText(query)).not.toContain("k1");
  });

  it("is a no-op for an empty id list", async () => {
    const result = await refreshKennelEvidence([], NOW);
    expect(result).toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("defaults now to the current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T23:59:00Z"));
    try {
      await refreshKennelEvidence();
    } finally {
      vi.useRealTimers();
    }
    expect(lastQuery().values).toContainEqual(new Date("2026-11-12T00:00:00Z"));
  });
});

describe("both return the affected-row count", () => {
  it("refreshScheduleOnlyFlags", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(42);
    expect(await refreshScheduleOnlyFlags("all")).toBe(42);
  });

  it("refreshKennelEvidence", async () => {
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(7);
    expect(await refreshKennelEvidence(["k1"])).toBe(7);
  });
});
