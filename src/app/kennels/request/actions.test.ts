import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUser = { id: "user_1" };

vi.mock("@/lib/auth", () => ({ getOrCreateUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { kennelRequest: { create: vi.fn() } },
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { submitKennelRequest } from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockCreate = vi.mocked(prisma.kennelRequest.create);
const mockRedirect = vi.mocked(redirect);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
  mockCreate.mockResolvedValue({} as never);
});

describe("submitKennelRequest", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const fd = new FormData();
    const result = await submitKennelRequest(null, fd);
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when kennelName is empty", async () => {
    const fd = new FormData();
    fd.set("kennelName", "");
    const result = await submitKennelRequest(null, fd);
    expect(result).toEqual({ error: "Kennel name is required" });
  });

  it("creates KennelRequest with all fields", async () => {
    const fd = new FormData();
    fd.set("kennelName", "Test Hash");
    fd.set("region", "NYC");
    fd.set("country", "USA");
    fd.set("sourceUrl", "https://test.com");
    fd.set("notes", "Great kennel");
    await submitKennelRequest(null, fd);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kennelName: "Test Hash",
        region: "NYC",
        country: "USA",
        sourceUrl: "https://test.com",
        notes: "Great kennel",
      }),
    });
  });

  it("calls redirect on success", async () => {
    const fd = new FormData();
    fd.set("kennelName", "Test Hash");
    await submitKennelRequest(null, fd);
    expect(mockRedirect).toHaveBeenCalledWith("/kennels?requested=true");
  });

  it("sets optional fields to null when empty", async () => {
    const fd = new FormData();
    fd.set("kennelName", "Test Hash");
    await submitKennelRequest(null, fd);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        region: null,
        country: null,
        sourceUrl: null,
        notes: null,
      }),
    });
  });
});
