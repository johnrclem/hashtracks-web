vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findMany: vi.fn() },
    kennelAlias: { findMany: vi.fn(), create: vi.fn() },
    sourceKennel: { upsert: vi.fn(), create: vi.fn() },
    kennelDiscovery: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/adapters/half-mind/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/adapters/half-mind/client")>()),
  fetchHalfMindListings: vi.fn(),
}));
vi.mock("@/lib/kennel-confirmations", () => ({
  confirmKennelRunningFor: vi.fn(),
  stopKennelFor: vi.fn(),
}));
vi.mock("@/lib/kennel-revalidate", () => ({ revalidateKennel: vi.fn() }));

import { prisma } from "@/lib/db";
import { fetchHalfMindListings, parseHalfMindResponse, type HalfMindResult } from "@/adapters/half-mind/client";
import { confirmKennelRunningFor, stopKennelFor } from "@/lib/kennel-confirmations";
import { revalidateKennel } from "@/lib/kennel-revalidate";
import { halfMindListingUrl } from "@/lib/half-mind";
import {
  HALF_MIND_EXTERNAL_SOURCE,
  HALF_MIND_SYNC_SCOPES,
  halfMindCheckNote,
  syncHalfMindDiscovery,
} from "./half-mind-discovery";

const NOW = new Date("2026-11-17T12:00:00Z");
const GA = { country: "USA", state: "GA" };
const PF_URL = halfMindListingUrl("19");

type Row = Record<string, unknown>;

/** A raw Half-Mind API row: Peach Fuzz H3, alive and checked Oct 7. */
const raw = (o: Row = {}): Row => ({
  id: 19,
  name: "Peach Fuzz H3",
  city: "Atlanta",
  state: "GA",
  country: "USA",
  lat: 33.75,
  lng: -84.39,
  status: "active",
  current_state: "Alive and Verified",
  schedules: ["Every Other Saturday 14:00 All Year"],
  website: "https://peachfuzz.example",
  facebook: "",
  last_verified: "2026-10-07 09:15:00",
  ...o,
});
const respond = (rows: Row[], truncated = false): HalfMindResult =>
  parseHalfMindResponse({ items: rows, truncated }, NOW);

const kennels = [
  { id: "k-pf", shortName: "Peach Fuzz H3", fullName: "Peach Fuzz Hash House Harriers", country: "USA", regionRef: { centroidLat: 33.75, centroidLng: -84.39 } },
  { id: "k-bs", shortName: "Black Sheep H3", fullName: "Black Sheep Hash House Harriers", country: "USA", regionRef: { centroidLat: 33.75, centroidLng: -84.39 } },
];
let linkedKennels: Row[];
let existingRows: Row[];

const linkedRow = (o: Row = {}): Row => ({
  id: "d-19",
  externalSlug: "19",
  externalScope: "USA/GA",
  status: "LINKED",
  matchedKennelId: "k-pf",
  processedBy: "admin-1",
  ...o,
});

function upsertArg(call = 0): { where: Row; create: Row; update: Row } {
  return vi.mocked(prisma.kennelDiscovery.upsert).mock.calls[call][0] as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  linkedKennels = [];
  existingRows = [];
  vi.mocked(prisma.kennel.findMany).mockImplementation((async (args: { where?: Row }) =>
    args?.where && "halfMindListingId" in args.where ? linkedKennels : kennels) as never);
  vi.mocked(prisma.kennelAlias.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennelDiscovery.findMany).mockImplementation((async () => existingRows) as never);
  vi.mocked(prisma.kennelDiscovery.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.kennelDiscovery.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(fetchHalfMindListings).mockResolvedValue(respond([raw()]));
  vi.mocked(confirmKennelRunningFor).mockResolvedValue({ success: true });
});

describe("constants", () => {
  it("pilots Georgia only, as HALFMIND rows", () => {
    expect(HALF_MIND_SYNC_SCOPES).toEqual([{ country: "USA", state: "GA" }]);
    expect(HALF_MIND_EXTERNAL_SOURCE).toBe("HALFMIND");
  });

  it("halfMindCheckNote names the check date with its year", () => {
    expect(halfMindCheckNote(new Date("2026-10-07T12:00:00Z"))).toBe("Half-Mind listing checked Oct 7, 2026");
  });
});

describe("syncHalfMindDiscovery: new listings", () => {
  it("creates a NEW row for a listing that passes the bar", async () => {
    const result = await syncHalfMindDiscovery([GA], NOW);

    expect(fetchHalfMindListings).toHaveBeenCalledWith(GA, NOW);
    expect(upsertArg().where).toEqual({
      externalSource_externalSlug: { externalSource: "HALFMIND", externalSlug: "19" },
    });
    expect(upsertArg().create).toMatchObject({
      status: "NEW",
      externalSource: "HALFMIND",
      externalSlug: "19",
      externalScope: "USA/GA",
      name: "Peach Fuzz H3",
      location: "Atlanta, GA, USA",
      latitude: 33.75,
      longitude: -84.39,
      schedule: "Every Other Saturday 2 PM",
      website: "https://peachfuzz.example",
      facebookUrl: null,
      externalUrl: PF_URL,
      externalStatus: "alive",
      externalCheckedAt: new Date("2026-10-07T12:00:00Z"),
      matchScore: 1,
    });
    const candidates = upsertArg().create.matchCandidates as { id: string; shortName: string; score: number }[];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(3);
    expect(candidates.map((c) => c.score)).toEqual([...candidates.map((c) => c.score)].sort((a, b) => b - a));
    expect(result).toMatchObject({ scopes: 1, fetched: 1, passedBar: 1, created: 1, updated: 0, errors: [] });
  });

  it("writes nothing for a listing that fails the bar and isn't stored", async () => {
    vi.mocked(fetchHalfMindListings).mockResolvedValue(
      respond([raw({ id: 528, status: "unknown", current_state: "Unknown" })]),
    );
    const result = await syncHalfMindDiscovery([GA], NOW);
    expect(prisma.kennelDiscovery.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ fetched: 1, passedBar: 0, created: 0, updated: 0 });
  });

  it("stores an exact-name match as candidate #1 with score 1, but keeps the row NEW and links nothing", async () => {
    await syncHalfMindDiscovery([GA], NOW);
    const create = upsertArg().create;
    expect((create.matchCandidates as Row[])[0]).toEqual({ id: "k-pf", shortName: "Peach Fuzz H3", score: 1 });
    expect(create.status).toBe("NEW");
    expect(create.matchedKennelId ?? null).toBeNull();
    expect(upsertArg().update).not.toHaveProperty("status");
    expect(prisma.sourceKennel.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceKennel.create).not.toHaveBeenCalled();
    expect(prisma.kennelAlias.create).not.toHaveBeenCalled();
  });
});

describe("syncHalfMindDiscovery: stored rows", () => {
  it.each(["NEW", "LINKED", "ADDED", "DISMISSED"])("updates a %s row's fields and keeps its status", async (status) => {
    existingRows = [linkedRow({ status, matchedKennelId: null })];
    vi.mocked(fetchHalfMindListings).mockResolvedValue(
      respond([raw({ name: "Peach Fuzz Hash", status: "unknown", current_state: "Unknown" })]),
    );
    const result = await syncHalfMindDiscovery([GA], NOW);

    const { update } = upsertArg();
    expect(update).not.toHaveProperty("status");
    expect(update).toMatchObject({ name: "Peach Fuzz Hash", externalStatus: "unknown", externalScope: "USA/GA" });
    expect(result).toMatchObject({ created: 0, updated: 1 });
  });
});

describe("syncHalfMindDiscovery: refreshing linked kennels", () => {
  it.each(["LINKED", "ADDED"])("records a newer check for a %s row whose kennel holds the listing", async (status) => {
    existingRows = [linkedRow({ status })];
    linkedKennels = [{ id: "k-pf", halfMindListingId: "19" }];

    const result = await syncHalfMindDiscovery([GA], NOW);

    expect(confirmKennelRunningFor).toHaveBeenCalledTimes(1);
    expect(confirmKennelRunningFor).toHaveBeenCalledWith(
      "admin-1",
      "k-pf",
      { observedOn: "2026-10-07", note: "Half-Mind listing checked Oct 7, 2026", url: PF_URL },
      NOW,
      { via: "HALF_MIND", onlyIfNewerForUrl: PF_URL },
    );
    expect(result.refreshedChecks).toBe(1);
    expect(revalidateKennel).toHaveBeenCalledWith("k-pf");
  });

  it("does not refresh a row whose kennel no longer holds the listing", async () => {
    existingRows = [linkedRow()];
    linkedKennels = [];
    await syncHalfMindDiscovery([GA], NOW);
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
  });

  it.each([null, "0000-00-00 00:00:00", "2026-12-01 00:00:00"])(
    "records nothing when last_verified is %s, and still updates the row",
    async (lastVerified) => {
      existingRows = [linkedRow()];
      linkedKennels = [{ id: "k-pf", halfMindListingId: "19" }];
      vi.mocked(fetchHalfMindListings).mockResolvedValue(
        respond([raw({ last_verified: lastVerified, website: "https://new.example" })]),
      );

      const result = await syncHalfMindDiscovery([GA], NOW);

      expect(confirmKennelRunningFor).not.toHaveBeenCalled();
      expect(upsertArg().update).toMatchObject({ externalCheckedAt: null, website: "https://new.example" });
      expect(result).toMatchObject({ updated: 1, refreshedChecks: 0 });
    },
  );

  it("counts nothing for a skipped check, and a stopped kennel without an error", async () => {
    existingRows = [linkedRow()];
    linkedKennels = [{ id: "k-pf", halfMindListingId: "19" }];

    vi.mocked(confirmKennelRunningFor).mockResolvedValueOnce({ skipped: true });
    const skipped = await syncHalfMindDiscovery([GA], NOW);
    expect(skipped).toMatchObject({ refreshedChecks: 0, skippedStopped: 0, errors: [] });

    vi.mocked(confirmKennelRunningFor).mockResolvedValueOnce({ stopped: true });
    const stopped = await syncHalfMindDiscovery([GA], NOW);
    expect(stopped).toMatchObject({ refreshedChecks: 0, skippedStopped: 1, errors: [] });
    expect(revalidateKennel).not.toHaveBeenCalled();
  });
});

describe("syncHalfMindDiscovery: dead and missing listings", () => {
  it("flags a linked listing Half-Mind marks dead", async () => {
    existingRows = [linkedRow()];
    linkedKennels = [{ id: "k-pf", halfMindListingId: "19" }];
    vi.mocked(fetchHalfMindListings).mockResolvedValue(respond([raw({ status: "dead", current_state: "Dead" })]));

    const result = await syncHalfMindDiscovery([GA], NOW);

    expect(upsertArg().update).toMatchObject({ externalStatus: "dead" });
    expect(result.flaggedDeadOrMissing).toBe(1);
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
    expect(stopKennelFor).not.toHaveBeenCalled();
  });

  it("flags a linked listing absent from a complete scope response as missing", async () => {
    existingRows = [linkedRow({ id: "d-77", externalSlug: "77", matchedKennelId: "k-bs" })];
    const result = await syncHalfMindDiscovery([GA], NOW);

    expect(prisma.kennelDiscovery.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["d-77"] } },
      data: { externalStatus: "missing" },
    });
    expect(result.flaggedDeadOrMissing).toBe(1);
    expect(stopKennelFor).not.toHaveBeenCalled();
  });

  it("does not flag missing listings when the response was truncated", async () => {
    existingRows = [linkedRow({ id: "d-77", externalSlug: "77", matchedKennelId: "k-bs" })];
    vi.mocked(fetchHalfMindListings).mockResolvedValue(respond([raw()], true));
    const result = await syncHalfMindDiscovery([GA], NOW);

    expect(prisma.kennelDiscovery.updateMany).not.toHaveBeenCalled();
    expect(result.flaggedDeadOrMissing).toBe(0);
  });
});

describe("syncHalfMindDiscovery: client errors", () => {
  it("records a scope's errors, writes nothing for it, and still runs the next scope", async () => {
    const AL = { country: "USA", state: "AL" };
    existingRows = [linkedRow({ id: "d-77", externalSlug: "77" })];
    vi.mocked(fetchHalfMindListings).mockImplementation(async (scope) =>
      scope.state === "GA"
        ? { ...respond([raw()]), errors: ["Half-Mind API returned HTTP 429"] }
        : respond([raw({ id: 501, name: "Mutha Rucker H3", city: "Enterprise", state: "AL" })]),
    );

    const result = await syncHalfMindDiscovery([GA, AL], NOW);

    expect(result.errors).toEqual(["USA/GA: Half-Mind API returned HTTP 429"]);
    expect(prisma.kennelDiscovery.upsert).toHaveBeenCalledTimes(1);
    expect(upsertArg().create).toMatchObject({ externalSlug: "501", externalScope: "USA/AL" });
    expect(prisma.kennelDiscovery.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["d-77"] } } }),
    );
    expect(result.scopes).toBe(2);
  });
});
