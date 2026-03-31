import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { regionNameToSlug } from "@/lib/region";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  // Core pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/kennels`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/hareline`, changeFrequency: "daily", priority: 0.9 },
  ];

  // Kennel detail pages
  const kennels = await prisma.kennel.findMany({
    where: { isHidden: false },
    select: { slug: true, lastEventDate: true, updatedAt: true },
  });

  const now = new Date();
  const ACTIVE_DAYS = 90;

  const kennelPages: MetadataRoute.Sitemap = kennels.map((k) => {
    const daysSinceEvent = k.lastEventDate
      ? Math.floor((now.getTime() - k.lastEventDate.getTime()) / (1000 * 60 * 60 * 24))
      : Infinity;
    const isActive = daysSinceEvent < ACTIVE_DAYS;

    return {
      url: `${baseUrl}/kennels/${k.slug}`,
      lastModified: k.updatedAt,
      changeFrequency: isActive ? "weekly" : "monthly",
      priority: isActive ? 0.8 : 0.5,
    };
  });

  // Region landing pages — only regions that have at least 1 kennel
  const regionsWithKennels = await prisma.kennel.groupBy({
    by: ["region"],
    where: { isHidden: false },
    _count: true,
  });

  // Deduplicate and filter to regions with valid landing page slugs
  const seenSlugs = new Set<string>();
  const regionPages: MetadataRoute.Sitemap = [];
  for (const r of regionsWithKennels) {
    const slug = regionNameToSlug(r.region);
    if (slug && !seenSlugs.has(slug)) {
      seenSlugs.add(slug);
      regionPages.push({
        url: `${baseUrl}/kennels/region/${slug}`,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return [...staticPages, ...kennelPages, ...regionPages];
}
