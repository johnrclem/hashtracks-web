import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findMany: vi.fn(), groupBy: vi.fn() },
    event: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import {
  buildSitemapIndexXml,
  buildUrlsetXml,
  loadSitemapSection,
  regionSlugsWithKennels,
  SITEMAP_HEADERS,
  sitemapSectionPath,
} from "./sitemap";

const BASE = "https://www.hashtracks.xyz";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.kennel.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.event.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.kennel.groupBy).mockResolvedValue([] as never);
});

describe("sitemap index", () => {
  it("lists the four sections", () => {
    const xml = buildSitemapIndexXml(BASE);
    expect(xml).toContain("<sitemapindex");
    for (const s of ["static", "kennels", "regions", "events"]) {
      expect(xml).toContain(`<loc>${BASE}/sitemap-${s}.xml</loc>`);
    }
  });

  it("is cached by the CDN for well under an hour, not by browsers", () => {
    expect(SITEMAP_HEADERS["Cache-Control"]).toContain("max-age=0");
    const cdn = SITEMAP_HEADERS["Vercel-CDN-Cache-Control"];
    const maxAge = Number(/max-age=(\d+)/.exec(cdn)?.[1]);
    const swr = Number(/stale-while-revalidate=(\d+)/.exec(cdn)?.[1]);
    expect(maxAge + swr).toBeLessThan(3600);
  });

  it("serves sections from the site root, so they may list any site URL", () => {
    expect(sitemapSectionPath("events")).toBe("/sitemap-events.xml");
  });
});

describe("buildUrlsetXml", () => {
  it("escapes XML and writes day-precision lastmod", () => {
    const xml = buildUrlsetXml(BASE, [
      { path: "/a?b=1&c=2", lastModified: new Date("2026-11-25T18:00:00Z") },
      { path: "/kennels" },
    ]);
    expect(xml).toContain(`<url><loc>${BASE}/a?b=1&amp;c=2</loc><lastmod>2026-11-25</lastmod></url>`);
    expect(xml).toContain(`<url><loc>${BASE}/kennels</loc></url>`);
  });
});

describe("kennels section", () => {
  it("leaves out hidden, listing-only and stopped kennels", async () => {
    await loadSitemapSection("kennels");
    const args = vi.mocked(prisma.kennel.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ isHidden: false, listingOnly: false, stoppedAt: null });
  });
});

describe("regions section", () => {
  it("needs two kennels and percent-encodes non-ASCII slugs", async () => {
    vi.mocked(prisma.kennel.groupBy).mockResolvedValue([
      { region: "Zürich", _count: { _all: 2 } },
      { region: "London", _count: { _all: 3 } },
      { region: "Glasgow", _count: { _all: 1 } },
    ] as never);
    const entries = await loadSitemapSection("regions");
    expect(entries.map((e) => e.path)).toEqual(["/kennels/region/london", "/kennels/region/z%C3%BCrich"]);
  });

  it("skips names that are not a region's canonical name", () => {
    expect(regionSlugsWithKennels([{ name: "Not A Region", count: 5 }], 2)).toEqual([]);
  });
});

describe("events section", () => {
  it("asks for confirmed, posted (not schedule-only) runs in the next 90 days", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "e1", updatedAt: new Date("2026-11-20T00:00:00Z") },
    ] as never);
    const entries = await loadSitemapSection("events", new Date("2026-11-25T03:00:00Z"));
    expect(entries).toEqual([{ path: "/hareline/e1", lastModified: new Date("2026-11-20T00:00:00Z") }]);

    const args = vi.mocked(prisma.event.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({
      status: "CONFIRMED",
      isCanonical: true,
      isScheduleOnly: false,
      isManualEntry: { not: true },
      kennel: { isHidden: false, listingOnly: false, stoppedAt: null },
      date: {
        gte: new Date("2026-11-25T12:00:00Z"),
        lt: new Date("2027-02-23T12:00:00Z"),
      },
    });
  });
});
