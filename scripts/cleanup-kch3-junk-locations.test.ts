import { describe, it, expect, vi } from "vitest";

// classifyJunkEvents is pure, but the module imports prisma at top level — mock
// it so importing here can't touch a real DB. (The entrypoint is argv-guarded.)
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { classifyJunkEvents, type EventRow } from "./cleanup-kch3-junk-locations";

const codeById = new Map([["k1", "kch3"]]);
const row = (id: string, date: string, locationName: string | null): EventRow => ({
  id,
  date: new Date(`${date}T12:00:00Z`),
  kennelId: "k1",
  locationName,
});

describe("classifyJunkEvents", () => {
  it("overwrites a junk value when the source post yields a real venue", () => {
    const fresh = new Map([["kch3|2024-12-14", "7103 Harvard Ave, Raytown, MO"]]);
    const { overwrite, nulled } = classifyJunkEvents([row("e1", "2024-12-14", "Hash Cash: $5")], codeById, fresh);
    expect(nulled).toHaveLength(0);
    expect(overwrite).toEqual([{ id: "e1", date: "2024-12-14", old: "Hash Cash: $5", fresh: "7103 Harvard Ave, Raytown, MO" }]);
  });

  it("nulls a junk value when the matching post has no location", () => {
    const fresh = new Map<string, string | null>([["kch3|2019-06-22", null]]);
    const { overwrite, nulled } = classifyJunkEvents([row("e2", "2019-06-22", "Time 3 p.m.")], codeById, fresh);
    expect(overwrite).toHaveLength(0);
    expect(nulled).toEqual([{ id: "e2", date: "2019-06-22", old: "Time 3 p.m.", fresh: null }]);
  });

  it("leaves a junk value untouched when there is NO matching source post (gemini #2136)", () => {
    const fresh = new Map<string, string | null>(); // post not fetched / absent
    const { overwrite, nulled } = classifyJunkEvents([row("e3", "2014-01-01", "Time 3 p.m.")], codeById, fresh);
    expect(overwrite).toHaveLength(0);
    expect(nulled).toHaveLength(0);
  });

  it("leaves a non-junk (real venue) value untouched even if it differs from fresh", () => {
    const fresh = new Map([["kch3|2025-03-15", "Macken Park baseball fields"]]);
    const { overwrite, nulled } = classifyJunkEvents(
      [row("e4", "2025-03-15", "Macken Park (different wording)")],
      codeById,
      fresh,
    );
    expect(overwrite).toHaveLength(0);
    expect(nulled).toHaveLength(0);
  });
});
