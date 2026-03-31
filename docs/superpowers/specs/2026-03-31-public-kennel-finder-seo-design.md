# Public Kennel Finder & SEO Optimization — Design Spec

## Context

Every "Is there a hash in [city]?" Facebook post (20-72 comments each in a 16.6K-member group) is a Google search that HashTracks should capture. Currently there's no sitemap, no robots.txt, no structured data, and no city-specific URLs — the site is invisible to search engines for the exact queries people ask. This feature adds the full SEO stack to the existing kennel directory and creates auto-generated region landing pages that target "hash house harriers [city]" searches.

**Target users (in priority order):**
1. Google searchers who don't know HashTracks exists
2. Traveling hashers looking for runs at a destination
3. Facebook group members who need a link to share

## 1. SEO Plumbing

### robots.txt (`src/app/robots.ts`)

Allow all crawlers. Block private routes:
- `/admin/*`
- `/api/*`
- `/misman/*`
- `/sign-in`, `/sign-up`
- `/invite/*`

Point to sitemap: `Sitemap: https://www.hashtracks.xyz/sitemap.xml`

### sitemap.xml (`src/app/sitemap.ts`)

Dynamic, generated from database on each request (Next.js convention):

- **Core pages:** `/`, `/kennels`, `/hareline` — static, high priority
- **Kennel detail pages:** `/kennels/[slug]` for all non-hidden kennels (~304 URLs). Priority based on activity status (active kennels higher).
- **Region landing pages:** `/kennels/region/[slug]` for regions with at least 1 kennel (~50 URLs). Only regions that have kennels get sitemap entries.
- **Excludes:** auth pages, admin, API routes, misman, invite

### JSON-LD Structured Data

**Kennel detail pages** — `SportsTeam` schema:
```json
{
  "@context": "https://schema.org",
  "@type": "SportsTeam",
  "name": "New York City Hash House Harriers",
  "alternateName": "NYCH3",
  "url": "https://www.hashtracks.xyz/kennels/nych3",
  "sport": "Hash House Harriers",
  "location": {
    "@type": "City",
    "name": "New York City, NY"
  },
  "foundingDate": "1978",
  "description": "Weekly Saturday runs in NYC."
}
```

Fields populated from kennel data: fullName, shortName (alternateName), slug (url), region (location), foundedYear (foundingDate), description. All optional fields omitted when null.

**Region landing pages** — `ItemList` schema:
```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "name": "Hash House Harrier Kennels in NYC",
  "numberOfItems": 11,
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "url": "https://www.hashtracks.xyz/kennels/nych3" }
  ]
}
```

**Homepage** — `WebSite` with `SearchAction`:
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "HashTracks",
  "url": "https://www.hashtracks.xyz",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://www.hashtracks.xyz/kennels?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
```

### OG Image Improvements

Kennel detail pages get a dynamic OG image (extending the existing `src/app/opengraph-image.tsx` edge pattern):

- Create `src/app/kennels/[slug]/opengraph-image.tsx`
- Content: kennel shortName (large), region, next run date or "Last run: X days ago", activity status
- Reuse existing dark background + orange accent styling

## 2. Region Landing Pages

### URL Pattern

`/kennels/region/[slug]` — e.g., `/kennels/region/nyc`, `/kennels/region/london`

The `/region/` segment prevents collision with kennel slugs at `/kennels/[slug]`.

### Which Regions Get Pages

Only regions that have at least 1 non-hidden kennel. Computed dynamically from DB — no manual list. As kennels are added to new regions, pages auto-appear in the sitemap.

### Page Structure

**Auto-generated intro** (computed from DB, not hardcoded):

Template: "[Region] has [N] active kennels [schedule summary]. Find your next trail below."

Examples:
- "New York City has 11 active kennels with runs every day of the week. Find your next trail below."
- "London has 7 active kennels running on weekdays and weekends. Find your next trail below."
- "Denver has 3 active kennels with weekly and biweekly runs. Find your next trail below."

Data sources for intro:
- Kennel count: `COUNT(*)` where region matches and activity status is active
- Schedule summary: aggregate `scheduleDayOfWeek` across region's kennels, summarize as "every day of the week" / "on weekdays and weekends" / "on Saturdays" etc.

**Below the intro:** Pre-filtered `KennelDirectory` component with the region pre-selected. All existing functionality (search, sort, map, filters) works within the region context.

### Metadata

- `<title>`: "Hash House Harriers in [Region] | HashTracks"
- `<meta description>`: The auto-generated intro text
- OpenGraph: title + description + region-specific OG image
- JSON-LD: `ItemList` (see above)

### Implementation

- Route: `src/app/kennels/region/[slug]/page.tsx`
- Server component that queries kennels for the region, computes intro, renders `KennelDirectory` with region pre-selected
- `generateStaticParams` not needed — these are dynamic server-rendered pages (data changes frequently)
- `generateMetadata` for per-region titles and descriptions

## 3. Enhanced `/kennels` Directory

### Metadata Improvements

- Description: "Browse [N] hash house harrier kennels across [M] regions on HashTracks. Find runs near you."
- Counts computed from DB at render time

### Internal Linking

Region filter chips in `KennelFilters` become `<Link>` elements pointing to `/kennels/region/[slug]` when used as single-region navigation. This gives Google crawlable paths from the directory to every region page.

The existing `?regions=` query string filtering continues to work for multi-region and combined filter scenarios. Region landing pages are the canonical single-region URL.

### No Other Changes

All existing filter/sort/map/geolocation functionality stays as-is. Auth is not required (already public).

## Files to Create/Modify

**New files:**
- `src/app/robots.ts` — robots.txt
- `src/app/sitemap.ts` — dynamic sitemap
- `src/app/kennels/region/[slug]/page.tsx` — region landing pages
- `src/app/kennels/[slug]/opengraph-image.tsx` — dynamic OG images for kennel pages
- `src/lib/seo.ts` — shared JSON-LD builders + intro text generator

**Modified files:**
- `src/app/layout.tsx` — add homepage JSON-LD (`WebSite` + `SearchAction`)
- `src/app/kennels/page.tsx` — enhanced metadata with counts, JSON-LD `ItemList`
- `src/app/kennels/[slug]/page.tsx` — add JSON-LD `SportsTeam`
- `src/components/kennels/KennelFilters.tsx` — region chips link to region pages

## Verification

- Google Rich Results Test on kennel detail page (validates JSON-LD)
- Google Rich Results Test on region landing page
- `curl -s https://www.hashtracks.xyz/robots.txt` returns expected content
- `curl -s https://www.hashtracks.xyz/sitemap.xml` returns valid XML with kennel + region URLs
- OG image renders correctly (check via og:image URL directly)
- Region page at `/kennels/region/nyc` shows intro + filtered directory
- Region page metadata visible in view-source

## Out of Scope

- Travel Mode Search (destination + date range) — separate roadmap item
- "No Kennel Here" interest registration — future feature
- Manual editorial content per region — intros are auto-generated only
- Per-event SEO pages — events are ephemeral, low SEO value
- Google Search Console setup — done manually after deploy
