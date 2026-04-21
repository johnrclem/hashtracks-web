import { describe, it, expect } from "vitest";
import {
  groupByDayWithLegs,
  groupByDestination,
} from "./multi-destination";

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

describe("groupByDayWithLegs", () => {
  it("returns one flat leg for a single-stop day (no overlap)", () => {
    const groups = groupByDayWithLegs([
      row("a", 0, "2026-04-20", "London"),
      row("b", 0, "2026-04-20", "London"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe("2026-04-20");
    expect(groups[0].hasOverlap).toBe(false);
    expect(groups[0].legs).toHaveLength(1);
    expect(groups[0].legs[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("marks days as hasOverlap when 2+ stops share the date", () => {
    // London and Paris both have events on Thursday April 23 (transit day).
    const groups = groupByDayWithLegs([
      row("lhr-1", 0, "2026-04-23", "London"),
      row("cdg-1", 1, "2026-04-23", "Paris"),
      row("cdg-2", 1, "2026-04-23", "Paris"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].hasOverlap).toBe(true);
    expect(groups[0].legs).toHaveLength(2);
    expect(groups[0].legs.map((l) => l.destinationIndex)).toEqual([0, 1]);
    expect(groups[0].legs[0].rows.map((r) => r.id)).toEqual(["lhr-1"]);
    expect(groups[0].legs[1].rows.map((r) => r.id)).toEqual(["cdg-1", "cdg-2"]);
  });

  it("preserves destinationLabel from the first row of each band", () => {
    const groups = groupByDayWithLegs([
      row("lhr-1", 0, "2026-04-23", "London"),
      row("cdg-1", 1, "2026-04-23", "Paris"),
    ]);
    expect(groups[0].legs[0].destinationLabel).toBe("London");
    expect(groups[0].legs[1].destinationLabel).toBe("Paris");
  });

  it("sorts days chronologically with cadence-based (null date) group last", () => {
    const groups = groupByDayWithLegs([
      row("cadence", 0, null),
      row("wed", 0, "2026-04-22"),
      row("mon", 0, "2026-04-20"),
    ]);
    expect(groups.map((g) => g.dateKey)).toEqual([
      "2026-04-20",
      "2026-04-22",
      null,
    ]);
  });

  it("sorts leg bands by destinationIndex regardless of input row order", () => {
    const groups = groupByDayWithLegs([
      // Paris (1) event mentioned first in input, but leg 01 (index 0) sorts first.
      row("cdg", 1, "2026-04-23", "Paris"),
      row("lhr", 0, "2026-04-23", "London"),
    ]);
    expect(groups[0].legs.map((l) => l.destinationIndex)).toEqual([0, 1]);
  });

  it("handles a 3-stop day with all three overlapping (hasOverlap + 3 legs)", () => {
    const groups = groupByDayWithLegs([
      row("lhr", 0, "2026-04-25"),
      row("cdg", 1, "2026-04-25"),
      row("ber", 2, "2026-04-25"),
    ]);
    expect(groups[0].hasOverlap).toBe(true);
    expect(groups[0].legs).toHaveLength(3);
  });

  it("returns empty array when no rows are supplied", () => {
    expect(groupByDayWithLegs([])).toEqual([]);
  });

  it("slices ISO timestamps to YYYY-MM-DD so 'date' stamps from the wire match", () => {
    // `date` is serialized as ISO on the wire (`.toISOString()`); the
    // grouping key must ignore the time portion so same-day events
    // collapse correctly.
    const groups = groupByDayWithLegs([
      row("a", 0, "2026-04-23T12:00:00.000Z"),
      row("b", 0, "2026-04-23T18:00:00.000Z"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dateKey).toBe("2026-04-23");
    expect(groups[0].legs[0].rows).toHaveLength(2);
  });
});

describe("groupByDestination", () => {
  it("returns one section per stop, position-ordered", () => {
    const sections = groupByDestination([
      row("c", 2, "2026-04-26"),
      row("a", 0, "2026-04-20"),
      row("b", 1, "2026-04-23"),
    ]);
    expect(sections.map((s) => s.destinationIndex)).toEqual([0, 1, 2]);
  });

  it("groups all rows per stop regardless of date", () => {
    const sections = groupByDestination([
      row("lhr-1", 0, "2026-04-20"),
      row("lhr-2", 0, "2026-04-21"),
      row("lhr-3", 0, null),
      row("cdg-1", 1, "2026-04-24"),
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[0].rows.map((r) => r.id)).toEqual(["lhr-1", "lhr-2", "lhr-3"]);
    expect(sections[1].rows.map((r) => r.id)).toEqual(["cdg-1"]);
  });

  it("omits stops with zero rows", () => {
    // Paris (1) has no rows in this mix. Only London + Berlin surface.
    const sections = groupByDestination([
      row("lhr", 0, "2026-04-20"),
      row("ber", 2, "2026-04-26"),
    ]);
    expect(sections.map((s) => s.destinationIndex)).toEqual([0, 2]);
  });

  it("returns empty when no rows supplied", () => {
    expect(groupByDestination([])).toEqual([]);
  });
});
