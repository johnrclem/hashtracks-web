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
- Each entry has: **hash name** (primary, public display) and **nerd name** (real name, may be private) — misman may only have one of these initially
- A KennelHasher can optionally be **linked to a site User** (see User Linking below)
- Roster entries are editable: fix spelling, add hash name after someone gets named, update nerd name, etc.
- **Roster seeding**: pre-populate from existing hare data in the database (anyone who has hared for the kennel in the last year). Could also do a targeted scrape of hashnyc.com hare data if needed. Future option to import from an attendance spreadsheet with smart name matching.

### Kennel Permissions (Misman Role)
- New permission level attached to each kennel: **misman**
- Below site-level admin — misman can only manage their own kennel(s)
- **Multiple misman per kennel** — all see the same roster and attendance data (kennels typically have 2-4 mismanagement members)
- Grants access to: attendance form, kennel roster management, attendance history
- Site admins can assign/revoke misman role per kennel

### KennelAttendance (Misman-Recorded Attendance)
- Ties a KennelHasher to a canonical Event
- Separate from the existing personal `Attendance` model (user self-check-in)
- Fields per record:
  - **paid** (boolean) — did they pay hash cash?
  - **haredThisTrail** (boolean) — were they a hare for this event?
  - **isVirgin** (boolean) — manual annotation, not auto-detected
  - **isVisitor** (boolean) — visiting from another kennel/city
  - **visitorLocation** (optional string) — where they're visiting from
  - **referralSource** (optional enum) — how they found the hash (virgins/visitors only)
    - Options: Word of mouth, Social media, Reddit, Meetup, Google search, Other (freetext)

---

## Features

### 1. Mobile-First Attendance Form
The primary interface — designed for use at trail on a phone.

- Misman selects an event (defaults to today's kennel event if one exists, but can pick **any recent event** for catch-up)
- **Autocomplete search** for both hash name and nerd name (hash name is primary display)
- **Smart suggestions**: surface frequent, regular, and recent attendees at the top to make population fast — once we have enough data, the form should feel like checking names off a list rather than typing
- Quick-add: if the hasher isn't in the roster, create a new KennelHasher inline from the form
- Per-hasher toggles: paid, hare, virgin, visitor
- Visitor sub-fields: location and referral source (shown only when visitor or virgin is checked)

### 2. Kennel Roster Management
- View/search all KennelHashers for a kennel
- Add, edit, delete roster entries
- Inline editing: fix spelling, add/change hash name or nerd name
- **Merge duplicates**: select two (or more) KennelHasher entries and merge them (combine attendance history under one record, choose which name to keep)
- Show per-hasher stats: total runs, last attended, hare count

### 3. User Linking
- System **suggests** links between KennelHasher entries and site Users based on name matching (fuzzy)
- Misman must **manually confirm** the link — the system never auto-links
- When linked: the site User sees a "pending confirmations" section at the top of their `/logbook` page ("NYCH3 misman recorded you at Run #2045 — confirm?")
- User accepts or dismisses the suggestion — **no auto-sync** to their personal logbook
- A KennelHasher can exist without ever being linked (many hashers won't use the site)

### 4. Hare Tracking
- Misman can flag any attendee as a hare for that event
- MVP: hare flag stays internal to KennelAttendance records
- **Future**: smart suggestion — if the event already has hares listed on the hareline (from scraping), suggest marking those attendees as hares on the form; eventually feed misman-recorded hares back into EventHare for public display

### 5. Attendance History & Reporting
- Per-event view: who attended, who paid, who hared
- Per-hasher view: all events attended at this kennel, total count, hare count
- Export to CSV (replacing the spreadsheet they're used to)

---

## Deferred / Future

| Feature | Status | Notes |
|---------|--------|-------|
| Hash cash amount tracking | Deferred | Boolean "paid" is sufficient for MVP; amount, pricing tiers, running balance come later |
| Auto-detect virgins | Deferred | Manual annotation for now; auto-flag based on attendance history is a future enhancement |
| Hare → EventHare sync | Deferred | Misman hare data stays internal for MVP; eventual public hareline integration |
| Auto-sync to user logbook | Deferred | Suggest-and-confirm model; auto-sync may come if users request it |
| Cross-kennel hasher directory | Deferred | Kennel-specific rosters for now; shared directory adds complexity without clear MVP need |
| Historical attendance CSV import | Deferred | Start fresh with new attendance; could import from Google Sheet later with smart name matching |
| Notification system | Deferred | Logbook page "pending confirmations" section is sufficient for MVP; notification bell/email comes later |

---

## Decisions Log

| Question | Decision |
|----------|----------|
| Hash cash tracking | Boolean "paid" flag per attendance; amounts/balances deferred |
| Logbook sync | Pending confirmations on `/logbook` page; no auto-sync |
| Roster scope | Kennel-specific (each kennel owns their list) |
| Virgin tracking | Manual per-event annotation; auto-detection deferred |
| Form timing | Any recent kennel event, not just today |
| Hare visibility | Internal to misman records for MVP; EventHare sync deferred |
| Referral source | Dropdown: Word of mouth, Social media, Reddit, Meetup, Google, Other (freetext) |
| Multi-misman | Yes, multiple users per kennel |
| Roster seeding | Pre-populate from existing hare data in DB (last year); CSV import deferred |
| Notifications | Logbook page "pending confirmations" section; notification system deferred |
| Auth at trail | Clerk auth required; if misman hands phone to someone, they use the misman's session |
