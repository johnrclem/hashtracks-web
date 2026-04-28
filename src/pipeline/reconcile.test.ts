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

/**
 * Build a minimal canonical Event shape for Prisma `findMany` mocks.
 * Default `sourceUrl` matches the most common scraped URL in these tests;
 * pass overrides to distinguish double-header slots or null-out fields.
 */
function mockEvent(
  id: string,
  kennelId: string,
  dateStr: string,
  overrides: {
    sourceUrl?: string | null;
    startTime?: string | null;
    title?: string | null;
  } = {},
) {
  return {
    id,
    kennelId,
    date: new Date(`${dateStr}T12:00:00Z`),
    sourceUrl: "https://hashnyc.com",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSourceKennelFind.mockResolvedValue([{ kennelId: "kennel_1" }] as never);
  mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });
  mockEventUpdateMany.mockResolvedValue({ count: 0 } as never);
});

describe("reconcileStaleEvents", () => {
  it("cancels sole-source events not in current scrape", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
    ];

    // DB has two events for kennel_1, but scrape only returned one date
    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
      buildRawEvent({ date: "2026-02-21", kennelTags: ["BoBBH3" ]}),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["Unknown" ]}),
      buildRawEvent({ date: "2026-02-21", kennelTags: ["BoBBH3" ]}),
    ];

    // DB has both dates
    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoH3" ]}),
    ];

    // DB has events for both kennels, plus an extra for kennel_2
    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_2", "2026-02-14"),
      mockEvent("evt_3", "kennel_2", "2026-02-21"),
    ] as never);

    // evt_3 has no other sources
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_3"]);
  });

  it("preserves events when scrape re-emits same (kennel,date) with different sourceUrl", async () => {
    // Regression: some adapters emit upcoming rows under one URL and past rows
    // under another (per-event detail pages, year archives, separate upcoming
    // vs. past sections). When the canonical Event was created with the upcoming
    // URL but the next scrape finds the same run under a different URL, the
    // match key must still collapse on (kennelId, date) — merge pipeline
    // identity — so the event is NOT orphaned.
    const scrapedEvents = [
      buildRawEvent({
        date: "2026-02-14",
        kennelTags: ["BoBBH3"],
        sourceUrl: "https://example.com/past/detail?id=123",
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14", {
        sourceUrl: "https://example.com/upcoming",
      }),
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(result.cancelledEventIds).toEqual([]);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    expect(mockRawEventGroupBy).not.toHaveBeenCalled();
  });

  it("cancels one half of a double-header when only the other is returned", async () => {
    // Regression complement to the single-slot URL-drift fix: when a slot has
    // TWO canonical Events (genuine double-header, distinguished by sourceUrl
    // in the merge pipeline) and the scrape returns only one of them, the
    // missing member must still be cancelled. Collapsing the reconcile key to
    // (kennelId, date) alone would treat both as present because one URL hit
    // the slot — disambiguation by sourceUrl is required when N>1.
    mockResolve
      .mockResolvedValueOnce({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({
        date: "2026-03-08",
        kennelTags: ["BoH3"],
        sourceUrl: "https://example.com/trail-a",
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-a" }),
      mockEvent("evt_2", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-b" }),
    ] as never);

    // evt_2 has no RawEvents from other sources
    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_2"]);
    expect(mockEventUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["evt_2"] } },
      data: { status: "CANCELLED" },
    });
  });

  it("preserves all canonicals in a double-header slot when a scraped row has no distinguishing fields", async () => {
    // Regression: if an adapter emits a bare (kennel, date) row with no
    // sourceUrl/startTime/title into a double-header slot, the merge cascade
    // has nothing to bind on. Rather than orphan both canonicals (which would
    // cascade to a false double-cancellation), reconcile preserves the whole
    // slot — the scrape proves *some* run happened that day, even if we can't
    // tell which. Mirrors the "favor preservation on ambiguous matches" design.
    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({
        date: "2026-03-08",
        kennelTags: ["BoH3"],
        sourceUrl: undefined,
        startTime: undefined,
        title: undefined,
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-a", startTime: "10:30", title: "Morning Trail" }),
      mockEvent("evt_2", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-b", startTime: "14:30", title: "Afternoon Trail" }),
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(result.cancelledEventIds).toEqual([]);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    expect(mockRawEventGroupBy).not.toHaveBeenCalled();
  });

  it("matches when adapter emits ISO timestamp instead of YYYY-MM-DD (slot-key normalization)", async () => {
    // Regression for GH #864. RawEventData.date is documented as "YYYY-MM-DD"
    // but nothing enforced it at the reconcile key-build site. If an adapter
    // (e.g. one layering over the WordPress REST API) leaked an ISO timestamp
    // like "2026-02-14T15:00:00" here, the scraped-side key would no longer
    // match the DB-side key (built from Event.date.toISOString().split("T")[0]),
    // and the canonical would look orphaned and get cancelled.
    const scrapedEvents = [
      buildRawEvent({
        // Cast through unknown because the type says YYYY-MM-DD — this is the
        // adapter-bug scenario we're protecting against.
        date: "2026-02-14T15:00:00Z" as unknown as string,
        kennelTags: ["BoBBH3"],
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
  });

  it("accepts merge-compatible loose date forms without suppressing the kennel", async () => {
    // Codex adversarial-review catch: an earlier cut of toIsoDateString rejected
    // "2026-2-14" and "2026-02-14 15:00:00" via a strict regex gate. Merge
    // (parseUtcNoonDate) still accepts those forms, so a strict reconcile would
    // suppress the kennel and silently disable stale-event cleanup — strictly
    // worse than the GH #864 mismatch this hardening was supposed to fix.
    const scrapedEvents = [
      buildRawEvent({
        date: "2026-2-14 15:00:00" as unknown as string,
        kennelTags: ["BoBBH3"],
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(result.kennelsSuppressedForBadDate).toEqual([]);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
  });

  it("uses literal-date semantics on offset timestamps (matches merge's parseUtcNoonDate)", async () => {
    // Regression for GH #864. Merge's parseUtcNoonDate splits on "-" and
    // parseInts the components, so "2026-02-14T23:30:00-05:00" binds the
    // canonical to Feb 14 (not Feb 15, even though the offset rolls it into
    // Feb 15 UTC). Reconcile must key the same way, or it would orphan the
    // row merge just wrote — the exact bug this hardening prevents.
    const scrapedEvents = [
      buildRawEvent({
        date: "2026-02-14T23:30:00-05:00" as unknown as string,
        kennelTags: ["BoBBH3"],
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
  });

  it("suppresses cancellations for a kennel when any scraped row has an unparseable date", async () => {
    // Reconcile runs AFTER merge has written canonicals. Naively skipping a
    // malformed row from scrapedBySlot would leave its canonical orphaned and
    // flip it to CANCELLED — strictly worse than the original mismatch bug.
    // Fail-safe shape: if ANY scraped row for kennel K has a bad date, suppress
    // cancellations for every canonical of K this run. Other kennels reconcile
    // normally.
    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({
        // Sole scraped row for kennel_1; date is garbage. Without the safeguard,
        // any canonical of kennel_1 would look orphaned and get cancelled.
        date: "not-a-date" as unknown as string,
        kennelTags: ["BoBBH3"],
      }),
    ];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    // kennel_1 was excluded from scope, so no candidates query was issued.
    expect(mockEventFindMany).not.toHaveBeenCalled();
    expect(result.candidatesExamined).toBe(0);
    expect(result.totalLinkedKennels).toBe(1);
    // The degraded state is surfaced in the return shape, not just console.
    expect(result.kennelsSuppressedForBadDate).toEqual(["kennel_1"]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unparseable date"),
    );
    warnSpy.mockRestore();
  });

  it("still cancels stale events for unaffected kennels when a different kennel has an unparseable date", async () => {
    // Blast-radius check: one kennel's parse failure must not suppress
    // reconciliation for another kennel in the same scrape.
    mockSourceKennelFind.mockResolvedValueOnce([
      { kennelId: "kennel_1" },
      { kennelId: "kennel_2" },
    ] as never);
    mockResolve
      .mockResolvedValueOnce({ kennelId: "kennel_1", matched: true })  // bad date
      .mockResolvedValueOnce({ kennelId: "kennel_2", matched: true }); // valid

    const scrapedEvents = [
      buildRawEvent({
        date: "not-a-date" as unknown as string,
        kennelTags: ["BoBBH3"],
      }),
      buildRawEvent({
        date: "2026-02-14",
        kennelTags: ["Kennel2"],
      }),
    ];

    // Candidates query is scoped to unaffected kennels only (kennel_2).
    // kennel_2's Feb 21 canonical has no scrape hit → should cancel.
    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_stale", "kennel_2", "2026-02-21"),
    ] as never);

    mockRawEventGroupBy.mockResolvedValueOnce([] as never);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    // The candidates query should have excluded kennel_1 (the tainted one).
    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelId: { in: ["kennel_2"] },
        }),
      }),
    );
    expect(result.cancelled).toBe(1);
    expect(result.cancelledEventIds).toEqual(["evt_stale"]);
    // kennel_1 appears in the suppression list but kennel_2 still reconciled.
    expect(result.kennelsSuppressedForBadDate).toEqual(["kennel_1"]);
    warnSpy.mockRestore();
  });

  it("preserves double-header member when URL drifts but startTime still matches", async () => {
    // Regression: merge's same-day cascade is URL → startTime → title. When an
    // adapter re-emits an afternoon double-header member under a new URL but
    // with the same startTime, merge updates the existing canonical. Reconcile
    // must mirror that cascade so it doesn't orphan the row merge would touch.
    mockResolve
      .mockResolvedValueOnce({ kennelId: "kennel_1", matched: true })
      .mockResolvedValueOnce({ kennelId: "kennel_1", matched: true });

    const scrapedEvents = [
      buildRawEvent({
        date: "2026-03-08",
        kennelTags: ["BoH3"],
        sourceUrl: "https://example.com/trail-a",
        startTime: "10:30",
      }),
      buildRawEvent({
        date: "2026-03-08",
        kennelTags: ["BoH3"],
        // URL drifted from trail-b to a per-event detail page
        sourceUrl: "https://example.com/detail?id=999",
        startTime: "14:30",
      }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-a", startTime: "10:30", title: null }),
      mockEvent("evt_2", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-b", startTime: "14:30", title: null }),
    ] as never);

    const result = await reconcileStaleEvents("src_1", scrapedEvents, 90);

    expect(result.cancelled).toBe(0);
    expect(mockEventUpdateMany).not.toHaveBeenCalled();
    expect(mockRawEventGroupBy).not.toHaveBeenCalled();
  });

  it("restricts candidates to canonical rows only", async () => {
    // Regression: non-canonical audit rows (merge-conflict shadows) must not
    // be treated as double-header peers of the canonical row. Here the test
    // just verifies the Prisma query includes `isCanonical: true`.
    mockEventFindMany.mockResolvedValueOnce([] as never);

    await reconcileStaleEvents("src_1", [buildRawEvent()], 90);

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isCanonical: true }),
      }),
    );
  });

  it("does not cancel same-day events when both present in scrape", async () => {
    const scrapedEvents = [
      buildRawEvent({ date: "2026-03-08", kennelTags: ["BoH3"], sourceUrl: "https://example.com/trail-a" }),
      buildRawEvent({ date: "2026-03-08", kennelTags: ["BoH3"], sourceUrl: "https://example.com/trail-b" }),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-a" }),
      mockEvent("evt_2", "kennel_1", "2026-03-08", { sourceUrl: "https://example.com/trail-b" }),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
    ];

    // DB returns events for both kennels in the window (scoped to kennel_1 only)
    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
      mockEvent("evt_3", "kennel_1", "2026-02-28"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
    ];

    // DB has events for both kennels — kennel_2's event would be orphaned
    // if we reconciled all linked kennels, but we only scraped kennel_1
    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
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
      buildRawEvent({ date: "2026-02-14", kennelTags: ["BoBBH3" ]}),
    ];

    mockEventFindMany.mockResolvedValueOnce([
      mockEvent("evt_1", "kennel_1", "2026-02-14"),
      mockEvent("evt_2", "kennel_1", "2026-02-21"),
      mockEvent("evt_3", "kennel_2", "2026-02-21"),
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
