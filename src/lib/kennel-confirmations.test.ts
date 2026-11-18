vi.mock("@/lib/db", () => {
  const prisma: Record<string, unknown> = {
    $queryRaw: vi.fn(),
    kennel: { findUnique: vi.fn() },
    kennelConfirmation: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("@/pipeline/kennel-evidence", () => ({ refreshKennelEvidence: vi.fn() }));

import { prisma } from "@/lib/db";
import { refreshKennelEvidence } from "@/pipeline/kennel-evidence";
import { matchesWhere } from "@/test/prisma-where";
import { confirmKennelRunningFor, evidenceAfter, revertHalfMindChecksFor } from "./kennel-confirmations";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const NOW = new Date("2026-11-13T12:00:00Z");
const base = { lastRunSeenAt: null, nextRunPostedAt: null, lastConfirmedAt: null, lastConfirmedVia: null };

describe("evidenceAfter", () => {
  it("names an admin confirmation", () => {
    expect(
      evidenceAfter({ ...base, lastConfirmedAt: d("2026-10-20"), lastConfirmedVia: "ADMIN" }, d("2026-10-01"), NOW),
    ).toBe("an admin confirmed this kennel running on Oct 20, after that date");
  });
  it("names a Half-Mind check", () => {
    expect(
      evidenceAfter({ ...base, lastConfirmedAt: d("2026-10-20"), lastConfirmedVia: "HALF_MIND" }, d("2026-10-01"), NOW),
    ).toBe("the Half-Mind listing was checked on Oct 20, after that date");
  });
});

describe("Half-Mind confirmations", () => {
  type Row = Record<string, unknown>;
  let rows: Row[];
  const U = "https://half-mind.com/regionalwebsite/p_list1.php?ID=19";
  const V = "https://half-mind.com/regionalwebsite/p_list1.php?ID=88";
  const check = { observedOn: "2026-10-07", note: "Half-Mind listing checked Oct 7, 2026", url: U };
  const halfMind = { via: "HALF_MIND", onlyIfNewerForUrl: U } as const;
  const confirmation = (o: Row): Row => ({
    kennelId: "k1",
    kind: "RUNNING",
    via: "HALF_MIND",
    url: U,
    revertedAt: null,
    ...o,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ id: "k1" } as never);
    vi.mocked(prisma.kennelConfirmation.findFirst).mockImplementation((async (args: { where: Row }) =>
      rows.find((r) => matchesWhere(r, args.where)) ?? null) as never);
    vi.mocked(prisma.kennelConfirmation.create).mockImplementation((async (args: { data: Row }) => {
      const row = { via: "ADMIN", revertedAt: null, ...args.data };
      rows.push(row);
      return row;
    }) as never);
    vi.mocked(prisma.kennelConfirmation.updateMany).mockImplementation((async (args: { where: Row; data: Row }) => {
      const hits = rows.filter((r) => matchesWhere(r, args.where));
      for (const r of hits) Object.assign(r, args.data);
      return { count: hits.length };
    }) as never);
  });

  it("skips the write when a reverted check for the same listing is as new or newer", async () => {
    rows.push(confirmation({ observedAt: d("2026-10-07"), revertedAt: d("2026-11-01") }));
    expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, halfMind)).toEqual({ skipped: true });

    rows.length = 0;
    rows.push(confirmation({ observedAt: d("2026-10-20"), revertedAt: d("2026-11-01") }));
    expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, halfMind)).toEqual({ skipped: true });

    expect(prisma.kennelConfirmation.create).not.toHaveBeenCalled();
    expect(refreshKennelEvidence).not.toHaveBeenCalled();
  });

  it("records the check when the only existing check is for a different listing, even a later one", async () => {
    rows.push(confirmation({ url: V, observedAt: d("2026-10-20") }));
    expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, halfMind)).toEqual({ success: true });
    expect(prisma.kennelConfirmation.create).toHaveBeenCalledWith({
      data: {
        kennelId: "k1",
        kind: "RUNNING",
        observedAt: d("2026-10-07"),
        note: check.note,
        url: U,
        createdById: "admin-1",
        via: "HALF_MIND",
      },
    });
    expect(refreshKennelEvidence).toHaveBeenCalledWith(["k1"], NOW);
  });

  it("records a newer check for the same listing", async () => {
    rows.push(confirmation({ observedAt: d("2026-10-01") }));
    expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, halfMind)).toEqual({ success: true });
    expect(rows).toHaveLength(2);
  });

  it("returns { stopped: true } for a Half-Mind write on a stopped kennel; an admin still gets the error", async () => {
    rows.push(confirmation({ kind: "STOPPED", via: "ADMIN", url: null, observedAt: d("2026-09-01") }));
    expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, halfMind)).toEqual({ stopped: true });
    expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW)).toEqual({
      error: "This kennel is stopped — restart it first.",
    });
    expect(prisma.kennelConfirmation.create).not.toHaveBeenCalled();
  });

  it("revertHalfMindChecksFor reverts only the kennel's open Half-Mind running checks for that listing", async () => {
    const open1 = confirmation({ observedAt: d("2026-10-07") });
    const open2 = confirmation({ observedAt: d("2026-09-07") });
    const admin = confirmation({ via: "ADMIN", url: null, observedAt: d("2026-10-10") });
    const old = confirmation({ observedAt: d("2026-08-07"), revertedAt: d("2026-09-01") });
    const other = confirmation({ kennelId: "k2", observedAt: d("2026-10-07") });
    const otherListing = confirmation({ url: V, observedAt: d("2026-10-12") });
    rows.push(open1, open2, admin, old, other, otherListing);

    expect(await revertHalfMindChecksFor("k1", U, NOW)).toBe(2);
    expect(open1.revertedAt).toEqual(NOW);
    expect(open2.revertedAt).toEqual(NOW);
    expect(admin.revertedAt).toBeNull();
    expect(old.revertedAt).toEqual(d("2026-09-01"));
    expect(other.revertedAt).toBeNull();
    expect(otherListing.revertedAt).toBeNull();
    expect(refreshKennelEvidence).toHaveBeenCalledWith(["k1"], NOW);
  });

  describe("requireHalfMindListingId", () => {
    const holding = (listingId: string | null) =>
      vi.mocked(prisma.kennel.findUnique)
        .mockResolvedValueOnce({ id: "k1" } as never) // the existence check, before the lock
        .mockResolvedValueOnce({ halfMindListingId: listingId } as never); // under the lock

    it("records the check while the kennel still holds the listing", async () => {
      holding("19");
      const opts = { ...halfMind, requireHalfMindListingId: "19" };
      expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, opts)).toEqual({ success: true });
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(rows).toHaveLength(1);
    });

    it.each([null, "88"])("skips the write when an unlink cleared the listing first (now %s)", async (listingId) => {
      holding(listingId);
      const opts = { ...halfMind, requireHalfMindListingId: "19" };
      expect(await confirmKennelRunningFor("admin-1", "k1", check, NOW, opts)).toEqual({ skipped: true });
      expect(prisma.kennelConfirmation.create).not.toHaveBeenCalled();
      expect(refreshKennelEvidence).not.toHaveBeenCalled();
    });
  });
});
