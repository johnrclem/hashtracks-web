import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { pickSurvivor } from "./dedup-rawevent-fingerprint";

type Row = Parameters<typeof pickSurvivor>[0][number];
const row = (overrides: Partial<Row>): Row => ({
  id: "id",
  sourceId: "src",
  fingerprint: "fp",
  scrapedAt: new Date("2026-01-01"),
  processed: false,
  eventId: null,
  ...overrides,
});

describe("pickSurvivor", () => {
  it("prefers a linked row over any unlinked sibling", () => {
    const rows = [
      row({ id: "a", scrapedAt: new Date("2026-01-10") }),
      row({ id: "b", scrapedAt: new Date("2026-01-05"), eventId: "evt_1" }),
      row({ id: "c", scrapedAt: new Date("2026-01-20") }),
    ];
    expect(pickSurvivor(rows).id).toBe("b");
  });

  it("among linked rows picks the most-recent scrapedAt", () => {
    const rows = [
      row({ id: "old", scrapedAt: new Date("2026-01-01"), eventId: "evt_1" }),
      row({ id: "new", scrapedAt: new Date("2026-03-01"), eventId: "evt_1" }),
      row({ id: "mid", scrapedAt: new Date("2026-02-01"), eventId: "evt_1" }),
    ];
    expect(pickSurvivor(rows).id).toBe("new");
  });

  it("among unlinked rows picks the OLDEST scrapedAt", () => {
    const rows = [
      row({ id: "old", scrapedAt: new Date("2026-01-01") }),
      row({ id: "new", scrapedAt: new Date("2026-03-01") }),
      row({ id: "mid", scrapedAt: new Date("2026-02-01") }),
    ];
    expect(pickSurvivor(rows).id).toBe("old");
  });

  it("does not consider `processed` as a tiebreaker (linkage is the only first-tier key)", () => {
    // Pre-flight diagnostic showed all multi-link groups point to a single
    // canonical Event, so processed=true vs false among linked siblings is
    // not a survivor-selection decider — the most-recent scrapedAt wins.
    const rows = [
      row({ id: "linked-unprocessed-new", scrapedAt: new Date("2026-03-01"), eventId: "evt_1", processed: false }),
      row({ id: "linked-processed-old", scrapedAt: new Date("2026-01-01"), eventId: "evt_1", processed: true }),
    ];
    expect(pickSurvivor(rows).id).toBe("linked-unprocessed-new");
  });

  it("throws on an empty group (defensive — caller should never invoke this)", () => {
    expect(() => pickSurvivor([])).toThrow(/empty group/);
  });
});
