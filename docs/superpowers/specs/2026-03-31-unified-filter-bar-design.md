# Unified Filter Bar Design

## Problem

The `/kennels` and `/hareline` pages have separate filter components (`KennelFilters` and `EventFilters`) with significant overlap. Both suffer from scaling issues:

1. **Day-of-week chips** — 7 always-visible buttons consume too much horizontal space
2. **Country chips** — one button per country doesn't scale past 3-4 countries (currently US, UK, Ireland, Germany, Japan and growing)
3. **Inconsistent UX** — two pages, two different filter implementations for the same underlying concepts

## Design

### Shared `<FilterBar>` Component

A single `FilterBar` component replaces both `KennelFilters` and `EventFilters`. Each page passes a configuration declaring which filter types to enable.

### Tier 1 — Always Visible

Four controls are always shown in a single row:

| Control | Behavior |
|---------|----------|
| **Search** | Text input. Full-width on mobile, `max-width: 280px` on desktop. Debounced 300ms. |
| **Region** | Searchable popover. Searches across all hierarchy levels (country, state, metro). Typing "UK" shows all UK regions; "California" shows CA metros; "London" matches directly. Multi-select with "All [State]" grouping. Absorbs the old country filter — no separate country control. |
| **Near Me** | Geolocation distance filter. Icon-only on mobile (`📍`), labeled on desktop. Existing `NearMeFilter` component behavior preserved. |
| **Filters** | Toggle button for the expandable Tier 2 row. Shows badge count of active secondary filters when collapsed. |

### Tier 2 — Expandable Filter Row

Toggled by the "Filters" button. Slides open below the Tier 1 row.

| Control | Type | Pages | Default |
|---------|------|-------|---------|
| **Run Day** | Multi-select dropdown | Both | None selected |
| **Frequency** | Single-select dropdown | Kennels only | "Any" |
| **Kennel** | Searchable multi-select popover | Hareline only | None selected |
| **Active only** | Toggle switch | Kennels only | On |
| **Has upcoming** | Toggle switch | Kennels only | Off |

**Desktop layout:** All Tier 2 controls in a single horizontal row with vertical dividers between groups.

**Mobile layout:** Controls stack vertically with full-width inputs and toggle switches for touch-friendly tap targets.

### Active Filter Chips

When Tier 2 filters are applied and the row is collapsed, dismissible chips appear below the Tier 1 row:

- Each active filter renders as a chip (e.g., "Mon, Wed ✕", "Weekly ✕")
- A "Clear all" link appears at the end
- The Filters button shows a badge with the count of active secondary filters

### Mobile Layout (≤640px)

- **Row 1:** Search input (full width)
- **Row 2:** Region (flex-1) + Near Me (icon) + Filters (icon + badge)
- **Expanded:** Filters stack vertically below Row 2 with full-width controls
- **Active chips:** Wrap below Row 2 when filters are applied and row is collapsed

### Page-Specific Controls (Outside FilterBar)

These remain as separate controls managed by each page, not part of FilterBar:

- **Hareline:** Time range selector (2w/4w/8w/12w/upcoming/past)
- **Hareline:** Scope toggle (My Kennels / All Kennels)
- **Both:** Sort controls (A-Z / Recently Active / Nearest)
- **Both:** View toggle (Grid/Map on kennels, List/Calendar/Map on hareline)

### Region Picker Enhancement

The existing `RegionFilterPopover` is enhanced to eliminate the need for a separate country filter:

- Top-level entries for each country (e.g., "All United States", "All United Kingdom", "All Germany")
- State-level entries below each country (e.g., "All California", "All New York")
- Metro-level entries at the leaf level
- Free-text search matches at all levels of the hierarchy
- Selecting a country or state selects all metros within it

## What Gets Removed

- `src/components/kennels/KennelFilters.tsx` — replaced by shared `FilterBar`
- `src/components/hareline/EventFilters.tsx` — replaced by shared `FilterBar`
- 7 day-of-week chip buttons → multi-select dropdown
- Per-country chip buttons → absorbed into region picker hierarchy
- `selectedCountry` state + `onCountryChange` prop → removed from both pages
- `DAY_FULL` export from `KennelFilters` → moved to `FilterBar` or shared util

## What Gets Created

- `src/components/shared/FilterBar.tsx` — unified filter bar component
- `src/components/shared/DayOfWeekSelect.tsx` — multi-select dropdown for run days
- Updated `RegionFilterPopover` with country-level entries and improved search

## URL Persistence

All filter state continues to sync to URL via `replaceState`. Parameter names stay the same for backwards compatibility:

- `q` — search text
- `regions` — pipe-delimited region names (including `state:` and `country:` prefixes for hierarchy)
- `days` — pipe-delimited day abbreviations
- `freq` — frequency value
- `upcoming` — "true" when on
- `active` — "false" when off (default is on)
- `distance` — near me distance in km
- `country` — **removed** (absorbed into `regions`). For backwards compatibility, if `country=UK` is in the URL on load, convert it to `regions=country:United Kingdom` and drop the param.

## Component API

```tsx
interface FilterBarProps {
  // Data source (to derive available options)
  items: { region: string; country?: string; scheduleDayOfWeek?: string; scheduleFrequency?: string; id: string; latitude?: number; longitude?: number }[];

  // Filter state
  search: string;
  onSearchChange: (v: string) => void;
  selectedRegions: string[];
  onRegionsChange: (v: string[]) => void;
  selectedDays: string[];
  onDaysChange: (v: string[]) => void;
  nearMeDistance: number | null;
  onNearMeDistanceChange: (v: number | null) => void;
  geoState: GeoState;
  onRequestLocation: () => void;

  // Optional page-specific filters
  selectedFrequency?: string;
  onFrequencyChange?: (v: string) => void;
  showActiveOnly?: boolean;
  onActiveOnlyChange?: (v: boolean) => void;
  showUpcomingOnly?: boolean;
  onUpcomingOnlyChange?: (v: boolean) => void;
  selectedKennels?: string[];
  onKennelsChange?: (v: string[]) => void;
  kennelOptions?: { id: string; shortName: string; fullName: string; region: string }[];
}
```

Optional props control which Tier 2 filters appear. If `onFrequencyChange` is not passed, the frequency dropdown doesn't render, etc.

## Mockups

Visual mockups for desktop and mobile layouts are saved in `.superpowers/brainstorm/` in this repository.
