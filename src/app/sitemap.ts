import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { regionNameToSlug, regionBySlug } from "@/lib/region";

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
      select: { slug: true, region: true, lastEventDate: true, updatedAt: true },
    }),
    prisma.event.findMany({
      where: {
        date: { gte: now },
        status: { not: "CANCELLED" },
        isCanonical: true,
        // #1560 PR F — NO `parentEventId: null` filter. Series children have
        // their own detail pages (`/hareline/[eventId]`) post-PR E.6, so they
        // belong in the sitemap. Including them helps search engines index
        // per-day trail pages (Strawberry Moon Trail, NYC Pride Watch Party!,
        // etc.) rather than only the umbrella parent.
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

  // Region landing pages (`/kennels/region/{slug}`) — derived from the
  // kennels query above rather than a separate query. Two guards:
  //  1. Not every `region` string resolves to a slug (`regionNameToSlug`
  //     returns null for freeform/legacy values) — those are skipped.
  //  2. The region page filters kennels by the EXACT canonical name
  //     (`where: { region: region.name }` in kennels/region/[slug]/page.tsx),
  //     but `regionNameToSlug` also maps ALIAS strings to the canonical slug
  //     (e.g. "Brasília, Brazil" → "brasilia"). A kennel stored under an
  //     alias-only region would advertise a slug whose page renders zero
  //     kennels — a thin/empty page, the opposite of what this sitemap is
  //     for. So only emit a slug when a visible kennel actually stores the
  //     canonical name the page queries by (`regionBySlug(slug).name`).
  const storedRegionNames = new Set(kennels.map((kennel) => kennel.region));
  const regionSlugs = new Set<string>();
  for (const name of storedRegionNames) {
    const slug = regionNameToSlug(name);
    if (slug && regionBySlug(slug)?.name === name) {
      regionSlugs.add(slug);
    }
  }
  // Sort so the emitted order is stable across regenerations — the kennels
  // query has no `orderBy`, so without this the Set's insertion order (and
  // thus the sitemap output) could vary between builds, producing noisy
  // sitemap diffs / cache churn even when the URL set is unchanged.
  const regionPages: MetadataRoute.Sitemap = [...regionSlugs]
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => ({
      url: `${baseUrl}/kennels/region/${slug}`,
      changeFrequency: "weekly",
      priority: 0.7,
    }));

  return [...staticPages, ...kennelPages, ...eventPages, ...regionPages];
}
