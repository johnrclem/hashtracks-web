import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { RawEventData } from "@/adapters/types";
import {
  buildManifest,
  checkDeclaredFields,
  compareManifest,
  computeApprovalHash,
  findRunNumberExceptions,
  trailingGapRecurs,
  type ManifestDeclaration,
} from "./manifest";
import {
  checkLiveCoverage,
  checkRowDates,
  checkRowRouting,
  checkRowShape,
  checkRunOrder,
  checkSeriesMarkerKeys,
  checkSiblingMentions,
  checkSize,
  checkStretchGap,
  medianRunInterval,
  touchedGuardPaths,
} from "./guards";

const weekly = (n: number, start = "2020-01-04"): string =>
  new Date(Date.parse(`${start}T12:00:00Z`) + 7 * 86_400_000 * n).toISOString().slice(0, 10);
const rows = (count: number): RawEventData[] =>
  Array.from({ length: count }, (_, i) => ({ date: weekly(i), kennelTags: ["zh4"], runNumber: i + 1, title: `Run ${i + 1}`, sourceUrl: "https://x" }));

const declaration: ManifestDeclaration = {
  archivePath: "scripts/data/zh4-history.json",
  sourceName: "Zagreb H4 run history",
  originSourceName: "Zagreb H4 Run Schedule Sheet",
  binding: "archive-source",
  kennelTimezone: "Europe/Zagreb",
  frozenAt: "2026-11-12",
  expectedKennelCodes: ["zh4"],
  expectedGaps: [],
  curatedCorrections: [],
};

describe("manifest (6.1) and G2", () => {
  it("builds Zagreb H4's real manifest: 716 rows on 715 dates, one same-date pair", () => {
    const bytes = readFileSync("scripts/data/zh4-history.json", "utf8");
    const m = buildManifest(bytes, declaration);
    expect(m.perKennel.zh4).toMatchObject({ rows: 716, uniqueDates: 715 });
    expect(m.sameDateGroups).toEqual([{ kennel: "zh4", date: "2014-10-04", runNumbers: [2059, 2060] }]);
    expect(m.piiScan.residual).toBe(0);
    expect(compareManifest(m, bytes)).toEqual([]);
  });

  it("G2 catches a changed archive, a tampered count and a stale hash", () => {
    const bytes = JSON.stringify(rows(30));
    const m = buildManifest(bytes, declaration);
    expect(compareManifest(m, JSON.stringify(rows(31))).map((p) => p.code)).toContain("manifest-drift");
    const tampered = { ...m, perKennel: { zh4: { ...m.perKennel.zh4, rows: 29 } } };
    expect(compareManifest(tampered, bytes).map((p) => p.code)).toContain("approval-hash-stale");
    expect(compareManifest({ ...tampered, approvalHash: computeApprovalHash(tampered) }, bytes).map((p) => p.detail)).toContain("perKennel differs from the archive");
  });

  it("leaves sample titles and the schedule-only estimate out of the approval hash", () => {
    const m = buildManifest(JSON.stringify(rows(5)), declaration);
    expect(computeApprovalHash({ ...m, scheduleOnlyEstimate: 99, perKennel: { zh4: { ...m.perKennel.zh4, sampleTitles: ["x"] } } })).toBe(m.approvalHash);
  });

  it("caps curated corrections and checks every gap's shape", () => {
    const r = rows(100);
    const many = Array.from({ length: 21 }, (_, i) => ({ row: i, reason: "fix" }));
    expect(checkDeclaredFields({ ...declaration, curatedCorrections: many }, r).map((p) => p.code)).toContain("corrections-cap");
    expect(checkDeclaredFields({ ...declaration, curatedCorrections: [{ row: 500, reason: "x" }] }, r).map((p) => p.code)).toContain("correction-row");
    const inside = { start: weekly(10), end: weekly(10), reason: "no run" };
    expect(checkDeclaredFields({ ...declaration, expectedGaps: [inside] }, r).map((p) => p.code)).toContain("gap-has-row");
    const long = { start: "2020-03-01", end: "2020-08-01", reason: "covid" };
    expect(checkDeclaredFields({ ...declaration, expectedGaps: [long] }, r).map((p) => p.code)).toContain("gap-length");
    const before = { start: "2019-01-01", end: "2019-01-10", reason: "x" };
    expect(checkDeclaredFields({ ...declaration, expectedGaps: [before] }, r).map((p) => p.code)).toContain("gap-outside-span");
  });

  it("accepts a trailing gap only when the break recurs in 2 of the 3 most recent full years", () => {
    // Weekly runs 2016-2025 with no runs every 1 Dec – 15 Jan (a winter break), 2020/21 included.
    const dates: string[] = [];
    for (let d = Date.parse("2016-01-16T12:00:00Z"); d < Date.parse("2025-11-30T12:00:00Z"); d += 7 * 86_400_000) {
      const iso = new Date(d).toISOString().slice(0, 10);
      const md = iso.slice(5);
      if (md >= "12-01" || md <= "01-15") continue;
      dates.push(iso);
    }
    const winter = { start: "2025-12-01", end: "2026-01-15", reason: "winter break" };
    expect(trailingGapRecurs(winter, dates)).toBe(true);
    const summer = { start: "2025-12-01", end: "2026-03-15", reason: "made up" };
    expect(trailingGapRecurs(summer, dates)).toBe(false);
  });

  it("finds run-number exceptions in (date, run) order", () => {
    const r = rows(6);
    r[3] = { ...r[3], runNumber: 2 };
    expect(findRunNumberExceptions(r)).toEqual([{ row: 3, date: r[3].date, runNumber: 2 }]);
  });
});

describe("pure guards", () => {
  it("G3: dates must be real and before today and frozenAt", () => {
    const r = [...rows(3), { date: "2020-02-30", kennelTags: ["zh4"] }, { date: "2026-11-20", kennelTags: ["zh4"] }];
    expect(checkRowDates(r, "2026-11-17", "2026-11-12")).toEqual([3, 4]);
  });

  it("G4 rows: one tag equal to the expected code", () => {
    const r: RawEventData[] = [{ date: "2020-01-01", kennelTags: ["zh4"] }, { date: "2020-01-02", kennelTags: ["zh4", "x"] }, { date: "2020-01-03", kennelTags: ["ZH4"] }];
    expect(checkRowRouting(r, "zh4")).toEqual([1, 2]);
  });

  it("section 3 shape: no series or links", () => {
    const r: RawEventData[] = [{ date: "2020-01-01", kennelTags: ["a"] }, { date: "2020-01-02", kennelTags: ["a"], seriesId: "s" }, { date: "2020-01-03", kennelTags: ["a"], externalLinks: [{ url: "u", label: "l" }] }];
    expect(checkRowShape(r)).toEqual([1, 2]);
  });

  it("G7: strict run order within 5 rows and 1%; at most 5% unnumbered", () => {
    expect(checkRunOrder(rows(600))).toEqual([]);
    const broken = rows(600);
    for (let i = 0; i < 6; i++) broken[100 + i * 10] = { ...broken[100 + i * 10], runNumber: 1 };
    expect(checkRunOrder(broken).join()).toMatch(/run-order/);
    const unnumbered = rows(100).map((r, i) => (i < 6 ? { ...r, runNumber: undefined } : r));
    expect(checkRunOrder(unnumbered).join()).toMatch(/unnumbered/);
  });

  it("G13: the 2,000-row cap", () => {
    expect(checkSize(2000)).toEqual([]);
    expect(checkSize(2001)).toHaveLength(1);
  });

  it("G6: names another kennel of the region by code, short name or alias, as a whole word", () => {
    const r: RawEventData[] = [
      { date: "2020-01-01", kennelTags: ["a"], title: "Joint run with Kubik H3!" },
      { date: "2020-01-02", kennelTags: ["a"], hares: "Kubikovic" },
      { date: "2020-01-03", kennelTags: ["a"], location: "Near the KH3 bar" },
    ];
    expect(checkSiblingMentions(r, [{ kennelCode: "kh3", names: ["kh3", "Kubik H3", "KH"] }])).toEqual([
      { row: 0, kennelCode: "kh3" },
      { row: 2, kennelCode: "kh3" },
    ]);
  });

  it("G15: the migration-sql checker, CI scripts and libpg-query's package entries", () => {
    expect(touchedGuardPaths(["src/lib/migration-sql/g17.ts", "scripts/ci/check-migrations.ts"])).toHaveLength(2);
    expect(touchedGuardPaths(["package.json"], { "package.json": '@@ -1 +1 @@\n-"libpg-query": "17.8.2"\n+"libpg-query": "17.9.0"' })).toEqual(["package.json"]);
    expect(touchedGuardPaths(["package.json"], { "package.json": '@@ -1 +1 @@\n-"zod": "3"\n+"zod": "4"' })).toEqual([]);
    expect(touchedGuardPaths(["package-lock.json"])).toEqual(["package-lock.json"]); // no patch to read: guarded
  });

  it("G15: guard paths", () => {
    expect(touchedGuardPaths(["scripts/data/x-history.json", "src/pipeline/merge.ts", ".github/workflows/ci.yml", "src/lib/backfill/plan.ts", "src/pipeline/merge.test.ts.bak"]))
      .toEqual(["src/pipeline/merge.ts", ".github/workflows/ci.yml", "src/lib/backfill/plan.ts"]);
  });

  it("G21 key: every committed row carries recurringSeriesId, even as null", () => {
    expect(checkSeriesMarkerKeys([{ recurringSeriesId: "abc" }, { recurringSeriesId: null }, {}])).toEqual([2]);
  });

  it("G20 gap: at most 1.5 median intervals from the archive's end to C, less declared gaps", () => {
    const dates = rows(30).map((r) => r.date);
    const last = dates.at(-1)!;
    const plus = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    expect(medianRunInterval(dates, [])).toBe(7);
    expect(checkStretchGap(dates, plus(last, 7), [])).toEqual([]);
    expect(checkStretchGap(dates, plus(last, 10), [])).toEqual([]);
    expect(checkStretchGap(dates, plus(last, 11), []).join()).toMatch(/gap/);
    const winter = { start: plus(last, 1), end: plus(last, 60), reason: "winter" };
    expect(checkStretchGap(dates, plus(last, 65), [winter])).toEqual([]);
    expect(checkStretchGap(dates, plus(last, 40), [winter]).join()).toMatch(/trailing-gap-past-split/);
    expect(checkStretchGap(dates, dates[10], [])).toEqual([]); // the archive runs past C
  });

  it("G20 coverage: 95% of the countable live rows, with corrections and unnumbered rows left out", () => {
    const stretch = Array.from({ length: 40 }, (_, i) => ({ index: i, date: weekly(i), runNumber: i + 1 }));
    const all = new Set(stretch.map((r) => `${r.date}#${r.runNumber}`));
    expect(checkLiveCoverage(stretch, new Set(), all).problems).toEqual([]);
    const missingThree = new Set([...all].slice(3));
    expect(checkLiveCoverage(stretch, new Set(), missingThree).problems.join()).toMatch(/coverage/);
    expect(checkLiveCoverage(stretch, new Set([0, 1, 2]), missingThree).problems).toEqual([]);
    const tooFew = stretch.map((r, i) => (i < 35 ? { ...r, runNumber: null } : r));
    expect(checkLiveCoverage(tooFew, new Set(), all).problems.join()).toMatch(/can be counted/);
  });
});
