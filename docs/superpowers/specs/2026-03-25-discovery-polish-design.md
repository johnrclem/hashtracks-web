# Phase 1: Discovery Polish — Design Spec

**Date:** 2026-03-25
**Goal:** Make the first 30 seconds amazing for new hashers — someone lands on HashTracks, quickly finds runs near them, and thinks "this is useful."
**Context:** HashTracks has 141 live sources, 188 kennels, and all major features shipped. The next priority is user growth. Run discovery is the primary hook; reminders/social retain; tracking rewards power users. This phase polishes the discovery experience before active promotion begins.

---

## 1. Map Stacking & Clustering Fixes

### Problem
- Events at the same venue share identical lat/lng and stack directly on top of each other — only the top pin is clickable.
- Cluster click behavior just zooms in. When multiple events are co-located (same coords), zooming can never separate them.
- Default Google MarkerClusterer blue circles don't match the brand.

### Solution

#### 1a. Co-located event grouping
Detect events sharing identical coordinates (within ~0.0001 tolerance). Render as a single "stacked" pin with a count badge (e.g., "3"). Click opens a list popover showing all events at that location — user picks one to select.

**Behavior:**
- Group events by rounded lat/lng (4 decimal places = ~11m tolerance)
- Single event at a location: render as normal pin
- Multiple events: render as a single pin with count badge overlay
- Click stacked pin: show popover/dropdown listing event date, kennel, title for each
- Select from list: highlights that event in the side panel (desktop) or navigates to detail (mobile)

**Implementation layer ordering:** Co-location grouping must happen *before* marker registration with `MarkerClusterer`. The flow is: (1) compute co-located groups from the events array, (2) render each group as a single `AdvancedMarker` (with count badge if group size > 1), (3) register those grouped markers with `MarkerClusterer`. This replaces the current pattern in `ClusteredMarkers.tsx` where every event gets its own marker. Maintain a `Map<AdvancedMarkerElement, EventWithCoords[]>` reverse lookup so click handlers can access the full event list for any marker or cluster.

#### 1b. Custom cluster renderer
Replace default blue Google clusters with branded styling:
- Neutral dark background (slate-800) with white count label
- Size scales with count (small/medium/large tiers)
- Matches app typography (JetBrains Mono for count, Outfit for labels)

#### 1c. Smart cluster click: zoom vs. list
- If cluster contains events that would separate at higher zoom levels: zoom in (default behavior)
- If cluster contains co-located events (all same coords): show list popover instead of zooming endlessly

**Implementation:** Provide a custom `onClusterClick` callback to the `MarkerClusterer` constructor. On click, use the reverse lookup map (from 1a) to collect all `EventWithCoords[]` for every marker in the clicked cluster. Check if all events share the same rounded coordinates — if so, show the list popover directly. If coordinates differ, perform the default zoom behavior. This avoids the unreliable "zoom and check if count changed" heuristic.

---

## 2. Region Drill-Down & Map Navigation

### Problem
- Clicking a cluster on the hareline map just zooms — no way to see "all events in this region."
- Kennel map has region aggregate pins with `onRegionSelect()` (filters to that region) — hareline map has no equivalent.
- No cross-linking between hareline map regions and kennel directory.

### Solution

#### 2a. Hareline map: cluster → region filter
When a user clicks a cluster that maps to a known region:
- Apply that region as a filter (update URL params)
- Show feedback: "Showing events in {region}" as a brief badge or the filter chip activating
- If cluster spans multiple regions, zoom in instead

**Detection logic:** Use the `Map<AdvancedMarkerElement, EventWithCoords[]>` reverse lookup (from Section 1a) to collect event objects from the cluster's markers. Check if all events share the same region (via `event.kennel?.region`). If so, treat as a region cluster and apply the region filter. If mixed, treat as geographic proximity cluster (zoom behavior).

#### 2b. Cross-link hareline and kennel directory
- On the hareline map, when a region filter is active, show a subtle link: "View {region} kennels" that navigates to `/kennels?regions={region}`
- On the kennel directory, when region-filtered, show: "View upcoming events in {region}" linking to `/hareline?regions={region}`

#### 2c. Shareable region URLs
Already implemented (`/hareline?regions=NYC`, `/kennels?regions=NYC`). Ensure these work as entry points:
- Region name in URL resolves correctly (case-insensitive, alias-aware)
- Page shows a clear scoping header: "Events in New York City" or "Kennels in London"
- Include region in page title for browser tabs and social sharing

---

## 3. Filter UX Improvements

### Problem
- New users see all events globally — no location-aware defaults.
- Region filter is a popover with search — powerful but not discoverable for first-time users.
- "Near Me" requires explicit opt-in; no prompt to use it.
- Empty states are minimal with no actionable guidance.

### Solution

#### 3a. Location-aware defaults
On first visit (no URL params, no stored preference):
1. Show a non-blocking prompt: "Find runs near you" with two options:
   - "Share location" (triggers geolocation, sets Near Me 50km)
   - "Pick a region" (opens region picker)
2. Store choice in localStorage as a single `hashtracks:locationPref` object:
   - `{ type: "nearMe", distance: 50 }` — if they shared location
   - `{ type: "region", name: "NYC" }` — if they picked a region
3. On return visits without URL params, restore stored preference
4. User can always clear/change via filter controls

**Preference precedence** (highest to lowest):
1. Explicit URL params (shared links always win)
2. `hashtracks:locationPref` (user's deliberate choice from first-visit prompt or most recent change)

Only one localStorage key is needed — the preference updates whenever the user changes their location context (Near Me toggle, region filter change, etc.). No separate "last region" tracking.

**Key constraint:** This must be non-blocking. If user dismisses, they see all events (current default). No modal gates.

**Pure function for testing:** Extract a `resolveLocationDefault(urlParams: URLSearchParams, storedPref: LocationPref | null): LocationDefault` function that can be unit-tested without mocking the browser.

#### 3b. Prominent region quick-chips
Show top regions as tappable chips directly in the filter bar:
- Display 4-6 most-populated regions as chips (e.g., "NYC", "Boston", "London", "Chicago", "DMV", "SF Bay")
- Tap to toggle filter (same as selecting in region popover)
- On mobile, horizontally scrollable
- Below the chips, "All regions" link opens full popover

**Data source:** Computed client-side from the events array already passed to `HarelineView` as props (no additional server query). Count events per region from the filtered dataset, show top N. This mirrors how regions are currently derived in `EventFilters.tsx`.

#### 3c. Improved empty states
Context-aware messaging with actionable CTAs:

| Context | Message | Actions |
|---------|---------|---------|
| Near Me, no coverage | "No runs found near you yet." | [Suggest a kennel], [Browse all events] |
| Region filtered, no events | "No upcoming runs in {region}." | [Browse all events], [Suggest a kennel] |
| Kennel filtered, no events | "No upcoming events for {kennel}." | [View kennel profile], [Clear filters] |
| Search, no results | "No events matching '{query}'." | [Clear search], [Browse all events] |
| General (shouldn't happen) | "No events match these filters." | [Clear all filters] |

Same pattern for kennel directory empty states.

---

## 4. "Suggest a Kennel" Feature

### Problem
Users in uncovered areas hit an empty hareline and bounce. No way to capture their interest or tell us what to add next.

### Solution

#### 4a. Suggestion form
Lightweight form (modal dialog triggered from multiple entry points):

**Fields:**
- Kennel name (required, text)
- City or region (required, text)
- Website URL (optional, URL)
- Relationship (required, radio):
  - "I hash with them"
  - "I'm on misman" (high-signal — fast-track onboarding)
  - "I found them online"
- Email for follow-up (optional, email)
- Notes (optional, textarea)

**No auth required** — lower friction for anonymous visitors.

#### 4b. Entry points
- Empty state CTAs on hareline and kennel directory (see Section 3c)
- Kennel directory: "Don't see your kennel?" button in filter area
- Footer: "Suggest a kennel" link
- Homepage: subtle CTA in the value props section

#### 4c. Backend
Store as `KennelSuggestion` model with proper Prisma enums (consistent with the 20+ enums already in the schema):

```prisma
enum SuggestionRelationship {
  HASH_WITH
  ON_MISMAN
  FOUND_ONLINE
}

enum SuggestionStatus {
  NEW
  REVIEWED
  ADDED
  DISMISSED
}

model KennelSuggestion {
  id           String                  @id @default(cuid())
  kennelName   String
  cityRegion   String
  regionId     String?                 // Auto-linked if cityRegion matches a known region
  region       Region?                 @relation(fields: [regionId], references: [id])
  websiteUrl   String?
  relationship SuggestionRelationship
  email        String?
  notes        String?
  status       SuggestionStatus        @default(NEW)
  ipHash       String?                 // SHA-256 of IP, for anonymous rate limiting
  userId       String?
  user         User?                   @relation(fields: [userId], references: [id])
  createdAt    DateTime                @default(now())
  updatedAt    DateTime                @updatedAt
}
```

The server action auto-links `regionId` when the free-text `cityRegion` matches a known region name or alias, making admin review easier and enabling grouping by coverage area.

Admin sees suggestions in the existing research dashboard (new tab or section). `ON_MISMAN` suggestions flagged for priority review.

#### 4d. Rate limiting
- Honeypot field for primary spam prevention (hidden input, reject if filled)
- DB-based dedup: unique constraint on `kennelName + cityRegion` with a 24-hour window (prevent duplicate submissions)
- Authenticated users: max 10 per day (query by userId)
- Anonymous users: max 5 per day per hashed IP (query by ipHash + createdAt window)
- Note: Vercel serverless is stateless — no in-memory rate limiting. All checks are DB-based.

---

## 5. First-Time UX & Location-Aware Entry

### Problem
The homepage drives users to `/hareline` or `/kennels` but doesn't help narrow to their area. A hasher in Chicago seeing 500 events from 20 regions isn't useful.

### Solution

#### 5a. Homepage "Find runs near you" section
Below the hero, add a prominent location entry point:
- "Find runs near you" heading
- Two-option layout:
  - "Use my location" button (map pin icon, triggers geolocation)
  - Region/city search input (autocomplete from known regions)
- On selection: redirect to `/hareline?regions={region}` or `/hareline?dist=50`
- Replaces or supplements the current region ticker

#### 5b. Personalized "Coming Up" feed
- If user has a stored region preference (localStorage), filter the 6-event feed to that region
- If authenticated with subscriptions, show subscribed kennel events
- Fallback: show events from most-populated regions (current behavior)

#### 5c. Return visitor defaults
- Uses the same `hashtracks:locationPref` localStorage key from Section 3a (single source of truth)
- On return to `/hareline` or `/kennels` without explicit URL params:
  - Restore region filter from stored preference
  - Show dismissible banner: "Showing events near {region}. [Change] [Show all]"
- Never override explicit URL params (shared links always win)
- Preference updates whenever user changes their region/location context

#### 5d. Scoping headers and dynamic page titles
When region-filtered (via URL or auto-restore):
- Show clear header: "Upcoming runs in New York City" instead of generic "Hareline"
- Include region in document title: "NYC Runs | HashTracks"
- Breadcrumb-style context for orientation

**Implementation:** Use `generateMetadata()` with `searchParams` in the hareline/kennels server components for the initial server-rendered title (replaces current static `export const metadata`). Additionally, set `document.title` client-side via `useEffect` in `HarelineView`/`KennelDirectory` when the user changes regions without a full page navigation. Both approaches are needed — server-side for initial load + SEO, client-side for SPA-style filter changes.

---

## Scope & Non-Goals

### In scope
- Map clustering/stacking fixes (hareline + kennel maps)
- Region drill-down on map interactions
- Filter UX improvements (defaults, chips, empty states)
- "Suggest a Kennel" form + backend
- First-time location prompt (homepage + hareline/kennels)
- Return visitor preference persistence
- Scoping headers and region-aware page titles

### Out of scope (deferred to Phase 2+)
- Guided multi-step onboarding wizard
- Email notification system / weekly digest
- SEO optimization (meta tags, structured data, sitemap)
- Social features ("Who's going" visibility)
- PWA / push notifications
- Region landing pages (dedicated `/regions/{slug}` routes)
- Map style customization (satellite, terrain modes)

---

## Data Model Changes

### New enums: `SuggestionRelationship`, `SuggestionStatus`
See Section 4c for definitions.

### New model: `KennelSuggestion`
See Section 4c for full schema (includes `regionId` relation, `ipHash`, proper enums).

### No changes to existing models
All other improvements are UI/client-side (localStorage, URL params, component logic). The `Region` model gains a new reverse relation from `KennelSuggestion` but no schema change is needed (Prisma infers it).

---

## Testing Strategy

- **Map clustering:** Unit tests for co-location grouping logic (coordinate rounding, group detection, `groupEventsByLocation()` pure function)
- **Filter defaults:** Unit tests for `resolveLocationDefault()` pure function (URL params vs stored pref precedence, null cases)
- **Suggest a Kennel:** Server action tests (validation, rate limiting by ipHash, DB persistence, region auto-linking, honeypot rejection)
- **Empty states:** Visual review (no automated component tests — matches current convention)
- **Region URL resolution:** Unit tests for case-insensitive region name/alias matching
- **Custom cluster renderer:** Visual review (renderer returns DOM elements, not easily unit-testable)
- **Integration:** Manual walkthrough of first-time user flow on mobile + desktop

---

## Success Criteria

1. A new visitor can find runs near them within 30 seconds of landing
2. No stacked/unclickable pins on either map view
3. Map clusters provide meaningful drill-down (region filter or event list)
4. Empty states always offer an actionable next step
5. Return visitors see their region context restored automatically
6. "Suggest a Kennel" captures demand signal from uncovered areas
