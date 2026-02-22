import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUser = { id: "user_1", email: "test@test.com" };
const mockMisman = { id: "misman_1", email: "misman@test.com" };

vi.mock("@/lib/auth", () => ({
  getOrCreateUser: vi.fn(),
  getAdminUser: vi.fn(),
  getMismanUser: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    userKennel: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    mismanRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getOrCreateUser, getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  requestMismanAccess,
  requestMismanAccessFromDashboard,
  approveMismanRequest,
  rejectMismanRequest,
} from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockMismanAuth = vi.mocked(getMismanUser);
const mockUserKennelFindFirst = vi.mocked(prisma.userKennel.findFirst);
const mockUserKennelFind = vi.mocked(prisma.userKennel.findUnique);
const mockUserKennelCreate = vi.mocked(prisma.userKennel.create);
const mockMismanRequestFindFirst = vi.mocked(prisma.mismanRequest.findFirst);
const mockMismanRequestFindUnique = vi.mocked(prisma.mismanRequest.findUnique);

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue(mockUser as never);
});

describe("requestMismanAccess", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await requestMismanAccess("kennel_1")).toEqual({
      error: "Not authenticated",
    });
  });

  it("returns error when not subscribed", async () => {
    mockUserKennelFind.mockResolvedValueOnce(null);
    expect(await requestMismanAccess("kennel_1")).toEqual({
      error: "You must subscribe to this kennel first",
    });
  });

  it("returns error when already misman", async () => {
    mockUserKennelFind.mockResolvedValueOnce({ role: "MISMAN" } as never);
    expect(await requestMismanAccess("kennel_1")).toEqual({
      error: "You already have misman access for this kennel",
    });
  });

  it("returns error when already admin", async () => {
    mockUserKennelFind.mockResolvedValueOnce({ role: "ADMIN" } as never);
    expect(await requestMismanAccess("kennel_1")).toEqual({
      error: "You already have misman access for this kennel",
    });
  });

  it("returns error when pending request exists", async () => {
    mockUserKennelFind.mockResolvedValueOnce({ role: "MEMBER" } as never);
    mockMismanRequestFindFirst.mockResolvedValueOnce({ id: "existing" } as never);
    expect(await requestMismanAccess("kennel_1")).toEqual({
      error: "You already have a pending request",
    });
  });

  it("creates request successfully", async () => {
    mockUserKennelFind.mockResolvedValueOnce({ role: "MEMBER" } as never);
    mockMismanRequestFindFirst.mockResolvedValueOnce(null);
    mockMismanRequestFindFirst.mockResolvedValueOnce(null);

    const result = await requestMismanAccess("kennel_1", "I'm the misman");
    expect(result).toEqual({ success: true });
    expect(prisma.mismanRequest.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        kennelId: "kennel_1",
        message: "I'm the misman",
      },
    });
  });

  it("trims empty message to null", async () => {
    mockUserKennelFind.mockResolvedValueOnce({ role: "MEMBER" } as never);
    mockMismanRequestFindFirst.mockResolvedValueOnce(null);

    await requestMismanAccess("kennel_1", "  ");
    expect(prisma.mismanRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message: null }),
    });
  });
});

describe("approveMismanRequest", () => {
  it("returns error when request not found", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce(null);
    expect(await approveMismanRequest("req_1")).toEqual({
      error: "Request not found",
    });
  });

  it("returns error when request not pending", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce({
      id: "req_1",
      status: "APPROVED",
      kennelId: "kennel_1",
      kennel: { slug: "nych3" },
    } as never);
    expect(await approveMismanRequest("req_1")).toEqual({
      error: "Request is not pending",
    });
  });

  it("returns error when not authorized", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce({
      id: "req_1",
      status: "PENDING",
      kennelId: "kennel_1",
      userId: "user_1",
      kennel: { slug: "nych3" },
    } as never);
    mockMismanAuth.mockResolvedValueOnce(null);

    expect(await approveMismanRequest("req_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("approves request and assigns MISMAN role", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce({
      id: "req_1",
      status: "PENDING",
      kennelId: "kennel_1",
      userId: "user_1",
      kennel: { slug: "nych3" },
    } as never);
    mockMismanAuth.mockResolvedValueOnce(mockMisman as never);

    const result = await approveMismanRequest("req_1");
    expect(result).toEqual({ success: true });

    expect(prisma.userKennel.upsert).toHaveBeenCalledWith({
      where: {
        userId_kennelId: { userId: "user_1", kennelId: "kennel_1" },
      },
      update: { role: "MISMAN" },
      create: { userId: "user_1", kennelId: "kennel_1", role: "MISMAN" },
    });

    expect(prisma.mismanRequest.update).toHaveBeenCalledWith({
      where: { id: "req_1" },
      data: expect.objectContaining({
        status: "APPROVED",
        resolvedBy: "misman_1",
      }),
    });
  });
});

describe("rejectMismanRequest", () => {
  it("returns error when request not found", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce(null);
    expect(await rejectMismanRequest("req_1")).toEqual({
      error: "Request not found",
    });
  });

  it("returns error when not authorized", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce({
      id: "req_1",
      status: "PENDING",
      kennelId: "kennel_1",
    } as never);
    mockMismanAuth.mockResolvedValueOnce(null);

    expect(await rejectMismanRequest("req_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("rejects request successfully", async () => {
    mockMismanRequestFindUnique.mockResolvedValueOnce({
      id: "req_1",
      status: "PENDING",
      kennelId: "kennel_1",
    } as never);
    mockMismanAuth.mockResolvedValueOnce(mockMisman as never);

    const result = await rejectMismanRequest("req_1");
    expect(result).toEqual({ success: true });

    expect(prisma.mismanRequest.update).toHaveBeenCalledWith({
      where: { id: "req_1" },
      data: expect.objectContaining({
        status: "REJECTED",
        resolvedBy: "misman_1",
      }),
    });
  });
});

describe("requestMismanAccessFromDashboard", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect(await requestMismanAccessFromDashboard("kennel_1")).toEqual({
      error: "Not authenticated",
    });
  });

  it("returns error when user is not misman of any kennel", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce(null);
    expect(await requestMismanAccessFromDashboard("kennel_1")).toEqual({
      error: "You must be misman of at least one kennel",
    });
  });

  it("returns error when already has misman access", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce({ id: "uk_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "MISMAN" } as never);
    expect(await requestMismanAccessFromDashboard("kennel_2")).toEqual({
      error: "You already have misman access for this kennel",
    });
  });

  it("returns error when already has admin access", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce({ id: "uk_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "ADMIN" } as never);
    expect(await requestMismanAccessFromDashboard("kennel_2")).toEqual({
      error: "You already have misman access for this kennel",
    });
  });

  it("returns error when pending request exists", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce({ id: "uk_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "MEMBER" } as never);
    mockMismanRequestFindFirst.mockResolvedValueOnce({ id: "existing" } as never);
    expect(await requestMismanAccessFromDashboard("kennel_2")).toEqual({
      error: "You already have a pending request for this kennel",
    });
  });

  it("auto-subscribes and creates request when not subscribed", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce({ id: "uk_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce(null);
    mockMismanRequestFindFirst.mockResolvedValueOnce(null);

    const result = await requestMismanAccessFromDashboard("kennel_2", "I manage this kennel");
    expect(result).toEqual({ success: true });

    expect(mockUserKennelCreate).toHaveBeenCalledWith({
      data: { userId: "user_1", kennelId: "kennel_2", role: "MEMBER" },
    });
    expect(prisma.mismanRequest.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        kennelId: "kennel_2",
        message: "I manage this kennel",
      },
    });
  });

  it("creates request without auto-subscribe when already subscribed", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce({ id: "uk_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce({ role: "MEMBER" } as never);
    mockMismanRequestFindFirst.mockResolvedValueOnce(null);

    const result = await requestMismanAccessFromDashboard("kennel_2", "test");
    expect(result).toEqual({ success: true });

    expect(mockUserKennelCreate).not.toHaveBeenCalled();
    expect(prisma.mismanRequest.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        kennelId: "kennel_2",
        message: "test",
      },
    });
  });

  it("trims empty message to null", async () => {
    mockUserKennelFindFirst.mockResolvedValueOnce({ id: "uk_1" } as never);
    mockUserKennelFind.mockResolvedValueOnce(null);
    mockMismanRequestFindFirst.mockResolvedValueOnce(null);

    await requestMismanAccessFromDashboard("kennel_2", "  ");
    expect(prisma.mismanRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ message: null }),
    });
  });
});
