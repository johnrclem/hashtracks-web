# Misman Attendance Management — Implementation Plan

## Context

Kennel mismanagement currently tracks attendance in Google Sheets — one column per trail, manual hasher name entry, inconsistent spelling. The Misman feature replaces this with a dedicated tool tied to HashTracks events, designed for mobile use at trail.

Full requirements: `docs/misman-attendance-requirements.md`

No roadmap dependencies — this feature is independent of the unfinished source scaling and config-driven onboarding items.

---

## Sprint Breakdown

### Sprint 8a: Schema + Auth Foundation

**Goal**: All database models, enum changes, auth helper. No UI — data layer only.

**Schema changes** (`prisma/schema.prisma`):
- Rename `UserKennelRole.SCRIBE` → `MISMAN` (confirmed: SCRIBE unused in all app code — only in schema + docs)
- Add enums: `HasherLinkStatus`, `ReferralSource`
- Add 6 models: `KennelHasher`, `KennelHasherLink`, `KennelAttendance`, `MismanRequest`, `RosterGroup`, `RosterGroupKennel` (exactly per requirements doc)
- Add relations to `User`, `Kennel`, `Event`

**Auth** (`src/lib/auth.ts`):
- Add `getMismanUser(kennelId)` — returns user if MISMAN/ADMIN for kennel or site admin
- Add `getRosterKennelIds(kennelId)` — returns all kennel IDs in the same Roster Group (or just the one if standalone)

**Event cascade** (`src/app/admin/events/actions.ts`):
- Add `kennelAttendance.deleteMany` to all 3 delete functions (`deleteEvent`, `bulkDeleteEvents`, `deleteSelectedEvents`)

**Tests**:
- Auth helpers: getMismanUser (5 cases), getRosterKennelIds (standalone + grouped)
- Event cascade: verify kennelAttendance included
- Add test factories: `buildKennelHasher`, `buildKennelAttendance`, `buildMismanRequest`

---

### Sprint 8b: Misman Dashboard + Role Assignment + Request Flow ✅

**Goal**: Users can request misman access, admins/mismans approve, mismans see a dashboard.

**Routes**:
- `/misman` — Dashboard: kennel cards for each misman kennel, pending requests (site admins see ALL pending requests)
- `/misman/layout.tsx` — Simple metadata layout (no auth guard — page handles access)
- `/admin/misman-requests` — Admin panel tab showing all misman requests with approve/reject

**Server actions** (`src/app/misman/actions.ts`):
- `requestMismanAccess(kennelId, message?)` — validates no duplicate PENDING, no existing MISMAN role
- `approveMismanRequest(requestId)` — upserts UserKennel with MISMAN role (reused by both `/misman` and `/admin`)
- `rejectMismanRequest(requestId)` — (reused by both `/misman` and `/admin`)

**Admin role management** (`src/app/admin/kennels/actions.ts`):
- `assignMismanRole(kennelId, userId)` — site admin direct assignment
- `revokeMismanRole(kennelId, userId)` — downgrade to MEMBER

**Admin panel** (`src/app/admin/layout.tsx`):
- Added "Misman" tab with pending count badge (between Requests and Kennels)
- `MismanRequestQueue` component in `src/components/admin/` — approve/reject UI reusing existing server actions

**UI modifications**:
- `/kennels/[slug]/page.tsx` — Add `MismanAccessButton` (visible to subscribed users without MISMAN/ADMIN)
- `Header.tsx` — Add "Misman" link for authenticated users (page handles access check)

**Components**: `MismanDashboard`, `MismanKennelCard`, `MismanAccessButton`, `MismanRequestQueue` (admin)

---

### Sprint 8c: Core Attendance Form + Roster CRUD (MVP)

**Goal**: The primary mobile-first attendance form + roster management. This is the **MVP deployment point** — it replaces the Google Sheet.

**Routes**:
- `/misman/[slug]/layout.tsx` — Kennel-level auth + tabbed nav (Attendance | Roster | History)
- `/misman/[slug]/attendance` — Attendance form (defaults to today's event)
- `/misman/[slug]/attendance/[eventId]` — Attendance for specific event
- `/misman/[slug]/roster` — Roster table (search, add, edit, delete)

**Roster actions** (`src/app/misman/[slug]/roster/actions.ts`):
- `createKennelHasher(kennelId, data)` — validates hashName or nerdName required
- `updateKennelHasher(hasherId, data)` — misman of kennel or roster group
- `deleteKennelHasher(hasherId)` — blocks if has attendance records
- `searchRoster(kennelId, query)` — fuzzy search across roster scope

**Attendance actions** (`src/app/misman/[slug]/attendance/actions.ts`):
- `recordAttendance(eventId, kennelHasherId, data)` — upsert (unique constraint handles dupes)
- `removeAttendance(kennelAttendanceId)`
- `updateAttendance(kennelAttendanceId, data)` — per-field updates
- `clearEventAttendance(eventId)` — bulk delete with count confirmation
- `getEventAttendance(eventId)` — for polling refresh
- `quickAddHasher(kennelId, eventId, data)` — create hasher + record attendance in one step

**Key UI components**:
- `AttendanceForm` — Event selector + autocomplete search (shadcn Command/cmdk) + live attendee list + polling (4s)
- `AttendanceRow` — Per-hasher row with toggle switches (paid, hare, virgin, visitor) + conditional visitor fields
- `EventSelector` — Dropdown of kennel events (last year, defaults to today)
- `RosterTable` — Searchable table with inline edit, per-hasher stats columns
- `HasherForm` — Dialog for add/edit (hashName, nerdName, email, phone, notes)

**Polling**: `useEffect` + `setInterval(4000)` calling `getEventAttendance`, silent on failure (mobile network tolerance)

**UX Fixes (post-MVP polish):**
- `AttendanceRow` — Responsive two-line layout on mobile (name on first line, toggles on second) to prevent name truncation
- `AttendanceRow` — Tooltip (`title`) and `aria-label` attributes on $, H, V, Vis toggle switches for accessibility
- `EventSelector` — Event dropdown filtered to current kennel only (not full roster group scope); keeps event selection focused when managing a specific kennel
- `HistoryList` — History page filtered to current kennel only (not roster group scope); matches attendance dropdown fix
- `RosterTable` — Column sorting on Hash Name, Kennel, and Runs headers (click-to-sort with arrow indicators)
- `RosterTable` — Delete confirmation uses AlertDialog instead of native `confirm()`
- `AttendanceForm` — Clear All Attendance uses AlertDialog with event info instead of native `confirm()`
- `MismanDashboard` — History button added to kennel cards alongside Attendance and Roster
- `MismanKennelLayout` — Kennel switcher dropdown in heading for quick navigation between managed kennels
- `AttendanceRow` — Semantic toggle track colors (green=paid, orange=hare, pink=virgin, blue=visitor)

---

### Sprint 8d: History + Hasher Detail + Roster Seeding ✅

**Goal**: Complete data views and seed rosters from existing hare data.

**Routes**:
- `/misman/[slug]/history` — Per-event attendance history, filterable by date range, paginated (25 per page)
- `/misman/[slug]/roster/[hasherId]` — Hasher detail: stats grid, contact info, user link status, full attendance history, edit/delete

**Server actions** (`src/app/misman/[slug]/history/actions.ts`):
- `getAttendanceHistory(kennelId, filters?)` — paginated event summaries with attendee counts, date filtering, roster group scope
- `getHasherDetail(kennelId, hasherId)` — full hasher profile with computed stats (total runs, hare count, paid count, first/last run), attendance history, user link data
- `seedRosterFromHares(kennelId)` — scans EventHare (last year, roster group scope), case-insensitive dedup against existing roster (hash names + nerd names), creates KennelHasher entries via `createMany`

**Key UI components**:
- `HistoryList` — Client component with expandable event cards (click to reveal attendee list with $ H V Vis indicators), date range filters, Previous/Next pagination
- `HasherDetail` — Client component with stats grid (total runs, times hared, times paid, hare rate), contact section, attendance history list, edit/delete actions
- `SeedRosterButton` — "Seed from Hares" button shown when roster is empty; confirmation dialog before seeding

**UI modifications**:
- `RosterTable` — Hash names now link to `/misman/[slug]/roster/[hasherId]` detail page
- `roster/page.tsx` — Shows `SeedRosterButton` when roster is empty

**Seed data** (`prisma/seed.ts`):
- RosterGroup seeding: "NYC Metro" (NYCH3, BrH3, NAH3, Knick, QBK, SI, Columbia, Harriettes, GGFM, NAWWH3), "Philly Area" (BFM, Philly H3)
- Upsert pattern: idempotent re-run safe

**Tests**: 14 new tests (getAttendanceHistory 4, getHasherDetail 5, seedRosterFromHares 5)

---

### Sprint 8e: Smart Suggestions + User Linking + Verification ✅

**Goal**: Make the attendance form faster with scoring algorithm; connect misman attendance to user logbooks.

**Smart suggestions** (`src/lib/misman/suggestions.ts`):
- Pure function: `computeSuggestionScores()` — frequency (0.5) + recency (0.3) + streak (0.2)
- Frequency/streak scoped to this kennel; recency considers roster group
- Threshold ≥ 0.3 = top suggestion; returns empty if < 3 events of data
- Streak caps at 4, lookback window 180 days
- `getSuggestions(kennelId)` server action in attendance actions — fetches data, calls pure function, enriches with hasher names
- `SuggestionList` component renders horizontally-wrapped chips above HasherSearch; fetched once on mount

**Fuzzy name matching** (`src/lib/fuzzy.ts`):
- Added `fuzzyNameMatch(a, b)` — pairwise name comparison using existing Levenshtein, returns 0–1 similarity score
- Case-insensitive, whitespace-trimmed, used by user linking

**User linking** (roster actions):
- `suggestUserLinks(kennelId)` — fuzzy match unlinked KennelHashers against roster-scope Users (hash name, nerd name, cross-compare); threshold ≥ 0.7
- `createUserLink(kennelId, hasherId, userId)` — creates SUGGESTED link; validates no existing active link, detects duplicate user in roster scope
- `confirmUserLink(linkId, userId)` — user confirms from logbook side; sets status to CONFIRMED
- `dismissUserLink(kennelId, linkId)` — misman dismisses suggestion
- `revokeUserLink(kennelId, linkId)` — misman revokes confirmed link; preserves attendance records
- `UserLinkSection` component on HasherDetail page: find match, dismiss, revoke actions
- `RosterTable` link status indicator (L=linked, P=pending) next to hasher names

**Logbook integration** (`src/app/logbook/`):
- `getPendingConfirmations()` — finds KennelAttendance for CONFIRMED-linked hashers where user has no Attendance record
- `confirmMismanAttendance(kennelAttendanceId)` — creates Attendance (CONFIRMED, HARE if haredThisTrail else RUN, isVerified=true)
- `PendingConfirmations` component at top of `/logbook` page — confirm or dismiss (localStorage for MVP)

**Verification** (`src/lib/misman/verification.ts`):
- `deriveVerificationStatus()` — pure function: verified / misman-only / user-only / none
- `computeVerificationStatuses()` — batch computation for event lists
- `VerificationBadge` component (V=green, M=yellow, U=blue) on HasherDetail attendance rows
- HasherDetail page fetches linked user's Attendance records to derive status per event

**Tests**: ~35 new tests (fuzzy 7, suggestions 12, getSuggestions 3, user linking 16, logbook 7, verification 6)

---

### Sprint 8f: Roster Groups Admin + Merge Duplicates

**Goal**: Admin roster group management and the duplicate merge workflow.

**Roster Groups** (`src/app/admin/roster-groups/`):
- CRUD: create group, add/remove kennels, delete group
- Duplicate scan on kennel addition (fuzzy match across combined roster)
- Tab in admin layout

**Merge duplicates** (roster actions):
- `previewMerge(primaryId, secondaryIds[])` — preview combined stats, conflicts, link status
- `executeMerge(primaryId, secondaryIds[], choices)` — transaction: reassign attendance (OR-merge for same-event dupes), transfer link, delete losers, log audit
- Block merge if linked to different Users

**Kennel deletion guard** (`src/app/admin/kennels/actions.ts`):
- Block deletion if KennelAttendance exists; cascade clean if no attendance data

---

## Sprint Dependencies

```
8a (Schema + Auth)
 └→ 8b (Dashboard + Roles)
     └→ 8c (Attendance + Roster) ← MVP deployable here
         ├→ 8d (History + Seeding)
         └→ 8e (Suggestions + Linking)
              └→ 8f (Groups + Merge)
```

Sprints 8d and 8e can run in parallel after 8c.

---

## Key Files

| File | Sprint | Change |
|------|--------|--------|
| `prisma/schema.prisma` | 8a | 6 new models, 2 enums, SCRIBE→MISMAN, relations |
| `src/lib/auth.ts` | 8a | `getMismanUser()`, `getRosterKennelIds()` |
| `src/app/admin/events/actions.ts` | 8a | KennelAttendance cascade (3 functions) |
| `src/test/factories.ts` | 8a | Misman test builders |
| `src/app/misman/` | 8b+ | New route tree (dashboard, attendance, roster, history) |
| `src/components/misman/` | 8b+ | New component directory |
| `src/app/kennels/[slug]/page.tsx` | 8b | MismanAccessButton |
| `src/components/layout/Header.tsx` | 8b | Misman nav link |
| `src/app/admin/kennels/actions.ts` | 8b, 8f | Role mgmt, deletion guard |
| `src/app/admin/misman-requests/page.tsx` | 8b | Admin misman request approval page |
| `src/components/admin/MismanRequestQueue.tsx` | 8b | Admin request queue (reuses misman actions) |
| `src/app/misman/[slug]/history/actions.ts` | 8d | History query, hasher detail, roster seeding actions |
| `src/components/misman/HistoryList.tsx` | 8d | Expandable event history with date filters + pagination |
| `src/components/misman/HasherDetail.tsx` | 8d | Hasher profile with stats, attendance history, edit/delete |
| `src/components/misman/SeedRosterButton.tsx` | 8d | One-click roster seeding from hare data |
| `src/components/misman/KennelSwitcher.tsx` | 8d | Kennel dropdown switcher in misman layout |
| `src/components/ui/alert-dialog.tsx` | 8d | Radix AlertDialog (confirmation dialogs for destructive actions) |
| `src/app/misman/[slug]/roster/[hasherId]/page.tsx` | 8d | Hasher detail page (server component) |
| `src/lib/misman/suggestions.ts` | 8e | Scoring algorithm (pure function) |
| `src/lib/misman/verification.ts` | 8e | Derived verification status |
| `src/app/logbook/page.tsx` | 8e | Pending confirmations section |
| `src/app/admin/roster-groups/` | 8f | New admin page |
| `prisma/seed.ts` | 8d | RosterGroup seeding |

## Risks

- **SCRIBE→MISMAN rename**: Zero risk — confirmed no app code references SCRIBE
- **Roster Group query perf**: Indexes on `KennelHasher(kennelId)` handle it; monitor for large groups
- **Mobile polling at trail**: Optimistic UI + silent poll failures; "last synced" indicator
- **Merge irreversibility**: Full `$transaction` + audit log on surviving entry

## Verification

After each sprint:
1. `npx prisma migrate dev` — migration applies cleanly
2. `npm run build` — no type errors
3. `npm test` — all tests pass (existing + new)
4. Manual testing on localhost: exercise the new pages/forms
5. Deploy to Vercel staging, verify with real database
