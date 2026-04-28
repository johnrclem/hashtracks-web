import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1", clerkId: "clerk_admin", email: "admin@test.com" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    region: { findUnique: vi.fn() },
    kennelAlias: { deleteMany: vi.fn() },
    sourceKennel: { deleteMany: vi.fn() },
    kennelAttendance: { count: vi.fn() },
    eventKennel: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    kennelHasher: { deleteMany: vi.fn() },
    kennelHasherLink: { deleteMany: vi.fn() },
    rosterGroupKennel: { deleteMany: vi.fn() },
    mismanRequest: { deleteMany: vi.fn() },
    userKennel: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn((arr: unknown[]) => Promise.all(arr)),
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createKennel,
  updateKennel,
  deleteKennel,
  assignMismanRole,
  revokeMismanRole,
  deduplicateEventKennels,
} from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockKennelFindFirst = vi.mocked(prisma.kennel.findFirst);
const mockKennelFindUnique = vi.mocked(prisma.kennel.findUnique);
const mockKennelFindMany = vi.mocked(prisma.kennel.findMany);
const mockKennelCreate = vi.mocked(prisma.kennel.create);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(mockAdmin as never);
  // findSimilarKennels() in createKennel needs this
  mockKennelFindMany.mockResolvedValue([] as never);
  // resolveRegionName() requires prisma.region.findUnique
  vi.mocked(prisma.region.findUnique).mockResolvedValue({ id: "region_1", name: "NYC" } as never);
});

describe("createKennel", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    const fd = new FormData();
    expect(await createKennel(fd)).toEqual({ error: "Not authorized" });
  });

  it("returns error when missing required fields", async () => {
    const fd = new FormData();
    fd.set("shortName", "");
    fd.set("fullName", "");
    fd.set("region", "");
    expect(await createKennel(fd)).toEqual({
      error: "Short name, full name, and region are required",
    });
  });

  it("returns error when kennelCode already exists", async () => {
    mockKennelFindUnique
      .mockResolvedValueOnce({ id: "existing" } as never); // kennelCode check
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "NYC");
    fd.set("regionId", "region_1");
    expect(await createKennel(fd)).toEqual({
      error: 'A kennel with code "nych3" already exists',
    });
  });

  it("returns error when slug already exists", async () => {
    mockKennelFindUnique
      .mockResolvedValueOnce(null)                         // kennelCode check
      .mockResolvedValueOnce({ id: "existing" } as never); // slug check
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "NYC");
    fd.set("regionId", "region_1");
    expect(await createKennel(fd)).toEqual({
      error: 'A kennel with slug "nych3" already exists',
    });
  });

  it("returns error when shortName + region already exists", async () => {
    vi.mocked(prisma.region.findUnique).mockResolvedValueOnce({ id: "region_1", name: "New York City, NY" } as never);
    mockKennelFindUnique
      .mockResolvedValueOnce(null)  // kennelCode check
      .mockResolvedValueOnce(null); // slug check
    mockKennelFindFirst.mockResolvedValueOnce({ id: "existing" } as never); // region check
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "New York City, NY");
    fd.set("regionId", "region_1");
    expect(await createKennel(fd)).toEqual({
      error: 'A kennel named "NYCH3" already exists in New York City, NY',
    });
  });

  it("allows same shortName in different regions", async () => {
    mockKennelFindUnique
      .mockResolvedValueOnce(null)  // kennelCode check
      .mockResolvedValueOnce(null); // slug check
    mockKennelFindFirst.mockResolvedValueOnce(null); // no match in this region
    mockKennelCreate.mockResolvedValueOnce({} as never);
    const fd = new FormData();
    fd.set("shortName", "TestH3");
    fd.set("fullName", "Test Hash");
    fd.set("region", "Boston, MA");
    fd.set("regionId", "region_1");
    const result = await createKennel(fd);
    expect(result).toEqual({ success: true });
  });

  it("creates kennel with aliases and kennelCode", async () => {
    mockKennelFindUnique
      .mockResolvedValueOnce(null)  // kennelCode check
      .mockResolvedValueOnce(null); // slug check
    mockKennelFindFirst.mockResolvedValueOnce(null);
    mockKennelCreate.mockResolvedValueOnce({} as never);
    const fd = new FormData();
    fd.set("shortName", "TestH3");
    fd.set("fullName", "Test Hash");
    fd.set("region", "NYC");
    fd.set("regionId", "region_1");
    fd.set("aliases", "Test, TH3");
    const result = await createKennel(fd);
    expect(result).toEqual({ success: true });
    expect(mockKennelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kennelCode: "testh3",
          shortName: "TestH3",
          slug: "testh3",
          aliases: {
            create: expect.arrayContaining([
              { alias: "Test" },
              { alias: "TH3" },
            ]),
          },
        }),
      }),
    );
  });

  it("generates correct slug from shortName with parens", async () => {
    mockKennelFindUnique
      .mockResolvedValueOnce(null)  // kennelCode check
      .mockResolvedValueOnce(null); // slug check
    mockKennelFindFirst.mockResolvedValueOnce(null);
    mockKennelCreate.mockResolvedValueOnce({} as never);
    const fd = new FormData();
    fd.set("shortName", "Drinking Practice (NYC)");
    fd.set("fullName", "Drinking Practice NYC");
    fd.set("region", "NYC");
    fd.set("regionId", "region_1");
    await createKennel(fd);
    expect(mockKennelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kennelCode: "drinking-practice-nyc",
          slug: "drinking-practice-nyc",
        }),
      }),
    );
  });
});

describe("updateKennel", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    const fd = new FormData();
    expect(await updateKennel("k1", fd)).toEqual({ error: "Not authorized" });
  });

  it("returns error on slug conflict", async () => {
    mockKennelFindFirst.mockResolvedValueOnce({ id: "other" } as never); // slug check
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "NYC");
    expect(await updateKennel("k1", fd)).toEqual({
      error: 'A kennel with slug "nych3" already exists',
    });
  });

  it("returns error on shortName + region conflict", async () => {
    mockKennelFindFirst
      .mockResolvedValueOnce(null)                         // slug check passes
      .mockResolvedValueOnce({ id: "other" } as never);    // region check fails
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "New York City, NY");
    expect(await updateKennel("k1", fd)).toEqual({
      error: 'A kennel named "NYCH3" already exists in New York City, NY',
    });
  });
});

describe("deleteKennel", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await deleteKennel("k1")).toEqual({ error: "Not authorized" });
  });

  it("returns error when kennel not found", async () => {
    mockKennelFindUnique.mockResolvedValueOnce(null);
    expect(await deleteKennel("k1")).toEqual({ error: "Kennel not found" });
  });

  it("returns error when kennel has events", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 5, members: 0 },
    } as never);
    const result = await deleteKennel("k1");
    expect(result.error).toContain("5 event(s)");
  });

  it("returns error when kennel has members", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 0, members: 3 },
    } as never);
    const result = await deleteKennel("k1");
    expect(result.error).toContain("3 subscriber(s)");
  });

  it("returns error when kennel is a co-host on EventKennel rows (#1023)", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 0, members: 0 },
    } as never);
    vi.mocked(prisma.eventKennel.count).mockResolvedValueOnce(7);
    const result = await deleteKennel("k1");
    expect(result.error).toContain("co-host on 7 event(s)");
  });

  it("returns error when kennel has attendance records", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 0, members: 0 },
    } as never);
    vi.mocked(prisma.eventKennel.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.kennelAttendance.count).mockResolvedValueOnce(12);
    const result = await deleteKennel("k1");
    expect(result.error).toContain("12 attendance record(s)");
  });

  it("deletes kennel when no events, members, co-hosts, or attendance", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 0, members: 0 },
    } as never);
    vi.mocked(prisma.eventKennel.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.kennelAttendance.count).mockResolvedValueOnce(0);
    const result = await deleteKennel("k1");
    expect(result).toEqual({ success: true });
  });
});

describe("deduplicateEventKennels (#1023 step 2)", () => {
  // The four collapse cases when source has an EventKennel row on event X
  // and target may or may not also have one.
  function makeTx() {
    return {
      eventKennel: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
  }

  it("re-points source row when target has no row on the event", async () => {
    const tx = makeTx();
    tx.eventKennel.findMany.mockResolvedValueOnce([{ eventId: "e1", isPrimary: true }]);
    tx.eventKennel.findUnique.mockResolvedValueOnce(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deduplicateEventKennels(tx as any, "src", "tgt");

    expect(tx.eventKennel.update).toHaveBeenCalledWith({
      where: { eventId_kennelId: { eventId: "e1", kennelId: "src" } },
      data: { kennelId: "tgt" },
    });
    expect(tx.eventKennel.delete).not.toHaveBeenCalled();
  });

  it("source-primary + target-secondary: deletes source FIRST, then promotes target (avoids partial unique index conflict)", async () => {
    const tx = makeTx();
    tx.eventKennel.findMany.mockResolvedValueOnce([{ eventId: "e1", isPrimary: true }]);
    tx.eventKennel.findUnique.mockResolvedValueOnce({ isPrimary: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deduplicateEventKennels(tx as any, "src", "tgt");

    const deleteOrder = tx.eventKennel.delete.mock.invocationCallOrder[0] ?? Infinity;
    const updateOrder = tx.eventKennel.update.mock.invocationCallOrder[0] ?? -Infinity;
    expect(deleteOrder).toBeLessThan(updateOrder);
    expect(tx.eventKennel.delete).toHaveBeenCalledWith({
      where: { eventId_kennelId: { eventId: "e1", kennelId: "src" } },
    });
    expect(tx.eventKennel.update).toHaveBeenCalledWith({
      where: { eventId_kennelId: { eventId: "e1", kennelId: "tgt" } },
      data: { isPrimary: true },
    });
  });

  it("source-secondary + target-primary: deletes source row, target stays primary", async () => {
    const tx = makeTx();
    tx.eventKennel.findMany.mockResolvedValueOnce([{ eventId: "e1", isPrimary: false }]);
    tx.eventKennel.findUnique.mockResolvedValueOnce({ isPrimary: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deduplicateEventKennels(tx as any, "src", "tgt");

    expect(tx.eventKennel.delete).toHaveBeenCalledWith({
      where: { eventId_kennelId: { eventId: "e1", kennelId: "src" } },
    });
    // No promotion — target was already primary.
    expect(tx.eventKennel.update).not.toHaveBeenCalled();
  });

  it("source-secondary + target-secondary: just deletes source, both stay non-primary", async () => {
    const tx = makeTx();
    tx.eventKennel.findMany.mockResolvedValueOnce([{ eventId: "e1", isPrimary: false }]);
    tx.eventKennel.findUnique.mockResolvedValueOnce({ isPrimary: false });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deduplicateEventKennels(tx as any, "src", "tgt");

    expect(tx.eventKennel.delete).toHaveBeenCalledOnce();
    expect(tx.eventKennel.update).not.toHaveBeenCalled();
  });

  it("processes multiple source rows independently", async () => {
    const tx = makeTx();
    tx.eventKennel.findMany.mockResolvedValueOnce([
      { eventId: "e1", isPrimary: true },
      { eventId: "e2", isPrimary: false },
    ]);
    // e1 → no target row (re-point); e2 → target has primary (collapse)
    tx.eventKennel.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ isPrimary: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await deduplicateEventKennels(tx as any, "src", "tgt");

    expect(tx.eventKennel.update).toHaveBeenCalledTimes(1); // only the e1 re-point
    expect(tx.eventKennel.delete).toHaveBeenCalledTimes(1); // only the e2 source row
  });
});

describe("assignMismanRole", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await assignMismanRole("k1", "u1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when kennel not found", async () => {
    mockKennelFindUnique.mockResolvedValueOnce(null);
    expect(await assignMismanRole("k1", "u1")).toEqual({
      error: "Kennel not found",
    });
  });

  describe("when kennel exists", () => {
    beforeEach(() => {
      mockKennelFindUnique.mockResolvedValueOnce({ slug: "nych3" } as never);
    });

    it("returns error when user not found", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      expect(await assignMismanRole("k1", "u1")).toEqual({
        error: "User not found",
      });
    });

    it("assigns MISMAN role via upsert", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u1" } as never);

      const result = await assignMismanRole("k1", "u1");
      expect(result).toEqual({ success: true });
      expect(prisma.userKennel.upsert).toHaveBeenCalledWith({
        where: { userId_kennelId: { userId: "u1", kennelId: "k1" } },
        update: { role: "MISMAN" },
        create: { userId: "u1", kennelId: "k1", role: "MISMAN" },
      });
    });
  });
});

describe("revokeMismanRole", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await revokeMismanRole("k1", "u1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when user is not a member", async () => {
    vi.mocked(prisma.userKennel.findUnique).mockResolvedValueOnce(null);
    expect(await revokeMismanRole("k1", "u1")).toEqual({
      error: "User is not a member of this kennel",
    });
  });

  it("returns error when user is already MEMBER", async () => {
    vi.mocked(prisma.userKennel.findUnique).mockResolvedValueOnce({
      role: "MEMBER",
    } as never);
    expect(await revokeMismanRole("k1", "u1")).toEqual({
      error: "User does not have misman access",
    });
  });

  it("downgrades MISMAN to MEMBER", async () => {
    vi.mocked(prisma.userKennel.findUnique).mockResolvedValueOnce({
      role: "MISMAN",
    } as never);

    const result = await revokeMismanRole("k1", "u1");
    expect(result).toEqual({ success: true });
    expect(prisma.userKennel.update).toHaveBeenCalledWith({
      where: { userId_kennelId: { userId: "u1", kennelId: "k1" } },
      data: { role: "MEMBER" },
    });
  });
});
