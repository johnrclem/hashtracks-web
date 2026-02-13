import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    userKennel: { findUnique: vi.fn() },
    rosterGroupKennel: { findUnique: vi.fn() },
  },
}));

import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  getOrCreateUser,
  getAdminUser,
  getMismanUser,
  getRosterKennelIds,
} from "./auth";

const mockCurrentUser = vi.mocked(currentUser);
const mockUserFind = vi.mocked(prisma.user.findUnique);
const mockUserCreate = vi.mocked(prisma.user.create);
const mockUserKennelFind = vi.mocked(prisma.userKennel.findUnique);
const mockRosterGroupKennelFind = vi.mocked(prisma.rosterGroupKennel.findUnique);

const clerkUser = {
  id: "clerk_1",
  firstName: "John",
  lastName: "Doe",
  emailAddresses: [{ emailAddress: "john@test.com" }],
  publicMetadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrCreateUser", () => {
  it("returns null when no Clerk user", async () => {
    mockCurrentUser.mockResolvedValueOnce(null);
    expect(await getOrCreateUser()).toBeNull();
  });

  it("returns existing user without creating", async () => {
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockUserFind.mockResolvedValueOnce({ id: "user_1" } as never);
    const result = await getOrCreateUser();
    expect(result).toEqual({ id: "user_1" });
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("creates user on first sign-in", async () => {
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockUserFind.mockResolvedValueOnce(null);
    mockUserCreate.mockResolvedValueOnce({ id: "user_new" } as never);
    const result = await getOrCreateUser();
    expect(result).toEqual({ id: "user_new" });
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clerkId: "clerk_1",
        email: "john@test.com",
        nerdName: "John Doe",
      }),
    });
  });

  it("handles missing firstName", async () => {
    const noName = { ...clerkUser, firstName: null, lastName: null };
    mockCurrentUser.mockResolvedValueOnce(noName as never);
    mockUserFind.mockResolvedValueOnce(null);
    mockUserCreate.mockResolvedValueOnce({ id: "user_new" } as never);
    await getOrCreateUser();
    expect(mockUserCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ nerdName: null }),
    });
  });
});

describe("getAdminUser", () => {
  it("returns null when no Clerk user", async () => {
    mockCurrentUser.mockResolvedValueOnce(null);
    expect(await getAdminUser()).toBeNull();
  });

  it("returns null when role is not admin", async () => {
    mockCurrentUser.mockResolvedValueOnce({ ...clerkUser, publicMetadata: { role: "user" } } as never);
    expect(await getAdminUser()).toBeNull();
  });

  it("returns user when role is admin", async () => {
    const adminClerk = { ...clerkUser, publicMetadata: { role: "admin" } };
    // getAdminUser calls currentUser() once, then getOrCreateUser() calls it again
    mockCurrentUser.mockResolvedValueOnce(adminClerk as never);
    mockCurrentUser.mockResolvedValueOnce(adminClerk as never);
    mockUserFind.mockResolvedValueOnce({ id: "admin_1" } as never);
    const result = await getAdminUser();
    expect(result).toEqual({ id: "admin_1" });
  });
});

describe("getMismanUser", () => {
  it("returns null when no Clerk user", async () => {
    mockCurrentUser.mockResolvedValueOnce(null);
    expect(await getMismanUser("kennel_1")).toBeNull();
  });

  it("returns user when site admin (bypasses kennel check)", async () => {
    const adminClerk = { ...clerkUser, publicMetadata: { role: "admin" } };
    // getMismanUser calls currentUser(), then getOrCreateUser() calls currentUser() again
    mockCurrentUser.mockResolvedValueOnce(adminClerk as never);
    mockCurrentUser.mockResolvedValueOnce(adminClerk as never);
    mockUserFind.mockResolvedValueOnce({ id: "admin_1" } as never);

    const result = await getMismanUser("kennel_1");
    expect(result).toEqual({ id: "admin_1" });
    expect(mockUserKennelFind).not.toHaveBeenCalled();
  });

  it("returns user when has MISMAN role for kennel", async () => {
    // getMismanUser calls currentUser() once, then getOrCreateUser() calls currentUser() again
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockUserFind.mockResolvedValueOnce({ id: "user_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "MISMAN" } as never);

    const result = await getMismanUser("kennel_1");
    expect(result).toEqual({ id: "user_1" });
  });

  it("returns user when has ADMIN role for kennel", async () => {
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockUserFind.mockResolvedValueOnce({ id: "user_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "ADMIN" } as never);

    const result = await getMismanUser("kennel_1");
    expect(result).toEqual({ id: "user_1" });
  });

  it("returns null when has MEMBER role (not misman)", async () => {
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockUserFind.mockResolvedValueOnce({ id: "user_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "MEMBER" } as never);

    expect(await getMismanUser("kennel_1")).toBeNull();
  });

  it("returns null when not a member of the kennel", async () => {
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockCurrentUser.mockResolvedValueOnce(clerkUser as never);
    mockUserFind.mockResolvedValueOnce({ id: "user_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce(null);

    expect(await getMismanUser("kennel_1")).toBeNull();
  });
});

describe("getRosterKennelIds", () => {
  it("returns single kennel ID for standalone kennel (not in group)", async () => {
    mockRosterGroupKennelFind.mockResolvedValueOnce(null);

    const result = await getRosterKennelIds("kennel_1");
    expect(result).toEqual(["kennel_1"]);
  });

  it("returns all kennel IDs in the roster group", async () => {
    mockRosterGroupKennelFind.mockResolvedValueOnce({
      kennelId: "kennel_1",
      group: {
        kennels: [
          { kennelId: "kennel_1" },
          { kennelId: "kennel_2" },
          { kennelId: "kennel_3" },
        ],
      },
    } as never);

    const result = await getRosterKennelIds("kennel_1");
    expect(result).toEqual(["kennel_1", "kennel_2", "kennel_3"]);
  });
});
