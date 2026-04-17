import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { getCanonicalSiteUrl } from "@/lib/site-url";

// Regenerate at most once per hour. Avoids hitting the DB on every crawler request.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getCanonicalSiteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "daily", priority: 1.0 },
    { url: `${baseUrl}/kennels`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/hareline`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/for-misman`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/suggest`, changeFrequency: "monthly", priority: 0.5 },
  ];

  const now = new Date();
  const activeDays = 90;

  const [kennels, upcomingEvents] = await Promise.all([
    prisma.kennel.findMany({
      where: { isHidden: false },
      select: { slug: true, lastEventDate: true, updatedAt: true },
    }),
    prisma.event.findMany({
      where: {
        date: { gte: now },
        status: { not: "CANCELLED" },
        isCanonical: true,
        parentEventId: null,
        kennel: { isHidden: false },
      },
      select: { id: true, updatedAt: true },
      orderBy: { date: "asc" },
      take: 5000,
    }),
  ]);

  const kennelPages: MetadataRoute.Sitemap = kennels.map((kennel) => {
    const daysSinceEvent = kennel.lastEventDate
      ? Math.floor((now.getTime() - kennel.lastEventDate.getTime()) / (1000 * 60 * 60 * 24))
      : Number.POSITIVE_INFINITY;
    const isActive = daysSinceEvent < activeDays;

    return {
      url: `${baseUrl}/kennels/${encodeURIComponent(kennel.slug)}`,
      lastModified: kennel.updatedAt.toISOString().split("T")[0],
      changeFrequency: isActive ? "weekly" : "monthly",
      priority: isActive ? 0.8 : 0.5,
    };
  });

  const eventPages: MetadataRoute.Sitemap = upcomingEvents.map((event) => ({
    url: `${baseUrl}/hareline/${event.id}`,
    lastModified: event.updatedAt.toISOString().split("T")[0],
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticPages, ...kennelPages, ...eventPages];
}
