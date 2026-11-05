import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { classifyCandidates, normalizeTitle, type Candidate } from "./restore-phoenix-big-ass-false-cancellations";

const BIG_ASS = "src_bigass";
const raw = (title: string | null, sourceId = BIG_ASS, description: string | null = null) => ({
  sourceId,
  title,
  description,
});
const ev = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  kennelCode: "lbh-phx",
  dateKey: "2026-02-09",
  title: "LBH #730",
  startTime: "18:30",
  adminCancelledAt: null,
  raws: [raw("LBH #730")],
  confirmedInSlot: 0,
  ...overrides,
});

describe("classifyCandidates", () => {
  it("restores a titled event backed only by the Big Ass source", () => {
    expect(classifyCandidates([ev("a")], BIG_ASS).get("a")).toBe("RESTORE");
  });

  it("never touches an admin-cancelled event", () => {
    const v = classifyCandidates([ev("a", { adminCancelledAt: new Date() })], BIG_ASS);
    expect(v.get("a")).toBe("SKIP_ADMIN_CANCELLED");
  });

  it("skips events with no RawEvents or with another source's RawEvent", () => {
    const v = classifyCandidates(
      [ev("a", { raws: [] }), ev("b", { dateKey: "2026-02-16", raws: [raw("x"), raw("x", "src_ical")] })],
      BIG_ASS,
    );
    expect(v.get("a")).toBe("SKIP_NO_RAWS");
    expect(v.get("b")).toBe("SKIP_OTHER_SOURCE");
  });

  it("keeps title-less day-cell junk rows cancelled", () => {
    const v = classifyCandidates([ev("a", { title: "Wrong Way Trail", raws: [raw(null)] })], BIG_ASS);
    expect(v.get("a")).toBe("SKIP_TITLELESS_ROW");
  });

  it("keeps rows whose source data signals a real cancellation", () => {
    const v = classifyCandidates(
      [
        ev("a", { raws: [raw("LBH #730 CANCELLED")] }),
        ev("b", { dateKey: "2026-02-16", raws: [raw("LBH #731", BIG_ASS, "Postponed due to rain")] }),
      ],
      BIG_ASS,
    );
    expect(v.get("a")).toBe("SKIP_CANCEL_SIGNAL");
    expect(v.get("b")).toBe("SKIP_CANCEL_SIGNAL");
  });

  it("skips a slot that already has a CONFIRMED canonical event", () => {
    expect(classifyCandidates([ev("a", { confirmedInSlot: 1 })], BIG_ASS).get("a")).toBe("SKIP_SLOT_TAKEN");
  });

  it("collapses same-slot rows whose titles differ only in punctuation, keeping the richer one", () => {
    const v = classifyCandidates(
      [
        ev("a", { title: "Hump D' Throwdown", startTime: null }),
        ev("b", { title: "Hump D’ Throwdown", startTime: "18:30" }),
      ],
      BIG_ASS,
    );
    expect(v.get("b")).toBe("RESTORE");
    expect(v.get("a")).toBe("SKIP_DUPLICATE_IN_SLOT");
  });

  it("keeps a genuine same-day double-header with different titles", () => {
    const v = classifyCandidates([ev("a", { title: "LBH #730" }), ev("b", { title: "JHOT #80085" })], BIG_ASS);
    expect(v.get("a")).toBe("RESTORE");
    expect(v.get("b")).toBe("RESTORE");
  });
});

describe("normalizeTitle", () => {
  it("ignores case, quotes and whitespace", () => {
    expect(normalizeTitle("Hump D' Throwdown")).toBe(normalizeTitle("hump d’ throwdown"));
    expect(normalizeTitle(null)).toBe("");
  });
});
