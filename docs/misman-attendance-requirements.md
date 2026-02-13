# Kennel Attendance Management (Misman Tool)

## Problem

Kennel mismanagement currently tracks attendance and hash cash in Google Sheets — adding a new column per trail and manually typing out each hasher's name. Names are inconsistently spelled (no autocomplete), and the person recording often remembers the nerd name but forgets the hash name, or vice versa. There's no connection between the attendance sheet and the event data already on HashTracks.

## Opportunity

Give mismanagement a dedicated tool to capture and track attendance tied to events already stored on HashTracks, replacing their spreadsheet workflow with something faster, smarter, and mobile-friendly.

---

## Core Concepts

### KennelHasher (Kennel-Specific Roster)
- Each kennel maintains its own roster of hashers
- A hasher who runs with both NYCH3 and EWH3 has **separate entries** in each kennel's roster
- Each entry has: **hash name** (primary, public display) and **nerd name** (real name, private to misman only)
- Optional contact fields: **email** and **mobile phone** (private to misman only) — useful for future communication features (e.g., trail announcements, payment reminders)
- A KennelHasher can optionally be **linked to a site User** (see User Linking below)
- Roster entries are editable: fix spelling, add hash name after someone gets named, update nerd name, add contact info, etc.
- **Roster seeding**: pre-populate from existing hare data in the database (anyone who has hared for the kennel in the last year). Could also do a targeted scrape of hashnyc.com hare data if needed. Future option to import from an attendance spreadsheet with smart name matching.

### Kennel Permissions (Misman Role)
- **Replaces the existing `SCRIBE` role** in `UserKennelRole` — MISMAN is the canonical name for kennel-level attendance managers
- Permission hierarchy: **ADMIN > MISMAN > MEMBER** (ADMIN implicitly has all MISMAN permissions)
- Below site-level admin — misman can only manage their own kennel(s)
- **Multiple misman per kennel** — all see the same roster and attendance data (kennels typically have 2-4 mismanagement members)
- Grants access to: attendance form, kennel roster management, attendance history, pending user links
- **Assignment flow**:
  - Site admins can directly assign/revoke misman role per kennel (via admin panel)
  - Any authenticated user can **request** misman access from a kennel's detail page
  - Existing mismans or site admins can approve/reject requests
- See [Misman Assignment](#11-misman-assignment) for full details

### KennelAttendance (Misman-Recorded Attendance)
- Ties a KennelHasher to a canonical Event
- Separate from the existing personal `Attendance` model (user self-check-in)
- When a KennelHasher is linked to a site User, the two systems can cross-reference to provide a **verification flow** (see [Verification Flow](#7-verification-flow))
- **Lookback limit**: misman can record attendance for events up to **1 year** in the past (configurable later)
- Fields per record:
  - **paid** (boolean) — did they pay hash cash?
  - **haredThisTrail** (boolean) — were they a hare for this event?
  - **isVirgin** (boolean) — manual annotation, not auto-detected
  - **isVisitor** (boolean) — visiting from another kennel/city
  - **visitorLocation** (optional string) — where they're visiting from
  - **referralSource** (optional enum) — how they found the hash (virgins/visitors only)
    - Options: Word of mouth, Social media, Reddit, Meetup, Google search, Other
  - **referralOther** (optional string) — freetext when referralSource is `OTHER`
  - **recordedBy** (user ID) — which misman recorded this entry (audit trail)

---

## Schema Definitions

### Enum Changes

```prisma
// Replace SCRIBE with MISMAN
enum UserKennelRole {
  MEMBER  // Subscribed hasher
  ADMIN   // Can edit kennel details + all MISMAN permissions
  MISMAN  // Can manage roster + attendance for this kennel
}

enum HasherLinkStatus {
  SUGGESTED  // System or misman suggested link; awaiting user confirmation
  CONFIRMED  // User accepted the link
  DISMISSED  // User dismissed the suggestion
}

enum ReferralSource {
  WORD_OF_MOUTH
  SOCIAL_MEDIA
  REDDIT
  MEETUP
  GOOGLE_SEARCH
  OTHER
}
```

### New Models

```prisma
// ── KENNEL ROSTER ──

model KennelHasher {
  id        String   @id @default(cuid())
  kennelId  String
  hashName  String?  // Public display name (primary identifier)
  nerdName  String?  // Real name (private, visible to misman only)
  email     String?  // Contact email (private, visible to misman only)
  phone     String?  // Mobile phone (private, visible to misman only)
  notes     String?  // Internal misman notes (e.g., "prefers trail name Mudflap")

  kennel      Kennel              @relation(fields: [kennelId], references: [id])
  attendances KennelAttendance[]
  userLink    KennelHasherLink?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  // At least one of hashName or nerdName must be provided (enforced in app logic)
  @@index([kennelId])
  @@index([kennelId, hashName])
  @@index([kennelId, nerdName])
}

// ── USER ↔ KENNEL HASHER LINKING ──

model KennelHasherLink {
  id             String           @id @default(cuid())
  kennelHasherId String           @unique // One link per KennelHasher
  userId         String
  status         HasherLinkStatus @default(SUGGESTED)
  suggestedBy    String?          // "system" or misman user ID who suggested
  confirmedBy    String?          // User ID who confirmed (always the linked user)
  dismissedBy    String?          // User ID or misman ID who dismissed

  kennelHasher KennelHasher @relation(fields: [kennelHasherId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id])
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@index([userId, status])
}

// ── MISMAN-RECORDED ATTENDANCE ──

model KennelAttendance {
  id              String          @id @default(cuid())
  kennelHasherId  String
  eventId         String
  paid            Boolean         @default(false)
  haredThisTrail  Boolean         @default(false)
  isVirgin        Boolean         @default(false)
  isVisitor       Boolean         @default(false)
  visitorLocation String?         // Where they're visiting from
  referralSource  ReferralSource? // How they found the hash
  referralOther   String?         // Freetext when referralSource is OTHER
  recordedBy      String          // Misman user ID who created this record

  kennelHasher KennelHasher @relation(fields: [kennelHasherId], references: [id])
  event        Event        @relation(fields: [eventId], references: [id])

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([kennelHasherId, eventId]) // One attendance per hasher per event
  @@index([eventId])
  @@index([kennelHasherId])
}

// ── MISMAN ACCESS REQUESTS ──

model MismanRequest {
  id         String        @id @default(cuid())
  userId     String
  kennelId   String
  message    String?       // "I'm the misman for GGFM, please grant access"
  status     RequestStatus @default(PENDING) // Reuses existing enum
  resolvedBy String?       // User ID of admin or misman who approved/rejected
  resolvedAt DateTime?

  user    User    @relation(fields: [userId], references: [id])
  kennel  Kennel  @relation(fields: [kennelId], references: [id])
  createdAt DateTime @default(now())

  @@unique([userId, kennelId]) // One pending request per user per kennel
}

// ── ROSTER GROUPS (Cross-Kennel Suggestion Sharing) ──

model RosterGroup {
  id      String              @id @default(cuid())
  name    String              // "NYC Metro", "Philly Area"
  kennels RosterGroupKennel[]
  createdAt DateTime          @default(now())
}

model RosterGroupKennel {
  id       String      @id @default(cuid())
  groupId  String
  kennelId String
  group    RosterGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  kennel   Kennel      @relation(fields: [kennelId], references: [id])

  @@unique([groupId, kennelId])
}
```

### Relation Additions to Existing Models

```prisma
// Add to User model:
  kennelHasherLinks KennelHasherLink[]
  mismanRequests    MismanRequest[]

// Add to Kennel model:
  kennelHashers    KennelHasher[]
  mismanRequests   MismanRequest[]
  rosterGroups     RosterGroupKennel[]

// Add to Event model:
  kennelAttendances KennelAttendance[]
```

### Validation Rules (App Logic, Not Schema)

- `KennelHasher`: at least one of `hashName` or `nerdName` must be non-null
- `KennelAttendance.referralOther`: only set when `referralSource` is `OTHER`
- `KennelAttendance.visitorLocation`: only relevant when `isVisitor` is `true`
- `KennelAttendance.eventId`: event must belong to the same kennel as the `KennelHasher`'s kennel, and the event date must be within 1 year of today
- `MismanRequest`: cannot request if user already has MISMAN or ADMIN role for that kennel

---

## Features

### 1. Mobile-First Attendance Form
The primary interface — designed for use at trail on a phone.

- Misman selects an event (defaults to today's kennel event if one exists, but can pick **any event up to 1 year in the past** for catch-up)
- **Autocomplete search** for both hash name and nerd name (hash name is primary display)
- **Smart suggestions**: surface frequent, regular, and recent attendees at the top (see [Smart Suggestions Algorithm](#8-smart-suggestions-algorithm))
- **Roster group suggestions**: if the kennel belongs to a roster group, suggestions also pull from sibling kennels' rosters (see [Roster Sharing](#13-roster-sharing))
- Quick-add: if the hasher isn't in the roster, create a new KennelHasher inline from the form
- Per-hasher toggles: paid, hare, virgin, visitor
- Visitor sub-fields: location and referral source (shown only when visitor or virgin is checked)
- **Live view**: multiple mismans recording the same event see each other's additions in near real-time via polling (see [Concurrency](#10-concurrency))

### 2. Kennel Roster Management
- View/search all KennelHashers for a kennel
- Add, edit, delete roster entries
- Inline editing: fix spelling, add/change hash name or nerd name, update contact info
- **Delete rules**: if a KennelHasher has zero KennelAttendance records, delete immediately (likely a mistake); if they have attendance records, block deletion — misman must either merge with another entry or explicitly delete attendance records first (with confirmation prompt)
- **Merge duplicates**: select two (or more) KennelHasher entries and merge them (see [Merge Duplicates](#9-merge-duplicates))
- Show per-hasher stats: total runs, last attended, hare count

### 3. User Linking
- System **suggests** links between KennelHasher entries and site Users based on name matching (fuzzy match on hash name and nerd name against `User.hashName` and `User.nerdName`)
- Link suggestions are generated during page load of the roster management page (query Users who are members of the kennel via `UserKennel` and compare names)
- Misman can **manually trigger** a link suggestion or confirm a system suggestion
- Linked user sees a "pending confirmations" section at the top of their `/logbook` page ("NYCH3 misman recorded you at Run #2045 — confirm?")
- User **accepts** (creates/confirms Attendance record in their logbook) or **dismisses** the suggestion
- **Revocation**: either the user or the misman can revoke a confirmed link at any time (sets status back to DISMISSED, does not delete historical KennelAttendance records)
- A KennelHasher can exist without ever being linked (many hashers won't use the site)
- If a linked KennelHasher is merged with another entry, the link transfers to the surviving entry (see [Merge Duplicates](#9-merge-duplicates))

### 4. Edit and Delete Flows
- Misman can **edit** any KennelAttendance record after the fact (change paid flag, toggle hare, update visitor info, etc.)
- Misman can **delete** an individual KennelAttendance record
- Misman can **clear and redo** an entire event's attendance — requires a confirmation prompt: *"This will delete N attendance records for [Kennel] Run #[Number]. This cannot be undone. Continue?"*
- **No edit history for MVP** — `updatedAt` timestamp provides basic "last modified" info; full audit log is deferred

### 5. Hare Tracking
- Misman can flag any attendee as a hare for that event via the `haredThisTrail` boolean
- MVP: hare flag stays internal to KennelAttendance records
- **Future**: smart suggestion — if the event already has hares listed on the hareline (from scraping), suggest marking those attendees as hares on the form; eventually feed misman-recorded hares back into EventHare for public display

### 6. Attendance History & Reporting
- Per-event view: who attended, who paid, who hared, virgin/visitor counts
- Per-hasher view: all events attended at this kennel, total count, hare count
- **CSV export: deferred** — not implementing at this time; will revisit when there's user demand

---

## 7. Verification Flow

When a KennelHasher is linked to a site User, the system can cross-reference `KennelAttendance` (misman-recorded) and `Attendance` (user self-check-in) for the same event. This produces a **derived verification status** — no additional stored state needed:

| KennelAttendance exists? | User Attendance exists? | Status | Display |
|---|---|---|---|
| Yes | Yes | **Verified** | Both misman and user agree this person attended |
| Yes | No | **Misman-only** | Misman recorded attendance; user hasn't confirmed in their logbook |
| No | Yes | **User-only** | User self-reported; misman hasn't recorded them |
| No | No | — | No attendance record |

### How it works in practice:

1. **Misman records attendance at trail** → creates `KennelAttendance` record
2. If the KennelHasher has a confirmed `KennelHasherLink` → system shows a prompt on the linked user's `/logbook` page: *"NYCH3 misman recorded you at Run #2045 — confirm?"*
3. User **accepts** → system creates an `Attendance` record (status: `CONFIRMED`) in their logbook → status becomes **Verified**
4. User **dismisses** → no Attendance record created; KennelAttendance remains as **Misman-only**
5. Alternatively, if user checks in first (via the existing hareline check-in flow), misman later records them → status becomes **Verified** automatically

The existing `Attendance.isVerified` and `Attendance.verifiedBy` fields remain in the schema for potential future use but are **not used by this feature** — verification is derived from the existence of records in both tables.

---

## 8. Smart Suggestions Algorithm

When misman opens the attendance form for an event, the system suggests hashers most likely to be present. The goal: **the form should feel like checking names off a list, not searching from scratch.**

### Inputs
- KennelAttendance history for this kennel (last 6 months)
- Total kennel events in the same period (for frequency normalization)
- KennelHasher roster for the kennel (and sibling kennels in the same roster group)

### Scoring Formula

```
score = (0.5 × frequency) + (0.3 × recency) + (0.2 × streak)
```

| Factor | Calculation | Rationale |
|---|---|---|
| **Frequency** | `events_attended_last_6mo / total_kennel_events_last_6mo` | Catches regulars who come most weeks |
| **Recency** | `max(0, 1 - (days_since_last_attendance / 180))` | Boosts people who attended recently; decays to 0 after 6 months of absence |
| **Streak** | `min(1, consecutive_recent_events / 4)` | Rewards people on a current run of consecutive events (maxes out at 4) |

### Display
- **Top suggestions** (score > 0.3): shown as a tap-to-add list at the top of the form — fast one-tap check-off
- **Remaining roster**: available via autocomplete search (hash name or nerd name)
- **Roster group suggestions**: hashers from sibling kennels with score > 0.5 shown in a separate "Also runs with [sibling kennel]" section (see [Roster Sharing](#13-roster-sharing))
- **New hasher**: always available via "Add new" quick-add at the bottom

### Notes
- The algorithm weights and thresholds are initial values — expect to tune based on real-world data and user feedback
- Frequency window (6 months) and recency decay (180 days) should be constants, easy to adjust
- For kennels with < 3 events of attendance data, fall back to alphabetical roster display

---

## 9. Merge Duplicates

Merging KennelHasher entries is a common operation — misman discover that "Mudflap" and "Mud Flap" are the same person.

### Flow
1. Misman selects 2+ KennelHasher entries from the roster
2. System shows a merge preview:
   - Combined attendance count
   - Which name will be kept (misman chooses primary hash name and nerd name)
   - Contact info to keep (email, phone — misman picks or merges)
   - Any user link status
3. Misman confirms the merge

### Edge Case Rules

| Scenario | Resolution |
|---|---|
| **Both attended same event** | Keep one KennelAttendance record. Boolean flags merge with OR logic: if either was `paid=true`, result is `paid=true`. Same for `haredThisTrail`, `isVirgin`, `isVisitor`. Keep `visitorLocation` and `referralSource` from whichever record has them. |
| **Conflicting boolean flags** | `true` wins (conservative: if someone was marked as paid in either record, they paid) |
| **One has a user link, other doesn't** | Transfer the link to the surviving KennelHasher entry |
| **Both have user links to different Users** | **Block the merge.** Display error: *"These roster entries are linked to different site users ([User A] and [User B]). Unlink one before merging."* This is a data integrity safeguard — two different people should not be merged. |
| **Both have user links to the same User** | Merge normally; keep the CONFIRMED link (or the one with higher status). Delete the duplicate link. |
| **Contact info conflicts** | Misman chooses which email/phone to keep during the merge preview |

### After Merge
- The "losing" KennelHasher entry is deleted
- All KennelAttendance records from the losing entry are re-assigned to the surviving entry (except duplicates for the same event, which are merged per the rules above)
- **Merge is not reversible** — the merge action is logged with timestamp, misman user ID, and the IDs/names of the merged entries (stored as a JSON audit field on the surviving KennelHasher, or a separate audit log — TBD during implementation)

---

## 10. Concurrency

Multiple mismans (typically 2-4 per kennel) may record attendance for the same event simultaneously — this is the primary use case (replacing a shared Google Sheet).

### Approach: Optimistic UI + Polling

- **Optimistic updates**: when misman adds a hasher, the name appears immediately in their local UI
- **Polling**: the attendance form polls for updates every **3-5 seconds**, fetching the current list of KennelAttendance records for the selected event
- **Conflict resolution**: the `@@unique([kennelHasherId, eventId])` constraint prevents duplicate entries; if two mismans try to add the same hasher, the second write is a no-op (upsert semantics)
- **Edits**: if two mismans edit the same record simultaneously, last-write-wins on a per-field basis (standard database behavior)

### Why Not WebSockets?
- The polling payload is small (list of hasher IDs + flags for one event, typically < 100 entries)
- 3-5 second latency is acceptable for this use case (it's not a chat app)
- Avoids infrastructure complexity (no WebSocket server, no connection management)
- Can upgrade to Server-Sent Events or WebSockets later if polling feels sluggish

---

## 11. Misman Assignment

### Three Assignment Paths

**Path 1: Site Admin Direct Assignment**
- Site admin navigates to existing admin panel → Kennels → selects kennel → "Manage Roles" section
- Search for a user by email or hash name
- Assign MISMAN role (creates or updates `UserKennel` entry with `role: MISMAN`)
- Can also revoke MISMAN role (downgrades to MEMBER)

**Path 2: Existing Misman Approves Request**
- From the misman dashboard (`/misman`), existing mismans see pending requests for their kennel(s)
- Can approve or reject requests
- Approval changes the requester's `UserKennel.role` to MISMAN

**Path 3: Self-Service Request**
- Any authenticated user visits a kennel's detail page (`/kennels/[slug]`)
- If they are a MEMBER (subscribed) but not MISMAN/ADMIN, they see a **"Request Misman Access"** link
- Clicking opens a simple form with an optional message field ("I'm the misman for this kennel")
- Creates a `MismanRequest` record (status: PENDING)
- Existing mismans and site admins are notified (via the misman dashboard; push notifications deferred)

### Permission Checks

A new auth helper is needed alongside the existing `getOrCreateUser()` and `getAdminUser()`:

```typescript
// Get user if they have MISMAN or ADMIN role for the specified kennel
async function getMismanUser(kennelId: string): Promise<User | null>

// Returns the user if:
// 1. They are authenticated (Clerk)
// 2. They have a UserKennel entry for this kennel with role MISMAN or ADMIN
// 3. OR they are a site admin (Clerk publicMetadata.role === "admin")
```

---

## 12. Privacy Boundaries

| Data | Misman of this kennel | Other kennel members | Public |
|---|---|---|---|
| Hash name | Yes | Yes (via attendance/hareline) | Yes |
| Nerd name (on KennelHasher) | Yes | No | No |
| Email (on KennelHasher) | Yes | No | No |
| Phone (on KennelHasher) | Yes | No | No |
| Misman notes | Yes | No | No |
| KennelAttendance records | Yes | No | No |
| Per-hasher stats (run count, etc.) | Yes | No (future: opt-in public profiles) | No |

**User profile privacy is separate**: a User's `nerdName` on their profile has its own privacy settings. The `nerdName` on a `KennelHasher` is kennel-specific data recorded by misman — it does not automatically sync with or override the User's profile privacy settings, even when linked.

---

## 13. Roster Sharing (Cross-Kennel Suggestions)

### Problem
Some kennels have heavily overlapping communities — e.g., NYC H3 and GGFM H3 share nearly all their regulars. When GGFM misman records attendance, they shouldn't have to re-enter everyone from scratch — the NYC H3 roster should inform their suggestions.

But not all kennels overlap — Boston H3 and NYC H3 are largely separate communities.

### Approach: Roster Groups

A **Roster Group** is an admin-created grouping of kennels that share a community. Examples:
- "NYC Metro" → NYC H3, GGFM H3, EWH3, LIH3, etc.
- "Philly Area" → Philly H3, BFM H3

### How It Works

1. **Site admin** creates a Roster Group and assigns kennels to it (via admin panel)
2. **Autocomplete**: when misman types a name, the search queries:
   - **First**: the current kennel's roster (exact + fuzzy match)
   - **Then**: sibling kennels in the same roster group (same search, but results shown in a separate "Also runs with [sibling]" section)
3. **Adding from sibling**: if misman selects a hasher from a sibling kennel's roster, the system creates a **new KennelHasher entry** in the current kennel, pre-populated with the source entry's data (hash name, nerd name, contact info). The entries are independent after creation — edits to one don't affect the other.
4. **Suggestions**: the smart suggestions algorithm (Section 8) runs on the current kennel's roster only. Sibling roster matches are a secondary signal, shown separately.

### What This Does NOT Do
- Does not merge rosters or share attendance data bidirectionally
- Does not allow misman of one kennel to see another kennel's full roster — only autocomplete matches
- Does not automatically create entries — misman must explicitly select a suggestion
- Does not sync changes between linked entries after creation

### Why Not a Shared Roster?
A truly shared roster (one KennelHasher entry used by multiple kennels) would require:
- Cross-kennel permission negotiation (who can edit shared entries?)
- Attendance records spanning multiple kennels (breaks the kennel-specific model)
- Complex merge semantics when kennels disagree on names

The Roster Group approach gives 80% of the benefit (fast suggestions, reduced data entry) with none of the complexity.

---

## Route Structure

```
/misman                              — Dashboard: kennels you're misman for, pending requests
/misman/[slug]/attendance            — Attendance form (mobile-first, primary interface)
/misman/[slug]/attendance/[eventId]  — Attendance form for a specific event
/misman/[slug]/roster                — Roster management (search, add, edit, merge)
/misman/[slug]/roster/[hasherId]     — Individual hasher detail (attendance history, stats)
/misman/[slug]/history               — Attendance history across all events

/kennels/[slug]                      — Existing kennel detail page (add "Request Misman Access" link)

/admin/kennels/[id]                  — Existing admin kennel edit (add "Manage Roles" section)
/admin/roster-groups                 — Roster Group management (create, assign kennels)
```

---

## Cascade & Data Integrity

| Trigger | Behavior | Rationale |
|---|---|---|
| **Event deleted** (admin action) | Delete all `KennelAttendance` for that event | Consistent with existing cascade that deletes `Attendance` and `EventHare` |
| **KennelHasher deleted** (no attendance) | Hard delete | Likely a mistake — no data to preserve |
| **KennelHasher deleted** (has attendance) | **Block deletion** — misman must first merge with another entry or explicitly delete all attendance records (with confirmation) | Prevents accidental data loss |
| **Kennel deleted** (has KennelAttendance) | **Block deletion** — admin sees: *"Cannot delete [kennel]: it has [N] attendance records. Archive the kennel instead."* | Preserves historical data; no known use case for deleting a kennel with real data |
| **Kennel deleted** (no attendance) | Cascade delete `KennelHasher` entries, `KennelHasherLink` entries, `MismanRequest` entries, `RosterGroupKennel` entries | Clean removal of a kennel added by mistake |
| **User account deleted** | Unlink from KennelHasher (delete `KennelHasherLink`), but **keep the KennelHasher roster entry and all attendance records** | The roster entry represents the real-world person, not their site account |
| **KennelHasherLink deleted/dismissed** | Delete the link record; KennelHasher and all KennelAttendance records are unaffected | Unlinking doesn't erase history |
| **MismanRequest resolved** | Keep the request record (soft archive via status change to APPROVED/REJECTED) | Audit trail for role assignments |

### Event Deletion Update

The existing event deletion logic in `src/app/admin/events/actions.ts` must be updated to also cascade-delete `KennelAttendance` records:

```typescript
await prisma.$transaction([
  prisma.rawEvent.updateMany({ ... }),
  prisma.eventHare.deleteMany({ where: { eventId } }),
  prisma.attendance.deleteMany({ where: { eventId } }),
  prisma.kennelAttendance.deleteMany({ where: { eventId } }), // NEW
  prisma.event.delete({ where: { id: eventId } }),
]);
```

---

## Deferred / Future

| Feature | Status | Notes |
|---------|--------|-------|
| Hash cash amount tracking | Deferred | Boolean "paid" is sufficient for MVP; amount, pricing tiers, running balance come later |
| Auto-detect virgins | Deferred | Manual annotation for now; auto-flag based on attendance history is a future enhancement |
| Hare → EventHare sync | Deferred | Misman hare data stays internal for MVP; eventual public hareline integration |
| Auto-sync to user logbook | Deferred | Suggest-and-confirm model; auto-sync may come if users request it |
| Cross-kennel hasher directory | Deferred | Roster Groups handle the suggestion use case; a full shared directory adds complexity without clear MVP need |
| Historical attendance CSV import | Deferred | Start fresh with new attendance; could import from Google Sheet later with smart name matching |
| CSV export | Deferred | Not implementing at this time; will revisit when there's user demand |
| Notification system | Deferred | Logbook page "pending confirmations" section is sufficient for MVP; notification bell/email comes later |
| Edit history / audit log | Deferred | `updatedAt` provides basic "last modified" for MVP; full audit trail comes later if needed |
| WebSocket / SSE real-time | Deferred | Polling (3-5s) is sufficient for MVP; upgrade if users report sluggish multi-misman experience |
| Misman contacting hashers | Deferred | Contact fields (email, phone) stored for future use; no messaging/notification features in MVP |

---

## Decisions Log

| # | Question | Decision |
|---|----------|----------|
| 1 | MISMAN vs SCRIBE role? | MISMAN replaces SCRIBE. Single role name for kennel-level attendance management. ADMIN implicitly includes MISMAN permissions. |
| 2 | Hash cash tracking | Boolean "paid" flag per attendance; amounts/balances deferred |
| 3 | Logbook sync | Pending confirmations on `/logbook` page; no auto-sync. Verification is derived from cross-referencing KennelAttendance and Attendance records. |
| 4 | Roster scope | Kennel-specific (each kennel owns their list). Roster Groups provide cross-kennel suggestions without shared ownership. |
| 5 | Virgin tracking | Manual per-event annotation; auto-detection deferred |
| 6 | Form timing | Any kennel event up to 1 year in the past |
| 7 | Hare visibility | Internal to misman records for MVP; EventHare sync deferred |
| 8 | Referral source | Enum field (`ReferralSource`) + separate `referralOther` freetext field for `OTHER` |
| 9 | Multi-misman | Yes, multiple users per kennel; live view via polling (3-5s) |
| 10 | Roster seeding | Pre-populate from existing hare data in DB (last year); CSV import deferred |
| 11 | Notifications | Logbook page "pending confirmations" section; notification system deferred |
| 12 | Auth at trail | Clerk auth required; if misman hands phone to someone, actions are attributed to the logged-in misman's session |
| 13 | Attendance lookback | 1 year max for recording attendance; may tighten later |
| 14 | KennelHasher deletion | Hard delete if no attendance; block if attendance exists (must merge or clear first) |
| 15 | Kennel deletion | Block if KennelAttendance exists; cascade clean if no attendance data |
| 16 | User account deletion | Unlink from KennelHasher; preserve roster entry and attendance history |
| 17 | Merge duplicates | True-wins for boolean conflicts; block merge if linked to different Users; not reversible |
| 18 | Concurrency | Optimistic UI + polling (3-5s); `@@unique` constraint prevents duplicate entries |
| 19 | Privacy | Nerd name, email, phone, notes visible to misman only; not to other members or public |
| 20 | Misman assignment | Three paths: site admin direct, existing misman approves request, self-service request from kennel page |
| 21 | Roster sharing | Roster Groups allow cross-kennel autocomplete suggestions; entries are copied (not shared) when selected |
| 22 | CSV export | Deferred — not implementing at this time |
| 23 | Edit history | Deferred — `updatedAt` only for MVP |
| 24 | Contact fields | Optional email and phone on KennelHasher; private to misman; messaging features deferred |
| 25 | Link revocation | Both user and misman can revoke a confirmed link; does not delete attendance history |
| 26 | Smart suggestions | Weighted score: 50% frequency + 30% recency + 20% streak. Thresholds tunable post-launch. |
