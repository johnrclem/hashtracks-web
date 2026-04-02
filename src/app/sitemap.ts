import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/kennels`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/hareline`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/for-misman`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/suggest`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const kennels = await prisma.kennel.findMany({
    where: { isHidden: false },
    select: { slug: true, lastEventDate: true, updatedAt: true },
  });

  const now = new Date();
  const activeDays = 90;

  const kennelPages: MetadataRoute.Sitemap = kennels.map((kennel) => {
    const daysSinceEvent = kennel.lastEventDate
      ? Math.floor((now.getTime() - kennel.lastEventDate.getTime()) / (1000 * 60 * 60 * 24))
      : Number.POSITIVE_INFINITY;
    const isActive = daysSinceEvent < activeDays;

    return {
      url: `${baseUrl}/kennels/${encodeURIComponent(kennel.slug)}`,
      lastModified: kennel.updatedAt,
      changeFrequency: isActive ? "weekly" : "monthly",
      priority: isActive ? 0.8 : 0.5,
    };
  });

  return [...staticPages, ...kennelPages];
}
