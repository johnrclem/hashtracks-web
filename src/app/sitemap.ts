import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { getBaseUrl } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/hareline`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/kennels`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/for-misman`, changeFrequency: "monthly", priority: 0.4 },
  ];

  // Kennel pages
  const kennels = await prisma.kennel.findMany({
    where: { isHidden: false },
    select: { slug: true, updatedAt: true },
  });
  const kennelPages: MetadataRoute.Sitemap = kennels.map((k) => ({
    url: `${baseUrl}/kennels/${k.slug}`,
    lastModified: k.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // Event pages — future + recent past (90 days) to keep sitemap manageable
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const events = await prisma.event.findMany({
    where: {
      status: { not: "CANCELLED" },
      parentEventId: null,
      date: { gte: cutoff },
      kennel: { isHidden: false },
    },
    select: { id: true, updatedAt: true },
    orderBy: { date: "desc" },
  });
  const eventPages: MetadataRoute.Sitemap = events.map((e) => ({
    url: `${baseUrl}/hareline/${e.id}`,
    lastModified: e.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...kennelPages, ...eventPages];
}
