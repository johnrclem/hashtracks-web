# Kennel Activity Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-compute kennel activity status from event data and surface it in the directory (filter + badges) and detail page (contextual last-run display).

**Architecture:** Add `lastEventDate` cached field to Kennel model, updated by the merge pipeline. A pure function computes status tiers (active/possibly-inactive/inactive/unknown) from this field. Directory gets an "Active only" toggle (default ON). Detail page swaps "Next Run" for "Last Run" when no upcoming events exist. Badges only appear on non-active kennels.

**Tech Stack:** Prisma schema, TypeScript, React (Next.js App Router), Tailwind CSS, shadcn/ui, Vitest

---

### Task 1: Pure Activity Status Function + Tests

**Files:**
- Create: `src/lib/activity-status.ts`
- Create: `src/lib/activity-status.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/lib/activity-status.test.ts
import { getActivityStatus, type ActivityStatus } from "@/lib/activity-status";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

describe("getActivityStatus", () => {
  it("returns 'unknown' for null", () => {
    expect(getActivityStatus(null)).toBe("unknown");
  });

  it("returns 'active' for event 0 days ago (today)", () => {
    expect(getActivityStatus(daysAgo(0))).toBe("active");
  });

  it("returns 'active' for event 89 days ago", () => {
    expect(getActivityStatus(daysAgo(89))).toBe("active");
  });

  it("returns 'possibly-inactive' for event 90 days ago", () => {
    expect(getActivityStatus(daysAgo(90))).toBe("possibly-inactive");
  });

  it("returns 'possibly-inactive' for event 91 days ago", () => {
    expect(getActivityStatus(daysAgo(91))).toBe("possibly-inactive");
  });

  it("returns 'possibly-inactive' for event 364 days ago", () => {
    expect(getActivityStatus(daysAgo(364))).toBe("possibly-inactive");
  });

  it("returns 'inactive' for event 365 days ago", () => {
    expect(getActivityStatus(daysAgo(365))).toBe("inactive");
  });

  it("returns 'inactive' for event 366 days ago", () => {
    expect(getActivityStatus(daysAgo(366))).toBe("inactive");
  });

  it("returns 'active' for future dates", () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 30);
    expect(getActivityStatus(future)).toBe("active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/activity-status.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/activity-status.ts
export type ActivityStatus = "active" | "possibly-inactive" | "inactive" | "unknown";

const ACTIVE_DAYS = 90;
const INACTIVE_DAYS = 365;

/**
 * Compute activity status from a kennel's most recent event date.
 * Thresholds: <90 days = active, 90-365 = possibly-inactive, 365+ = inactive, null = unknown.
 */
export function getActivityStatus(lastEventDate: Date | null): ActivityStatus {
  if (!lastEventDate) return "unknown";

  const now = new Date();
  const diffMs = now.getTime() - lastEventDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < ACTIVE_DAYS) return "active";
  if (diffDays < INACTIVE_DAYS) return "possibly-inactive";
  return "inactive";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/activity-status.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity-status.ts src/lib/activity-status.test.ts
git commit -m "feat: add getActivityStatus pure function with tests"
```

---

### Task 2: Schema Change — Add `lastEventDate` to Kennel

**Files:**
- Modify: `prisma/schema.prisma` (Kennel model, around line 147)

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, in the Kennel model, add after the `isHidden` field (line 147):

```prisma
  lastEventDate  DateTime?  // Cached: MAX(event.date) for activity status computation
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 3: Run type check to verify schema compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors — new optional field doesn't break existing code)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "schema: add lastEventDate to Kennel for activity status"
```

---

### Task 3: ActivityStatusBadge Component

**Files:**
- Create: `src/components/kennels/ActivityStatusBadge.tsx`

- [ ] **Step 1: Create the badge component**

```tsx
// src/components/kennels/ActivityStatusBadge.tsx
import { getActivityStatus, type ActivityStatus } from "@/lib/activity-status";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const STATUS_CONFIG: Record<Exclude<ActivityStatus, "active">, { label: string; classes: string; tooltip: string }> = {
  "possibly-inactive": {
    label: "Possibly Inactive",
    classes: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    tooltip: "No events in the last 90 days",
  },
  inactive: {
    label: "Inactive",
    classes: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    tooltip: "No events in over a year",
  },
  unknown: {
    label: "No Data",
    classes: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    tooltip: "No run data on HashTracks yet",
  },
};

interface ActivityStatusBadgeProps {
  lastEventDate: Date | string | null;
  size?: "sm" | "md";
}

export function ActivityStatusBadge({ lastEventDate, size = "sm" }: ActivityStatusBadgeProps) {
  const date = lastEventDate ? new Date(lastEventDate) : null;
  const status = getActivityStatus(date);

  // Active kennels don't get a badge
  if (status === "active") return null;

  const config = STATUS_CONFIG[status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center rounded-full font-medium shrink-0 ${config.classes} ${
            size === "sm"
              ? "h-5 px-1.5 text-[10px] leading-5"
              : "px-2 py-0.5 text-xs"
          }`}
          aria-label={config.label}
        >
          {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{config.tooltip}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/kennels/ActivityStatusBadge.tsx
git commit -m "feat: add ActivityStatusBadge component"
```

---

### Task 4: Add `lastEventDate` to KennelCard and Directory Query

**Files:**
- Modify: `src/components/kennels/KennelCard.tsx` (interface + render)
- Modify: `src/app/kennels/page.tsx` (query + serialization)

- [ ] **Step 1: Extend KennelCardData interface**

In `src/components/kennels/KennelCard.tsx`, add to the `KennelCardData` interface after `nextEvent`:

```typescript
  lastEventDate: string | null;
```

- [ ] **Step 2: Add badge to KennelCard render**

In `src/components/kennels/KennelCard.tsx`, add import at top:

```typescript
import { ActivityStatusBadge } from "@/components/kennels/ActivityStatusBadge";
```

Replace the header section (the `<div>` containing shortName + RegionBadge) with:

```tsx
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-tight truncate" title={kennel.fullName}>
              {kennel.shortName}
            </h3>
            <p className="text-sm text-muted-foreground truncate">
              {kennel.fullName}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ActivityStatusBadge lastEventDate={kennel.lastEventDate} />
            <RegionBadge region={kennel.region} size="sm" />
          </div>
        </div>
```

- [ ] **Step 3: Add `lastEventDate` to the kennels page query**

In `src/app/kennels/page.tsx`, add `lastEventDate: true` to the `select` object in the `prisma.kennel.findMany` call (after `scheduleFrequency`):

```typescript
        lastEventDate: true,
```

And in the serialization block (the `kennelsWithNext` map), add to the return object:

```typescript
      lastEventDate: k.lastEventDate ? k.lastEventDate.toISOString() : null,
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/kennels/KennelCard.tsx src/app/kennels/page.tsx
git commit -m "feat: display activity status badge on kennel directory cards"
```

---

### Task 5: "Active only" Filter in KennelFilters + KennelDirectory

**Files:**
- Modify: `src/components/kennels/KennelFilters.tsx` (add toggle prop + UI)
- Modify: `src/components/kennels/KennelDirectory.tsx` (state, URL sync, filter logic)

- [ ] **Step 1: Add filter prop to KennelFilters**

In `src/components/kennels/KennelFilters.tsx`, add to `KennelFiltersProps` interface:

```typescript
  showActiveOnly: boolean;
  onActiveOnlyChange: (v: boolean) => void;
```

Add destructured props in the function signature.

Add the toggle button right after the "Has upcoming" button (around line 224):

```tsx
      {/* Active only toggle */}
      <button
        onClick={() => onActiveOnlyChange(!showActiveOnly)}
        aria-pressed={showActiveOnly}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          showActiveOnly
            ? "bg-primary text-primary-foreground"
            : "border text-muted-foreground hover:text-foreground"
        }`}
      >
        Active only
      </button>
```

Update `activeFilterCount` to include the new filter:

```typescript
    (showActiveOnly ? 1 : 0) +
```

Add `onActiveOnlyChange(false)` to the "Clear filters" button's onClick handler.

- [ ] **Step 2: Add state and filter logic to KennelDirectory**

In `src/components/kennels/KennelDirectory.tsx`:

Add import:
```typescript
import { getActivityStatus } from "@/lib/activity-status";
```

Add state (after `showUpcomingOnly` state, around line 51), defaulting to ON:
```typescript
  const [showActiveOnly, setShowActiveOnlyState] = useState(
    searchParams.get("active") !== "false",
  );
```

Add URL sync wrapper (after `setShowUpcomingOnly`):
```typescript
  function setShowActiveOnly(v: boolean) {
    setShowActiveOnlyState(v);
    syncUrl({ active: v ? null : false });
  }
```

Update `syncUrl` defaults: add to the `isDefault` check:
```typescript
          (key === "active" && str !== "false") ||
```

Add to the `state` object in `syncUrl`:
```typescript
        active: showActiveOnly,
```

Add `showActiveOnly` to the `syncUrl` useCallback dependency array.

Add filter logic in the `filtered` useMemo, after the "Upcoming only" check (around line 241):
```typescript
      // Active only
      if (showActiveOnly) {
        const status = getActivityStatus(k.lastEventDate ? new Date(k.lastEventDate) : null);
        if (status !== "active") return false;
      }
```

Add `showActiveOnly` to the `filtered` useMemo dependency array.

Pass props to `<KennelFilters>`:
```tsx
        showActiveOnly={showActiveOnly}
        onActiveOnlyChange={setShowActiveOnly}
```

Add to `clearAllFilters`:
```typescript
    setShowActiveOnlyState(false);
```
And add `active: false` to the `syncUrl` call in `clearAllFilters`.

- [ ] **Step 3: Update KennelCardData type reference**

The `KennelCardData` type is imported from `KennelCard.tsx` — it already has `lastEventDate` from Task 4, so the filter can access `k.lastEventDate` in the filter pipeline.

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/kennels/KennelFilters.tsx src/components/kennels/KennelDirectory.tsx
git commit -m "feat: add 'Active only' filter to kennel directory (default ON)"
```

---

### Task 6: Contextual Last Run in KennelStats

**Files:**
- Modify: `src/components/kennels/KennelStats.tsx` (add lastEventDate prop, contextual swap)
- Modify: `src/app/kennels/[slug]/page.tsx` (pass lastEventDate)

- [ ] **Step 1: Add `lastEventDate` prop and swap logic to KennelStats**

In `src/components/kennels/KennelStats.tsx`, add to interface:

```typescript
  lastEventDate: string | null;
```

Add a `formatLastRun` function (after `formatNextRun`):

```typescript
function formatLastRun(lastEventDate: string): string {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  const eventUtc = new Date(lastEventDate).getTime();
  const diffDays = Math.round((todayUtc - eventUtc) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 30) return `${diffDays} days ago`;
  if (diffDays <= 365) {
    const months = Math.round(diffDays / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  return new Date(lastEventDate).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
```

Change the early return for zero events to show "No run data" instead of returning null:

Replace:
```typescript
  if (totalEvents === 0) return null;
```
With:
```typescript
  if (totalEvents === 0 && !lastEventDate) return null;
```

Replace the `nextRunDate` stats block (around line 91-97) with:

```typescript
  if (nextRunDate) {
    stats.push({
      icon: <ArrowRight className="h-5 w-5" />,
      value: formatNextRun(nextRunDate),
      label: "Next Run",
    });
  } else if (lastEventDate) {
    stats.push({
      icon: <Clock className="h-5 w-5" />,
      value: formatLastRun(lastEventDate),
      label: "Last Run",
    });
  }
```

Note: when `lastEventDate` is used as the "Last Run" stat, we need to avoid showing it twice as "Years Active" too. The existing `yearsActive` stat remains — it uses `foundedYear` or `oldestEventDate`, which is different from `lastEventDate`. No conflict.

- [ ] **Step 2: Pass `lastEventDate` from the detail page**

In `src/app/kennels/[slug]/page.tsx`, find where `KennelStats` is rendered and add the `lastEventDate` prop. First, add `lastEventDate: true` to the kennel query's `select` clause. Then pass it:

```tsx
<KennelStats
  currentRunNumber={currentRunNumber}
  totalEvents={totalEvents}
  oldestEventDate={oldestEventDate}
  nextRunDate={nextRunDate}
  foundedYear={kennel.foundedYear}
  region={kennel.region}
  lastEventDate={kennel.lastEventDate ? kennel.lastEventDate.toISOString() : null}
/>
```

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/kennels/KennelStats.tsx src/app/kennels/[slug]/page.tsx
git commit -m "feat: contextual last-run display on kennel detail page"
```

---

### Task 7: Merge Pipeline — Update `lastEventDate`

**Files:**
- Modify: `src/pipeline/merge.ts` (update `lastEventDate` after event upsert)

- [ ] **Step 1: Add `lastEventDate` update in `processNewRawEvent`**

In `src/pipeline/merge.ts`, find the `processNewRawEvent` function (around line 820). After the line:

```typescript
  const targetEventId = await upsertCanonicalEvent(event, kennelId, rawEvent.id, ctx);
```

Add:

```typescript
  // Update kennel's lastEventDate cache if this event is newer
  const eventDate = parseUtcNoonDate(event.date);
  await prisma.kennel.update({
    where: { id: kennelId },
    data: {
      lastEventDate: eventDate,
    },
    // Only update if the new date is more recent — use a raw conditional
  });
```

Actually, Prisma doesn't support conditional updates natively. Use a more targeted approach — update only if `lastEventDate` is null or older:

```typescript
  // Update kennel's lastEventDate cache if this event is newer
  const eventDate = parseUtcNoonDate(event.date);
  await prisma.$executeRaw`
    UPDATE "Kennel"
    SET "lastEventDate" = ${eventDate}, "updatedAt" = NOW()
    WHERE id = ${kennelId}
    AND ("lastEventDate" IS NULL OR "lastEventDate" < ${eventDate})
  `;
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS (existing merge tests still pass; raw SQL only executes against the real DB)

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/merge.ts
git commit -m "feat: update kennel lastEventDate in merge pipeline"
```

---

### Task 8: Backfill Script

**Files:**
- Create: `src/app/admin/kennels/backfill-last-event-action.ts`

- [ ] **Step 1: Create the backfill server action**

```typescript
// src/app/admin/kennels/backfill-last-event-action.ts
"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function backfillLastEventDates() {
  await getAdminUser(); // Auth guard

  // One query: MAX(date) per kennel, excluding cancelled and manual entries
  const results = await prisma.$queryRaw<{ kennelId: string; maxDate: Date }[]>`
    SELECT "kennelId", MAX(date) as "maxDate"
    FROM "Event"
    WHERE status != 'CANCELLED'
    AND "isManualEntry" != true
    AND "parentEventId" IS NULL
    GROUP BY "kennelId"
  `;

  let updated = 0;
  for (const row of results) {
    await prisma.kennel.update({
      where: { id: row.kennelId },
      data: { lastEventDate: row.maxDate },
    });
    updated++;
  }

  return { updated, total: results.length };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/kennels/backfill-last-event-action.ts
git commit -m "feat: add backfill action for kennel lastEventDate"
```

---

### Task 9: Push Schema + Run Backfill

- [ ] **Step 1: Push schema to database**

Run: `eval "$(fnm env)" && fnm use 20 && npx prisma db push`
Expected: Schema change applied (adds nullable `lastEventDate` column)

- [ ] **Step 2: Run backfill**

Call the backfill server action from the admin UI or via a quick script. Alternatively, use Prisma Studio to verify the column exists, then trigger backfill from the admin page.

- [ ] **Step 3: Run full CI checks**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: ALL PASS

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: push schema and verify backfill"
```

---

### Task 10: Manual Verification

- [ ] **Step 1: Start dev server and verify directory**

Run: `npm run dev`

1. Open http://localhost:3000/kennels
2. Verify "Active only" toggle is ON by default
3. Verify only active kennels are shown
4. Toggle OFF — verify inactive/unknown kennels appear with badges
5. Verify badge colors: yellow for "Possibly Inactive", red for "Inactive", gray for "No Data"
6. Verify badges appear next to RegionBadge on cards

- [ ] **Step 2: Verify kennel detail page**

1. Open an active kennel — verify "Next Run" displays as before
2. Open a kennel with no upcoming events — verify "Last Run" displays with relative date
3. Open a kennel-only record (no events) — verify stats section handles gracefully

- [ ] **Step 3: Verify URL persistence**

1. Toggle "Active only" OFF
2. Reload page — verify toggle stays OFF (URL param `active=false`)
3. Toggle ON and reload — verify no `active` param in URL (default)
