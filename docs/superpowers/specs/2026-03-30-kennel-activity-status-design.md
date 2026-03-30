# Kennel Activity Status — Design Spec

## Context

Facebook group members (16.6K-member HHH community) repeatedly complain about dead kennels in existing directories. HashTracks can differentiate by auto-computing activity status from real event data, letting users trust that listed kennels are actually running. This is a high-value, low-effort feature from the Discovery & Travel UX roadmap.

## Status Tiers

Computed from `lastEventDate` on the Kennel model:

| Status | Condition | Color | Badge shown? |
|--------|-----------|-------|-------------|
| Active | Event within last 90 days | — | No (next run date speaks for itself) |
| Possibly Inactive | 90–365 days since last event | Yellow | Yes, on directory card |
| Inactive | 365+ days since last event | Red | Yes, on directory card |
| Unknown | No events (kennel-only record) | Gray | Yes, on directory card |

Badges only appear on non-active kennels. Active kennels show no badge — their upcoming event info is sufficient.

## Data Layer

### Schema Change

Add to Kennel model in `prisma/schema.prisma`:

```prisma
lastEventDate DateTime?
```

### Pure Function

`getActivityStatus(lastEventDate: Date | null): 'active' | 'possibly-inactive' | 'inactive' | 'unknown'`

- `null` → `'unknown'`
- `< 90 days ago` → `'active'`
- `90–365 days ago` → `'possibly-inactive'`
- `> 365 days ago` → `'inactive'`

Location: new file `src/lib/activity-status.ts` (pure function, easily testable).

### Merge Pipeline Update

In `src/pipeline/merge.ts`, after upserting canonical events, update `lastEventDate` on the associated Kennel if the event date is newer than the current `lastEventDate`.

### Backfill

One-time script (can be a server action or standalone) that queries `MAX(event.date)` per kennel (excluding cancelled and manual-entry events) and writes to `lastEventDate`.

## Directory UI

### Filter: "Active only" toggle

- Added to `src/components/kennels/KennelFilters.tsx`
- Default: ON (hides inactive + unknown kennels)
- Synced to URL params (same pattern as existing filters)
- Client-side filter in `KennelDirectory.tsx`: when on, only show kennels where `getActivityStatus(lastEventDate) === 'active'`

### Badge Component

New `src/components/kennels/ActivityStatusBadge.tsx`:

- Follows RegionBadge pattern (small pill badge)
- Only renders for non-active statuses
- Yellow: "Possibly Inactive"
- Red: "Inactive"
- Gray: "No Data"
- Placed on KennelCard next to existing RegionBadge

## Detail Page (Kennel Profile)

### Contextual Swap in KennelStats

- **Has next run?** → Show "Next Run: [date]" (existing behavior, no change)
- **Has past events but no next run?** → Swap to "Last Run: [date]" with relative time (e.g., "51 days ago")
- **No events at all?** → Show "No run data on HashTracks yet"

No badge on the detail page. The contextual date info communicates status without redundancy.

## Files to Modify

- `prisma/schema.prisma` — add `lastEventDate` field
- `src/lib/activity-status.ts` — new: pure status function
- `src/lib/activity-status.test.ts` — new: unit tests for boundary cases
- `src/pipeline/merge.ts` — update `lastEventDate` on Kennel after event upsert
- `src/components/kennels/ActivityStatusBadge.tsx` — new: badge component
- `src/components/kennels/KennelCard.tsx` — add badge for non-active kennels
- `src/components/kennels/KennelDirectory.tsx` — add filter logic
- `src/components/kennels/KennelFilters.tsx` — add "Active only" toggle
- `src/components/kennels/KennelStats.tsx` — contextual swap (next run / last run / no data)
- `src/app/kennels/page.tsx` — include `lastEventDate` in kennel query
- `src/app/kennels/[slug]/page.tsx` — pass last event date to KennelStats

## Testing

- Unit tests for `getActivityStatus()`: boundary cases at 89, 90, 91, 364, 365, 366 days, null, future dates
- Unit tests for merge pipeline `lastEventDate` update logic
- Verify directory filter hides/shows correct kennels
- Manual verification: check directory with toggle on/off, check detail page for active vs inactive kennel

## Out of Scope

- Admin override of activity status
- Email/notification for status changes
- Historical activity trend tracking
