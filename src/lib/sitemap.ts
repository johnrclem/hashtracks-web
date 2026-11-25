import { prisma } from "@/lib/db";
import { getTodayUtcNoon, toIsoDateString } from "@/lib/date";
import { DISPLAYABLE_EVENT_NO_PARENT_WHERE } from "@/lib/event-filters";
import { DAY_MS } from "@/lib/kennel-status";
import { regionBySlug, regionNameToSlug, regionPath } from "@/lib/region";
import { getCanonicalSiteUrl } from "@/lib/site-url";

/**
 * The sitemap index (`/sitemap.xml`) and its four sections
 * (`/sitemap-{section}.xml`, at the root: a sitemap only covers URLs at or
 * below its own directory). Served by route handlers that run per request
 * and are cached at the CDN for at most an hour (see `SITEMAP_HEADERS`), so a
 * new event reaches the sitemap within the hour without a deploy.
 */

export const SITEMAP_SECTIONS = ["static", "kennels", "regions", "events"] as const;
export type SitemapSection = (typeof SITEMAP_SECTIONS)[number];

export interface SitemapEntry {
  /** Site-relative path, already percent-encoded. */
  path: string;
  lastModified?: Date;
}

/** Events this many days ahead go in the sitemap (owner decision D5). */
export const SITEMAP_EVENT_DAYS = 90;
/** The sitemap protocol's per-file URL limit. */
const SITEMAP_MAX_URLS = 50_000;
/** A region page earns a sitemap entry only with this many listed kennels. */
export const SITEMAP_REGION_MIN_KENNELS = 2;

/**
 * Kennels whose pages are meant for the index: visible, not listing-only
 * (those pages are noindex), and not marked STOPPED.
 */
export const SITEMAP_KENNEL_WHERE = {
  isHidden: false,
  listingOnly: false,
  stoppedAt: null,
} as const;

/**
 * Vercel's CDN keeps a section for 30 minutes and may serve it 10 minutes
 * stale while it refetches, so content is never more than ~40 minutes old.
 * Browsers and crawlers always revalidate.
 */
export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "max-age=1800, stale-while-revalidate=600",
} as const;

export function sitemapSectionPath(section: SitemapSection): string {
  return `/sitemap-${section}.xml`;
}

/** Route handler body shared by the four `/sitemap-{section}.xml` routes. */
export async function sitemapSectionResponse(section: SitemapSection): Promise<Response> {
  const entries = await loadSitemapSection(section);
  return new Response(buildUrlsetXml(getCanonicalSiteUrl(), entries), { headers: SITEMAP_HEADERS });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlDocument(root: "sitemapindex" | "urlset", items: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...items,
    `</${root}>`,
    "",
  ].join("\n");
}

export function buildSitemapIndexXml(baseUrl: string): string {
  return xmlDocument(
    "sitemapindex",
    SITEMAP_SECTIONS.map(
      (section) => `<sitemap><loc>${escapeXml(baseUrl + sitemapSectionPath(section))}</loc></sitemap>`,
    ),
  );
}

export function buildUrlsetXml(baseUrl: string, entries: SitemapEntry[]): string {
  return xmlDocument(
    "urlset",
    entries.map((entry) => {
      const lastmod = entry.lastModified ? `<lastmod>${toIsoDateString(entry.lastModified)}</lastmod>` : "";
      return `<url><loc>${escapeXml(baseUrl + entry.path)}</loc>${lastmod}</url>`;
    }),
  );
}

const STATIC_PATHS = ["/", "/kennels", "/hareline", "/about", "/for-misman", "/suggest"];

async function kennelEntries(): Promise<SitemapEntry[]> {
  const kennels = await prisma.kennel.findMany({
    where: SITEMAP_KENNEL_WHERE,
    select: { slug: true, updatedAt: true },
    orderBy: { slug: "asc" },
  });
  return kennels.map((k) => ({
    path: `/kennels/${encodeURIComponent(k.slug)}`,
    lastModified: k.updatedAt,
  }));
}

/**
 * Region slugs to list, from the stored `Kennel.region` names. The region page
 * filters kennels by the exact canonical name, so a name that is only an alias
 * of the canonical one would advertise an empty page; those are skipped.
 */
export function regionSlugsWithKennels(
  regions: { name: string; count: number }[],
  minKennels: number,
): string[] {
  const slugs = new Set<string>();
  for (const { name, count } of regions) {
    if (count < minKennels) continue;
    const slug = regionNameToSlug(name);
    if (slug && regionBySlug(slug)?.name === name) slugs.add(slug);
  }
  return [...slugs].sort((a, b) => a.localeCompare(b));
}

/**
 * Region pages worth indexing (and linking from the homepage): at least
 * SITEMAP_REGION_MIN_KENNELS indexable kennels, sorted by slug.
 */
export async function listIndexedRegions(): Promise<{ slug: string; name: string }[]> {
  const groups = await prisma.kennel.groupBy({
    by: ["region"],
    where: SITEMAP_KENNEL_WHERE,
    _count: { _all: true },
  });
  return regionSlugsWithKennels(
    groups.map((g) => ({ name: g.region, count: g._count._all })),
    SITEMAP_REGION_MIN_KENNELS,
  ).map((slug) => ({ slug, name: regionBySlug(slug)?.name ?? slug }));
}

/**
 * Confirmed runs in the next 90 days that a real source posted. Schedule-only
 * projections are left out (their pages are noindex). Series children keep
 * their own entries: each has its own detail page.
 */
async function eventEntries(now: Date): Promise<SitemapEntry[]> {
  const today = getTodayUtcNoon(now);
  const events = await prisma.event.findMany({
    where: {
      // The public-visibility contract (canonical, no private manual entries),
      // narrowed to confirmed runs and indexable kennels.
      ...DISPLAYABLE_EVENT_NO_PARENT_WHERE,
      date: { gte: new Date(today), lt: new Date(today + SITEMAP_EVENT_DAYS * DAY_MS) },
      status: "CONFIRMED",
      isScheduleOnly: false,
      kennel: SITEMAP_KENNEL_WHERE,
    },
    select: { id: true, updatedAt: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: SITEMAP_MAX_URLS,
  });
  return events.map((e) => ({ path: `/hareline/${e.id}`, lastModified: e.updatedAt }));
}

export async function loadSitemapSection(
  section: SitemapSection,
  now: Date = new Date(),
): Promise<SitemapEntry[]> {
  switch (section) {
    case "static":
      return STATIC_PATHS.map((path) => ({ path }));
    case "kennels":
      return kennelEntries();
    case "regions":
      return (await listIndexedRegions()).map(({ slug }) => ({ path: regionPath(slug) }));
    case "events":
      return eventEntries(now);
  }
}
