# Public Kennel Finder & SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HashTracks rank for "hash house harriers [city]" searches by adding full SEO infrastructure (sitemap, robots, JSON-LD, OG images) and auto-generated region landing pages.

**Architecture:** Add SEO plumbing files (robots.ts, sitemap.ts) at the app root. Create a shared `src/lib/seo.ts` for JSON-LD builders and region intro generation. Add region landing pages at `/kennels/region/[slug]` that reuse the existing `KennelDirectory` component with pre-filtered data. Enhance existing kennel pages with structured data.

**Tech Stack:** Next.js 16 App Router (metadata API, sitemap/robots conventions), JSON-LD via `<script type="application/ld+json">`, Node runtime for OG images (not edge — Prisma requires Node), Prisma queries, ISR for region pages

---

### Task 1: robots.ts

**Files:**
- Create: `src/app/robots.ts`

- [ ] **Step 1: Create the robots.ts file**

```typescript
// src/app/robots.ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/misman/", "/sign-in", "/sign-up", "/invite/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
```

- [ ] **Step 2: Verify locally**

Run: `npm run dev` then `curl http://localhost:3000/robots.txt`
Expected: Text output with `User-agent: *`, `Allow: /`, `Disallow:` entries, and `Sitemap:` URL

- [ ] **Step 3: Commit**

```bash
git add src/app/robots.ts
git commit -m "feat: add robots.txt with sitemap reference"
```

---

### Task 2: Shared SEO Utilities

**Files:**
- Create: `src/lib/seo.ts`
- Create: `src/lib/seo.test.ts`

- [ ] **Step 1: Write tests for JSON-LD builders and intro generator**

```typescript
// src/lib/seo.test.ts
import {
  buildKennelJsonLd,
  buildRegionItemListJsonLd,
  buildWebSiteJsonLd,
  generateRegionIntro,
} from "@/lib/seo";

const BASE_URL = "https://hashtracks.xyz";

describe("buildKennelJsonLd", () => {
  it("builds SportsTeam schema with all fields", () => {
    const result = buildKennelJsonLd({
      fullName: "New York City Hash House Harriers",
      shortName: "NYCH3",
      slug: "nych3",
      region: "New York City, NY",
      foundedYear: 1978,
      description: "Weekly Saturday runs in NYC.",
      website: "https://hashnyc.com",
    }, BASE_URL);

    expect(result["@type"]).toBe("SportsTeam");
    expect(result.name).toBe("New York City Hash House Harriers");
    expect(result.alternateName).toBe("NYCH3");
    expect(result.url).toBe("https://hashtracks.xyz/kennels/nych3");
    expect(result.foundingDate).toBe("1978");
    expect(result.location["@type"]).toBe("City");
    expect(result.location.name).toBe("New York City, NY");
    expect(result.sameAs).toBe("https://hashnyc.com");
  });

  it("omits null fields", () => {
    const result = buildKennelJsonLd({
      fullName: "Test H3",
      shortName: "TH3",
      slug: "th3",
      region: "Test, TX",
      foundedYear: null,
      description: null,
      website: null,
    }, BASE_URL);

    expect(result.foundingDate).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.sameAs).toBeUndefined();
  });
});

describe("buildRegionItemListJsonLd", () => {
  it("builds ItemList with kennel URLs", () => {
    const result = buildRegionItemListJsonLd(
      "NYC",
      [{ slug: "nych3" }, { slug: "bkh3" }],
      BASE_URL,
    );

    expect(result["@type"]).toBe("ItemList");
    expect(result.numberOfItems).toBe(2);
    expect(result.itemListElement).toHaveLength(2);
    expect(result.itemListElement[0].position).toBe(1);
    expect(result.itemListElement[0].url).toBe("https://hashtracks.xyz/kennels/nych3");
  });
});

describe("buildWebSiteJsonLd", () => {
  it("builds WebSite with SearchAction", () => {
    const result = buildWebSiteJsonLd(BASE_URL);

    expect(result["@type"]).toBe("WebSite");
    expect(result.potentialAction["@type"]).toBe("SearchAction");
    expect(result.potentialAction.target).toContain("{search_term_string}");
  });
});

describe("generateRegionIntro", () => {
  it("generates intro with active kennel count and schedule summary", () => {
    const result = generateRegionIntro("New York City, NY", 11, [
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]);
    expect(result).toContain("New York City, NY");
    expect(result).toContain("11");
    expect(result).toContain("every day of the week");
  });

  it("handles single day", () => {
    const result = generateRegionIntro("Denver, CO", 3, ["Saturday"]);
    expect(result).toContain("3");
    expect(result).toContain("Saturdays");
  });

  it("handles two days", () => {
    const result = generateRegionIntro("London, UK", 5, ["Saturday", "Sunday"]);
    expect(result).toContain("Saturdays and Sundays");
  });

  it("handles no schedule data", () => {
    const result = generateRegionIntro("Test Region", 2, []);
    expect(result).not.toContain("undefined");
    expect(result).toContain("2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/seo.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/seo.ts

const CONTEXT = "https://schema.org";

// ── JSON-LD Builders ──

interface KennelJsonLdInput {
  fullName: string;
  shortName: string;
  slug: string;
  region: string;
  foundedYear: number | null;
  description: string | null;
  website: string | null;
}

export function buildKennelJsonLd(kennel: KennelJsonLdInput, baseUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "SportsTeam" as const,
    name: kennel.fullName,
    alternateName: kennel.shortName,
    url: `${baseUrl}/kennels/${kennel.slug}`,
    sport: "Hash House Harriers",
    location: {
      "@type": "City" as const,
      name: kennel.region,
    },
    ...(kennel.foundedYear ? { foundingDate: String(kennel.foundedYear) } : {}),
    ...(kennel.description ? { description: kennel.description } : {}),
    ...(kennel.website ? { sameAs: kennel.website } : {}),
  };
}

export function buildRegionItemListJsonLd(
  regionName: string,
  kennels: { slug: string }[],
  baseUrl: string,
) {
  return {
    "@context": CONTEXT,
    "@type": "ItemList" as const,
    name: `Hash House Harrier Kennels in ${regionName}`,
    numberOfItems: kennels.length,
    itemListElement: kennels.map((k, i) => ({
      "@type": "ListItem" as const,
      position: i + 1,
      url: `${baseUrl}/kennels/${k.slug}`,
    })),
  };
}

export function buildWebSiteJsonLd(baseUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "WebSite" as const,
    name: "HashTracks",
    url: baseUrl,
    description: "Discover hash house harrier runs, track attendance, and find kennels worldwide.",
    potentialAction: {
      "@type": "SearchAction" as const,
      target: `${baseUrl}/kennels?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

// ── Region Intro Generator ──

export function generateRegionIntro(
  regionName: string,
  activeKennelCount: number,
  scheduleDays: string[],
): string {
  const uniqueDays = [...new Set(scheduleDays)];
  const daysSummary = formatDaysSummary(uniqueDays);

  const kennelWord = activeKennelCount === 1 ? "kennel" : "kennels";

  if (daysSummary) {
    return `${regionName} has ${activeKennelCount} active ${kennelWord} with runs on ${daysSummary}. Find your next trail below.`;
  }
  return `${regionName} has ${activeKennelCount} active ${kennelWord}. Find your next trail below.`;
}

function formatDaysSummary(days: string[]): string {
  if (days.length === 0) return "";
  if (days.length >= 7) return "every day of the week";

  const pluralized = days.map((d) => d + "s");
  if (pluralized.length === 1) return pluralized[0];
  if (pluralized.length === 2) return `${pluralized[0]} and ${pluralized[1]}`;
  return `${pluralized.slice(0, -1).join(", ")}, and ${pluralized[pluralized.length - 1]}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/seo.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/seo.ts src/lib/seo.test.ts
git commit -m "feat: add shared SEO utilities (JSON-LD builders, region intro generator)"
```

---

### Task 3: Dynamic Sitemap

**Files:**
- Create: `src/app/sitemap.ts`

- [ ] **Step 1: Create the sitemap**

```typescript
// src/app/sitemap.ts
import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { regionSlug } from "@/lib/region";

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

  const regionPages: MetadataRoute.Sitemap = regionsWithKennels.map((r) => ({
    url: `${baseUrl}/kennels/region/${regionSlug(r.region)}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticPages, ...kennelPages, ...regionPages];
}
```

- [ ] **Step 2: Verify locally**

Run: `npm run dev` then `curl http://localhost:3000/sitemap.xml | head -30`
Expected: Valid XML with `<urlset>` containing kennel and region URLs

- [ ] **Step 3: Commit**

```bash
git add src/app/sitemap.ts
git commit -m "feat: add dynamic sitemap with kennel and region URLs"
```

---

### Task 4: JSON-LD on Homepage

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add WebSite JSON-LD to the root layout**

In `src/app/layout.tsx`, add import at top:

```typescript
import { buildWebSiteJsonLd } from "@/lib/seo";
```

Inside the `RootLayout` component, before the `return`, add:

```typescript
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  const websiteJsonLd = buildWebSiteJsonLd(baseUrl);
```

In the `<head>` section (inside the `<html>` tag, before `<body>`), add:

```tsx
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </head>
```

Note: If there's no explicit `<head>` tag in the layout, add one between `<html>` and `<body>`.

- [ ] **Step 2: Verify locally**

Run: `npm run dev`, open http://localhost:3000, view page source, search for `application/ld+json`
Expected: JSON-LD block with `@type: "WebSite"` and `SearchAction`

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: add WebSite JSON-LD with SearchAction to homepage"
```

---

### Task 5: JSON-LD on Kennel Detail Pages

**Files:**
- Modify: `src/app/kennels/[slug]/page.tsx`

- [ ] **Step 1: Add SportsTeam JSON-LD to kennel detail page**

In `src/app/kennels/[slug]/page.tsx`, add import:

```typescript
import { buildKennelJsonLd } from "@/lib/seo";
```

Inside the `KennelDetailPage` component, after the kennel query resolves, add:

```typescript
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  const kennelJsonLd = buildKennelJsonLd({
    fullName: kennel.fullName,
    shortName: kennel.shortName,
    slug: kennel.slug,
    region: kennel.region,
    foundedYear: kennel.foundedYear,
    description: kennel.description,
    website: kennel.website,
  }, baseUrl);
```

At the top of the returned JSX (first child inside the wrapping `<div>`), add:

```tsx
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(kennelJsonLd) }}
      />
```

- [ ] **Step 2: Verify locally**

Run: `npm run dev`, open a kennel page (e.g., http://localhost:3000/kennels/nych3), view page source
Expected: JSON-LD block with `@type: "SportsTeam"`, kennel name, region, URL

- [ ] **Step 3: Commit**

```bash
git add src/app/kennels/\\[slug\\]/page.tsx
git commit -m "feat: add SportsTeam JSON-LD to kennel detail pages"
```

---

### Task 6: Dynamic OG Image for Kennel Pages

**Files:**
- Create: `src/app/kennels/[slug]/opengraph-image.tsx`

- [ ] **Step 1: Create the dynamic OG image generator**

```tsx
// src/app/kennels/[slug]/opengraph-image.tsx
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { getActivityStatus } from "@/lib/activity-status";

// Must use nodejs runtime (not edge) because Prisma requires Node.js
export const runtime = "nodejs";
export const alt = "HashTracks Kennel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: {
      shortName: true,
      fullName: true,
      region: true,
      lastEventDate: true,
      scheduleDayOfWeek: true,
      scheduleFrequency: true,
    },
  });

  if (!kennel) {
    return new ImageResponse(
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#141417", color: "#ffffff", fontSize: 48 }}>
        HashTracks
      </div>,
      { ...size },
    );
  }

  const status = getActivityStatus(kennel.lastEventDate);
  const statusText = status === "active" ? "Active" : status === "possibly-inactive" ? "Possibly Inactive" : status === "inactive" ? "Inactive" : "";
  const statusColor = status === "active" ? "#4ade80" : status === "possibly-inactive" ? "#facc15" : status === "inactive" ? "#f87171" : "#71717a";
  const schedule = [kennel.scheduleFrequency, kennel.scheduleDayOfWeek].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", backgroundColor: "#141417", padding: "60px 80px" }}>
        {/* Top accent line */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: "linear-gradient(90deg, #f97316, #fb923c, #fdba74)" }} />

        {/* Kennel name */}
        <div style={{ fontSize: 72, fontWeight: 800, color: "#ffffff", letterSpacing: "-2px", lineHeight: 1 }}>
          {kennel.shortName}
        </div>

        {/* Full name */}
        <div style={{ fontSize: 28, color: "#a1a1aa", marginTop: "12px" }}>
          {kennel.fullName}
        </div>

        {/* Region + schedule */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "24px", fontSize: 22, color: "#71717a" }}>
          <span>{kennel.region}</span>
          {schedule && <span>· {schedule}</span>}
        </div>

        {/* Activity status */}
        {statusText && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "16px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: statusColor }} />
            <span style={{ fontSize: 20, color: statusColor }}>{statusText}</span>
          </div>
        )}

        {/* Footer */}
        <div style={{ position: "absolute", bottom: "40px", display: "flex", alignItems: "center", gap: "12px", fontSize: 18, color: "#71717a" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#f97316" }} />
          hashtracks.xyz
        </div>
      </div>
    ),
    { ...size },
  );
}
```

- [ ] **Step 2: Verify locally**

Run: `npm run dev`, open http://localhost:3000/kennels/nych3/opengraph-image
Expected: PNG image with NYCH3 branding, region, schedule, activity status

- [ ] **Step 3: Commit**

```bash
git add src/app/kennels/\\[slug\\]/opengraph-image.tsx
git commit -m "feat: add dynamic OG images for kennel detail pages"
```

---

### Task 7: Region Landing Pages

**Files:**
- Create: `src/app/kennels/region/[slug]/page.tsx`

- [ ] **Step 1: Create the region landing page**

```tsx
// src/app/kennels/region/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { regionBySlug, getStateGroup } from "@/lib/region";
import { getActivityStatus } from "@/lib/activity-status";
import { generateRegionIntro, buildRegionItemListJsonLd } from "@/lib/seo";
import { KennelDirectory } from "@/components/kennels/KennelDirectory";
import { PageHeader } from "@/components/layout/PageHeader";
import { FadeInSection } from "@/components/home/HeroAnimations";

// ISR: revalidate region pages every hour for fast crawl responses
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const region = regionBySlug(slug);
  if (!region) return { title: "Region · HashTracks" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  // Count active kennels for description
  const kennels = await prisma.kennel.findMany({
    where: { region: region.name, isHidden: false },
    select: { lastEventDate: true, scheduleDayOfWeek: true },
  });
  const activeCount = kennels.filter(
    (k) => getActivityStatus(k.lastEventDate) === "active",
  ).length;
  const days = kennels.map((k) => k.scheduleDayOfWeek).filter(Boolean) as string[];
  const intro = generateRegionIntro(region.name, activeCount, days);

  const title = `Hash House Harriers in ${region.name} | HashTracks`;

  const canonicalUrl = `${baseUrl}/kennels/region/${slug}`;

  return {
    title,
    description: intro,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description: intro,
      url: canonicalUrl,
    },
  };
}

export default async function RegionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const region = regionBySlug(slug);
  if (!region) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));

  const [kennels, upcomingEvents] = await Promise.all([
    prisma.kennel.findMany({
      where: { region: region.name, isHidden: false },
      orderBy: [{ fullName: "asc" }],
      select: {
        id: true,
        slug: true,
        shortName: true,
        fullName: true,
        region: true,
        country: true,
        latitude: true,
        longitude: true,
        description: true,
        foundedYear: true,
        scheduleDayOfWeek: true,
        scheduleTime: true,
        scheduleFrequency: true,
        lastEventDate: true,
      },
    }),
    prisma.event.findMany({
      where: {
        date: { gte: todayUtc },
        status: "CONFIRMED",
        kennel: { region: region.name, isHidden: false },
      },
      orderBy: { date: "asc" },
      select: { kennelId: true, date: true, title: true },
    }),
  ]);

  // Build next event map
  const nextEventMap = new Map<string, { date: Date; title: string | null }>();
  for (const event of upcomingEvents) {
    if (!nextEventMap.has(event.kennelId)) {
      nextEventMap.set(event.kennelId, { date: event.date, title: event.title });
    }
  }

  // Serialize for client
  const kennelsWithNext = kennels.map((k) => {
    const next = nextEventMap.get(k.id);
    return {
      ...k,
      stateGroup: getStateGroup(k.region),
      nextEvent: next ? { date: next.date.toISOString(), title: next.title } : null,
      lastEventDate: k.lastEventDate ? k.lastEventDate.toISOString() : null,
    };
  });

  // Compute intro
  const activeCount = kennels.filter(
    (k) => getActivityStatus(k.lastEventDate) === "active",
  ).length;
  const days = kennels.map((k) => k.scheduleDayOfWeek).filter(Boolean) as string[];
  const intro = generateRegionIntro(region.name, activeCount, days);

  // JSON-LD
  const jsonLd = buildRegionItemListJsonLd(
    region.name,
    kennels.map((k) => ({ slug: k.slug })),
    baseUrl,
  );

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <FadeInSection>
        <PageHeader
          title={`Hashing in ${region.name}`}
          description={intro}
        />
      </FadeInSection>

      <FadeInSection delay={100}>
        <Suspense>
          <KennelDirectory kennels={kennelsWithNext} />
        </Suspense>
      </FadeInSection>
    </div>
  );
}
```

- [ ] **Step 2: Verify locally**

Run: `npm run dev`, open http://localhost:3000/kennels/region/new-york-city-ny
Expected: Page with "Hashing in New York City, NY" header, intro text, filtered kennel directory

- [ ] **Step 3: Verify 404 for unknown region**

Open http://localhost:3000/kennels/region/nonexistent
Expected: 404 page

- [ ] **Step 4: Commit**

```bash
git add src/app/kennels/region/
git commit -m "feat: add region landing pages with auto-generated intros"
```

---

### Task 8: Enhanced `/kennels` Metadata + JSON-LD

**Files:**
- Modify: `src/app/kennels/page.tsx`

- [ ] **Step 1: Add JSON-LD and enhanced metadata**

In `src/app/kennels/page.tsx`, add import:

```typescript
import { buildRegionItemListJsonLd } from "@/lib/seo";
```

Update the `generateMetadata` function to include kennel count when no region filter:

Replace the fallback return at the end of `generateMetadata`:
```typescript
  return {
    title: "Kennels | HashTracks",
    description: "Browse hash house harrier kennels across all regions on HashTracks.",
  };
```
With:
```typescript
  return {
    title: "Kennel Directory | HashTracks",
    description: "Browse hash house harrier kennels across all regions on HashTracks. Find runs near you.",
  };
```

In the `KennelsPage` component, after the `kennelsWithNext` serialization, add:

```typescript
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  const directoryJsonLd = buildRegionItemListJsonLd(
    "All Regions",
    kennels.slice(0, 100).map((k) => ({ slug: k.slug })),
    baseUrl,
  );
```

At the top of the returned JSX (first child inside the wrapping `<div>`), add:

```tsx
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(directoryJsonLd) }}
      />
```

- [ ] **Step 2: Verify locally**

View page source at http://localhost:3000/kennels
Expected: JSON-LD `ItemList` block, updated title and description in `<head>`

- [ ] **Step 3: Commit**

```bash
git add src/app/kennels/page.tsx
git commit -m "feat: add JSON-LD and enhanced metadata to kennel directory"
```

---

### Task 9: Region Chips Link to Landing Pages

**Files:**
- Modify: `src/components/kennels/KennelFilters.tsx`

- [ ] **Step 1: Make region filter chips link to region pages**

In `src/components/kennels/KennelFilters.tsx`, add import:

```typescript
import Link from "next/link";
import { regionSlug as toRegionSlug } from "@/lib/region";
```

After the "Clear filters" button (at the end of the component's JSX, before the closing `</div>`), add a section that renders region page links when no filters are active:

Actually — the spec says region chips in the filter bar become links. But the filter bar uses a Popover for region selection, not chips. The `RegionQuickChips` component in `KennelDirectory.tsx` is the better place for this.

Revise: In `src/components/kennels/KennelDirectory.tsx`, find the `RegionQuickChips` usage. The chips currently call `onRegionsChange` to filter client-side. We want them to also function as links for SEO.

The simplest approach: add a small "Browse by region" section below the directory that renders `<Link>` elements to region pages. This gives Google crawlable links without changing the existing filter UX.

In `src/app/kennels/page.tsx`, after the `<KennelDirectory>` component, add a section:

```tsx
      {/* SEO: Crawlable links to region pages */}
      <FadeInSection delay={200}>
        <div className="mt-8 border-t pt-6">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Browse by Region</h2>
          <div className="flex flex-wrap gap-2">
            {Array.from(new Set(kennels.map((k) => k.region))).sort().map((region) => {
              const slug = toRegionSlug(region);
              return (
                <Link
                  key={region}
                  href={`/kennels/region/${slug}`}
                  className="rounded-md border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  {region}
                </Link>
              );
            })}
          </div>
        </div>
      </FadeInSection>
```

Add import for `Link` and `regionSlug` (as `toRegionSlug`) at the top of the file:

```typescript
import Link from "next/link";
import { getStateGroup, regionAbbrev, regionSlug as toRegionSlug } from "@/lib/region";
```

Note: `Link` may already be imported — check first and don't duplicate.

- [ ] **Step 2: Verify locally**

Open http://localhost:3000/kennels, scroll to bottom
Expected: "Browse by Region" section with clickable links to `/kennels/region/[slug]`

- [ ] **Step 3: Verify links work**

Click a region link (e.g., "New York City, NY")
Expected: Navigates to `/kennels/region/new-york-city-ny` with filtered content

- [ ] **Step 4: Commit**

```bash
git add src/app/kennels/page.tsx
git commit -m "feat: add 'Browse by Region' links for SEO crawlability"
```

---

### Task 10: Verification & Final Checks

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run src/lib/seo.test.ts && npm test`
Expected: All new tests pass, no regressions

- [ ] **Step 2: Validate robots.txt**

Run: `curl http://localhost:3000/robots.txt`
Expected: Correct allow/disallow rules and sitemap URL

- [ ] **Step 3: Validate sitemap**

Run: `curl http://localhost:3000/sitemap.xml | grep -c '<url>'`
Expected: 350+ URLs (304 kennels + ~50 regions + 3 core pages)

- [ ] **Step 4: Validate JSON-LD with Google Rich Results Test**

Test URLs:
- http://localhost:3000 → WebSite schema
- http://localhost:3000/kennels/nych3 → SportsTeam schema
- http://localhost:3000/kennels/region/new-york-city-ny → ItemList schema

- [ ] **Step 5: Check OG image**

Open http://localhost:3000/kennels/nych3/opengraph-image
Expected: PNG image with NYCH3 branding

- [ ] **Step 6: Commit design docs**

```bash
git add docs/superpowers/specs/2026-03-31-public-kennel-finder-seo-design.md docs/superpowers/plans/2026-03-31-public-kennel-finder-seo.md
git commit -m "docs: add public kennel finder SEO design spec and plan"
```
