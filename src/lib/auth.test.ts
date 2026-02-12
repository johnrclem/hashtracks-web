import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));

import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getOrCreateUser, getAdminUser } from "./auth";

const mockCurrentUser = vi.mocked(currentUser);
const mockUserFind = vi.mocked(prisma.user.findUnique);
const mockUserCreate = vi.mocked(prisma.user.create);

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
