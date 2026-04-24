import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    event: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { selfHealSanitizers } from "./audit-runner";
import { sanitizeHares, sanitizeLocation } from "./merge";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe("merge sanitizers — regression coverage for recurring audit rules", () => {
  it("sanitizeLocation strips trailing contact-CTA paren (location-phone-number, SWH3 #910)", () => {
    expect(
      sanitizeLocation("Casa De Assover – Raleigh, NC (text Assover at 919-332-2615 for address)"),
    ).toBe("Casa De Assover – Raleigh, NC");
  });

  it("sanitizeLocation nulls email-CTA locations (location-email-cta, ABQ H3 #908)", () => {
    expect(sanitizeLocation("Inquire for location: abqh3misman@gmail.com")).toBeNull();
  });

  it("sanitizeHares nulls 'On On Q' boilerplate (hare-boilerplate-leak, BFMH3 #909)", () => {
    expect(sanitizeHares("On On Q")).toBeNull();
  });
});

describe("selfHealSanitizers", () => {
  it("updates locationName when the sanitizer output differs", async () => {
    const original = "Casa De Assover – Raleigh, NC (text Assover at 919-332-2615 for address)";
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "evt-swh3", locationName: original, haresText: null },
    ] as never);

    const result = await selfHealSanitizers();

    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-swh3", locationName: original },
      data: { locationName: "Casa De Assover – Raleigh, NC" },
    });
    expect(result).toEqual({ scanned: 1, locationHealed: 1, haresHealed: 0 });
  });

  it("writes null when sanitizeLocation rejects the whole value (email CTA)", async () => {
    const original = "Inquire for location: abqh3misman@gmail.com";
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "evt-abq", locationName: original, haresText: null },
    ] as never);

    const result = await selfHealSanitizers();

    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-abq", locationName: original },
      data: { locationName: null },
    });
    expect(result.locationHealed).toBe(1);
  });

  it("writes null when sanitizeHares rejects boilerplate ('On On Q')", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "evt-bfmh3", locationName: null, haresText: "On On Q" },
    ] as never);

    const result = await selfHealSanitizers();

    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-bfmh3", haresText: "On On Q" },
      data: { haresText: null },
    });
    expect(result).toEqual({ scanned: 1, locationHealed: 0, haresHealed: 1 });
  });

  it("does not issue an update when sanitizer output matches current value", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      {
        id: "evt-clean",
        locationName: "Central Park, New York, NY",
        haresText: "Assover, Slippery Pete",
      },
    ] as never);

    const result = await selfHealSanitizers();

    expect(prisma.event.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 1, locationHealed: 0, haresHealed: 0 });
  });

  it("heals empty-string values that slip past the non-null filter", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "evt-empty", locationName: "", haresText: null },
    ] as never);

    const result = await selfHealSanitizers();

    // sanitizeLocation("") returns null; the empty-string branch must run
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { id: "evt-empty", locationName: "" },
      data: { locationName: null },
    });
    expect(result.locationHealed).toBe(1);
  });

  it("skips the stat bump when a concurrent write made updateMany a no-op", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "evt-raced", locationName: "Inquire for location: x@y.com", haresText: null },
    ] as never);
    vi.mocked(prisma.event.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const result = await selfHealSanitizers();

    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ scanned: 1, locationHealed: 0, haresHealed: 0 });
  });

  it("batches both field updates into a single write when both need healing", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      {
        id: "evt-both",
        locationName: "Inquire for location: test@example.com",
        haresText: "On On Q",
      },
    ] as never);

    const result = await selfHealSanitizers();

    expect(prisma.event.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: {
        id: "evt-both",
        locationName: "Inquire for location: test@example.com",
        haresText: "On On Q",
      },
      data: { locationName: null, haresText: null },
    });
    expect(result).toEqual({ scanned: 1, locationHealed: 1, haresHealed: 1 });
  });

  it("queries the 7-back / 90-forward window with CONFIRMED filter and non-null OR", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([] as never);

    await selfHealSanitizers();

    const arg = vi.mocked(prisma.event.findMany).mock.calls[0][0]!;
    const where = arg.where as {
      date: { gte: Date; lte: Date };
      status: string;
      OR: { locationName?: { not: null }; haresText?: { not: null } }[];
    };

    expect(where.status).toBe("CONFIRMED");
    expect(where.OR).toEqual([
      { locationName: { not: null } },
      { haresText: { not: null } },
    ]);

    const now = Date.now();
    const gte = where.date.gte.getTime();
    const lte = where.date.lte.getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    // ~7 days back (tolerate clock skew between setup and assertion)
    expect(now - gte).toBeGreaterThan(6 * oneDay);
    expect(now - gte).toBeLessThan(8 * oneDay);
    // ~90 days forward
    expect(lte - now).toBeGreaterThan(89 * oneDay);
    expect(lte - now).toBeLessThan(91 * oneDay);
  });
});
