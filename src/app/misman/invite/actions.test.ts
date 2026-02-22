import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMisman = { id: "misman_1", email: "misman@test.com" };
const mockUser = { id: "user_1", email: "user@test.com" };

vi.mock("@/lib/auth", () => ({
  getOrCreateUser: vi.fn(),
  getMismanUser: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    mismanInvite: {
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    userKennel: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/invite", () => ({
  generateInviteToken: vi.fn().mockReturnValue("test-token-abc123"),
  computeExpiresAt: vi.fn().mockReturnValue(new Date("2026-02-22T12:00:00Z")),
  MAX_PENDING_PER_KENNEL: 20,
  DAILY_INVITE_LIMIT_PER_USER: 5,
  ONE_DAY_IN_MS: 24 * 60 * 60 * 1000,
}));

import { getOrCreateUser, getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createMismanInvite,
  revokeMismanInvite,
  listMismanInvites,
  redeemMismanInvite,
  getKennelMismans,
} from "./actions";

const mockMismanAuth = vi.mocked(getMismanUser);
const mockUserAuth = vi.mocked(getOrCreateUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockMismanAuth.mockResolvedValue(mockMisman as never);
  mockUserAuth.mockResolvedValue(mockUser as never);
});

describe("createMismanInvite", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await createMismanInvite("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when max pending invites reached", async () => {
    vi.mocked(prisma.mismanInvite.count).mockResolvedValueOnce(20);
    expect(await createMismanInvite("kennel_1")).toEqual({
      error: "Maximum of 20 pending invites per kennel",
    });
  });

  it("returns error when user daily limit exceeded", async () => {
    vi.mocked(prisma.mismanInvite.count)
      .mockResolvedValueOnce(0)  // per-kennel check passes
      .mockResolvedValueOnce(5); // per-user daily check fails
    expect(await createMismanInvite("kennel_1")).toEqual({
      error: "You can create up to 5 invites per day. Please try again tomorrow.",
    });
  });

  it("creates invite with correct fields", async () => {
    vi.mocked(prisma.mismanInvite.count)
      .mockResolvedValueOnce(0)  // per-kennel check
      .mockResolvedValueOnce(0); // per-user daily check
    vi.mocked(prisma.mismanInvite.create).mockResolvedValueOnce({
      id: "mi_1",
      token: "test-token-abc123",
      expiresAt: new Date("2026-02-22T12:00:00Z"),
      kennel: { slug: "nych3" },
    } as never);

    const result = await createMismanInvite("kennel_1", "invitee@test.com", 7);
    expect(result.data).toBeDefined();
    expect(result.data!.token).toBe("test-token-abc123");
    expect(result.data!.inviteUrl).toContain("/invite/test-token-abc123");

    expect(prisma.mismanInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kennelId: "kennel_1",
          inviterId: "misman_1",
          inviteeEmail: "invitee@test.com",
          token: "test-token-abc123",
        }),
      }),
    );
  });

  it("trims empty email to null", async () => {
    vi.mocked(prisma.mismanInvite.count)
      .mockResolvedValueOnce(0)  // per-kennel check
      .mockResolvedValueOnce(0); // per-user daily check
    vi.mocked(prisma.mismanInvite.create).mockResolvedValueOnce({
      id: "mi_1",
      token: "test-token-abc123",
      expiresAt: new Date("2026-02-22T12:00:00Z"),
      kennel: { slug: "nych3" },
    } as never);

    await createMismanInvite("kennel_1", "  ");
    expect(prisma.mismanInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          inviteeEmail: null,
        }),
      }),
    );
  });
});

describe("revokeMismanInvite", () => {
  it("returns error when invite not found", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce(null);
    expect(await revokeMismanInvite("mi_missing")).toEqual({
      error: "Invite not found",
    });
  });

  it("returns error when not authorized for kennel", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "PENDING",
      expiresAt: new Date("2099-01-01"),
      kennel: { slug: "nych3" },
    } as never);
    mockMismanAuth.mockResolvedValueOnce(null);

    expect(await revokeMismanInvite("mi_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when invite is not PENDING", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "ACCEPTED",
      expiresAt: new Date("2099-01-01"),
      kennel: { slug: "nych3" },
    } as never);

    expect(await revokeMismanInvite("mi_1")).toEqual({
      error: "Invite is not pending",
    });
  });

  it("returns error when invite already expired", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "PENDING",
      expiresAt: new Date("2020-01-01"),
      kennel: { slug: "nych3" },
    } as never);

    expect(await revokeMismanInvite("mi_1")).toEqual({
      error: "Invite has already expired",
    });
  });

  it("revokes successfully", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "PENDING",
      expiresAt: new Date("2099-01-01"),
      kennel: { slug: "nych3" },
    } as never);
    vi.mocked(prisma.mismanInvite.update).mockResolvedValueOnce({} as never);

    const result = await revokeMismanInvite("mi_1");
    expect(result).toEqual({ success: true });
    expect(prisma.mismanInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mi_1" },
        data: expect.objectContaining({ status: "REVOKED" }),
      }),
    );
  });
});

describe("listMismanInvites", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await listMismanInvites("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns invites with effective expired status", async () => {
    const pastDate = new Date("2020-01-01");
    const futureDate = new Date("2099-01-01");

    vi.mocked(prisma.mismanInvite.findMany).mockResolvedValueOnce([
      {
        id: "mi_1",
        inviteeEmail: "a@test.com",
        status: "PENDING",
        expiresAt: pastDate,
        createdAt: new Date("2026-02-01"),
        acceptedAt: null,
        revokedAt: null,
        inviter: { hashName: "TrailBoss", email: "boss@test.com" },
        acceptor: null,
      },
      {
        id: "mi_2",
        inviteeEmail: null,
        status: "PENDING",
        expiresAt: futureDate,
        createdAt: new Date("2026-02-10"),
        acceptedAt: null,
        revokedAt: null,
        inviter: { hashName: "TrailBoss", email: "boss@test.com" },
        acceptor: null,
      },
    ] as never);

    const result = await listMismanInvites("kennel_1");
    expect(result.data).toHaveLength(2);
    expect(result.data![0].status).toBe("EXPIRED"); // PENDING past expiry
    expect(result.data![1].status).toBe("PENDING"); // Still valid
  });
});

describe("redeemMismanInvite", () => {
  it("returns error when not authenticated", async () => {
    mockUserAuth.mockResolvedValueOnce(null);
    expect(await redeemMismanInvite("some-token")).toEqual({
      error: "Not authenticated",
    });
  });

  it("returns error when token not found", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce(null);
    expect(await redeemMismanInvite("bad-token")).toEqual({
      error: "Invite not found",
    });
  });

  it("returns error when invite expired", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "PENDING",
      expiresAt: new Date("2020-01-01"),
      kennel: { slug: "nych3" },
    } as never);

    expect(await redeemMismanInvite("expired-token")).toEqual({
      error: "This invite has expired",
    });
  });

  it("returns error when invite already accepted", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "ACCEPTED",
      expiresAt: new Date("2099-01-01"),
      kennel: { slug: "nych3" },
    } as never);

    expect(await redeemMismanInvite("used-token")).toEqual({
      error: "This invite has already been used",
    });
  });

  it("returns error when invite revoked", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "REVOKED",
      expiresAt: new Date("2099-01-01"),
      kennel: { slug: "nych3" },
    } as never);

    expect(await redeemMismanInvite("revoked-token")).toEqual({
      error: "This invite was cancelled",
    });
  });

  it("upserts UserKennel and marks invite accepted on success", async () => {
    vi.mocked(prisma.mismanInvite.findUnique).mockResolvedValueOnce({
      id: "mi_1",
      kennelId: "kennel_1",
      status: "PENDING",
      expiresAt: new Date("2099-01-01"),
      kennel: { slug: "nych3" },
    } as never);
    vi.mocked(prisma.userKennel.upsert).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.mismanInvite.update).mockResolvedValueOnce({} as never);

    const result = await redeemMismanInvite("valid-token");
    expect(result).toEqual({ success: true, kennelSlug: "nych3" });

    expect(prisma.userKennel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_kennelId: { userId: "user_1", kennelId: "kennel_1" } },
        update: { role: "MISMAN" },
        create: { userId: "user_1", kennelId: "kennel_1", role: "MISMAN" },
      }),
    );

    expect(prisma.mismanInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mi_1" },
        data: expect.objectContaining({
          status: "ACCEPTED",
          acceptedBy: "user_1",
        }),
      }),
    );
  });
});

describe("getKennelMismans", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await getKennelMismans("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns misman and admin users", async () => {
    vi.mocked(prisma.userKennel.findMany).mockResolvedValueOnce([
      {
        user: { id: "u1", hashName: "TrailBoss", email: "boss@test.com" },
        role: "MISMAN",
        createdAt: new Date("2026-01-01"),
      },
      {
        user: { id: "u2", hashName: null, email: "admin@test.com" },
        role: "ADMIN",
        createdAt: new Date("2025-06-01"),
      },
    ] as never);

    const result = await getKennelMismans("kennel_1");
    expect(result.data).toHaveLength(2);
    expect(result.data![0]).toEqual(
      expect.objectContaining({
        userId: "u1",
        hashName: "TrailBoss",
        role: "MISMAN",
      }),
    );
    expect(result.data![1]).toEqual(
      expect.objectContaining({
        userId: "u2",
        email: "admin@test.com",
        role: "ADMIN",
      }),
    );
  });
});
