import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRawEvent } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findUnique: vi.fn(), update: vi.fn() },
    sourceKennel: { findMany: vi.fn() },
    rawEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    eventLink: { upsert: vi.fn() },
    kennel: { findUnique: vi.fn() },
  },
}));

vi.mock("./fingerprint", () => ({
  generateFingerprint: vi.fn(() => "fp_abc123"),
}));

vi.mock("./kennel-resolver", () => ({
  resolveKennelTag: vi.fn(),
  clearResolverCache: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { generateFingerprint } from "./fingerprint";
import { resolveKennelTag } from "./kennel-resolver";
import { processRawEvents } from "./merge";

const mockSourceFind = vi.mocked(prisma.source.findUnique);
const _mockSourceUpdate = vi.mocked(prisma.source.update);
const mockSourceKennelFind = vi.mocked(prisma.sourceKennel.findMany);
const mockRawEventFind = vi.mocked(prisma.rawEvent.findFirst);
const mockRawEventCreate = vi.mocked(prisma.rawEvent.create);
const mockRawEventUpdate = vi.mocked(prisma.rawEvent.update);
const mockEventFindMany = vi.mocked(prisma.event.findMany);
const mockEventCreate = vi.mocked(prisma.event.create);
const mockEventUpdate = vi.mocked(prisma.event.update);
const mockResolve = vi.mocked(resolveKennelTag);
const mockFingerprint = vi.mocked(generateFingerprint);

beforeEach(() => {
  vi.clearAllMocks();
  mockSourceFind.mockResolvedValue({ trustLevel: 5 } as never);
  mockSourceKennelFind.mockResolvedValue([{ kennelId: "kennel_1" }] as never);
  mockRawEventCreate.mockResolvedValue({ id: "raw_1" } as never);
  mockRawEventUpdate.mockResolvedValue({} as never);
  vi.mocked(prisma.eventLink.upsert).mockResolvedValue({} as never);
  mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });
});

describe("processRawEvents", () => {
  it("skips event when fingerprint already exists", async () => {
    mockRawEventFind.mockResolvedValueOnce({ id: "existing" } as never);
    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it("creates new canonical event", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
    expect(mockRawEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processed: true, eventId: "evt_1" }),
      }),
    );
  });

  it("updates existing event when trust level is >=", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([{ id: "evt_1", trustLevel: 5 }] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.updated).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalled();
  });

  it("does not update when trust level is lower", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([{ id: "evt_1", trustLevel: 8 }] as never);

    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.updated).toBe(1);
    expect(mockEventUpdate).not.toHaveBeenCalled();
  });

  it("tracks unmatched kennel tags", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockResolve.mockResolvedValueOnce({ kennelId: null, matched: false });

    const result = await processRawEvents("src_1", [buildRawEvent({ kennelTag: "UNKNOWN" })]);
    expect(result.unmatched).toEqual(["UNKNOWN"]);
  });

  it("deduplicates unmatched tags", async () => {
    mockRawEventFind.mockResolvedValue(null);
    mockResolve.mockResolvedValue({ kennelId: null, matched: false });

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "UNKNOWN" }),
      buildRawEvent({ kennelTag: "UNKNOWN" }),
    ]);
    expect(result.unmatched).toEqual(["UNKNOWN"]);
  });

  it("continues processing after individual event error", async () => {
    // First event: fingerprint lookup throws
    mockRawEventFind.mockRejectedValueOnce(new Error("DB error"));
    // Second event: succeeds
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);
    // Need unique fingerprints
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-02-14" }),
      buildRawEvent({ date: "2026-02-15" }),
    ]);
    expect(result.created).toBe(1);
  });

  it("handles empty events array", async () => {
    const result = await processRawEvents("src_1", []);
    expect(result).toEqual({
      created: 0, updated: 0, skipped: 0, blocked: 0,
      unmatched: [], blockedTags: [], eventErrors: 0, eventErrorMessages: [],
      mergeErrorDetails: [], sampleBlocked: [], sampleSkipped: [],
    });
  });

  it("parses date correctly as UTC noon", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    await processRawEvents("src_1", [buildRawEvent({ date: "2026-02-14" })]);

    const createCall = mockEventCreate.mock.calls[0][0] as { data: { date: Date } };
    const date = createCall.data.date;
    expect(date.getUTCHours()).toBe(12);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCDate()).toBe(14);
  });

  it("links RawEvent to existing Event after update", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([{ id: "evt_existing", trustLevel: 3 }] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [buildRawEvent()]);
    expect(mockRawEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ processed: true, eventId: "evt_existing" }),
      }),
    );
  });
});

describe("source-kennel guard", () => {
  it("blocks event when resolved kennel is not linked to source", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_other", matched: true });
    // Source is only linked to kennel_1 (default mock)

    const result = await processRawEvents("src_1", [buildRawEvent({ kennelTag: "OtherH3" })]);
    expect(result.blocked).toBe(1);
    expect(result.blockedTags).toEqual(["OtherH3"]);
    expect(result.created).toBe(0);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it("allows event when resolved kennel IS linked to source", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);
    // kennel_1 is in the linked set (default mock)

    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.blocked).toBe(0);
    expect(result.created).toBe(1);
  });

  it("deduplicates blocked tags", async () => {
    mockRawEventFind.mockResolvedValue(null);
    mockResolve.mockResolvedValue({ kennelId: "kennel_other", matched: true });
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "OtherH3" }),
      buildRawEvent({ kennelTag: "OtherH3" }),
    ]);
    expect(result.blocked).toBe(2);
    expect(result.blockedTags).toEqual(["OtherH3"]);
  });

  it("fetches SourceKennel links only once per batch", async () => {
    mockRawEventFind.mockResolvedValue(null);
    mockEventFindMany.mockResolvedValue([] as never);
    mockEventCreate.mockResolvedValue({ id: "evt_1" } as never);
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");

    await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-02-14" }),
      buildRawEvent({ date: "2026-02-15" }),
    ]);
    expect(mockSourceKennelFind).toHaveBeenCalledTimes(1);
  });
});

describe("mergeErrorDetails", () => {
  it("populates mergeErrorDetails with fingerprint and reason on error", async () => {
    mockRawEventFind.mockRejectedValueOnce(new Error("DB connection lost"));
    // generateFingerprint is called twice: once at line 53, once in catch block at line 200
    mockFingerprint.mockReturnValueOnce("fp_error_event").mockReturnValueOnce("fp_error_event");

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-01", kennelTag: "TestH3" }),
    ]);

    expect(result.eventErrors).toBe(1);
    expect(result.mergeErrorDetails).toEqual([
      { fingerprint: "fp_error_event", reason: "DB connection lost" },
    ]);
  });

  it("caps mergeErrorDetails at 50 entries", async () => {
    // Create 55 events that all fail
    const events = Array.from({ length: 55 }, (_, i) =>
      buildRawEvent({ date: `2026-03-${String(i + 1).padStart(2, "0")}` }),
    );
    mockRawEventFind.mockRejectedValue(new Error("Repeated failure"));

    const result = await processRawEvents("src_1", events);
    expect(result.mergeErrorDetails!.length).toBe(50);
    expect(result.eventErrors).toBe(55);
  });

  it("captures sample skipped events for unmatched tags", async () => {
    mockRawEventFind.mockResolvedValue(null);
    mockResolve.mockResolvedValue({ kennelId: null, matched: false });
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "UnknownH3", date: "2026-03-01" }),
      buildRawEvent({ kennelTag: "UnknownH3", date: "2026-03-02" }),
    ]);

    expect(result.sampleSkipped!.length).toBe(2);
    expect(result.sampleSkipped![0].reason).toBe("UNMATCHED_TAG");
    expect(result.sampleSkipped![0].kennelTag).toBe("UnknownH3");
    expect(result.sampleSkipped![0].suggestedAction).toContain("UnknownH3");
  });

  it("captures sample blocked events for source-kennel mismatch", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_other", matched: true });
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({ shortName: "OtherH3" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "OtherH3" }),
    ]);

    expect(result.sampleBlocked!.length).toBe(1);
    expect(result.sampleBlocked![0].reason).toBe("SOURCE_KENNEL_MISMATCH");
  });

  it("captures sample skipped events from fingerprint-deduped unprocessed RawEvents", async () => {
    // Existing unprocessed RawEvent (previously unmatched)
    mockRawEventFind.mockResolvedValueOnce({ id: "raw_existing", processed: false } as never);
    mockResolve.mockResolvedValueOnce({ kennelId: null, matched: false });

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "UnknownH3", date: "2026-03-01" }),
    ]);

    expect(result.skipped).toBe(1);
    expect(result.sampleSkipped!.length).toBe(1);
    expect(result.sampleSkipped![0].reason).toBe("UNMATCHED_TAG");
    expect(result.sampleSkipped![0].kennelTag).toBe("UnknownH3");
  });

  it("captures sample blocked events from fingerprint-deduped unprocessed RawEvents", async () => {
    // Existing unprocessed RawEvent (previously blocked by source-kennel guard)
    mockRawEventFind.mockResolvedValueOnce({ id: "raw_existing", processed: false } as never);
    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_other", matched: true });
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({ shortName: "OtherH3" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "OtherH3", date: "2026-03-01" }),
    ]);

    expect(result.skipped).toBe(1);
    expect(result.sampleBlocked!.length).toBe(1);
    expect(result.sampleBlocked![0].reason).toBe("SOURCE_KENNEL_MISMATCH");
    expect(result.sampleBlocked![0].kennelTag).toBe("OtherH3");
  });

  it("does not capture samples from fingerprint-deduped processed RawEvents", async () => {
    // Existing processed RawEvent (already linked to a canonical Event)
    mockRawEventFind.mockResolvedValueOnce({ id: "raw_existing", processed: true } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "NYCH3", date: "2026-03-01" }),
    ]);

    expect(result.skipped).toBe(1);
    expect(result.sampleSkipped!.length).toBe(0);
    expect(result.sampleBlocked!.length).toBe(0);
    // resolveKennelTag should NOT be called for processed deduped events
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe("double-header support", () => {
  it("creates second event when same kennel+date but different sourceUrl", async () => {
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");
    // First event: no fingerprint match, no existing events → create
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);
    // Second event: no fingerprint match, one existing with different sourceUrl → create new (double-header)
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://example.com/trail-a", startTime: "10:30", title: "Trail A" },
    ] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_2" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://example.com/trail-a", startTime: "10:30", title: "Trail A" }),
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://example.com/trail-b", startTime: "14:30", title: "Trail B" }),
    ]);

    // Both events created — different sourceUrls trigger double-header detection
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
  });

  it("creates new event when multiple exist and no disambiguation match", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    // Two existing events, none matching the new event's sourceUrl/startTime/title
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://example.com/trail-a", startTime: "10:30", title: "Trail A" },
      { id: "evt_2", trustLevel: 5, sourceUrl: "https://example.com/trail-b", startTime: "14:30", title: "Trail B" },
    ] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_3" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://example.com/trail-c", startTime: "18:00", title: "Trail C" }),
    ]);

    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledTimes(1);
  });

  it("matches by sourceUrl when multiple same-day events exist", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://example.com/trail-a", startTime: "10:30", title: "Trail A" },
      { id: "evt_2", trustLevel: 5, sourceUrl: "https://example.com/trail-b", startTime: "14:30", title: "Trail B" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://example.com/trail-b", startTime: "14:30", title: "Trail B Updated" }),
    ]);

    expect(result.updated).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evt_2" } }),
    );
  });

  it("matches single existing event when incoming has no sourceUrl", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://example.com/old-url", startTime: "10:00", title: "Old Title" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: undefined, startTime: "11:00", title: "New Title" }),
    ]);

    // Single existing event matches when incoming lacks sourceUrl (backward-compatible)
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  it("treats same-batch duplicate with matching runNumber as update, not double-header", async () => {
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");
    // First event: no fingerprint match, no existing events → create
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1", runNumber: 2100, startTime: "14:00" } as never);
    // Second event: no fingerprint match, one existing (the one we just created) with same runNumber
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://hashnyc.com/#past", startTime: "14:00", runNumber: 2100, title: "Trail" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", runNumber: 2100, startTime: "14:00", sourceUrl: "https://hashnyc.com/#past" }),
      buildRawEvent({ date: "2026-03-08", runNumber: 2100, startTime: "14:00", sourceUrl: "https://hashnyc.com/#future" }),
    ]);

    // Second event should update the first, not create a duplicate
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("treats same-batch duplicate with matching startTime as update, not double-header", async () => {
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");
    // First event: create
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1", startTime: "19:30" } as never);
    // Second event: same day, same startTime, already matched in batch
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://example.com/a", startTime: "19:30", title: "Trail" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", startTime: "19:30", sourceUrl: "https://example.com/a" }),
      buildRawEvent({ date: "2026-03-08", startTime: "19:30", sourceUrl: "https://example.com/b" }),
    ]);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("still creates double-header when same-batch events have different startTime and runNumber", async () => {
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");
    // First event: create
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1", startTime: "10:30", runNumber: 100 } as never);
    // Second event: different startTime and runNumber → genuine double-header
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://example.com/a", startTime: "10:30", runNumber: 100, title: "Morning Trail" },
    ] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_2" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", startTime: "10:30", runNumber: 100, sourceUrl: "https://example.com/a", title: "Morning Trail" }),
      buildRawEvent({ date: "2026-03-08", startTime: "19:00", runNumber: 200, sourceUrl: "https://example.com/b", title: "Evening Trail" }),
    ]);

    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
  });

  it("cross-source: matches single existing event with different sourceUrl and creates EventLink", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://source-a.com/event", startTime: "10:00", title: "Trail" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://source-b.com/event", startTime: "10:00", title: "Trail" }),
    ]);

    // Cross-source: first time seeing this kennel+date in batch → match existing + create EventLink
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    expect(vi.mocked(prisma.eventLink.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_url: { eventId: "evt_1", url: "https://source-b.com/event" } },
      }),
    );
  });

  it("multi-event fallback: matches by startTime when sourceUrl doesn't match", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://source-a.com/trail-a", startTime: "10:30", title: "Trail A" },
      { id: "evt_2", trustLevel: 5, sourceUrl: "https://source-a.com/trail-b", startTime: "14:30", title: "Trail B" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://source-b.com/event", startTime: "14:30", title: "Different Title" }),
    ]);

    // sourceUrl didn't match, but startTime fallback found evt_2
    expect(result.updated).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evt_2" } }),
    );
  });
});

describe("empty event guard", () => {
  it("skips events with no display data and no kennelTag", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "",
        title: undefined,
        location: undefined,
        hares: undefined,
        runNumber: undefined,
      }),
    ]);

    expect(result.created).toBe(0);
    expect(result.eventErrors).toBe(1);
    expect(result.eventErrorMessages[0]).toContain("Skipping empty event");
    expect(mockRawEventCreate).not.toHaveBeenCalled();
  });

  it("generates default title from kennelTag when title is missing", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "DUHHH",
        title: undefined,
        location: undefined,
        hares: undefined,
        runNumber: undefined,
      }),
    ]);

    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "DUHHH Trail" }),
      }),
    );
  });

  it("includes run number in default title when available", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "DH3",
        title: undefined,
        location: undefined,
        hares: undefined,
        runNumber: 42,
      }),
    ]);

    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "DH3 Trail #42" }),
      }),
    );
  });

  it("preserves adapter-provided title over default", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "NYCH3",
        title: "Valentine's Day Trail",
        location: undefined,
        hares: undefined,
        runNumber: undefined,
      }),
    ]);

    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Valentine's Day Trail" }),
      }),
    );
  });

  it("processes events that have at least a runNumber", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        title: undefined,
        location: undefined,
        hares: undefined,
        runNumber: 42,
      }),
    ]);

    expect(result.created).toBe(1);
  });
});

describe("location preservation on update", () => {
  it("preserves existing locationName when new source has undefined location", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, locationName: "The Pub", locationAddress: "https://maps.google.com/pub" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ location: undefined, locationUrl: undefined }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("locationName");
    expect(updateCall.data).not.toHaveProperty("locationAddress");
  });

  it("preserves existing haresText when new source has undefined hares", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, haresText: "Mudflap" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ hares: undefined }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("haresText");
  });

  it("preserves existing description when new source has undefined description", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, description: "A lovely trail" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ description: undefined }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("description");
  });

  it("clears locationName when source explicitly provides empty location", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, locationName: "The Pub" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ location: "TBD" }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).toHaveProperty("locationName");
    expect(updateCall.data.locationName).toBeNull();
  });
});

describe("sanitizeLocationUrl", () => {
  it("filters Google My Maps viewer URLs from locationAddress on create", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    await processRawEvents("src_1", [
      buildRawEvent({ locationUrl: "https://www.google.com/maps/d/u/0/viewer?mid=abc123" }),
    ]);

    const createCall = mockEventCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.locationAddress).toBeNull();
  });

  it("filters Google My Maps viewer URLs from locationAddress on update", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5 },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ locationUrl: "https://www.google.com/maps/d/u/0/viewer?mid=abc123" }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.locationAddress).toBeNull();
  });

  it("filters Google My Maps URLs with multi-part TLDs (google.co.uk)", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    await processRawEvents("src_1", [
      buildRawEvent({ locationUrl: "https://www.google.co.uk/maps/d/viewer?mid=abc123" }),
    ]);

    const createCall = mockEventCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.locationAddress).toBeNull();
  });

  it("passes through valid Google Maps URLs", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);

    const mapsUrl = "https://www.google.com/maps/search/?api=1&query=The+Pub";
    await processRawEvents("src_1", [
      buildRawEvent({ locationUrl: mapsUrl }),
    ]);

    const createCall = mockEventCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createCall.data.locationAddress).toBe(mapsUrl);
  });
});

// ── sanitizeTitle + sanitizeHares ──

import { sanitizeTitle, sanitizeLocation, sanitizeHares } from "./merge";

describe("sanitizeTitle", () => {
  it("passes through normal titles", () => {
    expect(sanitizeTitle("The Pre-Saint Patrick's Day Trail")).toBe("The Pre-Saint Patrick's Day Trail");
  });

  it("returns null for 'hares needed' admin text", () => {
    expect(sanitizeTitle("Hares needed! Email the Hare Razor")).toBeNull();
  });

  it("returns null for 'Hare needed' singular", () => {
    expect(sanitizeTitle("Hare needed for this week")).toBeNull();
  });

  it("returns null for 'Need a hare'", () => {
    expect(sanitizeTitle("Need a hare")).toBeNull();
  });

  it("returns null for 'volunteer to hare'", () => {
    expect(sanitizeTitle("Volunteer to hare this trail!")).toBeNull();
  });

  it("strips embedded email addresses", () => {
    expect(sanitizeTitle("Trail Name <foo@bar.com> details")).toBe("Trail Name details");
  });

  it("returns null for undefined", () => {
    expect(sanitizeTitle(undefined)).toBeNull();
  });

  it("returns null for empty/whitespace", () => {
    expect(sanitizeTitle("  ")).toBeNull();
  });

  it("returns null for time-only title '12:30pm'", () => {
    expect(sanitizeTitle("12:30pm")).toBeNull();
  });

  it("returns null for time-only title '1:00 PM'", () => {
    expect(sanitizeTitle("1:00 PM")).toBeNull();
  });

  it("returns null for time-only title '11:00'", () => {
    expect(sanitizeTitle("11:00")).toBeNull();
  });

  it("returns null for bare hour with am/pm like '1pm'", () => {
    expect(sanitizeTitle("1pm")).toBeNull();
  });

  it("returns null for bare hour with am/pm like '12 AM'", () => {
    expect(sanitizeTitle("12 AM")).toBeNull();
  });

  it("passes through title that contains a time but is not time-only", () => {
    expect(sanitizeTitle("Meet at 12:30pm for the trail")).toBe("Meet at 12:30pm for the trail");
  });

  it("returns null for kennel-prefixed 'HARES NEEDED'", () => {
    expect(sanitizeTitle("BH3: HARES NEEDED!")).toBeNull();
  });

  it("returns null for kennel-prefixed 'Need a hare'", () => {
    expect(sanitizeTitle("NYCH3 - Need a hare")).toBeNull();
  });

  it("preserves valid title with kennel prefix", () => {
    expect(sanitizeTitle("BH3: The St Patrick's Trail")).toBe("BH3: The St Patrick's Trail");
  });

  it("strips embedded M/DD/YY date from title", () => {
    expect(sanitizeTitle("SOCO #13 3/20/26 Spring Equinox Hash")).toBe("SOCO #13 Spring Equinox Hash");
  });

  it("strips embedded MM/DD/YYYY date from title", () => {
    expect(sanitizeTitle("Trail Name 03/20/2026 Special Run")).toBe("Trail Name Special Run");
  });

  it("strips leading day-of-week + month + day prefix from title", () => {
    expect(sanitizeTitle("Saturday March 28th OH3 #1364 Granny Panties")).toBe("OH3 #1364 Granny Panties");
  });

  it("strips leading abbreviated day + month prefix from title", () => {
    expect(sanitizeTitle("Sat Mar 28 OH3 Trail")).toBe("OH3 Trail");
  });

  it("strips trailing day-of-week + month date", () => {
    expect(sanitizeTitle("SWH3 #1783, Saturday, March 21")).toBe("SWH3 #1783");
  });

  it("strips trailing abbreviated day + month date", () => {
    expect(sanitizeTitle("Run Name, Thu, Mar 19")).toBe("Run Name");
  });

  it("strips trailing day + month + year", () => {
    expect(sanitizeTitle("Event Name, Friday, April 4, 2026")).toBe("Event Name");
  });

  it("does not strip run numbers that look like dates", () => {
    expect(sanitizeTitle("NYCH3 #3/20 Anniversary")).toBe("NYCH3 #3/20 Anniversary");
  });

  it("does not strip full date after # prefix", () => {
    expect(sanitizeTitle("Trail #12/25/26")).toBe("Trail #12/25/26");
  });

  it("collapses extra whitespace after date removal", () => {
    expect(sanitizeTitle("SOCO #13  3/20/26  Spring Equinox")).toBe("SOCO #13 Spring Equinox");
  });
});

// ── sanitizeHares ──

describe("sanitizeHares", () => {
  it("passes through normal hare names", () => {
    expect(sanitizeHares("Mudflap & Trail Blazer")).toBe("Mudflap & Trail Blazer");
  });

  it("returns null for undefined/null/empty", () => {
    expect(sanitizeHares(undefined)).toBeNull();
    expect(sanitizeHares(null)).toBeNull();
    expect(sanitizeHares("")).toBeNull();
    expect(sanitizeHares("  ")).toBeNull();
  });

  it("returns null for TBD/TBA placeholders", () => {
    expect(sanitizeHares("TBD")).toBeNull();
    expect(sanitizeHares("TBA")).toBeNull();
    expect(sanitizeHares("Needed")).toBeNull();
  });

  it("truncates at boilerplate marker 'WHAT TIME'", () => {
    expect(sanitizeHares("Captain Hash WHAT TIME: 6:30 PM")).toBe("Captain Hash");
  });

  it("truncates at boilerplate marker 'WHERE:'", () => {
    expect(sanitizeHares("Captain Hash WHERE: The Pub")).toBe("Captain Hash");
  });

  it("truncates at boilerplate marker 'Location:'", () => {
    expect(sanitizeHares("Penis ColadaLocation: Probably Bolton")).toBe("Penis Colada");
  });

  it("truncates at 'Hash Cash' marker", () => {
    expect(sanitizeHares("Alice & Bob Hash Cash: $5")).toBe("Alice & Bob");
  });

  it("truncates at 'Registration' marker", () => {
    expect(sanitizeHares("Captain Hash Registration: http://example.com")).toBe("Captain Hash");
  });

  it("truncates at 'Directions:' marker", () => {
    expect(sanitizeHares("Trail Blazer Directions: Take I-95 North")).toBe("Trail Blazer");
  });

  it("truncates at 'Length:' marker", () => {
    expect(sanitizeHares("Mudflap Length: 3 miles")).toBe("Mudflap");
  });

  it("truncates at 'Distance:' marker", () => {
    expect(sanitizeHares("Captain Hash Distance: 5k")).toBe("Captain Hash");
  });

  it("truncates at 'Price:' marker", () => {
    expect(sanitizeHares("Alice Price: $10")).toBe("Alice");
  });

  it("caps at 200 chars with smart truncation", () => {
    const longHares = "A".repeat(100) + ", " + "B".repeat(100) + ", " + "C".repeat(50);
    const result = sanitizeHares(longHares);
    expect(result!.length).toBeLessThanOrEqual(200);
    // Should truncate at last comma
    expect(result).not.toContain("C");
  });
});

// ── sanitizeLocation ──

describe("sanitizeLocation", () => {
  it("passes through normal locations", () => {
    expect(sanitizeLocation("The Pub")).toBe("The Pub");
  });

  it("returns null for TBA", () => {
    expect(sanitizeLocation("TBA")).toBeNull();
  });

  it("returns null for TBD", () => {
    expect(sanitizeLocation("TBD")).toBeNull();
  });

  it("returns null for TBC", () => {
    expect(sanitizeLocation("TBC")).toBeNull();
  });

  it("returns null for bare URLs", () => {
    expect(sanitizeLocation("https://maps.google.com/some-place")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(sanitizeLocation(undefined)).toBeNull();
  });

  it("returns null for empty/whitespace", () => {
    expect(sanitizeLocation("  ")).toBeNull();
  });

  it("strips embedded URLs from location text", () => {
    expect(sanitizeLocation("The Pub https://example.com")).toBe("The Pub");
  });

  it("strips embedded URLs from location text (maps URL)", () => {
    expect(sanitizeLocation("Location https://maps.app.goo.gl/xyz Rest")).toBe("Location Rest");
  });

  it("collapses double commas", () => {
    expect(sanitizeLocation("Pub,, Boston, MA")).toBe("Pub, Boston, MA");
  });

  it("uppercases trailing 2-letter US state abbreviation", () => {
    expect(sanitizeLocation("65 Fairchild St, Charleston, sc")).toBe("65 Fairchild St, Charleston, SC");
  });

  it("removes exact duplicate segments", () => {
    expect(sanitizeLocation("Brooklyn, NY, Brooklyn, NY")).toBe("Brooklyn, NY");
  });

  it("deduplicates segments case-insensitively", () => {
    expect(sanitizeLocation("The Pub, the pub, Boston, MA")).toBe("The Pub, Boston, MA");
  });

  it("deduplicates full garbled Meetup venue string", () => {
    expect(sanitizeLocation("Miami Miami, FL, Miami Miami, FL, Florida, FL")).toBe("Miami Miami, FL, Florida");
  });

  it("preserves normal multi-segment locations", () => {
    expect(sanitizeLocation("Central Park Tavern, 100 W 67th St, New York, NY")).toBe("Central Park Tavern, 100 W 67th St, New York, NY");
  });

  it("preserves single-segment locations (no commas)", () => {
    expect(sanitizeLocation("The Pub")).toBe("The Pub");
  });

  it("returns null for Registration: URL values", () => {
    expect(sanitizeLocation("Registration: https://example.com/signup")).toBeNull();
  });

  it("returns null for bare 'Registration' placeholder", () => {
    expect(sanitizeLocation("Registration")).toBeNull();
  });

  it("returns null for placeholder revealed after URL stripping", () => {
    expect(sanitizeLocation("TBD https://example.com")).toBeNull();
  });

  it("uppercases state abbreviation without space after comma", () => {
    expect(sanitizeLocation("The Pub, Charleston,sc")).toBe("The Pub, Charleston, SC");
  });

  it("filters 'Online event' as invalid location", () => {
    expect(sanitizeLocation("Online event")).toBeNull();
    expect(sanitizeLocation("online")).toBeNull();
    expect(sanitizeLocation("Online Event")).toBeNull();
  });

  it("strips trailing decimal coordinate pair after period", () => {
    expect(sanitizeLocation("Park at 9801 Durant Rd, Raleigh. 35.898606316275696, -78.57963120196699"))
      .toBe("9801 Durant Rd, Raleigh");
  });

  it("strips trailing decimal coordinate pair after comma", () => {
    expect(sanitizeLocation("123 Main St, Springfield, 39.7817, -89.6501"))
      .toBe("123 Main St, Springfield");
  });

  it("does not strip non-coordinate trailing numbers", () => {
    expect(sanitizeLocation("Suite 200, 123 Main St")).toBe("Suite 200, 123 Main St");
  });

  it("strips coordinate pair with negative lat", () => {
    expect(sanitizeLocation("Some Park, City. -33.8688, 151.2093"))
      .toBe("Some Park, City");
  });

  it("removes trailing period left after coordinate stripping", () => {
    expect(sanitizeLocation("Park at 9801 Durant Rd, Raleigh. 35.898606, -78.579631"))
      .toBe("9801 Durant Rd, Raleigh");
  });

  it("strips 3-decimal coordinate pairs (common Google Calendar export)", () => {
    expect(sanitizeLocation("Some Park, Raleigh. 35.898, -78.579")).toBe("Some Park, Raleigh");
  });

  it("strips bare coordinate pairs without separator prefix", () => {
    expect(sanitizeLocation("Some Park 35.898606, -78.579631")).toBe("Some Park");
  });

  it("does not strip coordinates with too few decimal places (avoids false positives)", () => {
    expect(sanitizeLocation("Place, City. 35.9, -78.6")).toBe("Place, City. 35.9, -78.6");
  });

  it("strips leading 'Maps,' prefix from Google Calendar location", () => {
    expect(sanitizeLocation("Maps, 64A Market St, Portland, ME 04101, USA"))
      .toBe("64A Market St, Portland, ME 04101, USA");
  });

  it("strips 'Meet at' instruction prefix from location", () => {
    expect(sanitizeLocation("Meet at Mikeys Late Night Slice 6562 Riverside Drive Dublin"))
      .toBe("Mikeys Late Night Slice 6562 Riverside Drive Dublin");
  });

  it("strips 'Park at' instruction prefix from location", () => {
    expect(sanitizeLocation("Park at 9801 Durant Rd, Raleigh"))
      .toBe("9801 Durant Rd, Raleigh");
  });

  it("strips 'Start at' instruction prefix from location", () => {
    expect(sanitizeLocation("Start at Central Park")).toBe("Central Park");
  });

  it("strips 'Head to' instruction prefix from location", () => {
    expect(sanitizeLocation("Head to The Pub, 123 Main St")).toBe("The Pub, 123 Main St");
  });

  it("strips 'Gather at' instruction prefix from location", () => {
    expect(sanitizeLocation("Gather at the pavilion")).toBe("the pavilion");
  });

  it("preserves location starting with 'Meeting' (not an instruction prefix)", () => {
    expect(sanitizeLocation("Meeting Room B, 123 Main St")).toBe("Meeting Room B, 123 Main St");
  });

  it("strips instruction prefix case-insensitively", () => {
    expect(sanitizeLocation("MEET AT The Bar")).toBe("The Bar");
  });

  it("strips 'Park at' + trailing GPS coordinates together", () => {
    expect(sanitizeLocation("Park at 9801 Durant Rd, Raleigh. 35.898606, -78.579631"))
      .toBe("9801 Durant Rd, Raleigh");
  });

  it("strips instruction text after em-dash", () => {
    expect(sanitizeLocation("Santa Cruz, CA — check Facebook for detrails")).toBe("Santa Cruz, CA");
  });

  it("strips instruction text after en-dash", () => {
    expect(sanitizeLocation("Downtown Park – see website for details")).toBe("Downtown Park");
  });

  it("strips instruction text after period", () => {
    expect(sanitizeLocation("Central Park. Check Facebook for updates")).toBe("Central Park");
  });

  it("preserves location with legitimate em-dash (venue name)", () => {
    expect(sanitizeLocation("The Pub — A Fine Establishment")).toBe("The Pub — A Fine Establishment");
  });
});
