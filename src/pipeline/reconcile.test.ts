import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRawEvent } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    sourceKennel: { findMany: vi.fn() },
    event: { findMany: vi.fn(), updateMany: vi.fn() },
    rawEvent: { groupBy: vi.fn() },
  },
}));

vi.mock("./kennel-resolver", () => ({
  resolveKennelTag: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { resolveKennelTag } from "./kennel-resolver";
import { reconcileStaleEvents } from "./reconcile";

const mockSourceKennelFind = vi.mocked(prisma.sourceKennel.findMany);
const mockEventFindMany = vi.mocked(prisma.event.findMany);
const mockEventUpdateMany = vi.mocked(prisma.event.updateMany);
const mockRawEventGroupBy = vi.mocked(prisma.rawEvent.groupBy);
const mockResolve = vi.mocked(resolveKennelTag);

beforeEach(() => {
  vi.clearAllMocks();
  mockSourceKennelFind.mockResolvedValue([{ kennelId: "kennel_1" }] as never);
  mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });
  mockEventUpdateMany.mockResolvedValue({ count: 0 } as never);
});

describe("reconcileStaleEvents", () => {
  it("cancels sole-source events not in current scrape", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    // DB has two events for kennel_1, but scrape only returned one date
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
    ] as never);

    // No orphaned events have RawEvents from other sources
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_2"]);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["evt_2"] } },
      data: { status: "CANCELLED" },
    });
  });

  it("preserves multi-source events when one source removes them", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
    ] as never);

    // evt_2 has RawEvents from another source
    mockRawEventGroupBy.mockResolvedValueOnce([{ eventId: "evt_2" }] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(result.cancelledEventIds).toEqual([]);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
  });

  it("does not cancel events that match scraped dates", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
      buildRawEvent({ date: "2026-02-21", kennelTag: "BoBBH3" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(mockRawEventGroupBy).not.toHaveBeenCalled();
  });

  it("returns zero when no kennels are linked to the source", async () => {
    mockSourceKennelFind.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", [buildRawEvent()], 90);

    expect(result.cancelled).toBe(0);
    expect(mockEventFindMany).not.toHaveBeenCalled();
  });

  it("returns zero when no orphaned events exist", async () => {
    mockEventFindMany.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", [buildRawEvent()], 90);

    expect(result.cancelled).toBe(0);
    expect(mockRawEventGroupBy).not.toHaveBeenCalled();
  });

  it("skips events with unresolved kennel tags in scrape results", async () => {
    // First call: unresolved tag, second call: resolved
    mockResolve
      .mockResolvedValueOnce({ kennelId: null, matched: false })
      .mockResolvedValueOnce({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "Unknown" }),
      buildRawEvent({ date: "2026-02-21", kennelTag: "BoBBH3" }),
    ];

    // DB has both dates
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
    ] as never);

    // evt_1 is orphaned because the unresolved tag didn't add "kennel_1:2026-02-14" to the set
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    // evt_1 is orphaned (kennel_1:2026-02-14 not in scraped set due to unresolved tag)
    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_1"]);
  });

  it("handles multiple kennels linked to one source", async () => {
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
      { kennelId: "kennel_2" },
    ] as never);

    mockResolve
      .mockResolvedValueOnce({ kennelId: "kennel_1", matched: true })
      .mockResolvedValueOnce({ kennelId: "kennel_2", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoH3" }),
    ];

    // DB has events for both kennels, plus an extra for kennel_2
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_2", kennelId: "kennel_2", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_3", kennelId: "kennel_2", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
    ] as never);

    // evt_3 has no other sources
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_3"]);
  });

  it("does not cancel same-day events when both present in scrape", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-03-08", kennelTag: "BoH3", sourceUrl: "https://example.com/trail-a" }),
      buildRawEvent({ date: "2026-03-08", kennelTag: "BoH3", sourceUrl: "https://example.com/trail-b" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-03-08T12:00:00Z"), sourceUrl: "https://example.com/trail-a", },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-03-08T12:00:00Z"), sourceUrl: "https://example.com/trail-b", },
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(mockRawEventGroupBy).not.toHaveBeenCalled();
  });

  it("scopes reconciliation to scrapedKennelIds subset when provided", async () => {
    // Source has two linked kennels, but only kennel_1 was scraped
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
      { kennelId: "kennel_2" },
    ] as never);

    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    // DB returns events for both kennels in the window (scoped to kennel_1 only)
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com" },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com" },
    ] as never);

    // evt_2 is orphaned and sole-source
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90, ["kennel_1"]);

    // Only kennel_1 events are in scope; evt_2 is cancelled
    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_2"]);
    // kennelsInScope reflects the subset; totalLinkedKennels reflects the full set
    expect(result.kennelsInScope).toBe(1);
    expect(result.totalLinkedKennels).toBe(2);

    // Verify the DB query was scoped to kennel_1 only (not kennel_2)
    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelId: { in: ["kennel_1"] },
        }),
      }),
    );
  });

  it("cancels multiple orphaned events in one batch", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
      { id: "evt_3", kennelId: "kennel_1", date: new Date("2026-02-28T12:00:00Z"), sourceUrl: "https://hashnyc.com", },
    ] as never);

    // Both orphaned events are sole-source (no other sources)
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(2);
    expect(result.cancelledEventIds).toEqual(["evt_2", "evt_3"]);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["evt_2", "evt_3"] } },
      data: { status: "CANCELLED" },
    });
  });

  it("scopes to scrapedKennelIds when provided — unscraped kennels untouched", async () => {
    // Two kennels linked to the source
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
      { kennelId: "kennel_2" },
    ] as never);

    mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    // DB has events for both kennels — kennel_2's event would be orphaned
    // if we reconciled all linked kennels, but we only scraped kennel_1
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com" },
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90, ["kennel_1"]);

    // Only kennel_1 was in scope, so the query should use { in: ["kennel_1"] }
    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelId: { in: ["kennel_1"] },
        }),
      }),
    );
    expect(result.cancelled).toBe(0);
    expect(result.kennelsInScope).toBe(1);
    expect(result.totalLinkedKennels).toBe(2);
  });

  it("falls back to all linked kennels when scrapedKennelIds is undefined", async () => {
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
      { kennelId: "kennel_2" },
    ] as never);

    mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelId: { in: ["kennel_1", "kennel_2"] },
        }),
      }),
    );
    expect(result.kennelsInScope).toBe(2);
    expect(result.totalLinkedKennels).toBe(2);
  });

  it("ignores scrapedKennelIds not linked to source (intersection)", async () => {
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
    ] as never);

    mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([] as never);

    // Pass kennel_99 which is NOT linked — should be filtered out
    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90, ["kennel_1", "kennel_99"]);

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelId: { in: ["kennel_1"] },
        }),
      }),
    );
    expect(result.kennelsInScope).toBe(1);
  });

  it("returns diagnostic fields in result", async () => {
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
      { kennelId: "kennel_2" },
    ] as never);

    mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTag: "BoBBH3" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", kennelId: "kennel_1", date: new Date("2026-02-14T12:00:00Z"), sourceUrl: "https://hashnyc.com" },
      { id: "evt_2", kennelId: "kennel_1", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com" },
      { id: "evt_3", kennelId: "kennel_2", date: new Date("2026-02-21T12:00:00Z"), sourceUrl: "https://hashnyc.com" },
    ] as never);

    // evt_3 has another source
    mockRawEventGroupBy.mockResolvedValueOnce([{ eventId: "evt_3" }] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.candidatesExamined).toBe(3);
    expect(result.multiSourcePreserved).toBe(1);
    expect(result.cancelled).toBe(1); // evt_2 only
    expect(result.kennelsInScope).toBe(2);
    expect(result.totalLinkedKennels).toBe(2);
  });

  it("preserves the days-wide past window by default", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-21T12:00:00Z");
      vi.setSystemTime(now);
      mockEventFindMany.mockResolvedValueOnce([] as never);

      await reconcileStaleEvents("src_1", [buildRawEvent()], 90);

      const call = mockEventFindMany.mock.calls[0][0] as {
        where: { date: { gte: Date; lte: Date } };
      };
      expect(call.where.date.gte).toEqual(new Date(now.getTime() - 90 * 86_400_000));
      expect(call.where.date.lte).toEqual(new Date(now.getTime() + 90 * 86_400_000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("restricts the past side to now when upcomingOnly is true", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-04-21T12:00:00Z");
      vi.setSystemTime(now);
      mockEventFindMany.mockResolvedValueOnce([] as never);

      await reconcileStaleEvents("src_1", [buildRawEvent()], 90, undefined, true);

      const call = mockEventFindMany.mock.calls[0][0] as {
        where: { date: { gte: Date; lte: Date } };
      };
      expect(call.where.date.gte).toEqual(now);
      expect(call.where.date.lte).toEqual(new Date(now.getTime() + 90 * 86_400_000));
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns empty result when scrapedKennelIds has no overlap with linked kennels", async () => {
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
    ] as never);

    const result = await reconcileStaleEvents("src_1", [buildRawEvent()], 90, ["kennel_99"]);

    expect(result.cancelled).toBe(0);
    expect(result.kennelsInScope).toBe(0);
    expect(result.totalLinkedKennels).toBe(1);
    expect(mockEventFindMany).not.toHaveBeenCalled();
  });
});
