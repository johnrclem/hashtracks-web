# Region Architecture & Kennel Discovery Restructuring

## Context

HashTracks currently has ~70 kennels across 36 regions (29 US, 7 UK) and needs to scale to thousands globally. The current flat-region approach has several problems:

- **Data clutter**: Manual region selection during kennel creation leads to duplicates ("New York City", "New York Metro", "New York, NY")
- **Unused hierarchy**: `Region.parentId` exists in the schema but drives no UI or queries
- **Hyper-granularity**: UK has 7 regions for ~7 kennels (Old Coulsdon, Barnes, Enfield are each single-kennel regions)
- **No proximity discovery**: Map shows region centroids, not individual kennel locations; no "near me" search
- **Flat filter dropdown**: 36 regions already feels cluttered; will be unworkable at 200+

**Goal**: Restructure geography to support global-scale kennel discovery with a map-first UX, geospatial kennel locations, and consolidated metro-level regions.

---

## 1. Taxonomy & Data Model Strategy

### Core Principle

**Regions become metro-level grouping labels. Geospatial precision moves to the Kennel model itself.**

Regions answer "which metro area?" for UI grouping, timezone inference, and badge colors. Kennel lat/lng answers "where exactly?" for map pins and proximity search. These are orthogonal concerns.

### Schema Changes

#### Add to `Kennel` model (`prisma/schema.prisma:93`)

```prisma
// -- LOCATION --
latitude       Float?      // Home base coords (nullable, backfilled)
longitude      Float?
city           String?     // "Brooklyn", "San Francisco"
stateProvince  String?     // "NY", "CA", "England"

@@index([latitude, longitude])
```

- **Why lat/lng on Kennel?** Currently the map (`KennelMapView.tsx`) clusters all kennels at region centroids. With kennel-level coords, each kennel gets its own pin. The `KennelDiscovery` model already stores lat/lng from Hash Rego, so the data pipeline exists.
- **Why city/stateProvince?** Enables text-based filtering ("all kennels in California") without runtime geocoding. Don't add `countryCode` — the existing `country` field already works.
- **Why not PostGIS?** Haversine formula + basic float index handles proximity queries efficiently up to ~5,000 kennels. PostGIS adds operational complexity for no current benefit. Revisit when kennel count reaches thousands.
- Nullable — many kennels won't have coords initially; fallback to region centroid (already works via `getEventCoords()` in `src/lib/geo.ts`).

#### Add to `Region` model (`prisma/schema.prisma:64`)

```prisma
stateProvince  String?     // "NY", "CA" — for grouping within country
```

#### Hierarchy Strategy: 2 levels, actually used

Keep the existing `parentId` self-relation (max 2 levels). The schema is fine — the problem is that nothing uses it.

**Create parent regions:**

| Parent | Children |
|--------|----------|
| DMV | Washington DC, Northern Virginia, Baltimore, Frederick, Fredericksburg, Southern Maryland, Jefferson County WV |
| SF Bay Area | San Francisco, Oakland, San Jose, Marin County |
| Chicagoland | Chicago, South Shore |

#### UK Region Consolidation

**Merge all London-area regions into a single "London" region**, then rely on kennel lat/lng for sub-area precision.

Merge targets:
- South West London -> London
- West London -> London
- Surrey -> London
- Old Coulsdon -> London
- Enfield -> London
- Barnes -> London

Use existing `mergeRegions()` action in `src/app/admin/regions/actions.ts` for the mechanics. This collapses the UK filter dropdown from 7 entries to 1.

---

## 2. Discovery UX Recommendations

### Map-first default for `/kennels`

Switch the default `displayView` from `"grid"` to `"map"` in `KennelDirectory.tsx`. Grid remains available as secondary tab.

### Individual kennel pins

Replace region-centroid clustering in `KennelMapView.tsx` with individual kennel pins using new lat/lng fields. For kennels without lat/lng, fall back to region centroid (existing pattern). Use `@googlemaps/markerclusterer` (already used in the hareline `ClusteredMarkers.tsx`) to handle visual density.

### "Near Me" proximity search

Add a geolocation button above the map:
1. Browser Geolocation API (free, no API key) gets user coordinates
2. Filter kennels within selectable radius using `haversineDistance()` (already in `src/lib/geo.ts`)
3. `DISTANCE_OPTIONS = [10, 25, 50, 100, 250]` already defined in `src/lib/geo.ts`
4. Sort results by distance ascending

### Hierarchical region filter

Replace the flat `RegionCombobox` popover in `KennelFilters.tsx` with a two-level expandable list:
- "DMV (7)" -> click to expand -> Washington DC, Northern Virginia, Baltimore...
- "SF Bay Area (5)" -> click to expand -> San Francisco, Oakland, San Jose...
- Selecting a parent auto-selects all children
- Flat regions (no parent) appear at top level as before

### Country tabs (future, >5 countries)

When the platform reaches 5+ countries, evolve the current country filter buttons into a tab bar above the map.

---

## 3. Data Integrity & Onboarding Flow

### Fix "Add Kennel" flow (`src/components/admin/KennelForm.tsx`)

**Current problem**: Admin manually selects region from dropdown, leading to duplicates and mismatches.

**Solution**: Add Google Places Autocomplete to kennel creation:
1. Add a "Location" text input using Google Places Autocomplete API (key `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` already browser-exposed)
2. When admin selects a Places result, auto-fill:
   - `latitude`/`longitude` from Places geometry
   - `city`/`stateProvince`/`country` from Places address components
   - Auto-suggest best `regionId` by finding nearest region centroid via `haversineDistance()`
3. Admin can override suggested region, but gets a smart default
4. For kennels created via `addKennelFromDiscovery()` (`src/app/admin/discovery/actions.ts`), lat/lng already exists in `KennelDiscovery` — just pass it through

### "Unassigned" / edge-case kennels

- Kennels without lat/lng fall back to region centroid on the map (existing behavior)
- Kennels that don't fit a metro region get assigned to a state/country-level region (e.g., "Colorado" or "Scotland")
- The `isHidden` flag on Kennel already handles truly edge-case entries

---

## 4. Migration Plan

### Step 1: Schema migration (zero-downtime)

Add `latitude`, `longitude`, `city`, `stateProvince` to Kennel (all nullable). Add `stateProvince` to Region. `npx prisma migrate dev`.

### Step 2: Backfill lat/lng from KennelDiscovery

```sql
UPDATE "Kennel" k SET latitude = d.latitude, longitude = d.longitude
FROM "KennelDiscovery" d
WHERE d."matchedKennelId" = k.id AND d.latitude IS NOT NULL AND k.latitude IS NULL;
```

### Step 3: Backfill lat/lng from Event median

```sql
UPDATE "Kennel" k SET latitude = sub.med_lat, longitude = sub.med_lng
FROM (
  SELECT "kennelId",
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latitude) AS med_lat,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY longitude) AS med_lng
  FROM "Event" WHERE latitude IS NOT NULL GROUP BY "kennelId" HAVING COUNT(*) >= 3
) sub WHERE k.id = sub."kennelId" AND k.latitude IS NULL;
```

### Step 4: Backfill city/stateProvince via reverse geocoding

For kennels with lat/lng but no city, batch-call `reverseGeocode()` from `src/lib/geo.ts`. Rate-limit to 50 QPS (Google free tier).

### Step 5: Consolidate UK regions

Merge 6 London-area regions into canonical "London" using `mergeRegions()` from `src/app/admin/regions/actions.ts`.

### Step 6: Create parent regions

Create "DMV", "SF Bay Area", "Chicagoland" parent regions. Set `parentId` on children via `updateRegion()`.

### Step 7: Update seed data

Update `REGION_SEED_DATA` in `src/lib/region.ts` and `prisma/seed.ts` with new fields and hierarchy.

---

## 5. Codebase Impact (files to modify)

### Phase 1: Kennel Geolocation

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 4 fields to Kennel + index; add stateProvince to Region |
| `prisma/seed.ts` | Add lat/lng/city/stateProvince to kennel seed records |
| `src/app/admin/kennels/actions.ts` | Accept + persist new geo fields in create/update |
| `src/components/admin/KennelForm.tsx` | Add Places autocomplete, auto-suggest region |
| `src/app/admin/discovery/actions.ts` | Pass lat/lng through in addKennelFromDiscovery |
| `src/pipeline/kennel-discovery.ts` | Copy lat/lng to Kennel on link/add |
| `src/lib/geo.ts` | Add `getKennelCoords()` helper (kennel -> region centroid fallback) |

### Phase 2: Map-first Discovery UX

| File | Change |
|------|--------|
| `src/components/kennels/KennelMapView.tsx` | Individual pins instead of region centroids |
| `src/components/kennels/KennelDirectory.tsx` | Default to map view; add "near me" filter; distance sorting |
| `src/components/kennels/KennelFilters.tsx` | Add distance/radius filter; hierarchical region popover |
| `src/components/kennels/KennelCard.tsx` | Display city in card |
| `src/app/kennels/page.tsx` | Pass lat/lng in KennelCardData |

### Phase 3: Region Hierarchy

| File | Change |
|------|--------|
| `src/lib/region.ts` | Add parent-child to REGION_SEED_DATA; update sync maps |
| `src/components/admin/RegionCombobox.tsx` | Group by parent in admin forms |
| `src/app/admin/regions/page.tsx` | Show hierarchy visually (indent children) |
| `src/app/admin/regions/actions.ts` | Update AI suggestions to consider hierarchy |

### Files that should NOT change (pipeline safety)

| File | Reason |
|------|--------|
| `src/pipeline/kennel-resolver.ts` | Resolves by shortName/alias, not geography |
| `src/pipeline/merge.ts` | Deduplicates by kennelId+date fingerprint; geography-agnostic |
| `src/pipeline/scrape.ts` | Orchestration layer, no region logic |
| `src/adapters/*` | Adapters produce RawEvents with kennel tags, not coordinates |

### Existing utilities to reuse

| Utility | File | Purpose |
|---------|------|---------|
| `haversineDistance()` | `src/lib/geo.ts` | Distance calculation for "near me" |
| `DISTANCE_OPTIONS` | `src/lib/geo.ts` | Radius filter values |
| `geocodeAddress()` | `src/lib/geo.ts` | Forward geocoding |
| `reverseGeocode()` | `src/lib/geo.ts` | Backfill city/state from coords |
| `getEventCoords()` | `src/lib/geo.ts` | Lat/lng -> region centroid fallback pattern |
| `mergeRegions()` | `src/app/admin/regions/actions.ts` | UK region consolidation |
| `@googlemaps/markerclusterer` | Already in hareline map | Cluster dense kennel pins |

---

## 6. Verification

### After schema migration
- `npx prisma db push` succeeds
- `npm test` passes (93 test files)
- Existing kennel pages render unchanged (new fields are nullable)

### After backfill
- Spot-check 10 kennels: lat/lng plausible for their region
- Verify UK region merge: filter dropdown shows 1 "London" entry
- Verify parent regions: DMV, SF Bay Area, Chicagoland appear as groupings

### After UX changes
- `/kennels` defaults to map view with individual kennel pins
- "Near Me" button gets browser location, filters by radius
- Region filter shows expandable parent groups
- Grid view still works with alphabetical region grouping
- URL filter persistence still works (`?regions=...&distance=50`)
