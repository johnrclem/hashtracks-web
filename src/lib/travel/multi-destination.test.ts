import { describe, it, expect } from "vitest";
import { bucketDays, bucketStops } from "./multi-destination";

interface TestRow {
  destinationIndex: number;
  destinationLabel: string | null;
  date: string | null;
  id: string;
}

const row = (
  id: string,
  destinationIndex: number,
  date: string | null,
  label: string | null = null,
): TestRow => ({ id, destinationIndex, destinationLabel: label, date });

const emptyKind = <T,>(): T[] => [];

describe("bucketDays", () => {
  it("returns one day bucket for a single-stop day (no overlap)", () => {
    const buckets = bucketDays({
      confirmed: [row("a", 0, "2026-04-20", "London"), row("b", 0, "2026-04-20", "London")],
      likely: emptyKind<TestRow>(),
      possible: emptyKind<TestRow>(),
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].dateKey).toBe("2026-04-20");
    expect(buckets[0].bandsByStop.size).toBe(1);
    const band = buckets[0].bandsByStop.get(0);
    expect(band?.confirmed.map((r) => r.id)).toEqual(["a", "b"]);
    expect(band?.label).toBe("London");
  });

  it("separates stops into different bands within the same day (overlap)", () => {
    const buckets = bucketDays({
      confirmed: [row("lhr-1", 0, "2026-04-23", "London"), row("cdg-1", 1, "2026-04-23", "Paris"), row("cdg-2", 1, "2026-04-23", "Paris")],
      likely: emptyKind<TestRow>(),
      possible: emptyKind<TestRow>(),
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].bandsByStop.size).toBe(2);
    expect(buckets[0].bandsByStop.get(0)?.confirmed.map((r) => r.id)).toEqual(["lhr-1"]);
    expect(buckets[0].bandsByStop.get(1)?.confirmed.map((r) => r.id)).toEqual(["cdg-1", "cdg-2"]);
  });

  it("upgrades a null label when a later row in the same (day, stop) band has one", () => {
    // First row lacks a label; second sets it. The band should carry the later value.
    const buckets = bucketDays({
      confirmed: [row("a", 0, "2026-04-20", null), row("b", 0, "2026-04-20", "London")],
      likely: emptyKind<TestRow>(),
      possible: emptyKind<TestRow>(),
    });
    expect(buckets[0].bandsByStop.get(0)?.label).toBe("London");
  });

  it("merges confirmed + likely + possible for the same (day, stop) band", () => {
    const buckets = bucketDays({
      confirmed: [row("c", 0, "2026-04-20")],
      likely: [row("l", 0, "2026-04-20")],
      possible: [row("p", 0, "2026-04-20")],
    });
    const band = buckets[0].bandsByStop.get(0)!;
    expect(band.confirmed.map((r) => r.id)).toEqual(["c"]);
    expect(band.likely.map((r) => r.id)).toEqual(["l"]);
    expect(band.possible.map((r) => r.id)).toEqual(["p"]);
  });

  it("sorts days chronologically with cadence-based (null date) group last", () => {
    const buckets = bucketDays({
      confirmed: emptyKind<TestRow>(),
      likely: emptyKind<TestRow>(),
      possible: [row("cadence", 0, null), row("wed", 0, "2026-04-22"), row("mon", 0, "2026-04-20")],
    });
    expect(buckets.map((b) => b.dateKey)).toEqual(["2026-04-20", "2026-04-22", null]);
  });

  it("slices ISO timestamps to YYYY-MM-DD so wire-formatted dates collapse", () => {
    const buckets = bucketDays({
      confirmed: [row("a", 0, "2026-04-23T12:00:00.000Z"), row("b", 0, "2026-04-23T18:00:00.000Z")],
      likely: emptyKind<TestRow>(),
      possible: emptyKind<TestRow>(),
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].dateKey).toBe("2026-04-23");
    expect(buckets[0].bandsByStop.get(0)?.confirmed).toHaveLength(2);
  });

  it("handles a 3-stop day with all three overlapping", () => {
    const buckets = bucketDays({
      confirmed: [row("lhr", 0, "2026-04-25"), row("cdg", 1, "2026-04-25"), row("ber", 2, "2026-04-25")],
      likely: emptyKind<TestRow>(),
      possible: emptyKind<TestRow>(),
    });
    expect(buckets[0].bandsByStop.size).toBe(3);
    expect([...buckets[0].bandsByStop.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("returns empty array when no rows supplied", () => {
    expect(
      bucketDays({ confirmed: emptyKind<TestRow>(), likely: emptyKind<TestRow>(), possible: emptyKind<TestRow>() }),
    ).toEqual([]);
  });
});

describe("bucketStops", () => {
  it("partitions rows by destinationIndex into a Map for O(1) lookup", () => {
    const buckets = bucketStops({
      confirmed: [row("a", 0, "2026-04-20"), row("b", 2, "2026-04-26")],
      likely: [row("c", 1, "2026-04-23")],
      possible: [row("d", 0, null)],
    });
    expect(buckets.size).toBe(3);
    expect(buckets.get(0)?.confirmed.map((r) => r.id)).toEqual(["a"]);
    expect(buckets.get(0)?.possible.map((r) => r.id)).toEqual(["d"]);
    expect(buckets.get(1)?.likely.map((r) => r.id)).toEqual(["c"]);
    expect(buckets.get(2)?.confirmed.map((r) => r.id)).toEqual(["b"]);
  });

  it("groups all three row kinds per stop", () => {
    const buckets = bucketStops({
      confirmed: [row("c", 0, "2026-04-20")],
      likely: [row("l", 0, "2026-04-21")],
      possible: [row("p", 0, null)],
    });
    const b = buckets.get(0)!;
    expect(b.confirmed).toHaveLength(1);
    expect(b.likely).toHaveLength(1);
    expect(b.possible).toHaveLength(1);
  });

  it("returns an empty map when no rows supplied", () => {
    expect(
      bucketStops({ confirmed: emptyKind<TestRow>(), likely: emptyKind<TestRow>(), possible: emptyKind<TestRow>() }).size,
    ).toBe(0);
  });

  it("skips stops with zero rows", () => {
    const buckets = bucketStops({
      confirmed: [row("a", 0, "2026-04-20")],
      likely: emptyKind<TestRow>(),
      possible: [row("b", 2, null)],
    });
    expect([...buckets.keys()].sort((a, b) => a - b)).toEqual([0, 2]);
  });
});
