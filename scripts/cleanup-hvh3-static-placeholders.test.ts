import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { partitionPlaceholders } from "./cleanup-hvh3-static-placeholders";

const STATIC = "src_static";
const ev = (id: string, rawSourceIds: string[], attendances = 0) => ({
  id,
  date: new Date("2026-12-03T12:00:00Z"),
  status: "CONFIRMED",
  rawSourceIds,
  attendances,
});

describe("partitionPlaceholders", () => {
  it("selects events backed only by the static source with no attendance", () => {
    const { deletable, otherSource, withAttendance } = partitionPlaceholders(
      [ev("a", [STATIC]), ev("b", [STATIC, STATIC])],
      STATIC,
    );
    expect(deletable.map((e) => e.id)).toEqual(["a", "b"]);
    expect(otherSource).toEqual([]);
    expect(withAttendance).toEqual([]);
  });

  it("keeps any event that another source also backs", () => {
    const { deletable, otherSource } = partitionPlaceholders([ev("a", [STATIC, "src_fb"])], STATIC);
    expect(deletable).toEqual([]);
    expect(otherSource.map((e) => e.id)).toEqual(["a"]);
  });

  it("keeps events with no RawEvents at all (not provably synthetic)", () => {
    const { deletable, otherSource } = partitionPlaceholders([ev("a", [])], STATIC);
    expect(deletable).toEqual([]);
    expect(otherSource.map((e) => e.id)).toEqual(["a"]);
  });

  it("never selects a placeholder that has attendance", () => {
    const { deletable, withAttendance } = partitionPlaceholders([ev("a", [STATIC], 1)], STATIC);
    expect(deletable).toEqual([]);
    expect(withAttendance.map((e) => e.id)).toEqual(["a"]);
  });
});
