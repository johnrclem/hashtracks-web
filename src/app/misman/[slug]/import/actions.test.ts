// ── Mocks ──

const mockMisman = { id: "misman_1", clerkId: "clerk_misman" };

vi.mock("@/lib/auth", () => ({
  getMismanUser: vi.fn(),
  getRosterGroupId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    kennelHasher: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    event: {
      findMany: vi.fn(),
    },
    kennelAttendance: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/misman/csv-import", () => ({
  parseAttendanceCSV: vi.fn(),
  matchHasherNames: vi.fn(),
  matchColumnHeaders: vi.fn(),
  buildImportRecords: vi.fn(),
  DEFAULT_CELL_MARKERS: { present: "x", paid: "p", hared: "h" },
}));

vi.mock("@/lib/misman/hare-sync", () => ({
  syncEventHares: vi.fn(),
}));

import { getMismanUser, getRosterGroupId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseAttendanceCSV,
  matchHasherNames,
  matchColumnHeaders,
  buildImportRecords,
} from "@/lib/misman/csv-import";
import { syncEventHares } from "@/lib/misman/hare-sync";
import { previewCSVImport, executeCSVImport } from "./actions";

const mockAuth = vi.mocked(getMismanUser);
const mockGetRosterGroup = vi.mocked(getRosterGroupId);
const mockParseCSV = vi.mocked(parseAttendanceCSV);
const mockMatchHashers = vi.mocked(matchHasherNames);
const mockMatchColumns = vi.mocked(matchColumnHeaders);
const mockBuildRecords = vi.mocked(buildImportRecords);
const mockRosterFind = vi.mocked(prisma.kennelHasher.findMany);
const mockHasherCreate = vi.mocked(prisma.kennelHasher.create);
const mockEventFind = vi.mocked(prisma.event.findMany);
const mockAttendanceFind = vi.mocked(prisma.kennelAttendance.findMany);
const mockAttendanceCreateMany = vi.mocked(prisma.kennelAttendance.createMany);
const mockSyncHares = vi.mocked(syncEventHares);

const baseConfig = {
  nameColumn: 0,
  dataStartColumn: 1,
  headerRow: 0,
  dataStartRow: 1,
  fuzzyThreshold: 0.8,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockMisman as never);
  mockGetRosterGroup.mockResolvedValue("rg_1" as never);
});

// ── previewCSVImport ──

describe("previewCSVImport", () => {
  it("returns error when not authorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await previewCSVImport("kennel_1", "csv data", baseConfig);
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns error for empty CSV (no hasher names)", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: [],
      headers: [],
      rows: [],
    } as never);

    const result = await previewCSVImport("kennel_1", "csv data", baseConfig);
    expect(result).toEqual({ error: "No hasher names found in CSV. Check column configuration." });
  });

  it("returns correct preview data with match counts", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: ["Mudflap", "Speed Demon"],
      headers: ["2026-01-01", "2026-01-08"],
      rows: [["x", "p"], ["x", ""]],
    } as never);
    mockRosterFind.mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John" },
    ] as never);
    mockMatchHashers.mockReturnValueOnce({
      matched: [{ csvName: "Mudflap", kennelHasherId: "kh_1", matchType: "exact", matchScore: 1 }],
      unmatched: ["Speed Demon"],
    } as never);
    mockEventFind.mockResolvedValueOnce([
      { id: "evt_1", date: new Date("2026-01-01T12:00:00Z"), runNumber: 100, kennelId: "kennel_1" },
    ] as never);
    mockMatchColumns.mockReturnValueOnce({
      matched: [{ columnHeader: "2026-01-01", eventId: "evt_1", date: new Date("2026-01-01") }],
      unmatched: ["2026-01-08"],
    } as never);
    mockAttendanceFind.mockResolvedValueOnce([] as never);
    mockBuildRecords.mockReturnValueOnce({
      records: [{ kennelHasherId: "kh_1", eventId: "evt_1", paid: true, hared: false }],
      duplicateCount: 0,
    } as never);

    const result = await previewCSVImport("kennel_1", "csv data", baseConfig);

    expect(result.data).toBeDefined();
    expect(result.data!.hasherCount).toBe(2);
    expect(result.data!.matchedHashers).toHaveLength(1);
    expect(result.data!.unmatchedHashers).toEqual(["Speed Demon"]);
    expect(result.data!.recordCount).toBe(1);
    expect(result.data!.paidCount).toBe(1);
  });

  it("counts duplicates against existing attendance", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: ["Mudflap"],
      headers: ["2026-01-01"],
      rows: [["x"]],
    } as never);
    mockRosterFind.mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John" },
    ] as never);
    mockMatchHashers.mockReturnValueOnce({
      matched: [{ csvName: "Mudflap", kennelHasherId: "kh_1", matchType: "exact", matchScore: 1 }],
      unmatched: [],
    } as never);
    mockEventFind.mockResolvedValueOnce([
      { id: "evt_1", date: new Date("2026-01-01T12:00:00Z"), runNumber: 100, kennelId: "kennel_1" },
    ] as never);
    mockMatchColumns.mockReturnValueOnce({
      matched: [{ columnHeader: "2026-01-01", eventId: "evt_1", date: new Date("2026-01-01") }],
      unmatched: [],
    } as never);
    mockAttendanceFind.mockResolvedValueOnce([
      { kennelHasherId: "kh_1", eventId: "evt_1" },
    ] as never);
    mockBuildRecords.mockReturnValueOnce({
      records: [],
      duplicateCount: 1,
    } as never);

    const result = await previewCSVImport("kennel_1", "csv data", baseConfig);

    expect(result.data!.duplicateCount).toBe(1);
    expect(result.data!.recordCount).toBe(0);
  });
});

// ── executeCSVImport ──

describe("executeCSVImport", () => {
  const execConfig = { ...baseConfig, createHashers: false };

  it("returns error when not authorized", async () => {
    mockAuth.mockResolvedValueOnce(null as never);
    const result = await executeCSVImport("kennel_1", "csv data", execConfig);
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("creates attendance records with audit log", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: ["Mudflap"],
      headers: ["2026-01-01"],
      rows: [["x"]],
    } as never);
    mockRosterFind.mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John" },
    ] as never);
    mockMatchHashers.mockReturnValueOnce({
      matched: [{ csvName: "Mudflap", kennelHasherId: "kh_1", matchType: "exact", matchScore: 1 }],
      unmatched: [],
    } as never);
    mockEventFind.mockResolvedValueOnce([
      { id: "evt_1", date: new Date("2026-01-01T12:00:00Z"), runNumber: 100, kennelId: "kennel_1" },
    ] as never);
    mockMatchColumns.mockReturnValueOnce({
      matched: [{ columnHeader: "2026-01-01", eventId: "evt_1", date: new Date("2026-01-01") }],
      unmatched: [],
    } as never);
    mockAttendanceFind.mockResolvedValueOnce([] as never);
    mockBuildRecords.mockReturnValueOnce({
      records: [{ kennelHasherId: "kh_1", eventId: "evt_1", paid: false, hared: false }],
      duplicateCount: 0,
    } as never);
    mockAttendanceCreateMany.mockResolvedValueOnce({ count: 1 } as never);

    const result = await executeCSVImport("kennel_1", "csv data", execConfig);

    expect(result.data!.created).toBe(1);
    expect(mockAttendanceCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    // Verify audit log is included
    const createCall = mockAttendanceCreateMany.mock.calls[0][0];
    const firstRecord = (createCall as { data: unknown[] }).data[0] as Record<string, unknown>;
    expect(firstRecord.recordedBy).toBe("misman_1");
    expect(firstRecord.editLog).toBeDefined();
  });

  it("creates new hashers when createHashers=true", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: ["Mudflap", "NewHasher"],
      headers: ["2026-01-01"],
      rows: [["x"], ["x"]],
    } as never);
    mockRosterFind.mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John" },
    ] as never);
    mockMatchHashers.mockReturnValueOnce({
      matched: [{ csvName: "Mudflap", kennelHasherId: "kh_1", matchType: "exact", matchScore: 1 }],
      unmatched: ["NewHasher"],
    } as never);
    mockHasherCreate.mockResolvedValueOnce({ id: "kh_new" } as never);
    mockEventFind.mockResolvedValueOnce([
      { id: "evt_1", date: new Date("2026-01-01T12:00:00Z"), runNumber: 100, kennelId: "kennel_1" },
    ] as never);
    mockMatchColumns.mockReturnValueOnce({
      matched: [{ columnHeader: "2026-01-01", eventId: "evt_1", date: new Date("2026-01-01") }],
      unmatched: [],
    } as never);
    mockAttendanceFind.mockResolvedValueOnce([] as never);
    mockBuildRecords.mockReturnValueOnce({
      records: [
        { kennelHasherId: "kh_1", eventId: "evt_1", paid: false, hared: false },
        { kennelHasherId: "kh_new", eventId: "evt_1", paid: false, hared: false },
      ],
      duplicateCount: 0,
    } as never);
    mockAttendanceCreateMany.mockResolvedValueOnce({ count: 2 } as never);

    const result = await executeCSVImport("kennel_1", "csv data", {
      ...baseConfig,
      createHashers: true,
    });

    expect(result.data!.createdHashers).toBe(1);
    expect(mockHasherCreate).toHaveBeenCalledWith({
      data: {
        rosterGroupId: "rg_1",
        kennelId: "kennel_1",
        hashName: "NewHasher",
      },
    });
  });

  it("skips unmatched hashers when createHashers=false", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: ["Unknown"],
      headers: ["2026-01-01"],
      rows: [["x"]],
    } as never);
    mockRosterFind.mockResolvedValueOnce([] as never);
    mockMatchHashers.mockReturnValueOnce({
      matched: [],
      unmatched: ["Unknown"],
    } as never);
    mockEventFind.mockResolvedValueOnce([
      { id: "evt_1", date: new Date("2026-01-01T12:00:00Z"), runNumber: 100, kennelId: "kennel_1" },
    ] as never);
    mockMatchColumns.mockReturnValueOnce({
      matched: [{ columnHeader: "2026-01-01", eventId: "evt_1", date: new Date("2026-01-01") }],
      unmatched: [],
    } as never);
    mockAttendanceFind.mockResolvedValueOnce([] as never);
    mockBuildRecords.mockReturnValueOnce({
      records: [],
      duplicateCount: 0,
    } as never);

    const result = await executeCSVImport("kennel_1", "csv data", execConfig);

    expect(result.data!.created).toBe(0);
    expect(result.data!.unmatchedHashers).toBe(1);
    expect(mockHasherCreate).not.toHaveBeenCalled();
  });

  it("triggers syncEventHares for events with hare records", async () => {
    mockParseCSV.mockReturnValueOnce({
      hasherNames: ["Mudflap"],
      headers: ["2026-01-01"],
      rows: [["h"]],
    } as never);
    mockRosterFind.mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John" },
    ] as never);
    mockMatchHashers.mockReturnValueOnce({
      matched: [{ csvName: "Mudflap", kennelHasherId: "kh_1", matchType: "exact", matchScore: 1 }],
      unmatched: [],
    } as never);
    mockEventFind.mockResolvedValueOnce([
      { id: "evt_1", date: new Date("2026-01-01T12:00:00Z"), runNumber: 100, kennelId: "kennel_1" },
    ] as never);
    mockMatchColumns.mockReturnValueOnce({
      matched: [{ columnHeader: "2026-01-01", eventId: "evt_1", date: new Date("2026-01-01") }],
      unmatched: [],
    } as never);
    mockAttendanceFind.mockResolvedValueOnce([] as never);
    mockBuildRecords.mockReturnValueOnce({
      records: [{ kennelHasherId: "kh_1", eventId: "evt_1", paid: false, hared: true }],
      duplicateCount: 0,
    } as never);
    mockAttendanceCreateMany.mockResolvedValueOnce({ count: 1 } as never);
    mockSyncHares.mockResolvedValueOnce(undefined as never);

    const result = await executeCSVImport("kennel_1", "csv data", execConfig);

    expect(result.data!.created).toBe(1);
    expect(mockSyncHares).toHaveBeenCalledWith("evt_1");
  });
});
