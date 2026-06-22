import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUser = { id: "user_1", clerkId: "clerk_1", email: "test@test.com" };

vi.mock("@/lib/auth", () => ({ getOrCreateUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { update: vi.fn() },
    kennelHasherLink: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  updateProfile,
  getMyKennelLinks,
  acceptLinkRequest,
  declineLinkRequest,
  revokeMyLink,
} from "./actions";

const mockAuth = vi.mocked(getOrCreateUser);
const mockUserUpdate = vi.mocked(prisma.user.update);
const mockLinkFindMany = vi.mocked(prisma.kennelHasherLink.findMany);
const mockLinkFindUnique = vi.mocked(prisma.kennelHasherLink.findUnique);
const mockLinkUpdate = vi.mocked(prisma.kennelHasherLink.update);

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
        data: expect.objectContaining({ hashName: "Mudflap", nerdName: "John Doe", bio: "I love hashing" }),
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
        data: expect.objectContaining({ hashName: "Mudflap", nerdName: null, bio: null }),
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

  it("defaults visibility to PRIVATE and hideClerkImage to false when absent", async () => {
    const fd = new FormData();
    fd.set("hashName", "Mudflap");
    await updateProfile(null, fd);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attendanceVisibility: "PRIVATE",
          hideClerkImage: false,
          avatarUrl: null,
        }),
      }),
    );
  });

  it("persists PUBLIC visibility and a hidden Clerk image", async () => {
    const fd = new FormData();
    fd.set("attendanceVisibility", "PUBLIC");
    fd.set("hideClerkImage", "true");
    await updateProfile(null, fd);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attendanceVisibility: "PUBLIC",
          hideClerkImage: true,
        }),
      }),
    );
  });

  it("stores a first-party Blob avatar URL", async () => {
    const blob = "https://abc123.public.blob.vercel-storage.com/avatar-x.png";
    const fd = new FormData();
    fd.set("avatarUrl", blob);
    const result = await updateProfile(null, fd);
    expect(result).toEqual({ success: true });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ avatarUrl: blob }) }),
    );
  });

  it("clears the avatar when avatarUrl is empty", async () => {
    const fd = new FormData();
    fd.set("avatarUrl", "");
    await updateProfile(null, fd);
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ avatarUrl: null }) }),
    );
  });

  it("rejects a non-first-party avatar URL without writing", async () => {
    const fd = new FormData();
    fd.set("avatarUrl", "https://evil.example.com/x.png");
    const result = await updateProfile(null, fd);
    expect(result).toEqual({ error: "Profile photo must be uploaded through HashTracks" });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

// ── getMyKennelLinks ──

describe("getMyKennelLinks", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await getMyKennelLinks();
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns mapped links for authenticated user", async () => {
    mockLinkFindMany.mockResolvedValueOnce([
      {
        id: "link_1",
        status: "SUGGESTED",
        createdAt: new Date("2026-02-18"),
        updatedAt: new Date("2026-02-18"),
        kennelHasher: {
          id: "kh_1",
          hashName: "Trail Blazer",
          nerdName: "John",
          kennel: { shortName: "NYCH3", slug: "nych3" },
          rosterGroup: {
            name: "NYC Metro",
            kennels: [{ kennel: { shortName: "NYCH3", slug: "nych3" } }],
          },
        },
      },
    ] as never);

    const result = await getMyKennelLinks();
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toMatchObject({
      id: "link_1",
      status: "SUGGESTED",
      hashName: "Trail Blazer",
      kennelShortName: "NYCH3",
      kennelSlug: "nych3",
    });
  });
});

// ── acceptLinkRequest ──

describe("acceptLinkRequest", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await acceptLinkRequest("link_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when link not found", async () => {
    mockLinkFindUnique.mockResolvedValueOnce(null);
    const result = await acceptLinkRequest("link_missing");
    expect(result).toEqual({ error: "Link not found" });
  });

  it("returns error when link belongs to different user", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "other_user",
      status: "SUGGESTED",
      kennelHasher: { kennel: null },
    } as never);
    const result = await acceptLinkRequest("link_1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns error when link is not SUGGESTED", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "user_1",
      status: "CONFIRMED",
      kennelHasher: { kennel: null },
    } as never);
    const result = await acceptLinkRequest("link_1");
    expect(result).toEqual({ error: "Link is not in SUGGESTED status" });
  });

  it("updates link to CONFIRMED on success", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "user_1",
      status: "SUGGESTED",
      kennelHasher: { kennel: { slug: "nych3" } },
    } as never);
    mockLinkUpdate.mockResolvedValueOnce({} as never);

    const result = await acceptLinkRequest("link_1");
    expect(result).toEqual({ success: true });
    expect(mockLinkUpdate).toHaveBeenCalledWith({
      where: { id: "link_1" },
      data: { status: "CONFIRMED", confirmedBy: "user_1" },
    });
  });
});

// ── declineLinkRequest ──

describe("declineLinkRequest", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await declineLinkRequest("link_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when link belongs to different user", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "other_user",
      status: "SUGGESTED",
      kennelHasher: { kennel: null },
    } as never);
    const result = await declineLinkRequest("link_1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns error when link is not SUGGESTED", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "user_1",
      status: "CONFIRMED",
      kennelHasher: { kennel: null },
    } as never);
    const result = await declineLinkRequest("link_1");
    expect(result).toEqual({ error: "Link is not in SUGGESTED status" });
  });

  it("updates link to DISMISSED on success", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "user_1",
      status: "SUGGESTED",
      kennelHasher: { kennel: { slug: "nych3" } },
    } as never);
    mockLinkUpdate.mockResolvedValueOnce({} as never);

    const result = await declineLinkRequest("link_1");
    expect(result).toEqual({ success: true });
    expect(mockLinkUpdate).toHaveBeenCalledWith({
      where: { id: "link_1" },
      data: { status: "DISMISSED", dismissedBy: "user_1" },
    });
  });
});

// ── revokeMyLink ──

describe("revokeMyLink", () => {
  it("returns error when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await revokeMyLink("link_1");
    expect(result).toEqual({ error: "Not authenticated" });
  });

  it("returns error when link belongs to different user", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "other_user",
      status: "CONFIRMED",
      kennelHasher: { kennel: null },
    } as never);
    const result = await revokeMyLink("link_1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns error when link is not CONFIRMED", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "user_1",
      status: "SUGGESTED",
      kennelHasher: { kennel: null },
    } as never);
    const result = await revokeMyLink("link_1");
    expect(result).toEqual({ error: "Can only revoke confirmed links" });
  });

  it("updates link to DISMISSED on success", async () => {
    mockLinkFindUnique.mockResolvedValueOnce({
      id: "link_1",
      userId: "user_1",
      status: "CONFIRMED",
      kennelHasher: { kennel: { slug: "nych3" } },
    } as never);
    mockLinkUpdate.mockResolvedValueOnce({} as never);

    const result = await revokeMyLink("link_1");
    expect(result).toEqual({ success: true });
    expect(mockLinkUpdate).toHaveBeenCalledWith({
      where: { id: "link_1" },
      data: { status: "DISMISSED", dismissedBy: "user_1" },
    });
  });
});
