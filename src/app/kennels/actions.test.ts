import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUser = { id: "user_1", clerkId: "clerk_1", email: "test@test.com" };

vi.mock("@/lib/auth", () => ({ getOrCreateUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    userKennel: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { subscribeToKennel, unsubscribeFromKennel } from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockUKFind = vi.mocked(prisma.userKennel.findUnique);
const mockUKCreate = vi.mocked(prisma.userKennel.create);
const mockUKDeleteMany = vi.mocked(prisma.userKennel.deleteMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
});

describe("subscribeToKennel", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await subscribeToKennel("k1")).toEqual({ error: "Not authenticated" });
  });

  it("creates UserKennel with MEMBER role", async () => {
    mockUKFind.mockResolvedValueOnce(null);
    mockUKCreate.mockResolvedValueOnce({} as never);
    const result = await subscribeToKennel("k1");
    expect(result).toEqual({ success: true });
    expect(mockUKCreate).toHaveBeenCalledWith({
      data: { userId: "user_1", kennelId: "k1", role: "MEMBER" },
    });
  });

  it("is idempotent when already subscribed", async () => {
    mockUKFind.mockResolvedValueOnce({ id: "uk_1" } as never);
    const result = await subscribeToKennel("k1");
    expect(result).toEqual({ success: true });
    expect(mockUKCreate).not.toHaveBeenCalled();
  });
});

describe("unsubscribeFromKennel", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await unsubscribeFromKennel("k1")).toEqual({ error: "Not authenticated" });
  });

  it("deletes UserKennel", async () => {
    mockUKDeleteMany.mockResolvedValueOnce({} as never);
    const result = await unsubscribeFromKennel("k1");
    expect(result).toEqual({ success: true });
    expect(mockUKDeleteMany).toHaveBeenCalledWith({
      where: { userId: "user_1", kennelId: "k1" },
    });
  });
});
