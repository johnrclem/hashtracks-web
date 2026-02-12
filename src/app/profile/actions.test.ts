import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUser = { id: "user_1", clerkId: "clerk_1", email: "test@test.com" };

vi.mock("@/lib/auth", () => ({ getOrCreateUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { update: vi.fn() } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateProfile } from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockUserUpdate = vi.mocked(prisma.user.update);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
  mockUserUpdate.mockResolvedValue({} as never);
});

describe("updateProfile", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const fd = new FormData();
    const result = await updateProfile(null, fd);
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("updates all fields", async () => {
    const fd = new FormData();
    fd.set("hashName", "Mudflap");
    fd.set("nerdName", "John Doe");
    fd.set("bio", "I love hashing");
    const result = await updateProfile(null, fd);
    expect(result).toEqual({ success: true });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { hashName: "Mudflap", nerdName: "John Doe", bio: "I love hashing" },
      }),
    );
  });

  it("trims whitespace", async () => {
    const fd = new FormData();
    fd.set("hashName", "  Mudflap  ");
    fd.set("nerdName", "");
    fd.set("bio", "");
    await updateProfile(null, fd);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { hashName: "Mudflap", nerdName: null, bio: null },
      }),
    );
  });

  it("converts empty strings to null", async () => {
    const fd = new FormData();
    fd.set("hashName", "   ");
    fd.set("nerdName", "");
    fd.set("bio", "");
    await updateProfile(null, fd);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hashName: null }),
      }),
    );
  });
});
