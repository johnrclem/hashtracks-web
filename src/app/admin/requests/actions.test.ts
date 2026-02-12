import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { kennelRequest: { update: vi.fn() } },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { approveRequest, rejectRequest } from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockRequestUpdate = vi.mocked(prisma.kennelRequest.update);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(mockAdmin as never);
  mockRequestUpdate.mockResolvedValue({} as never);
});

describe("approveRequest", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await approveRequest("r1")).toEqual({ error: "Not authorized" });
  });

  it("updates status to APPROVED", async () => {
    const result = await approveRequest("r1");
    expect(result).toEqual({ success: true });
    expect(mockRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED" }),
      }),
    );
  });
});

describe("rejectRequest", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await rejectRequest("r1")).toEqual({ error: "Not authorized" });
  });

  it("updates status to REJECTED", async () => {
    const result = await rejectRequest("r1");
    expect(result).toEqual({ success: true });
    expect(mockRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
  });
});
