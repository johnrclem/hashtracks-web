import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMisman = { id: "misman_1", email: "misman@test.com" };

vi.mock("@/lib/auth", () => ({
  getMismanUser: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getMismanUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { updateKennelSettings } from "./actions";

function buildFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

describe("updateKennelSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when user is not authorized", async () => {
    vi.mocked(getMismanUser).mockResolvedValue(null);

    const result = await updateKennelSettings("kennel_1", buildFormData());

    expect(result).toEqual({ error: "Not authorized" });
    expect(prisma.kennel.update).not.toHaveBeenCalled();
  });

  it("returns error when kennel is not found", async () => {
    vi.mocked(getMismanUser).mockResolvedValue(mockMisman as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue(null);

    const result = await updateKennelSettings("kennel_1", buildFormData());

    expect(result).toEqual({ error: "Kennel not found" });
    expect(prisma.kennel.update).not.toHaveBeenCalled();
  });

  it("updates kennel with correct fields and revalidates", async () => {
    vi.mocked(getMismanUser).mockResolvedValue(mockMisman as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ slug: "test-h3" } as never);
    vi.mocked(prisma.kennel.update).mockResolvedValue({} as never);

    const fd = buildFormData({
      description: "A great kennel",
      website: "https://testh3.com",
      scheduleDayOfWeek: "Monday",
      instagramHandle: "@testh3",
      foundedYear: "2005",
      dogFriendly: "true",
    });

    const result = await updateKennelSettings("kennel_1", fd);

    expect(result).toEqual({ success: true });
    expect(prisma.kennel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "kennel_1" },
        data: expect.objectContaining({
          description: "A great kennel",
          website: "https://testh3.com",
          scheduleDayOfWeek: "Monday",
          instagramHandle: "@testh3",
          foundedYear: 2005,
          dogFriendly: true,
        }),
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/kennels/test-h3");
    expect(revalidatePath).toHaveBeenCalledWith("/misman/test-h3/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/kennels");
  });

  it("rejects javascript: URLs to prevent XSS", async () => {
    vi.mocked(getMismanUser).mockResolvedValue(mockMisman as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ slug: "test-h3" } as never);
    vi.mocked(prisma.kennel.update).mockResolvedValue({} as never);

    const fd = buildFormData({
      website: "javascript:alert(1)",
      facebookUrl: "data:text/html,<script>alert(1)</script>",
      paymentLink: "https://venmo.com/testh3",
    });

    await updateKennelSettings("kennel_1", fd);

    const updateCall = vi.mocked(prisma.kennel.update).mock.calls[0][0];
    expect(updateCall.data.website).toBeNull();
    expect(updateCall.data.facebookUrl).toBeNull();
    expect(updateCall.data.paymentLink).toBe("https://venmo.com/testh3");
  });

  it("rejects out-of-range foundedYear values", async () => {
    vi.mocked(getMismanUser).mockResolvedValue(mockMisman as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ slug: "test-h3" } as never);
    vi.mocked(prisma.kennel.update).mockResolvedValue({} as never);

    const fd = buildFormData({ foundedYear: "9999" });

    await updateKennelSettings("kennel_1", fd);

    const updateCall = vi.mocked(prisma.kennel.update).mock.calls[0][0];
    expect(updateCall.data.foundedYear).toBeNull();
  });

  it("returns error when database update fails", async () => {
    vi.mocked(getMismanUser).mockResolvedValue(mockMisman as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValue({ slug: "test-h3" } as never);
    vi.mocked(prisma.kennel.update).mockRejectedValue(new Error("DB connection lost"));

    const result = await updateKennelSettings("kennel_1", buildFormData());

    expect(result).toEqual({ error: "Unable to update kennel settings" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
