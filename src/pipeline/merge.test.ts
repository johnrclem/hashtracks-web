import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRawEvent } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findUnique: vi.fn(), update: vi.fn() },
    sourceKennel: { findMany: vi.fn() },
    rawEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    eventLink: { upsert: vi.fn() },
    kennel: { findUnique: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  },
}));

vi.mock("./fingerprint", () => ({
  generateFingerprint: vi.fn(() => "fp_abc123"),
}));

vi.mock("./kennel-resolver", () => ({
  resolveKennelTag: vi.fn(),
  clearResolverCache: vi.fn(),
}));

vi.mock("@/lib/geo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/geo")>();
  return {
    ...actual,
    extractCoordsFromMapsUrl: vi.fn(() => null),
    geocodeAddress: vi.fn(async () => null),
    resolveShortMapsUrl: vi.fn(async () => null),
    reverseGeocode: vi.fn(async () => null),
    parseDMSFromLocation: vi.fn(() => null),
    stripDMSFromLocation: vi.fn((loc: string) => loc),
  };
});

import { prisma } from "@/lib/db";
import { generateFingerprint } from "./fingerprint";
import { resolveKennelTag } from "./kennel-resolver";
import { processRawEvents, sanitizeTitle, sanitizeLocation, sanitizeHares, friendlyKennelName, rewriteStaleDefaultTitle, suppressRedundantCity, NON_ENGLISH_GEO_RE, completenessScore, pickCanonicalEventId, pickCanonicalEventIds } from "./merge";

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
  mockSourceFind.mockResolvedValue({ trustLevel: 5, type: "HTML_SCRAPER" } as never);
  mockSourceKennelFind.mockResolvedValue([{ kennelId: "kennel_1" }] as never);
  mockRawEventCreate.mockResolvedValue({ id: "raw_1" } as never);
  mockRawEventUpdate.mockResolvedValue({} as never);
  vi.mocked(prisma.eventLink.upsert).mockResolvedValue({} as never);
  mockResolve.mockResolvedValue({ kennelId: "kennel_1", matched: true });
  // recomputeCanonical calls findMany once per successful upsert AFTER the
  // existing disambiguation findMany. Tests queue responses for the first
  // call via mockResolvedValueOnce; default fallthrough returns [] so
  // recomputeCanonical early-exits on length 0 and doesn't consume the
  // next test's queued response.
  mockEventFindMany.mockResolvedValue([] as never);
  vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
});

describe("processRawEvents", () => {
  it("skips event when fingerprint already exists (processed)", async () => {
    mockRawEventFind.mockResolvedValueOnce({ id: "existing", processed: true, eventId: "evt_1" } as never);
    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it("re-processes orphaned RawEvent (processed=false, eventId=null) after admin delete", async () => {
    mockRawEventFind.mockResolvedValueOnce({ id: "existing", processed: false, eventId: null } as never);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_new" } as never);
    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
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

  it("does not full-update when trust level is lower, but enriches NULL fields", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    // Existing event has trust 8; source trust is 5. All user-facing fields
    // are null/undefined so the lower-trust enrichment path fills them.
    mockEventFindMany.mockResolvedValueOnce([{ id: "evt_1", trustLevel: 8 }] as never);
    mockEventUpdate.mockResolvedValue({ id: "evt_1" } as never);

    const result = await processRawEvents("src_1", [buildRawEvent()]);
    // updated is 1 (the matched-event counter at line 850). The enrichment
    // path fires an update call but doesn't double-count.
    expect(result.updated).toBe(1);
    // The enrichment update should contain description/hares/location/startTime
    // but NOT title, runNumber, or other full-update-only fields.
    const enrichCall = mockEventUpdate.mock.calls.find(
      (call: unknown[]) => (call[0] as { data?: { description?: string } })?.data?.description,
    );
    expect(enrichCall).toBeDefined();
    const enrichData = (enrichCall![0] as { data: Record<string, unknown> }).data;
    expect(enrichData).toHaveProperty("description");
    expect(enrichData).not.toHaveProperty("title");
    expect(enrichData).not.toHaveProperty("runNumber");
    expect(enrichData).not.toHaveProperty("trustLevel");
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
      created: 0, createdEventIds: [], updated: 0, skipped: 0, blocked: 0, restored: 0,
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

  it("never writes locationCity for HARRIER_CENTRAL sources on create (#471)", async () => {
    mockSourceFind.mockResolvedValue({ trustLevel: 5, type: "HARRIER_CENTRAL" } as never);
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_new" } as never);

    await processRawEvents("src_1", [
      buildRawEvent({ location: "Sobu line, West exit", kennelTag: "tokyo-h3" }),
    ]);

    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationCity: null }),
      }),
    );
  });

  it("clears existing runNumber when adapter emits null (HC social re-scrape #892)", async () => {
    // Existing canonical event was previously stored with runNumber=2100 (a
    // social that wrongly inherited a numbered-run value before #892). HC
    // adapter now emits runNumber=null for eventNumber<=0; merge UPDATE must
    // overwrite, not preserve, so the user-visible "#0/#2100" regression goes
    // away on next scrape — not just for newly-created events.
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_social", trustLevel: 5, runNumber: 2100 },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [buildRawEvent({ runNumber: null })]);

    const updateCall = mockEventUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(updateCall.data.runNumber).toBeNull();
  });

  it("preserves existing runNumber when adapter omits the field (undefined)", async () => {
    // Symmetric guard: many adapters never emit runNumber. They must not
    // accidentally clear an existing value.
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_existing", trustLevel: 5, runNumber: 1234 },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [buildRawEvent({ runNumber: undefined })]);

    const updateCall = mockEventUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("runNumber");
  });

  it("preserves existing locationCity for HARRIER_CENTRAL sources on update (#471)", async () => {
    // On UPDATE we never touch locationCity for canonical-location sources. If a non-HC
    // source previously populated city for this canonical event (cross-source merge),
    // an HC scrape must not wipe it.
    mockSourceFind.mockResolvedValue({ trustLevel: 5, type: "HARRIER_CENTRAL" } as never);
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_existing", trustLevel: 5, locationCity: "Tokyo" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ location: "Sobu line, West exit", kennelTag: "tokyo-h3" }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(updateCall).toBeDefined();
    expect(updateCall.data).not.toHaveProperty("locationCity");
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

  it("re-processes unprocessed unmatched RawEvents (blocked at kennel level)", async () => {
    // Existing unprocessed RawEvent with no eventId — gets re-processed but blocked
    // by kennel resolution (unmatched tag). This is correct: the re-process attempt
    // lets the pipeline apply its own guards rather than permanently skipping.
    mockRawEventFind.mockResolvedValueOnce({ id: "raw_existing", processed: false, eventId: null } as never);
    mockResolve.mockResolvedValueOnce({ kennelId: null, matched: false });

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "UnknownH3", date: "2026-03-01" }),
    ]);

    // Event is re-processed but fails kennel resolution
    expect(result.created).toBe(0);
  });

  it("re-processes unprocessed blocked RawEvents (blocked at source-kennel guard)", async () => {
    // Existing unprocessed RawEvent — gets re-processed but blocked by source-kennel guard
    mockRawEventFind.mockResolvedValueOnce({ id: "raw_existing", processed: false, eventId: null } as never);
    mockResolve.mockResolvedValueOnce({ kennelId: "kennel_other", matched: true });
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({ shortName: "OtherH3" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ kennelTag: "OtherH3", date: "2026-03-01" }),
    ]);

    // Event is re-processed but blocked by source-kennel guard — counts as blocked
    expect(result.blocked).toBe(1);
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

  it("multi-event fallback: URL-less incoming with unique runNumber matches that row", async () => {
    // iCal feeds often have no URL. With two existing rows, runNumber
    // disambiguates before startTime (which differs across source timezones).
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, sourceUrl: "https://source-a.com/a", startTime: "10:30", runNumber: 100, title: "Trail A" },
      { id: "evt_2", trustLevel: 5, sourceUrl: "https://source-a.com/b", startTime: "14:30", runNumber: 200, title: "Trail B" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: undefined, startTime: "15:00", runNumber: 200 }),
    ]);

    expect(result.updated).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "evt_2" } }),
    );
  });

  it("multi-event fallback: ambiguous runNumber (two rows share it) skips the runNumber step", async () => {
    // Multi-part event: two rows with same runNumber at distinct URLs
    // (e.g. AVLH3 #786 Part B + Part C on different Meetup pages). A
    // URL-less incoming with that runNumber must NOT silently merge into
    // the first match — the selector keeps them split, so the matcher
    // falls through to startTime/title for disambiguation.
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "part_b", trustLevel: 5, sourceUrl: "https://meetup.com/a", startTime: "10:00", runNumber: 786, title: "AVLH3 #786 Part B" },
      { id: "part_c", trustLevel: 5, sourceUrl: "https://meetup.com/b", startTime: "18:00", runNumber: 786, title: "AVLH3 #786 Part C" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      // Incoming matches Part C by startTime, not by ambiguous runNumber.
      buildRawEvent({ date: "2026-03-08", sourceUrl: undefined, startTime: "18:00", runNumber: 786 }),
    ]);

    expect(result.updated).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "part_c" } }),
    );
  });

  it("multi-event fallback: ambiguous runNumber with no secondary discriminator creates a new row", async () => {
    // Worst-case ambiguous path: runNumber matches >1 row, incoming has no
    // URL, no startTime, no title. Matcher must NOT silently merge into
    // whichever sibling is first — create a new row so the slot stays
    // inspectable (dedup cleanup or operator review can sort it out).
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "part_b", trustLevel: 5, sourceUrl: "https://meetup.com/a", startTime: "10:00", runNumber: 786, title: "AVLH3 #786 Part B" },
      { id: "part_c", trustLevel: 5, sourceUrl: "https://meetup.com/b", startTime: "18:00", runNumber: 786, title: "AVLH3 #786 Part C" },
    ] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_new" } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        date: "2026-03-08",
        sourceUrl: undefined,
        startTime: undefined,
        title: undefined,
        runNumber: 786,
      }),
    ]);

    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("lower-trust source restores a CANCELLED row and mirrors status in-memory", async () => {
    // Regression guard for round-2 stale-after-restore: the lower-trust
    // restore path at upsertCanonicalEvent updates DB status but must also
    // mutate the in-memory `existingEvent.status` so recomputeCanonical's
    // status-aware pool sees the row as live, not CANCELLED.
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      {
        id: "evt_restored",
        trustLevel: 9, // higher than ctx.trustLevel=5 → takes restore path only
        status: "CANCELLED",
        sourceUrl: "https://source-a.com/event",
        startTime: "19:00",
        title: "Trail",
        runNumber: 42,
      },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-03-08", sourceUrl: "https://source-a.com/event", startTime: "19:00", runNumber: 42 }),
    ]);

    expect(result.restored).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_restored" },
        data: { status: "CONFIRMED" },
      }),
    );
  });

  it("restores a CANCELLED row via refreshExistingEvent even when scraped row has no startTime (#874)", async () => {
    // Dublin Nash Hash regression: the hareline row "3–5 July 2026" has no
    // time, so composeUtcStart returns null. Without this fix, the early
    // return in refreshExistingEvent bypassed the CANCELLED→CONFIRMED restore
    // for processed=true fingerprint matches, leaving the event cancelled
    // indefinitely once it had been cancelled by a prior reconcile cycle.
    mockRawEventFind.mockResolvedValueOnce({
      id: "raw_existing",
      processed: true,
      eventId: "evt_cancelled",
    } as never);
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      trustLevel: 5,
      dateUtc: null,
      timezone: "Europe/Dublin",
      status: "CANCELLED",
    } as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-07-03", startTime: undefined }),
    ]);

    expect(result.restored).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalledWith({
      where: { id: "evt_cancelled" },
      data: { status: "CONFIRMED" },
    });
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

  it("generates default title using kennel display name (not raw tag)", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      shortName: "DUHHH", fullName: "DUHHH", region: "Dallas-Fort Worth, TX",
      latitude: null, longitude: null, country: "US", regionRef: null,
    } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "duhhh",
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

  it("uses friendlyKennelName for short kennel codes in default title", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      shortName: "H5", fullName: "Harrisburg-Hershey Hash House Harriers", region: "Harrisburg, PA",
      latitude: null, longitude: null, country: "US", regionRef: null,
    } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "h5-hash",
        title: undefined,
        location: undefined,
        hares: undefined,
        runNumber: 314,
      }),
    ]);

    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Harrisburg-Hershey H3 Trail #314" }),
      }),
    );
  });

  it("includes run number in default title when available", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([] as never);
    mockEventCreate.mockResolvedValueOnce({ id: "evt_1" } as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      shortName: "Houston H3", fullName: "Houston Hash House Harriers", region: "Houston, TX",
      latitude: null, longitude: null, country: "US", regionRef: null,
    } as never);

    const result = await processRawEvents("src_1", [
      buildRawEvent({
        kennelTag: "h4-tx",
        title: undefined,
        location: undefined,
        hares: undefined,
        runNumber: 42,
      }),
    ]);

    expect(result.created).toBe(1);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: "Houston H3 Trail #42" }),
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

describe("time/cost field clearing on update (#530)", () => {
  // startTime
  it("preserves existing startTime when new source has undefined startTime", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, startTime: "18:00" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ startTime: undefined }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("startTime");
  });

  it("overwrites existing startTime when new source provides a string startTime", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, startTime: "18:00" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ startTime: "19:30" }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.startTime).toBe("19:30");
  });

  it("clears existing startTime when source explicitly provides null", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, startTime: "18:00" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ startTime: null }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).toHaveProperty("startTime");
    expect(updateCall.data.startTime).toBeNull();
  });

  // endTime
  it("preserves existing endTime when new source has undefined endTime", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, endTime: "20:00" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ endTime: undefined }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("endTime");
  });

  it("overwrites existing endTime when new source provides a string endTime", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, endTime: "20:00" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ endTime: "21:30" }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.endTime).toBe("21:30");
  });

  it("clears existing endTime when source explicitly provides null", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, endTime: "20:00" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ endTime: null }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).toHaveProperty("endTime");
    expect(updateCall.data.endTime).toBeNull();
  });

  // cost
  it("preserves existing cost when new source has undefined cost", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, cost: "$5" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ cost: undefined }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty("cost");
  });

  it("overwrites existing cost when new source provides a string cost", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, cost: "$5" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ cost: "$10" }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data.cost).toBe("$10");
  });

  it("clears existing cost when source explicitly provides null", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1", trustLevel: 5, cost: "$5" },
    ] as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    await processRawEvents("src_1", [
      buildRawEvent({ cost: null }),
    ]);

    const updateCall = mockEventUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).toHaveProperty("cost");
    expect(updateCall.data.cost).toBeNull();
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

  it("strips parenthetical instruction text from title", () => {
    expect(sanitizeTitle("Philly Hash (See: hashphilly.com for details)")).toBe("Philly Hash");
  });

  it("strips 'Visit' instruction variant", () => {
    expect(sanitizeTitle("Weekly Run (Visit our website for info)")).toBe("Weekly Run");
  });

  it("strips trailing ' - Location TBD' from EWH3-style titles", () => {
    expect(sanitizeTitle("Havana Lewinsky & Just Tommy - Location TBD")).toBe(
      "Havana Lewinsky & Just Tommy",
    );
  });

  it("does not strip Location TBD when not a trailing suffix", () => {
    expect(sanitizeTitle("Location TBD - Meet at the Park")).toBe("Location TBD - Meet at the Park");
  });

  it("returns null for 'Wanna Hare?' CTA title", () => {
    expect(sanitizeTitle("Wanna Hare? Check out our upcoming available dates!")).toBeNull();
  });

  it("returns null for 'available dates' CTA title", () => {
    expect(sanitizeTitle("Check out our available dates for haring")).toBeNull();
  });

  it("returns null for schedule description used as title", () => {
    expect(sanitizeTitle("Mosquito H3 runs on the first and third Wednesdays of the month on the west side of Houston.")).toBeNull();
  });

  it("returns null for 'meets every' schedule description", () => {
    expect(sanitizeTitle("BH3 meets every Saturday at 2pm")).toBeNull();
  });

  it("returns null for 'hashes on the' schedule description", () => {
    expect(sanitizeTitle("Our kennel hashes on the second Sunday")).toBeNull();
  });

  it("passes through normal title containing 'run' (regression)", () => {
    expect(sanitizeTitle("Fun Run at the Park")).toBe("Fun Run at the Park");
  });

  it("passes through title with 'run on' not matching schedule pattern (regression)", () => {
    expect(sanitizeTitle("Trail Run on the Beach")).toBe("Trail Run on the Beach");
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

  it("returns null for sentence-shaped CTAs (#963)", () => {
    // Live City H3 #1920 case: the source description starts "Hare - We need
    // a Hare, Contact Full Load!" and the adapter passes the value through
    // verbatim. sanitizeHares must catch the embedded "need a Hare" phrase
    // (via CTA_EMBEDDED_PATTERNS) and return null so the merge UPDATE path
    // writes haresText: null and clears any stale "real" hare value (#949).
    expect(sanitizeHares("We need a Hare, Contact Full Load!")).toBeNull();
    expect(sanitizeHares("Need a hare for this trail")).toBeNull();
    expect(sanitizeHares("Hare needed — please volunteer")).toBeNull();
    expect(sanitizeHares("Looking for a hare")).toBeNull();
  });

  it("does NOT clear legitimate hare names that contain the word 'need' (no false positives)", () => {
    // Defensive: a hare name like "Need For Speed" or "Needled" should not
    // be misclassified as a CTA. CTA_EMBEDDED_PATTERNS requires "need" to
    // be followed by "(a) hare(s)", so these pass through.
    expect(sanitizeHares("Need For Speed")).toBe("Need For Speed");
    expect(sanitizeHares("Needled")).toBe("Needled");
  });

  it("truncates at boilerplate marker 'WHAT TIME'", () => {
    expect(sanitizeHares("Captain Hash WHAT TIME: 6:30 PM")).toBe("Captain Hash");
  });

  it("truncates at boilerplate marker 'WHERE:'", () => {
    expect(sanitizeHares("Captain Hash WHERE: The Pub")).toBe("Captain Hash");
  });

  it("truncates at boilerplate marker 'Location:'", () => {
    expect(sanitizeHares("Penis Colada Location: Probably Bolton")).toBe("Penis Colada");
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

  // Fix 1: word boundary prevents false positive on "on on" substring
  it("does not truncate hare name containing 'on on' substring", () => {
    expect(sanitizeHares("Son on of a Peach")).toBe("Son on of a Peach");
  });

  it("does not truncate hare name containing 'Start' substring (Headstart)", () => {
    expect(sanitizeHares("Headstart")).toBe("Headstart");
  });

  it("still truncates at real On On boilerplate marker", () => {
    expect(sanitizeHares("Captain Hash On On: The Pub")).toBe("Captain Hash");
  });

  it("still truncates at real On-On boilerplate marker", () => {
    expect(sanitizeHares("Captain Hash On-On: The Pub")).toBe("Captain Hash");
  });

  it("returns null when the whole value is boilerplate (#819)", () => {
    // Stale "On On Q" canonical value was surviving because the old impl only
    // truncated when the marker was mid-string (idx > 0), leaving idx===0 as
    // a pass-through. See bangkokhash hare-boilerplate-leak audit.
    expect(sanitizeHares("On On Q")).toBeNull();
    expect(sanitizeHares("On-On The Pub")).toBeNull();
    expect(sanitizeHares("On On: 6:30 at The Pub")).toBeNull();
  });

  // Fix 2: URL rejection
  it("rejects bare URL as hare value", () => {
    expect(sanitizeHares("https://maps.app.goo.gl/cqc9yN889CTN23vLA")).toBeNull();
  });

  it("rejects http URL as hare value", () => {
    expect(sanitizeHares("http://example.com/hares")).toBeNull();
  });

  // Fix 3: single-character artifact rejection
  it("rejects single-character hare value as scraping artifact", () => {
    expect(sanitizeHares("S")).toBeNull();
    expect(sanitizeHares("A")).toBeNull();
  });

  it("passes through two-character hare name", () => {
    expect(sanitizeHares("Al")).toBe("Al");
  });

  it("returns null for 'Sign up!' CTA text", () => {
    expect(sanitizeHares("Sign up!")).toBeNull();
    expect(sanitizeHares("sign up")).toBeNull();
    expect(sanitizeHares("Sign Up")).toBeNull();
  });

  it("returns null for 'volunteer' CTA text", () => {
    expect(sanitizeHares("Volunteer")).toBeNull();
    expect(sanitizeHares("volunteer")).toBeNull();
  });

  it("does not filter names containing 'sign' as substring", () => {
    expect(sanitizeHares("Stop Sign Steve")).toBe("Stop Sign Steve");
  });
});

// ── friendlyKennelName ──

describe("friendlyKennelName", () => {
  it("returns shortName when longer than 4 chars", () => {
    expect(friendlyKennelName("Houston H3", "Houston Hash House Harriers")).toBe("Houston H3");
  });

  it("returns shortName when longer than 4 chars (SeaMon)", () => {
    expect(friendlyKennelName("SeaMon", "Seattle Monday Hash House Harriers")).toBe("SeaMon");
  });

  it("expands short code using fullName with HHH suffix", () => {
    expect(friendlyKennelName("H5", "Harrisburg-Hershey Hash House Harriers")).toBe("Harrisburg-Hershey H3");
  });

  it("expands short code (GAL)", () => {
    expect(friendlyKennelName("GAL", "Galveston Hash House Harriers")).toBe("Galveston H3");
  });

  it("expands short code (OCH3)", () => {
    expect(friendlyKennelName("OCH3", "Old Coulsdon Hash House Harriers")).toBe("Old Coulsdon H3");
  });

  it("returns fullName as-is when no HHH suffix", () => {
    expect(friendlyKennelName("SFM", "South Fulton Mob")).toBe("South Fulton Mob");
  });

  it("returns fullName as-is when no HHH suffix (LBH)", () => {
    expect(friendlyKennelName("LBH", "Love Bucket Hash")).toBe("Love Bucket Hash");
  });

  it("returns shortName when fullName equals shortName", () => {
    expect(friendlyKennelName("H6", "H6")).toBe("H6");
  });

  it("returns shortName when fullName is null", () => {
    expect(friendlyKennelName("H5", null)).toBe("H5");
  });

  it("returns shortName when stripping HHH leaves empty string", () => {
    expect(friendlyKennelName("HHH", "Hash House Harriers")).toBe("HHH");
  });

  it("handles 'Hash House Harriers and Harriettes' suffix (DH4)", () => {
    expect(friendlyKennelName("DH4", "Dayton Hash House Harriers and Harriettes")).toBe("Dayton H3");
  });

  it("returns fullName when only 'Hash House Harriettes' (no Harriers)", () => {
    // "Hash House Harriettes" alone (without "Harriers") is not the standard HHH suffix
    expect(friendlyKennelName("XH3", "Example Hash House Harriettes")).toBe("Example Hash House Harriettes");
  });
});

// ── rewriteStaleDefaultTitle ──

describe("rewriteStaleDefaultTitle", () => {
  it("rewrites kennelCode-based title to display name (case-insensitive)", () => {
    expect(rewriteStaleDefaultTitle("KWH3 Trail", "kwh3", "Key West H3", "Key West Hash House Harriers"))
      .toBe("Key West H3 Trail");
  });

  it("rewrites kennelCode-based title with run number", () => {
    expect(rewriteStaleDefaultTitle("kwh3 Trail #42", "kwh3", "Key West H3", "Key West Hash House Harriers"))
      .toBe("Key West H3 Trail #42");
  });

  it("rewrites FEH3 to Fort Eustis H3", () => {
    expect(rewriteStaleDefaultTitle("FEH3 Trail", "feh3", "Fort Eustis H3", "Fort Eustis Hash House Harriers"))
      .toBe("Fort Eustis H3 Trail");
  });

  it("does not rewrite non-default titles", () => {
    expect(rewriteStaleDefaultTitle("Halloween Hash Bash", "kwh3", "Key West H3", "Key West Hash House Harriers"))
      .toBe("Halloween Hash Bash");
  });

  it("does not rewrite when display name matches kennelCode", () => {
    expect(rewriteStaleDefaultTitle("nych3 Trail", "nych3", "NYCH3", "New York City Hash House Harriers"))
      .toBe("nych3 Trail");
  });

  it("returns original title when no match", () => {
    expect(rewriteStaleDefaultTitle("Something Else", "kwh3", "Key West H3", null))
      .toBe("Something Else");
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

  it("strips leading decimal coordinate pair", () => {
    expect(sanitizeLocation("30.290552, -97.772365, the corner of Enfield and Exposition"))
      .toBe("the corner of Enfield and Exposition");
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

  it("deduplicates abbreviated intersection name (LBH3 pattern)", () => {
    expect(sanitizeLocation("North San Miguel Road & Barcelona Place, N San Miguel Rd & Barcelona Pl, Walnut, CA 91789, USA"))
      .toBe("North San Miguel Road & Barcelona Place, Walnut, CA 91789, USA");
  });

  it("does not deduplicate legitimately different address segments", () => {
    expect(sanitizeLocation("123 Main St, Suite 200, Springfield, IL"))
      .toBe("123 Main St, Suite 200, Springfield, IL");
  });

  it("deduplicates when abbreviated form is first", () => {
    expect(sanitizeLocation("N Main St, North Main Street, Springfield, IL"))
      .toBe("North Main Street, Springfield, IL");
  });

  // Contact-CTA stripping / nulling (#829 email, #831 phone).
  // LOCATION_EMAIL_CTA_RE is anchored on a leading contact verb, so multi-
  // segment addresses that merely mention an email aren't nulled. The paren-
  // strip requires a CTA verb at the start AND a contact-info signal inside
  // (digits/@/"for <noun>") so legitimate parens like "(Call Center entrance)"
  // or "The Pub (upstairs)" survive.
  it.each([
    // input → expected (null = should return null)
    ["Casa De Assover – Raleigh, NC (text Assover at 919-332-2615 for address)", "Casa De Assover – Raleigh, NC"], // #831
    ["The Usual Spot (call 555-1212 for directions)", "The Usual Spot"],
    ["Hideout Bar (message @hare for address)", "Hideout Bar"],
    ["The Pub (upstairs), Boston, MA", "The Pub (upstairs), Boston, MA"],
    ["The Conference Hall (Call Center entrance)", "The Conference Hall (Call Center entrance)"],
    ["The Pub, 123 Main St, Boston, MA — see hi@x.com", "The Pub, 123 Main St, Boston, MA"],
    ["Inquire for location: abqh3misman@gmail.com", null], // #829
    ["Email venue@example.com for address", null],
    ["Contact misman@example.org for address", null],
    ["Maps, Inquire for location: foo@example.com", null],
  ])("sanitizes contact-CTA locations: %s", (input, expected) => {
    expect(sanitizeLocation(input)).toBe(expected);
  });
});

// ── NON_ENGLISH_GEO_RE (French locale location normalization) ──

describe("NON_ENGLISH_GEO_RE", () => {
  it("matches German geographic terms", () => {
    expect(NON_ENGLISH_GEO_RE.test("Frankfurt, Bundesland Hessen")).toBe(true);
    expect(NON_ENGLISH_GEO_RE.test("Berliner Straße 42")).toBe(true);
    expect(NON_ENGLISH_GEO_RE.test("Vereinigte Staaten")).toBe(true);
  });

  it("matches Spanish geographic terms", () => {
    expect(NON_ENGLISH_GEO_RE.test("Madrid, Comunidad de Madrid")).toBe(true);
    expect(NON_ENGLISH_GEO_RE.test("Barcelona, Provincia de Barcelona")).toBe(true);
  });

  it("matches French Préfecture (ASCII-boundary compatible)", () => {
    expect(NON_ENGLISH_GEO_RE.test("Préfecture de Paris")).toBe(true);
  });

  it("does not match English geographic text", () => {
    expect(NON_ENGLISH_GEO_RE.test("Rochester, NY, USA")).toBe(false);
    expect(NON_ENGLISH_GEO_RE.test("123 Main St, Springfield, IL")).toBe(false);
  });

  // Note: French patterns starting with É (État, États-Unis) don't match due to
  // \b word boundary not firing on non-ASCII characters. This is a known limitation
  // — the geocoder's language=en param handles French locations at the API level.
});

// ── suppressRedundantCity ──

describe("suppressRedundantCity", () => {
  it("returns city when locationName has no state code", () => {
    expect(suppressRedundantCity("The Pub", "Akron, OH")).toBe("Akron, OH");
  });

  it("returns city when city is already in locationName", () => {
    expect(suppressRedundantCity("123 Main St, Akron, OH", "Akron, OH")).toBe("Akron, OH");
  });

  it("suppresses city when locationName has state code and city differs", () => {
    expect(suppressRedundantCity("13480 Congress Lake Avenue, Hartville, OH", "Akron, OH")).toBeNull();
  });

  it("suppresses city when locationName has state + zip and city differs", () => {
    expect(suppressRedundantCity("1234 Main St, Palm Beach County, FL 33414", "Wellington, FL")).toBeNull();
  });

  it("preserves city when locationName has only street + state (no city segment)", () => {
    expect(suppressRedundantCity("123 Main St, OH", "Akron, OH")).toBe("Akron, OH");
  });

  it("preserves city when locationName is county + state (2 segments)", () => {
    expect(suppressRedundantCity("Palm Beach County, FL", "Wellington, FL")).toBe("Wellington, FL");
  });

  it("returns null when city is null", () => {
    expect(suppressRedundantCity("Some Location, NY", null)).toBeNull();
  });

  it("returns city when locationName is null", () => {
    expect(suppressRedundantCity(null, "Akron, OH")).toBe("Akron, OH");
  });

  it("suppresses neighborhood for full US address ending in country (#906)", () => {
    // N2H3 case: full address with zip + USA suffix shouldn't get a
    // reverse-geocoded neighborhood ("Marlene Village") appended.
    expect(
      suppressRedundantCity(
        "Greek Village, 301 NW Murray Blvd, Portland, OR 97229, USA",
        "Marlene Village, OR",
      ),
    ).toBeNull();
  });

  it("preserves city when full US address contains the city (#906)", () => {
    expect(
      suppressRedundantCity(
        "Greek Village, 301 NW Murray Blvd, Portland, OR 97229, USA",
        "Portland, OR",
      ),
    ).toBe("Portland, OR");
  });

  it("preserves city for international address with no zip (#906)", () => {
    expect(
      suppressRedundantCity(
        "Marina Green, San Francisco, California",
        "San Francisco, CA",
      ),
    ).toBe("San Francisco, CA");
  });

  it("suppresses neighborhood for Google-formatted US address with ZIP before state (#906)", () => {
    // Google Maps & Harrier Central both emit "...ZIP, ST, United States".
    // Note: HARRIER_CENTRAL itself is in shouldSkipReverseGeocode so this path
    // isn't reached for HC events today, but other sources emit the same shape.
    expect(
      suppressRedundantCity(
        "Apothecary Ale House, 227 Spruce Street, Morgantown, 26505-7511, WV, United States",
        "Marlene Village, WV",
      ),
    ).toBeNull();
  });

  it("preserves city when ZIP-before-state US address contains the city (#906)", () => {
    expect(
      suppressRedundantCity(
        "Apothecary Ale House, 227 Spruce Street, Morgantown, 26505-7511, WV, United States",
        "Morgantown, WV",
      ),
    ).toBe("Morgantown, WV");
  });

  it("preserves city for international address with 5-digit postal code (#906)", () => {
    // German 5-digit postal code shouldn't trigger US zip suppression.
    expect(
      suppressRedundantCity(
        "Hofbräuhaus, Platzl 9, 80331 München, Germany",
        "Munich",
      ),
    ).toBe("Munich");
    // French 5-digit postal code.
    expect(
      suppressRedundantCity(
        "Tour Eiffel, 5 Avenue Anatole France, 75007 Paris, France",
        "Paris",
      ),
    ).toBe("Paris");
  });
});

// ============================================================================
// canonical-row selection: when two sources produce rows for the same
// (kennelId, date) and the upsert disambiguation can't collapse them, pick
// exactly one row for display paths.
// ============================================================================

const EMPTY_DISPLAY_FIELDS = {
  title: null,
  haresText: null,
  locationName: null,
  locationStreet: null,
  locationCity: null,
  locationAddress: null,
  latitude: null,
  longitude: null,
  startTime: null,
  endTime: null,
  cost: null,
  sourceUrl: null,
  runNumber: null,
  description: null,
};

type Candidate = Parameters<typeof pickCanonicalEventId>[0][number];

function candidate(overrides: Partial<Candidate> & { id: string }): Candidate {
  return {
    trustLevel: 5,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    status: "CONFIRMED",
    ...EMPTY_DISPLAY_FIELDS,
    ...overrides,
  };
}

describe("completenessScore", () => {
  it("returns 0 for a row with no populated display fields", () => {
    expect(completenessScore(EMPTY_DISPLAY_FIELDS)).toBe(0);
  });

  it("counts each populated field exactly once", () => {
    expect(
      completenessScore({
        ...EMPTY_DISPLAY_FIELDS,
        title: "Run #42",
        startTime: "14:00",
        latitude: 33.75,
        longitude: -84.39,
      }),
    ).toBe(3);
  });

  it("treats empty strings as not-populated", () => {
    expect(
      completenessScore({
        ...EMPTY_DISPLAY_FIELDS,
        title: "",
        haresText: "",
        startTime: "",
      }),
    ).toBe(0);
  });

  it("counts lat+lng as a single unit (half a pair is useless)", () => {
    expect(
      completenessScore({ ...EMPTY_DISPLAY_FIELDS, latitude: 33.75, longitude: null }),
    ).toBe(0);
    expect(
      completenessScore({ ...EMPTY_DISPLAY_FIELDS, latitude: 33.75, longitude: -84.39 }),
    ).toBe(1);
  });
});

describe("pickCanonicalEventId", () => {
  it("returns null for an empty input", () => {
    expect(pickCanonicalEventId([])).toBeNull();
  });

  it("returns the single id when there's no competition", () => {
    expect(pickCanonicalEventId([candidate({ id: "e1" })])).toBe("e1");
  });

  // Rows in a single signature group (dup-drift scenarios): share
  // startTime + sourceUrl + title so they collapse to one canonical.
  const DUP_SIG = {
    title: "Run #42",
    startTime: "14:00",
    sourceUrl: "https://example.com/42",
  } as const;

  it("picks the row with the higher trustLevel", () => {
    const winner = candidate({ id: "e1", ...DUP_SIG, trustLevel: 8 });
    const loser = candidate({
      id: "e2",
      ...DUP_SIG,
      trustLevel: 5,
      haresText: "Full field set",
      locationName: "Piedmont Park",
    });
    expect(pickCanonicalEventId([loser, winner])).toBe("e1");
  });

  it("picks the more-populated row when trustLevels tie", () => {
    const sparse = candidate({ id: "e1", ...DUP_SIG, trustLevel: 5 });
    const rich = candidate({
      id: "e2",
      ...DUP_SIG,
      trustLevel: 5,
      haresText: "hares",
      locationName: "park",
    });
    expect(pickCanonicalEventId([sparse, rich])).toBe("e2");
  });

  it("picks the older row when trust and completeness both tie", () => {
    const older = candidate({
      id: "e1",
      ...DUP_SIG,
      trustLevel: 5,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = candidate({
      id: "e2",
      ...DUP_SIG,
      trustLevel: 5,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(pickCanonicalEventId([newer, older])).toBe("e1");
  });

  it("trust wins over completeness", () => {
    // Prod audit case: a high-trust source with just title + startTime
    // must beat a low-trust source that guessed 10 fields.
    const highTrust = candidate({
      id: "e1",
      ...DUP_SIG,
      trustLevel: 9,
    });
    const lowTrust = candidate({
      id: "e2",
      ...DUP_SIG,
      trustLevel: 3,
      haresText: "Maybe?",
      locationName: "Some park",
      locationStreet: "123 Some St",
      locationCity: "Atlanta",
      latitude: 33.75,
      longitude: -84.39,
      description: "long description",
    });
    expect(pickCanonicalEventId([lowTrust, highTrust])).toBe("e1");
  });

  it("handles three-way dup-drift groups correctly", () => {
    const a = candidate({ id: "a", ...DUP_SIG, trustLevel: 5 });
    const b = candidate({
      id: "b",
      ...DUP_SIG,
      trustLevel: 7,
      haresText: "hares",
    });
    const c = candidate({ id: "c", ...DUP_SIG, trustLevel: 6 });
    expect(pickCanonicalEventId([a, b, c])).toBe("b");
  });

  it("preserves multiple canonicals for genuine double-headers (distinct startTime)", () => {
    // Regression: a single-winner selector would demote morning OR evening
    // trail, making one invisible in all display paths that filter on
    // isCanonical: true. Grouping by (startTime, sourceUrl, title)
    // signature keeps both — upsertCanonicalEvent intentionally creates
    // these two rows because batchMatchedEvents detected a same-day,
    // different-time entry.
    const morning = candidate({
      id: "morning",
      trustLevel: 5,
      title: "Morning Trail",
      startTime: "09:00",
      sourceUrl: "https://example.com/morning",
    });
    const evening = candidate({
      id: "evening",
      trustLevel: 5,
      title: "Evening Trail",
      startTime: "18:00",
      sourceUrl: "https://example.com/evening",
    });
    const canonicals = pickCanonicalEventIds([morning, evening]);
    expect(canonicals.has("morning")).toBe(true);
    expect(canonicals.has("evening")).toBe(true);
    expect(canonicals.size).toBe(2);
  });

  it("collapses cross-source dupes that share a signature", () => {
    // Same startTime + same title + same sourceUrl → one real run, two
    // database rows. Only one survives as canonical.
    const rowA = candidate({
      id: "a",
      trustLevel: 5,
      title: "Run #42",
      startTime: "14:00",
      sourceUrl: "https://example.com/42",
    });
    const rowB = candidate({
      id: "b",
      trustLevel: 7,
      title: "Run #42",
      startTime: "14:00",
      sourceUrl: "https://example.com/42",
    });
    const canonicals = pickCanonicalEventIds([rowA, rowB]);
    expect(canonicals.size).toBe(1);
    expect(canonicals.has("b")).toBe(true);
  });

  it("handles mixed double-header + dup-drift in one (kennelId, date) slot", () => {
    // Morning trail has two dup rows (same signature) + an evening trail
    // (different signature). Expect exactly 2 canonicals: one from the
    // morning group, the evening trail.
    const morningA = candidate({
      id: "morning-a", trustLevel: 5, title: "AM", startTime: "09:00",
    });
    const morningB = candidate({
      id: "morning-b", trustLevel: 8, title: "AM", startTime: "09:00",
    });
    const evening = candidate({
      id: "evening", trustLevel: 5, title: "PM", startTime: "18:00",
    });
    const canonicals = pickCanonicalEventIds([morningA, morningB, evening]);
    expect(canonicals.size).toBe(2);
    expect(canonicals.has("morning-b")).toBe(true); // higher trust wins within sig
    expect(canonicals.has("evening")).toBe(true);
  });

  // Canonical-selection matrix: signature grouping (runNumber × sourceUrl)
  // plus status-aware filtering. Prod cases referenced inline:
  //   #826 SFH3 GPH3 #1704 — ICAL "GPH3 Run #1704" vs HTML "Almost Old
  //     Enough to be a Museum Piece" at same sourceUrl (race dup → collapse)
  //   AVLH3 2024-03-31 #786 — Part B + Part C at distinct Meetup URLs
  //     (multi-part event → both canonical)
  // Status-aware: display paths filter `status != CANCELLED AND
  // isCanonical = true`, so a cancelled winner would hide the live sibling.
  it.each([
    {
      name: "#826 cross-source title drift at same URL collapses",
      rowA: { id: "a", trustLevel: 8, runNumber: 1704, title: "GPH3 Run #1704", sourceUrl: "https://www.sfh3.com/runs/6516" },
      rowB: { id: "b", trustLevel: 7, runNumber: 1704, title: "Almost Old Enough to be a Museum Piece", sourceUrl: "https://www.sfh3.com/runs/6516" },
      expectedCanonicals: ["a"],
    },
    {
      name: "distinct runNumbers on same date stay as two canonicals",
      rowA: { id: "a", runNumber: 500, title: "Charity Run", startTime: "09:00" },
      rowB: { id: "b", runNumber: 1704, title: "Weekly Trail", startTime: "18:00" },
      expectedCanonicals: ["a", "b"],
    },
    {
      name: "no-runNumber rows fall back to title+time+url signature",
      rowA: { id: "a", title: "AM Trail", startTime: "09:00" },
      rowB: { id: "b", title: "PM Trail", startTime: "18:00" },
      expectedCanonicals: ["a", "b"],
    },
    {
      name: "same runNumber + URL collapses even when one row has no title",
      rowA: { id: "a", trustLevel: 5, runNumber: 42, title: "Run #42", sourceUrl: "https://example.com/runs/42" },
      rowB: { id: "b", trustLevel: 8, runNumber: 42, title: null, sourceUrl: "https://example.com/runs/42", haresText: "Slalom", locationName: "Piedmont Park" },
      expectedCanonicals: ["b"],
    },
    {
      name: "same runNumber at distinct URLs is a multi-part event (two canonicals)",
      rowA: { id: "a", runNumber: 786, title: "AVLH3 #786 Part B", sourceUrl: "https://meetup.com/events/299709371/" },
      rowB: { id: "b", runNumber: 786, title: "AVLH3 #786 Part C", sourceUrl: "https://meetup.com/events/299709393/" },
      expectedCanonicals: ["a", "b"],
    },
    {
      name: "CANCELLED row is excluded when a live sibling exists (even at lower trust)",
      rowA: { id: "cancelled", ...DUP_SIG, trustLevel: 9, status: "CANCELLED" as const, haresText: "was-hares", locationName: "old venue" },
      rowB: { id: "live", ...DUP_SIG, trustLevel: 5, status: "CONFIRMED" as const },
      expectedCanonicals: ["live"],
    },
    {
      name: "whole-group-CANCELLED falls through to normal trust/completeness ordering",
      // Reconcile needs a stable canonical pointer to un-cancel later.
      rowA: { id: "older", ...DUP_SIG, trustLevel: 5, status: "CANCELLED" as const, createdAt: new Date("2026-01-01T00:00:00Z") },
      rowB: { id: "newer", ...DUP_SIG, trustLevel: 8, status: "CANCELLED" as const, createdAt: new Date("2026-03-01T00:00:00Z") },
      expectedCanonicals: ["newer"],
    },
    {
      // #866 cross-source race path: one source emits (runNumber, no URL),
      // another emits (runNumber, URL). Pre-fix their signatures differ
      // (`run#N::` vs `run#N::<url>`) and both survive as canonical.
      name: "#866 URL-less + URL-bearing at same runNumber + compatible startTime collapses",
      rowA: { id: "url-less", trustLevel: 5, runNumber: 1704, title: "Run #1704", startTime: "14:00", sourceUrl: null },
      rowB: { id: "url-bearing", trustLevel: 5, runNumber: 1704, title: "Run #1704", startTime: "14:00", sourceUrl: "https://example.com/1704", haresText: "hares", locationName: "park" },
      expectedCanonicals: ["url-bearing"],
    },
    {
      name: "#866 collapse works when both sides have null startTime",
      rowA: { id: "url-less", trustLevel: 5, runNumber: 42, title: "Run #42", sourceUrl: null },
      rowB: { id: "url-bearing", trustLevel: 7, runNumber: 42, title: "Run #42", sourceUrl: "https://example.com/42" },
      expectedCanonicals: ["url-bearing"],
    },
    {
      // Safety: if the URL-less row claims a different time than the
      // URL-bearing row, treat them as separate events (e.g. someone typo'd
      // the runNumber into a different trail).
      name: "#866 conflicting startTimes keep both canonicals",
      rowA: { id: "url-less", trustLevel: 5, runNumber: 1704, title: "Run #1704", startTime: "09:00", sourceUrl: null },
      rowB: { id: "url-bearing", trustLevel: 5, runNumber: 1704, title: "Run #1704", startTime: "18:00", sourceUrl: "https://example.com/1704" },
      expectedCanonicals: ["url-less", "url-bearing"],
    },
    {
      // AVLH3 multi-part preservation: two URL-bearing rows for the same
      // runNumber at distinct URLs must still produce two canonicals
      // because neither is URL-less (no race to collapse).
      name: "AVLH3 multi-part still splits when neither side is URL-less",
      rowA: { id: "a", runNumber: 786, title: "AVLH3 #786 Part B", sourceUrl: "https://meetup.com/events/299709371/" },
      rowB: { id: "b", runNumber: 786, title: "AVLH3 #786 Part C", sourceUrl: "https://meetup.com/events/299709393/" },
      expectedCanonicals: ["a", "b"],
    },
  ])("$name", ({ rowA, rowB, expectedCanonicals }) => {
    const canonicals = pickCanonicalEventIds([candidate(rowA), candidate(rowB)]);
    expect([...canonicals].sort((a, b) => a.localeCompare(b))).toEqual(
      [...expectedCanonicals].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("#866 two URL-less rows + one URL-bearing row collapse into one canonical", () => {
    // The URL-less signature group buckets BOTH null-URL rows together
    // (signature ignores startTime when runNumber is set). The helper must
    // inspect every row's startTime, not just [0], or input order decides
    // whether collapse happens.
    const urlLessA = candidate({
      id: "url-less-a",
      runNumber: 1704,
      title: "Run #1704",
      startTime: null,
      sourceUrl: null,
    });
    const urlLessB = candidate({
      id: "url-less-b",
      runNumber: 1704,
      title: "Run #1704",
      startTime: "14:00",
      sourceUrl: null,
    });
    const urlBearing = candidate({
      id: "url-bearing",
      trustLevel: 8,
      runNumber: 1704,
      title: "Run #1704",
      startTime: "14:00",
      sourceUrl: "https://example.com/1704",
    });
    // Order should not matter: run both permutations.
    for (const rows of [
      [urlLessA, urlLessB, urlBearing],
      [urlLessB, urlLessA, urlBearing],
      [urlBearing, urlLessA, urlLessB],
    ]) {
      const canonicals = pickCanonicalEventIds(rows);
      expect(canonicals.size).toBe(1);
      expect(canonicals.has("url-bearing")).toBe(true);
    }
  });

  it("#866 URL-less group with conflicting internal time blocks collapse", () => {
    // If the URL-less group contains rows with two different concrete times,
    // it can't be the same event as a single-time URL-bearing peer. Safety:
    // keep both groups canonical rather than silently merging.
    const urlLessMorning = candidate({
      id: "url-less-morning",
      runNumber: 42,
      title: "Run #42",
      startTime: "09:00",
      sourceUrl: null,
    });
    const urlLessEvening = candidate({
      id: "url-less-evening",
      runNumber: 42,
      title: "Run #42",
      startTime: "18:00",
      sourceUrl: null,
    });
    const urlBearing = candidate({
      id: "url-bearing",
      runNumber: 42,
      title: "Run #42",
      startTime: "18:00",
      sourceUrl: "https://example.com/42",
    });
    const canonicals = pickCanonicalEventIds([
      urlLessMorning,
      urlLessEvening,
      urlBearing,
    ]);
    // URL-less group stays (it's one signature group, one canonical winner
    // by trust/completeness), URL-bearing stays — two canonicals total.
    expect(canonicals.size).toBe(2);
    expect(canonicals.has("url-bearing")).toBe(true);
  });

  it("#866 URL-less internally conflicted times + URL-bearing blank-time peer blocks collapse", () => {
    // Codex review regression: URL-less group has {09:00, 18:00}, URL-bearing
    // peer has null startTime. A blank peer cannot disambiguate which of the
    // two URL-less rows it matches, so collapse must be blocked.
    const urlLessMorning = candidate({
      id: "url-less-morning",
      runNumber: 99,
      title: "Run #99",
      startTime: "09:00",
      sourceUrl: null,
    });
    const urlLessEvening = candidate({
      id: "url-less-evening",
      runNumber: 99,
      title: "Run #99",
      startTime: "18:00",
      sourceUrl: null,
    });
    const urlBearingBlank = candidate({
      id: "url-bearing-blank",
      runNumber: 99,
      title: "Run #99",
      startTime: null,
      sourceUrl: "https://example.com/99",
    });
    const canonicals = pickCanonicalEventIds([
      urlLessMorning,
      urlLessEvening,
      urlBearingBlank,
    ]);
    expect(canonicals.size).toBe(2);
    expect(canonicals.has("url-bearing-blank")).toBe(true);
  });

  it("#866 ambiguous URL-less + two URL-bearing peers preserves all groups", () => {
    // Conservative fallback: if the URL-less row could belong to either of
    // two URL-bearing multi-part rows, don't guess — keep all three
    // canonicals. Reproducing #866 for this rare topology beats silently
    // collapsing a genuine multi-part event.
    const urlLess = candidate({
      id: "url-less",
      runNumber: 786,
      title: "AVLH3 #786",
      startTime: null,
      sourceUrl: null,
    });
    const partB = candidate({
      id: "part-b",
      runNumber: 786,
      title: "AVLH3 #786 Part B",
      startTime: null,
      sourceUrl: "https://meetup.com/events/299709371/",
    });
    const partC = candidate({
      id: "part-c",
      runNumber: 786,
      title: "AVLH3 #786 Part C",
      startTime: null,
      sourceUrl: "https://meetup.com/events/299709393/",
    });
    const canonicals = pickCanonicalEventIds([urlLess, partB, partC]);
    expect(canonicals.size).toBe(3);
    expect(canonicals.has("url-less")).toBe(true);
    expect(canonicals.has("part-b")).toBe(true);
    expect(canonicals.has("part-c")).toBe(true);
  });

  it("flips the winner when equal-trust completeness shifts after an update", () => {
    // Regression: the update path in upsertCanonicalEvent enriches fields
    // on the target row. If recomputeCanonical scores pre-update state, a
    // sibling with higher pre-update completeness wins even though the
    // updated row would beat it now. Splicing the fresh row into
    // sameDayEvents is what guarantees the selector sees the post-update
    // score.
    const preUpdate = candidate({
      id: "updating",
      ...DUP_SIG,
      trustLevel: 5,
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
    const sibling = candidate({
      id: "sibling",
      ...DUP_SIG,
      trustLevel: 5,
      haresText: "hares",
      locationName: "park",
      createdAt: new Date("2026-03-02T00:00:00Z"),
    });
    expect(pickCanonicalEventId([preUpdate, sibling])).toBe("sibling");

    const postUpdate = {
      ...preUpdate,
      haresText: "hares",
      locationName: "park",
      locationStreet: "123 Piedmont Ave",
      latitude: 33.75,
      longitude: -84.39,
    };
    // Completeness now beats the sibling (4 vs 2).
    expect(pickCanonicalEventId([postUpdate, sibling])).toBe("updating");
  });
});
