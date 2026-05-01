# Admin Cancellation Override — Design Spec

> **Status:** approved 2026-05-01.
> **Audience:** the `writing-plans` skill that turns this spec into an implementation plan, plus future readers asking "why did we build it this way?"
> **Source decisions:** brainstorming session 2026-05-01; pre-code Codex adversarial review caught four substantive issues, all reflected here.
> **Originating motivation:** [`docs/facebook-integration-strategy.md`](../../facebook-integration-strategy.md) Tier 1 item — the U5 (cancellations / conflicts) row in the use-case table. Charleston-bridge-run scenario from `docs/facebook-user-research.md` line 39.

## Context

When a kennel posts on Facebook (or via any source) that they're cancelling a specific run — typically due to a city event, weather, or hare unavailability — HashTracks today shows a phantom event because the source keeps emitting the same RRULE/calendar entry. The only available correctness path is `deleteEvent`, which has three problems:

1. It loses the audit trail (why was this event removed?).
2. The next scrape recreates the same event (STATIC_SCHEDULE re-emits weekly; Google Calendar still has the entry).
3. There's no way to undo a delete that turns out to be premature.

This spec adds a first-class **admin cancellation override**: an admin marks an event cancelled with a reason; the override survives re-scrapes; the public-facing UI hides the event the same way it already hides reconciler-cancelled events.

## Goals

- Admin can cancel a single event (any source type) with a required reason.
- The cancellation is **sticky** — survives all subsequent merge / reconcile passes.
- Un-cancel is one-click and restores normal merge behavior.
- Audit history of cancel/uncancel transitions is durable (survives re-cancel; lost only on hard delete).
- Zero changes to the public-facing user UX.

## Non-goals

- Bulk cancellation (multi-select, date-range). Single-event-at-a-time only. Bulk is a UX speedup that can layer on without changing the data model. Out of scope; revisit if multi-week-hiatus cancellations become common.
- A dedicated `/admin/events/[id]` detail page. Existing list-with-row-action surface is enough for v1.
- Public-facing UI changes. Admin-cancelled events flow through the existing `status: { not: "CANCELLED" }` filter and stay hidden. Showing cancellations to users with reason-banners is a separate UX feature; out of scope.
- iCal `STATUS:CANCELLED` export. The current `src/lib/calendar.ts` does not skip CANCELLED events at all (pre-existing bug for *all* CANCELLED events, not introduced here). Out of scope; flagged as a follow-up.
- A separate `EventAuditLog` table. JSON column on Event is sufficient for v1 audit needs.
- Auto-detecting "kennel posted a different run on a previously-cancelled date." See "Known limitation" below.
- A separate "kennel hiatus" concept distinct from event cancellation. If a kennel goes on extended hiatus, admin cancels each upcoming event individually; range support is YAGNI until proven.

## Data model

Three new nullable fields on `Event` for current state, plus one append-only history field.

### Schema change (`prisma/schema.prisma` Event model, lines 320–378)

```prisma
model Event {
  // ... existing fields unchanged
  status                    EventStatus @default(CONFIRMED)
  // ... existing fields (isManualEntry, submittedByUserId, isCanonical, etc.) unchanged

  adminCancelledAt          DateTime?  // null = no admin override; non-null = locked
  adminCancelledBy          String?    // Clerk userId of the admin (matches User.clerkUserId shape)
  adminCancellationReason   String?    // free-text, required at action layer (3–500 chars after trim)
  adminAuditLog             Json?      // append-only history; see "Audit log shape" below

  // ... timestamps unchanged
}
```

### Semantics

- **Atomic group**: `adminCancelledAt`, `adminCancelledBy`, `adminCancellationReason` are set together (admin-cancel) and cleared together (un-cancel). No mixed states.
- **Lock signal**: `adminCancelledAt != null` is the sole signal that an admin has explicitly cancelled. Used by the merge pipeline guard.
- **`status` is the rendering source-of-truth.** Admin-cancel always sets `status = "CANCELLED"`. Un-cancel always sets `status = "CONFIRMED"` regardless of what the source is currently emitting. After un-cancel, the reconciler re-cancels normally on the next scrape if the source has stopped emitting.
- **`adminAuditLog` is append-only**: never rewritten, only extended. Each cancel/uncancel transition appends one entry. Survives a cancel→uncancel→re-cancel cycle. Lost only on hard `deleteEvent`/`deleteEventsCascade` (acceptable v1 boundary; RawEvents are also lost in those paths).

### Audit log shape

Reuses `appendAuditLog()` and the `AuditLogEntry` interface from `src/lib/misman/audit.ts`. The util is generic (just appends to a JSON array), but its current `AuditAction` type union (`"record" | "update" | "remove" | "clear" | "import" | "hare_sync"`) is misman-specific. The implementation must extend that union to include `"cancel" | "uncancel"` (or widen it to `string`) — `writing-plans` decides whether to keep `audit.ts` under `misman/` and just extend the union, or move it to `src/lib/audit.ts` and rename the misman-specific docstring. Either is acceptable; the public function signatures don't change.

Each entry follows the existing `AuditLogEntry` shape:

```ts
// Existing in src/lib/misman/audit.ts after extending AuditAction:
interface AuditLogEntry {
  action: AuditAction; // now includes "cancel" | "uncancel"
  timestamp: string;   // ISO 8601
  userId: string;      // Clerk userId
  changes?: Record<string, { old: unknown; new: unknown }>;
  details?: Record<string, unknown>;
}

// Cancel entry concrete shape:
{
  action: "cancel",
  timestamp: "2026-05-03T14:22:31.000Z",
  userId: admin.clerkUserId,
  changes: { status: { old: "CONFIRMED", new: "CANCELLED" } },
  details: { reason: trimmed },
}

// Uncancel entry (no reason; status flips back):
{
  action: "uncancel",
  timestamp: "2026-05-04T09:15:02.000Z",
  userId: admin.clerkUserId,
  changes: { status: { old: "CANCELLED", new: "CONFIRMED" } },
}
```

The log is `null` for events that have never had an admin cancellation. After the first cancel, it's `[entry]`. After un-cancel, `[cancelEntry, uncancelEntry]`. After re-cancel, three entries, etc.

### Migration

Pure additive, all nullable, no backfill. Existing CANCELLED events (set by the reconciler) keep all four new fields `null` and behave exactly as today. No data risk.

```sql
-- Generated by `npm run prisma -- migrate dev --name add_admin_cancellation_override`
ALTER TABLE "Event" ADD COLUMN "adminCancelledAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "adminCancelledBy" TEXT;
ALTER TABLE "Event" ADD COLUMN "adminCancellationReason" TEXT;
ALTER TABLE "Event" ADD COLUMN "adminAuditLog" JSONB;
```

### Why not the alternatives

- **Generic `manualOverrides: Json` field.** Forward-compatible if we add other override types later (manually-edited start time, location override). Costs typed-wrapper complexity and validation surface today for a use case we don't have. YAGNI.
- **Separate `EventOverride` table.** Cleanest for many overrides per event over time. Adds a join to merge-pipeline reads (hot path). Overkill for one boolean lock per event.
- **Three fields without `adminAuditLog`.** Simpler but loses history on cancel→uncancel→re-cancel. Codex's review correctly identified this as undermining the feature's audit-friendliness premise. The JSON log is cheap to add now; retrofitting later is harder.

## Pipeline integration

The merge pipeline currently has **two** restore sites that flip `CANCELLED → CONFIRMED` when a fresh RawEvent re-asserts the schedule. Both must be guarded.

### Centralized helper (new)

```ts
// src/pipeline/merge.ts (or a small new file imported by merge.ts)
export function isAdminLocked(event: { adminCancelledAt: Date | null }): boolean {
  return event.adminCancelledAt !== null;
}
```

A single helper used at every restore site. Future restore code paths must consult `isAdminLocked()` before flipping status. The helper exists primarily to centralize the invariant; even if we only have two call sites today, it documents the rule.

### Site 1: `upsertCanonicalEvent()` (~line 990)

Today (paraphrased):

```ts
const shouldRestore = existing.status === "CANCELLED";
```

Becomes:

```ts
const shouldRestore = existing.status === "CANCELLED" && !isAdminLocked(existing);
```

### Site 2: `refreshExistingEvent()` called from `handleDuplicateFingerprint()`

This is the **steady-state path** that fires on every weekly STATIC_SCHEDULE re-scrape. Today it has its own independent `existingEvent?.status === "CANCELLED"` check that flips status back to CONFIRMED. Becomes:

```ts
if (existingEvent?.status === "CANCELLED" && !isAdminLocked(existingEvent)) {
  // existing restore logic
}
```

**This is the path Codex flagged as the silent feature-killer.** Without guarding it, the override would be undone on every routine scrape.

### Reconciler (`src/pipeline/reconcile.ts`) — no change

The reconciler only touches `status: "CONFIRMED"` orphans (events whose source stops emitting them). It never reads or writes already-CANCELLED rows. An admin-cancelled event is already CANCELLED, so the reconciler ignores it. No changes needed.

### Field updates remain unguarded

When a cancelled event has admin lock + an incoming RawEvent, the merge still updates fields like `description`, `locationName`, `startTime`, etc. The lock is **only** on the status restore. Rationale: if the source corrects a typo or updates the location, the admin viewing the cancelled row should see the latest data.

This produces a **known limitation** documented below.

### Required regression test

The implementation plan must include a Vitest case that:

1. Creates an event in CONFIRMED state from a STATIC_SCHEDULE source.
2. Re-runs the same scrape (deduplicate-fingerprint path) and asserts status stays CONFIRMED.
3. Sets admin override (CANCELLED + the lock fields).
4. Re-runs the same scrape (deduplicate-fingerprint path).
5. Asserts status remains CANCELLED.

Step 4 specifically exercises `refreshExistingEvent()`. Without that step, the test passes against the line-990 guard alone — which is exactly the silent failure mode Codex caught.

### Known limitation: replacement runs on a cancelled date

**Scenario:** Admin cancels Saturday May 3 (city bridge run). Two weeks later, the kennel posts a *materially different* run on the same Saturday May 3 (memorial trail, different title/location). The merge matches by `(kennelId, date)`, updates the fields in place, but `status` stays CANCELLED. The replacement run is hidden behind the old cancellation reason.

**v1 expectation:** admin un-cancels (or deletes) the override when this happens. The merge pipeline does not auto-detect "same date, different signature → fork to a new canonical row."

**Why we accept this in v1:**
- The motivating use case (FB-only kennel cancels their weekly run) doesn't trigger it — the source keeps emitting the same RRULE-generated event with the same fields.
- The replacement-run scenario is rare and operationally visible (admin sees the cancelled-row's location/title diverging from what the kennel posted).
- Auto-forking adds significant merge complexity ("materially different" is fuzzy) and risks worse failure modes (incorrectly forking benign field updates).

**v2 path if the limitation becomes painful:** add a "fields diverged from cancellation snapshot → fork to new canonical row" check. The cancellation could capture a snapshot of `(title, locationName, startTime)` at cancel time; the merge compares incoming RawEvent fields against the snapshot and forks above a diff threshold.

## Server actions

All actions live in `src/app/admin/events/actions.ts` and follow the existing pattern: `getAdminUser()` gate, return `ActionResult<T>`, revalidate the right paths, log to console for breadcrumb visibility.

### `adminCancelEvent(eventId, reason)` — new

```ts
export async function adminCancelEvent(
  eventId: string,
  reason: string,
): Promise<ActionResult<{ event: Event }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const trimmed = reason.trim();
  if (trimmed.length < 3) return { error: "Reason must be at least 3 characters" };
  if (trimmed.length > 500) return { error: "Reason must be 500 characters or fewer" };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { kennel: { select: { slug: true } } }, // for revalidation
  });
  if (!event) return { error: "Event not found" };
  if (event.adminCancelledAt) {
    return { error: "Event already admin-cancelled — un-cancel first to change reason" };
  }

  const auditEntry: AuditLogEntry = {
    action: "cancel",
    timestamp: new Date().toISOString(),
    userId: admin.clerkUserId,
    changes: { status: { old: event.status, new: "CANCELLED" } },
    details: { reason: trimmed },
  };

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      status: "CANCELLED",
      adminCancelledAt: new Date(),
      adminCancelledBy: admin.clerkUserId,
      adminCancellationReason: trimmed,
      adminAuditLog: appendAuditLog(event.adminAuditLog, auditEntry),
    },
  });

  console.log(
    `[admin-cancel] event=${eventId} kennel=${event.kennelId} admin=${admin.clerkUserId} reason="${trimmed}"`,
  );

  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  revalidateTag(HARELINE_EVENTS_TAG);
  revalidatePath(`/kennels/${event.kennel.slug}`); // SLUG, not kennelId
  revalidatePath(`/hareline/${eventId}`); // event detail page

  return { success: true, event: updated };
}
```

**Key points:**
- `kennel: { select: { slug: true } }` is included specifically so revalidation hits the real public route (`/kennels/[slug]`), not a non-existent `/kennels/[kennelId]` path. This was a Codex finding; the implementation must use the slug.
- The "already admin-cancelled" guard prevents accidental reason-overwrite. Forces the operator to un-cancel first.
- Audit entry is appended to `adminAuditLog` in the same `update`.

### `uncancelEvent(eventId)` — extended

The existing action (already in the file) restores `CANCELLED → CONFIRMED`. Three changes:

1. Clear all three current-state fields (`adminCancelledAt`, `adminCancelledBy`, `adminCancellationReason`) in the same `prisma.event.update`.
2. Append an `{ action: "uncancel", changes: { status: { old: "CANCELLED", new: "CONFIRMED" } } }` entry to `adminAuditLog`. No `details.reason` (un-cancel doesn't take one).
3. Add `revalidatePath(/kennels/${kennel.slug})` to the existing revalidation block — currently missing, small bonus fix.

The action does not branch on whether the event was admin-cancelled vs reconciler-cancelled. One mental model: "undo cancellation, regardless of who set it." If the source still isn't emitting the event after un-cancel, the reconciler will re-cancel on the next scrape, exactly like today.

### Validation rules (server-enforced)

| Field | Rule | Error message |
|---|---|---|
| `eventId` | exists in DB | `"Event not found"` |
| `reason` | trimmed length ≥ 3 | `"Reason must be at least 3 characters"` |
| `reason` | trimmed length ≤ 500 | `"Reason must be 500 characters or fewer"` |
| Already locked | `event.adminCancelledAt == null` | `"Event already admin-cancelled — un-cancel first to change reason"` |

These are enforced server-side. The UI dialog mirrors them client-side for fast feedback but is not the source of truth.

### Auth

`getAdminUser()` from `src/lib/auth.ts`. Same gate every other action in the file uses. No new permission concepts.

`adminCancelledBy` stores `clerkUserId` (the Clerk-side identifier), not the local `User.id`. Reasoning: future viewer code resolving "who cancelled this?" can hit Clerk for display name / avatar without a local DB join. The existing `User.clerkUserId` field on the local `User` model also accepts the same value, so a join is possible if needed.

## Admin UI

Per the brainstorming directive, the visual design is owned by `frontend-design` during implementation. This section locks the **interaction model** and the components/patterns to reuse. `frontend-design` does not get to redo the data model or change which events are user-visible.

### Surface

Existing `/admin/events` page (`src/app/admin/events/page.tsx`). The current `EventTable` component already has a row-action dropdown (delete, etc.). Add a **"Cancel event…"** menu item to the same dropdown. No new page, no new tab, no new column.

Trigger: 3-dot icon (`MoreHorizontal` from lucide), consistent with `AlertCard.tsx` — the established admin row-action vocabulary.

### Interaction flow

1. Admin scans `/admin/events`, finds the event.
2. Clicks the row's 3-dot menu → **"Cancel event…"** (trailing `…` signals a confirmation step).
3. A `Dialog` opens with:
   - **Header**: kennel shortName + date + title (so admin can confirm the right event).
   - **Body**: required `Textarea` for reason (3–500 chars, live char counter, error styling on invalid).
   - **Footer**: `Cancel` button (closes dialog, no DB change) and a destructive `Confirm cancellation` button (disabled until reason is valid).
4. On confirm: server action runs via `useTransition()`, `sonner` toast shows success or error, `router.refresh()` updates the row in place. The row now shows `Status: CANCELLED` and the kennel's hareline view drops the event.

### Re-cancel and un-cancel

If the row is already admin-cancelled, the dropdown swaps the menu item:

- "Cancel event…" → **"Un-cancel event"** (no dialog; one click; toast on success).
- This matches the existing one-click `uncancelEvent` UX. Re-cancelling with a different reason is `Un-cancel → Cancel event…` (two-step intentional).

### Lock-state surfacing

When an event row has `adminCancelledAt != null`, surface the override metadata via a small lock icon (`lucide` `Lock`) next to the CANCELLED badge with a `Tooltip`:

> Cancelled by [Clerk display name or userId] on [date]: [reason]

If `adminAuditLog.length > 1` (multiple cancel/uncancel transitions), append `+ N prior cancellations` to the tooltip. Click-through to a full audit-log view is deferred to v2; the JSON is queryable from the DB without UI for now.

`frontend-design` validates whether this is inline-on-the-row, a separate column, or a different visual treatment. The data model and information shown are fixed; the visual treatment is open.

### Components & patterns reused

| Need | Pattern source |
|---|---|
| Row dropdown | `AlertCard.tsx` + existing `EventTable.tsx` (`DropdownMenu` family) |
| Confirmation dialog | Existing `EventTable.tsx` delete-preview dialog (`Dialog` + `Textarea`) |
| Toast feedback | `sonner` (used everywhere) |
| Lock badge / icon | `Tooltip` + `lucide` `Lock` |
| Server-action client glue | `useTransition()` + `router.refresh()` per `AlertCard.tsx` lines 122–146 |

No new shadcn components. No new dependencies.

### What `frontend-design` decides at implementation time

- Exact dialog copy and field labels.
- Whether the lock icon is inline with the status badge or in its own column.
- Mobile-friendly behavior (shadcn `DropdownMenu` should handle this; verify).
- Empty-state and error-state copy for the dialog.
- Visual treatment of the "+N prior cancellations" hint.

## Public-facing UX

**Zero changes.** Admin-cancelled events flow through the existing `status: { not: "CANCELLED" }` filter in `src/lib/event-filters.ts` and stay hidden from the hareline list, exactly like reconciler-cancelled events today. iCal export, `EventCard`, kennel detail pages, etc. — none need touching for this feature.

`src/lib/calendar.ts` does not currently emit `STATUS:CANCELLED` for any cancelled event (pre-existing gap, not introduced here). Out of scope; flagged as a follow-up.

## Edge cases the design intentionally allows

| Case | Behavior |
|---|---|
| Multi-source events (RawEvents from 3+ sources, e.g. NOSE) | Lock fires regardless of how many sources reassert |
| Source removes the event after admin cancels | Reconciler ignores already-CANCELLED rows; override stays |
| Source removes the event, admin un-cancels | Reconciler re-cancels on next scrape; new fields stay null (now reconciler-cancelled, not admin-cancelled). Audit log records the un-cancel; the reconciler-cancel doesn't append a separate audit entry. Acceptable. |
| Two admins cancel same event in quick succession | Last write wins on fields; both hit row-level lock; audit log records both attempts in order |
| Race during the action (scrape mid-flight) | Postgres row-level locking serializes; whichever writes last wins. Acceptable for low-traffic admin path. |
| Hard delete on admin-cancelled event | Row dies, audit log dies with it. Symmetric with how `deleteEvent` already loses RawEvent context. v1 boundary. |
| Bulk delete (`deleteEventsCascade`) | Unchanged; no parallel guard needed (deletion is intentional removal, not auto-pipeline behavior) |
| Replacement run on cancelled date | Documented limitation above; admin un-cancels manually |

## Verification & testing

### Unit / integration tests (Vitest)

1. **Action: `adminCancelEvent`** — happy path, validation errors (short/long reason, missing event, already-locked), audit log append shape, audit log accumulates across cancel/uncancel/cancel cycle.
2. **Action: `uncancelEvent`** — clears all three lock fields, appends audit entry, works regardless of who set CANCELLED.
3. **Pipeline: merge restore via `upsertCanonicalEvent`** — admin-locked event stays CANCELLED when source re-asserts.
4. **Pipeline: merge restore via `refreshExistingEvent` (duplicate-fingerprint path)** — same. **This is the regression test Codex's review demanded; it must exist.**
5. **Pipeline: field updates flow through the lock** — admin-cancelled event still receives location/description updates from incoming RawEvent.
6. **Pipeline: reconciler ignores admin-cancelled events** — admin-locked + source stops emitting → no double-cancel attempt.
7. **Audit log shape** — append-only, ISO timestamps, includes admin/reason/before-after on cancel entries.

### Manual verification (admin)

1. Create or pick a real STATIC_SCHEDULE event in production (preview deployment).
2. Cancel it via the new dialog with a reason.
3. Verify it disappears from the hareline.
4. Wait for the next scrape window (or trigger manually).
5. Verify the event is still cancelled.
6. Un-cancel.
7. Verify it reappears on the hareline.
8. Verify `adminAuditLog` in the DB shows two entries (cancel + uncancel) with the right shape.

### CI gates (per project conventions)

- `npx tsc --noEmit && npm run lint && npm test` clean before opening PR.
- `/simplify` review on the diff.
- `/codex:adversarial-review` on the diff before opening PR.

## Files touched (estimate)

| Purpose | File | Change |
|---|---|---|
| Schema | `prisma/schema.prisma` | +4 nullable fields on Event model |
| Migration | `prisma/migrations/<ts>_add_admin_cancellation_override/migration.sql` | new file |
| Server actions | `src/app/admin/events/actions.ts` | +1 new action; modify `uncancelEvent`; both call audit-log helper |
| Pipeline helper | `src/pipeline/merge.ts` (or new util) | +1 `isAdminLocked()` helper; +2 guard sites |
| Tests | `src/pipeline/merge.test.ts` | +regression tests for both restore sites |
| Tests | `src/app/admin/events/actions.test.ts` | +tests for new action + extended uncancel |
| Admin UI | `src/components/admin/EventTable.tsx` | +dropdown item, +Dialog, +`useTransition` glue |
| Admin UI | `src/components/admin/CancellationOverrideDialog.tsx` (new) | the Dialog component (`frontend-design` shapes the copy/visuals) |
| Audit util | reuse `src/lib/misman/audit.ts` | no changes; just import `appendAuditLog` |

The implementation plan from `writing-plans` will sequence these into atomic, testable steps.

## Decision record

This section is here so the next person reading the spec doesn't re-derive the same conclusions.

1. **Single event, not range / bulk.** Bulk is a UX speedup, not a correctness primitive. Re-evaluate when multi-week-hiatus cancellations become a recurring ask.
2. **Source-agnostic, not STATIC_SCHEDULE-only.** The Charleston use case was a Google Calendar kennel; the FB strategy doc's STATIC_SCHEDULE framing was incomplete. Same code complexity.
3. **Three current-state fields + append-only JSON audit log on Event.** Not a separate `EventOverride` table (overkill); not a generic `manualOverrides: Json` (over-engineered for one override type); not three fields without a log (loses history on re-cancel — Codex correctly flagged this).
4. **Two merge restore sites guarded via centralized `isAdminLocked()` helper.** Codex caught that the design originally only named the line-990 site; the duplicate-fingerprint path at `refreshExistingEvent()` is the steady-state path that fires on every weekly STATIC_SCHEDULE re-scrape. Both must be guarded; future restore code paths must consult the helper.
5. **Lock guards status restore only, not field updates.** If a source corrects a typo or updates the location, the admin viewing the cancelled row should see the latest data. The replacement-run-on-cancelled-date scenario is a known limitation; admin un-cancels manually when it happens. v2 can auto-fork via a snapshot-diff if this becomes painful.
6. **Public UX unchanged.** Admin-cancelled events stay hidden from the hareline like reconciler-cancelled events. Showing-with-reason is a separate UX feature for v2.
7. **iCal `STATUS:CANCELLED` not emitted.** Pre-existing bug for all CANCELLED events (not introduced here). Out of scope; tracked as a follow-up.
8. **`frontend-design` owns the visual treatment, not the data model.** Visual decisions (dialog copy, lock-icon placement, mobile behavior) are open at implementation time. The interaction model and components/patterns are locked here.
9. **Codex adversarial-review found 4 substantive issues pre-code; all 4 are reflected in this spec.** Specifically: two-site merge guard, replacement-run known limitation, slug-based revalidation, append-only audit log. Without those corrections, the feature would silently fail on its primary use case.
