import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

// In-memory tables behind a fake prisma, so link → unlink → relink → sync runs
// the real confirmation and sync code end to end.
const tables = vi.hoisted(() => ({
  kennel: [] as Record<string, unknown>[],
  kennelDiscovery: [] as Record<string, unknown>[],
  kennelConfirmation: [] as Record<string, unknown>[],
  region: [] as Record<string, unknown>[],
  kennelAlias: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", async () => {
  const { matchesWhere } = await import("@/test/prisma-where");
  const { buildPrismaUniqueViolation } = await import("@/test/factories");
  let seq = 0;
  const fakeTable = (name: keyof typeof tables) => {
    const rows = () => tables[name];
    const find = async ({ where }: { where?: Row } = {}) => rows().find((r) => matchesWhere(r, where)) ?? null;
    const create = async ({ data }: { data: Row }) => {
      const row = { id: `${name}-${++seq}`, ...data };
      rows().push(row);
      return row;
    };
    return {
      findUnique: vi.fn(find),
      findFirst: vi.fn(find),
      findMany: vi.fn(async ({ where }: { where?: Row } = {}) => rows().filter((r) => matchesWhere(r, where))),
      create: vi.fn(create),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = await find({ where });
        if (!row) throw new Error(`${name} not found`);
        return Object.assign(row, data);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const hits = rows().filter((r) => matchesWhere(r, where));
        // Like Postgres, Kennel.halfMindListingId is unique.
        const taken = (r: Row) => !hits.includes(r) && r.halfMindListingId === data.halfMindListingId;
        if (name === "kennel" && data.halfMindListingId != null && rows().some(taken)) {
          throw buildPrismaUniqueViolation(["halfMindListingId"]);
        }
        for (const r of hits) Object.assign(r, data);
        return { count: hits.length };
      }),
      upsert: vi.fn(async ({ where, create: c, update }: { where: Row; create: Row; update: Row }) => {
        const row = await find({ where });
        return row ? Object.assign(row, update) : create({ data: c });
      }),
      // `by` plus `_max` only.
      groupBy: vi.fn(async ({ by, _max, where }: { by: string[]; _max: Record<string, true>; where?: Row }) => {
        const groups = new Map<string, Row & { _max: Row }>();
        for (const r of rows().filter((x) => matchesWhere(x, where))) {
          const key = JSON.stringify(by.map((f) => r[f]));
          const group = groups.get(key) ?? { ...Object.fromEntries(by.map((f) => [f, r[f]])), _max: {} };
          for (const f of Object.keys(_max)) {
            const v = r[f] as Date;
            const best = group._max[f] as Date | undefined;
            if (!best || v > best) group._max[f] = v;
          }
          groups.set(key, group);
        }
        return [...groups.values()];
      }),
    };
  };
  const prisma: Record<string, unknown> = {
    kennel: fakeTable("kennel"),
    kennelDiscovery: fakeTable("kennelDiscovery"),
    kennelConfirmation: fakeTable("kennelConfirmation"),
    region: fakeTable("region"),
    kennelAlias: fakeTable("kennelAlias"),
    sourceKennel: { upsert: vi.fn(), create: vi.fn() },
    scheduleRule: { create: vi.fn(), createMany: vi.fn() },
    $queryRaw: vi.fn(),
  };
  // Like Postgres, a throw inside the transaction rolls back its writes.
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => {
    const snapshot = Object.entries(tables).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))] as const);
    try {
      return await fn(prisma);
    } catch (err) {
      for (const [name, rows] of snapshot) tables[name as keyof typeof tables].splice(0, Infinity, ...rows);
      throw err;
    }
  });
  return { prisma };
});
vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/kennel-revalidate", () => ({ revalidateKennel: vi.fn() }));
vi.mock("@/pipeline/kennel-evidence", () => ({ refreshKennelEvidence: vi.fn() }));
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/adapters/half-mind/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/adapters/half-mind/client")>()),
  fetchHalfMindListings: vi.fn(),
}));
vi.mock("@/lib/kennel-confirmations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/kennel-confirmations")>();
  return {
    ...actual,
    confirmKennelRunningFor: vi.fn(actual.confirmKennelRunningFor),
    revertHalfMindChecksFor: vi.fn(actual.revertHalfMindChecksFor),
  };
});

import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { fetchHalfMindListings, parseHalfMindResponse } from "@/adapters/half-mind/client";
import { confirmKennelRunningFor, revertHalfMindChecksFor } from "@/lib/kennel-confirmations";
import { halfMindListingUrl } from "@/lib/half-mind";
import { syncHalfMindDiscovery } from "@/pipeline/half-mind-discovery";
import { buildPrismaUniqueViolation } from "@/test/factories";
import {
  addListingOnlyKennel,
  dismissHalfMindListing,
  linkHalfMindListing,
  runHalfMindSync,
  unlinkHalfMindListing,
} from "./half-mind-actions";

const NOW = new Date("2026-11-17T12:00:00Z");
const OCT_7 = new Date("2026-10-07T12:00:00Z");
const PF_URL = halfMindListingUrl("19");
const NOT_HALF_MIND = "This is not a Half-Mind row.";

function kennelRow(o: Row): Row {
  return { isHidden: false, country: "USA", halfMindListingId: null, listingOnly: false, ...o };
}

function halfMindRow(o: Row = {}): Row {
  return {
    id: "d-19",
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
    externalCheckedAt: OCT_7,
    matchCandidates: [{ id: "k-pf", shortName: "Peach Fuzz H3", score: 1 }],
    matchScore: 1,
    status: "NEW",
    matchedKennelId: null,
    processedBy: null,
    processedAt: null,
    ...o,
  };
}

const kennel = (id: string) => tables.kennel.find((k) => k.id === id)!;
const discovery = (id: string) => tables.kennelDiscovery.find((d) => d.id === id)!;
const runningChecks = () => tables.kennelConfirmation.filter((c) => c.kind === "RUNNING");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  tables.kennel.splice(0, Infinity,
    kennelRow({ id: "k-pf", shortName: "Peach Fuzz H3", fullName: "Peach Fuzz H3", slug: "peach-fuzz-h3" }),
    kennelRow({ id: "k-bs", shortName: "Black Sheep H3", fullName: "Black Sheep H3", slug: "black-sheep-h3" }),
  );
  tables.kennelDiscovery.splice(0, Infinity,
    halfMindRow(),
    { id: "d-hr", externalSource: "HASHREGO", externalSlug: "NEWH3", name: "New H3", status: "NEW" },
  );
  tables.kennelConfirmation.splice(0);
  tables.region.splice(0, Infinity, { id: "r-atl", name: "Atlanta, GA", country: "USA" });
  tables.kennelAlias.splice(0);
  vi.mocked(getAdminUser).mockResolvedValue({ id: "admin-1" } as never);
  vi.mocked(fetchHalfMindListings).mockResolvedValue(
    parseHalfMindResponse({
      items: [{
        id: 19, name: "Peach Fuzz H3", city: "Atlanta", state: "GA", country: "USA", lat: 33.75, lng: -84.39,
        status: "active", current_state: "Alive and Verified", schedules: ["Every Other Saturday 14:00 All Year"],
        website: "https://peachfuzz.example", facebook: "", last_verified: "2026-10-07 09:15:00",
      }],
      truncated: false,
    }, NOW),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Half-Mind actions: access", () => {
  const calls = (id: string) => [
    () => linkHalfMindListing(id, "k-pf"),
    () => unlinkHalfMindListing(id),
    () => addListingOnlyKennel(id, { shortName: "X H3", fullName: "X H3", regionId: "r-atl" }),
    () => dismissHalfMindListing(id),
  ];

  it("refuses non-admins", async () => {
    vi.mocked(getAdminUser).mockResolvedValue(null as never);
    for (const call of [...calls("d-19"), () => runHalfMindSync()]) {
      expect(await call()).toEqual({ error: "Not authorized" });
    }
    expect(discovery("d-19").status).toBe("NEW");
    expect(kennel("k-pf").halfMindListingId).toBeNull();
    expect(fetchHalfMindListings).not.toHaveBeenCalled();
  });

  it("refuses rows that are not Half-Mind rows", async () => {
    for (const call of calls("d-hr")) {
      expect(await call()).toEqual({ error: NOT_HALF_MIND });
    }
    expect(discovery("d-hr").status).toBe("NEW");
    expect(prisma.kennel.update).not.toHaveBeenCalled();
    expect(prisma.kennel.create).not.toHaveBeenCalled();
  });
});

describe("linkHalfMindListing", () => {
  it("links the listing, marks the row LINKED and records the Half-Mind check", async () => {
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({ success: true });

    expect(kennel("k-pf").halfMindListingId).toBe("19");
    expect(discovery("d-19")).toMatchObject({
      status: "LINKED",
      matchedKennelId: "k-pf",
      processedBy: "admin-1",
      processedAt: NOW,
    });
    expect(confirmKennelRunningFor).toHaveBeenCalledWith(
      "admin-1",
      "k-pf",
      { observedOn: "2026-10-07", note: "Half-Mind listing checked Oct 7, 2026", url: PF_URL },
      NOW,
      { via: "HALF_MIND" },
    );
    expect(runningChecks()).toEqual([
      expect.objectContaining({ kennelId: "k-pf", via: "HALF_MIND", observedAt: OCT_7, url: PF_URL, createdById: "admin-1" }),
    ]);
  });

  it("links a stale row without recording a check", async () => {
    discovery("d-19").externalCheckedAt = new Date("2025-09-01T12:00:00Z");
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({
      success: true,
      warning: "Linked; the Half-Mind check is too old to record.",
    });
    expect(kennel("k-pf").halfMindListingId).toBe("19");
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
    expect(runningChecks()).toHaveLength(0);
  });

  it("links a row Half-Mind no longer marks alive without recording a check", async () => {
    discovery("d-19").externalStatus = "dead";
    const result = await linkHalfMindListing("d-19", "k-pf");
    expect(result).toMatchObject({ success: true });
    expect(result).toHaveProperty("warning");
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
  });

  it("links a stopped kennel and says the check was not recorded", async () => {
    tables.kennelConfirmation.push({
      id: "c-stop", kennelId: "k-pf", kind: "STOPPED", via: "ADMIN", observedAt: new Date("2026-09-01T12:00:00Z"), revertedAt: null,
    });
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({
      success: true,
      warning: "Linked; the kennel is stopped, so the check was not recorded.",
    });
    expect(discovery("d-19").status).toBe("LINKED");
    expect(runningChecks()).toHaveLength(0);
  });

  it("refuses, writing nothing, when the listing is already on another kennel", async () => {
    kennel("k-bs").halfMindListingId = "19";
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({
      error: "That Half-Mind listing is already linked to Black Sheep H3.",
    });
    expect(kennel("k-pf").halfMindListingId).toBeNull();
    expect(discovery("d-19").status).toBe("NEW");
    expect(prisma.kennelDiscovery.updateMany).not.toHaveBeenCalled();
    expect(tables.kennelConfirmation).toHaveLength(0);
  });

  it("refuses when the kennel already has a different listing", async () => {
    kennel("k-pf").halfMindListingId = "88";
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({
      error: "Peach Fuzz H3 is already linked to Half-Mind listing #88. Unlink it first.",
    });
    expect(kennel("k-pf").halfMindListingId).toBe("88");
    expect(discovery("d-19").status).toBe("NEW");
  });

  it("maps a concurrent P2002 on halfMindListingId to the already-linked message", async () => {
    // Another admin linked the listing to Black Sheep while this link ran.
    kennel("k-bs").halfMindListingId = "19";
    vi.mocked(prisma.kennel.updateMany).mockRejectedValueOnce(buildPrismaUniqueViolation(["halfMindListingId"]));
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({
      error: "That Half-Mind listing is already linked to Black Sheep H3.",
    });
    expect(kennel("k-pf").halfMindListingId).toBeNull();
    expect(discovery("d-19").status).toBe("NEW");
    expect(tables.kennelConfirmation).toHaveLength(0);
  });

  it("refuses, writing nothing, when the kennel took another listing after it was read", async () => {
    // A second link to Peach Fuzz committed between our read and our write.
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce(
      { id: "k-pf", shortName: "Peach Fuzz H3", halfMindListingId: null } as never,
    );
    kennel("k-pf").halfMindListingId = "88";
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({
      error: "Peach Fuzz H3 is already linked to Half-Mind listing #88. Unlink it first.",
    });
    expect(kennel("k-pf").halfMindListingId).toBe("88");
    expect(discovery("d-19")).toMatchObject({ status: "NEW", matchedKennelId: null });
    expect(tables.kennelConfirmation).toHaveLength(0);
  });

  it.each(["DISMISSED", "LINKED"])("refuses, writing nothing, when the row became %s after it was read", async (status) => {
    vi.mocked(prisma.kennelDiscovery.findUnique).mockResolvedValueOnce({ ...discovery("d-19") } as never);
    discovery("d-19").status = status;
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({ error: "Only a NEW Half-Mind row can be linked." });
    expect(kennel("k-pf").halfMindListingId).toBeNull();
    expect(discovery("d-19")).toMatchObject({ status, matchedKennelId: null });
    expect(tables.kennelConfirmation).toHaveLength(0);
  });
});

describe("unlinkHalfMindListing", () => {
  it("clears the listing, reverts its checks and puts the row back to NEW; the sync then leaves the kennel alone", async () => {
    await linkHalfMindListing("d-19", "k-pf");
    expect(await unlinkHalfMindListing("d-19")).toEqual({ success: true });

    expect(kennel("k-pf").halfMindListingId).toBeNull();
    expect(revertHalfMindChecksFor).toHaveBeenCalledWith("k-pf", PF_URL, NOW);
    expect(runningChecks().every((c) => c.revertedAt)).toBe(true);
    expect(discovery("d-19")).toMatchObject({ status: "NEW", matchedKennelId: null });

    vi.mocked(confirmKennelRunningFor).mockClear();
    const result = await syncHalfMindDiscovery(undefined, NOW);
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
    expect(result.refreshedChecks).toBe(0);
  });

  it("relinking records the current check again, and a sync at the same date is skipped", async () => {
    await linkHalfMindListing("d-19", "k-pf");
    await unlinkHalfMindListing("d-19");
    expect(await linkHalfMindListing("d-19", "k-pf")).toEqual({ success: true });

    const relink = vi.mocked(confirmKennelRunningFor).mock.calls.at(-1)!;
    expect(relink[4]).toEqual({ via: "HALF_MIND" });
    expect(runningChecks()).toHaveLength(2);
    expect(runningChecks().filter((c) => !c.revertedAt)).toHaveLength(1);

    vi.mocked(confirmKennelRunningFor).mockClear();
    const result = await syncHalfMindDiscovery(undefined, NOW);

    // The pre-gate sees the recorded check: no transaction at all.
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
    expect(result.refreshedChecks).toBe(0);
    expect(runningChecks()).toHaveLength(2);
  });

  it("after a relink to another kennel, the sync gates on that kennel's own recorded check", async () => {
    await linkHalfMindListing("d-19", "k-pf");
    await unlinkHalfMindListing("d-19");
    await linkHalfMindListing("d-19", "k-bs");
    expect(runningChecks().filter((c) => c.kennelId === "k-bs" && !c.revertedAt)).toHaveLength(1);

    vi.mocked(confirmKennelRunningFor).mockClear();
    const result = await syncHalfMindDiscovery(undefined, NOW);
    expect(confirmKennelRunningFor).not.toHaveBeenCalled();
    expect(result.refreshedChecks).toBe(0);
  });

  it("refuses a row that isn't linked", async () => {
    expect(await unlinkHalfMindListing("d-19")).toHaveProperty("error");
    expect(revertHalfMindChecksFor).not.toHaveBeenCalled();
  });

  it("reverts only the unlinked listing's checks", async () => {
    await linkHalfMindListing("d-19", "k-pf");
    const otherUrl = halfMindListingUrl("88");
    tables.kennelConfirmation.push({
      id: "c-88", kennelId: "k-pf", kind: "RUNNING", via: "HALF_MIND", url: otherUrl,
      observedAt: new Date("2026-11-01T12:00:00Z"), revertedAt: null,
    });

    await unlinkHalfMindListing("d-19");

    const byUrl = (url: string) => runningChecks().filter((c) => c.url === url);
    expect(byUrl(PF_URL).every((c) => c.revertedAt)).toBe(true);
    expect(byUrl(otherUrl)).toEqual([expect.objectContaining({ revertedAt: null })]);
  });

  it("skips the revert when the kennel no longer holds the listing", async () => {
    await linkHalfMindListing("d-19", "k-pf");
    kennel("k-pf").halfMindListingId = "88"; // the row was stranded: its kennel holds another listing

    expect(await unlinkHalfMindListing("d-19")).toEqual({ success: true });

    expect(kennel("k-pf").halfMindListingId).toBe("88");
    expect(revertHalfMindChecksFor).not.toHaveBeenCalled();
    expect(discovery("d-19")).toMatchObject({ status: "NEW", matchedKennelId: null });
  });
});

describe("addListingOnlyKennel", () => {
  const form = { shortName: "Southeast Xtra H3", fullName: "Southeast Xtra Hash House Harriers", regionId: "r-atl" };

  beforeEach(() => {
    tables.kennelDiscovery.push(halfMindRow({
      id: "d-301",
      externalSlug: "301",
      name: "Southeast Xtra H3",
      website: null,
      facebookUrl: "https://www.facebook.com/groups/sextra",
      latitude: 33.6,
      longitude: -84.2,
      schedule: "Monthly Saturday 2 PM",
      externalUrl: halfMindListingUrl("301"),
      matchCandidates: [{ id: "k-bs", shortName: "Black Sheep H3", score: 0.41 }],
      matchScore: 0.41,
    }));
  });

  it("refuses a likely duplicate unless confirmed", async () => {
    expect(await addListingOnlyKennel("d-19", { ...form, shortName: "Peach Fuzz 2" })).toEqual({
      error: "This listing looks like Peach Fuzz H3 (match 1).",
      duplicateOf: { id: "k-pf", shortName: "Peach Fuzz H3", score: 1 },
    });
    expect(prisma.kennel.create).not.toHaveBeenCalled();

    const result = await addListingOnlyKennel("d-19", { ...form, shortName: "Peach Fuzz 2" }, { confirmNotDuplicate: true });
    expect(result).toMatchObject({ success: true });
  });

  it("creates a listing-only kennel through the shared helper, marks the row ADDED and records the check", async () => {
    const result = await addListingOnlyKennel("d-301", form);
    expect(result).toEqual({ success: true, kennelId: expect.any(String) });
    const kennelId = (result as { kennelId: string }).kennelId;

    const { data } = vi.mocked(prisma.kennel.create).mock.calls[0][0] as { data: Row };
    expect(data).toMatchObject({
      shortName: "Southeast Xtra H3",
      fullName: "Southeast Xtra Hash House Harriers",
      listingOnly: true,
      halfMindListingId: "301",
      latitude: 33.6,
      longitude: -84.2,
      website: null,
      facebookUrl: "https://www.facebook.com/groups/sextra",
      scheduleNotes: "Monthly Saturday 2 PM",
      regionRef: { connect: { id: "r-atl" } },
    });
    const aliases = (data.aliases as { create: { alias: string }[] }).create.map((a) => a.alias);
    expect(aliases).not.toContain("301");
    expect(prisma.scheduleRule.create).not.toHaveBeenCalled();
    expect(prisma.scheduleRule.createMany).not.toHaveBeenCalled();
    expect(prisma.kennelAlias.create).not.toHaveBeenCalled();

    expect(discovery("d-301")).toMatchObject({ status: "ADDED", matchedKennelId: kennelId, processedBy: "admin-1" });
    expect(runningChecks()).toEqual([
      expect.objectContaining({ kennelId, via: "HALF_MIND", url: halfMindListingUrl("301"), observedAt: OCT_7 }),
    ]);
  });

  it("adds a stale row without recording a check, and says so", async () => {
    discovery("d-301").externalCheckedAt = new Date("2025-01-10T12:00:00Z");
    expect(await addListingOnlyKennel("d-301", form)).toEqual({
      success: true,
      kennelId: expect.any(String),
      warning: "Added; the Half-Mind check is too old to record.",
    });
    expect(runningChecks()).toHaveLength(0);
  });

  it("adds a row Half-Mind no longer marks alive without recording a check, and says so", async () => {
    discovery("d-301").externalStatus = "dead";
    expect(await addListingOnlyKennel("d-301", form)).toEqual({
      success: true,
      kennelId: expect.any(String),
      warning: "Added; Half-Mind doesn't mark this kennel alive, so the check was not recorded.",
    });
    expect(runningChecks()).toHaveLength(0);
  });

  it("refuses when another kennel already holds the listing", async () => {
    kennel("k-bs").halfMindListingId = "301";
    expect(await addListingOnlyKennel("d-301", form)).toEqual({
      error: "That Half-Mind listing is already linked to Black Sheep H3.",
    });
    expect(prisma.kennel.create).not.toHaveBeenCalled();
  });
});

describe("dismissHalfMindListing", () => {
  it("dismisses a NEW row", async () => {
    expect(await dismissHalfMindListing("d-19")).toEqual({ success: true });
    expect(discovery("d-19")).toMatchObject({ status: "DISMISSED", processedBy: "admin-1" });
  });

  it.each(["LINKED", "ADDED"])("refuses a %s row", async (status) => {
    discovery("d-19").status = status;
    expect(await dismissHalfMindListing("d-19")).toEqual({ error: "Only a NEW Half-Mind row can be dismissed." });
    expect(discovery("d-19").status).toBe(status);
  });

  it("refuses when a link landed after the row was read", async () => {
    vi.mocked(prisma.kennelDiscovery.findUnique).mockResolvedValueOnce({ ...discovery("d-19") } as never);
    Object.assign(discovery("d-19"), { status: "LINKED", matchedKennelId: "k-pf" });
    expect(await dismissHalfMindListing("d-19")).toEqual({ error: "Only a NEW Half-Mind row can be dismissed." });
    expect(discovery("d-19")).toMatchObject({ status: "LINKED", matchedKennelId: "k-pf", processedBy: null });
  });
});

describe("runHalfMindSync", () => {
  it("runs the pilot sync and returns its counts", async () => {
    const result = await runHalfMindSync();
    expect(result).toMatchObject({ success: true, scopes: 1, fetched: 1, passedBar: 1, created: 0, updated: 1 });
  });
});
