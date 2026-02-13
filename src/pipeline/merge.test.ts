import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRawEvent } from "@/test/factories";

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findUnique: vi.fn(), update: vi.fn() },
    sourceKennel: { findMany: vi.fn() },
    rawEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    event: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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
import { processRawEvents, updateSourceHealth } from "./merge";

const mockSourceFind = vi.mocked(prisma.source.findUnique);
const mockSourceUpdate = vi.mocked(prisma.source.update);
const mockSourceKennelFind = vi.mocked(prisma.sourceKennel.findMany);
const mockRawEventFind = vi.mocked(prisma.rawEvent.findFirst);
const mockRawEventCreate = vi.mocked(prisma.rawEvent.create);
const mockRawEventUpdate = vi.mocked(prisma.rawEvent.update);
const mockEventFind = vi.mocked(prisma.event.findUnique);
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
    mockEventFind.mockResolvedValueOnce(null);
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
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", trustLevel: 5 } as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await processRawEvents("src_1", [buildRawEvent()]);
    expect(result.updated).toBe(1);
    expect(mockEventUpdate).toHaveBeenCalled();
  });

  it("does not update when trust level is lower", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFind.mockResolvedValueOnce({ id: "evt_1", trustLevel: 8 } as never);

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
    mockEventFind.mockResolvedValueOnce(null);
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
    });
  });

  it("parses date correctly as UTC noon", async () => {
    mockRawEventFind.mockResolvedValueOnce(null);
    mockEventFind.mockResolvedValueOnce(null);
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
    mockEventFind.mockResolvedValueOnce({ id: "evt_existing", trustLevel: 3 } as never);
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
    mockEventFind.mockResolvedValueOnce(null);
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
    mockEventFind.mockResolvedValue(null);
    mockEventCreate.mockResolvedValue({ id: "evt_1" } as never);
    mockFingerprint.mockReturnValueOnce("fp_1").mockReturnValueOnce("fp_2");

    await processRawEvents("src_1", [
      buildRawEvent({ date: "2026-02-14" }),
      buildRawEvent({ date: "2026-02-15" }),
    ]);
    expect(mockSourceKennelFind).toHaveBeenCalledTimes(1);
  });
});

describe("updateSourceHealth", () => {
  it("sets HEALTHY when no errors", async () => {
    mockSourceUpdate.mockResolvedValueOnce({} as never);
    await updateSourceHealth("src_1", { created: 5, updated: 0, skipped: 0, unmatched: [] }, []);
    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthStatus: "HEALTHY" }),
      }),
    );
  });

  it("sets DEGRADED when has errors but also processed events", async () => {
    mockSourceUpdate.mockResolvedValueOnce({} as never);
    await updateSourceHealth("src_1", { created: 3, updated: 0, skipped: 0, unmatched: [] }, ["some error"]);
    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthStatus: "DEGRADED" }),
      }),
    );
  });

  it("sets FAILING when no events processed and has errors", async () => {
    mockSourceUpdate.mockResolvedValueOnce({} as never);
    await updateSourceHealth("src_1", { created: 0, updated: 0, skipped: 0, unmatched: [] }, ["error"]);
    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthStatus: "FAILING" }),
      }),
    );
  });

  it("does not set lastSuccessAt when FAILING", async () => {
    mockSourceUpdate.mockResolvedValueOnce({} as never);
    await updateSourceHealth("src_1", { created: 0, updated: 0, skipped: 0, unmatched: [] }, ["error"]);
    const updateData = (mockSourceUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(updateData.lastSuccessAt).toBeUndefined();
  });
});
