# HashTracks Roadmap

Living document tracking what's been built, what's next, and where we're headed.

Last updated: 2026-02-22

**Competitive context:** See [competitive-analysis.md](competitive-analysis.md) for detailed analysis of Harrier Central (the primary competitor), user pain points from their GitHub issues, and strategic positioning rationale behind these priorities.

---

## What's Built

### Core Platform (Sprints 1-4 + Polish)
- [x] Next.js 16 App Router, Prisma 7, Clerk auth, Railway PostgreSQL, Vercel deployment
- [x] Kennel directory with subscriptions, profiles, admin tools
- [x] Source engine: adapter framework, merge pipeline, fingerprint dedup, kennel resolver
- [x] Hareline: list/calendar views, filters (region, kennel, day, scope), URL persistence
- [x] Master-detail layout: event list + detail panel on desktop, full-page on mobile
- [x] Admin UI: source management, manual scrape trigger, scrape logs, source health

### Data Sources (29 live)

**NYC / NJ / Philly (7 sources)**
- [x] **hashnyc.com** (HTML Scraper) — 11 NYC-area kennels
- [x] **Summit H3 Spreadsheet** (Google Sheets) — 3 NJ kennels (Summit, SFM, ASSSH3)
- [x] **BFM Google Calendar** (Google Calendar API) — BFM, Philly H3
- [x] **Philly H3 Google Calendar** (Google Calendar API) — BFM, Philly H3
- [x] **BFM Website** (HTML Scraper) — benfranklinmob.com + special events page
- [x] **Philly H3 Website** (HTML Scraper) — hashphilly.com/nexthash/
- [x] **Hash Rego** (Hash Rego) — BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3 (multi-region aggregator)

**Boston (1 source)**
- [x] **Boston Hash Calendar** (Google Calendar API) — 5 Boston kennels

**Chicago (3 sources)**
- [x] **Chicagoland Hash Calendar** (Google Calendar API) — 11 Chicago-area kennels
- [x] **Chicago Hash Website** (HTML Scraper) — CH3 (secondary enrichment)
- [x] **Thirstday Hash Website** (HTML Scraper) — TH3 (secondary enrichment)

**DC / DMV (8 sources)**
- [x] **EWH3 Google Calendar** (Google Calendar API) — EWH3
- [x] **SHITH3 Google Calendar** (Google Calendar API) — SHITH3
- [x] **W3H3 Hareline Spreadsheet** (Google Sheets) — W3H3 (West Virginia)
- [x] **Charm City H3 iCal Feed** (iCal Feed) — CCH3 (Baltimore)
- [x] **BAH3 iCal Feed** (iCal Feed) — BAH3 (Baltimore/Annapolis)
- [x] **EWH3 WordPress Trail News** (HTML Scraper) — EWH3 (secondary enrichment)
- [x] **DCH4 WordPress Trail Posts** (HTML Scraper) — DCH4
- [x] **OFH3 Blogspot Trail Posts** (HTML Scraper) — OFH3
- [x] **Hangover H3 DigitalPress Blog** (HTML Scraper) — H4

**SF Bay Area (2 sources)**
- [x] **SFH3 MultiHash iCal Feed** (iCal Feed) — 13 SF Bay Area kennels
- [x] **SFH3 MultiHash HTML Hareline** (HTML Scraper) — 13 SF Bay Area kennels (secondary enrichment)

**London / UK (7 sources)**
- [x] **London Hash Run List** (HTML Scraper) — LH3
- [x] **City Hash Website** (HTML Scraper) — CityH3
- [x] **West London Hash Website** (HTML Scraper) — WLH3
- [x] **Barnes Hash Hare Line** (HTML Scraper) — BarnesH3
- [x] **Old Coulsdon Hash Run List** (HTML Scraper) — OCH3
- [x] **SLASH Run List** (HTML Scraper) — SLH3 (South London)
- [x] **Enfield Hash Blog** (HTML Scraper) — EH3

### The Logbook — Sprint 5 COMPLETE
- [x] "I Was There" one-click check-in (past events only, defaults to RUN)
- [x] Participation level selector: R / H / BH / DC / BM / W / C
- [x] Edit/delete attendance with dialog
- [x] Activity link field (any URL — Strava, Garmin, AllTrails, etc.)
- [x] Notes field for personal trail notes
- [x] Attendance badges on hareline event cards and detail panel
- [x] "My Runs" page (`/logbook`) with filters (region, kennel, level)
- [x] Stats dashboard (`/logbook/stats`): totals, per-kennel, per-region, per-level breakdowns
- [x] Milestone markers (25, 50, 69, 100, 150, 200, 250, 300, 400, 500, 666, 700, 800, 900, 1000)

### "I'm Going" RSVP — Sprint 7 COMPLETE
- [x] AttendanceStatus enum: INTENDING / CONFIRMED
- [x] "I'm Going" toggle on future events, "Going" blue badge, "Confirm" button after event
- [x] checkIn() auto-upgrade: INTENDING → CONFIRMED
- [x] Stats filter: only CONFIRMED counted in stats/milestones

### Kennel Attendance Management (Misman Tool) — Sprints 8-9 COMPLETE
- [x] KennelHasher roster, KennelAttendance, Misman role per kennel
- [x] Mobile attendance form: event selector, hasher search, quick-add, per-hasher toggles (paid/hare/virgin/visitor)
- [x] Smart suggestions: weighted scoring surfaces likely attendees as tap-to-add chips
- [x] Attendance history: per-event and per-hasher views with date filtering
- [x] User linking: fuzzy-match KennelHasher → site User; logbook sync with pending confirmations
- [x] Verification badges: derived status (verified/misman-only/user-only) on attendance rows
- [x] Roster groups: shared rosters across kennels, admin CRUD, misman request flow
- [x] Merge duplicates: pairwise fuzzy scan, preview, OR-merge attendance
- [x] Audit log: JSON editLog with field-level diffs, edit history timeline
- [x] Hare→EventHare sync: auto-sync misman hare flags to structured EventHare records
- [x] Historical CSV import: matrix-format upload, fuzzy hasher matching, step-by-step wizard
- [x] Invite links: secure token-based misman onboarding (MismanInvite lifecycle)
- [x] Roster group requests: mismans request shared groups, admin approve/reject

See [misman-attendance-requirements.md](misman-attendance-requirements.md) and [misman-implementation-plan.md](misman-implementation-plan.md) for full details.

### Hasher-Kennel Linking — COMPLETE
- [x] User-side visibility: KennelConnections on profile page (accept/decline/revoke link requests)
- [x] PendingLinkRequests banner on logbook page (dismissible, benefits messaging)
- [x] Profile invite from roster: misman generates invite link, hasher redeems via /invite/link
- [x] User activity on attendance form: misman sees RSVPs/check-ins from site users with link-to-roster flow

### Source Monitoring & Self-Healing — COMPLETE
- [x] Rolling-window health analysis (event count, fill rates, structure hash, consecutive failures)
- [x] Admin alerts page with 6 alert types, filter tabs, structured context display
- [x] Self-healing actions: re-scrape, create alias/kennel, file GitHub issue — all from alert card
- [x] Repair history timeline, auto-resolve for stable structure changes

### Scrape Logging — COMPLETE
- [x] Structured errors (fetch/parse/merge) across all 5 adapters
- [x] Fill rate columns with color coding, structure hash history
- [x] Sample blocked/skipped events with suggested actions
- [x] Performance timing (fetchDurationMs, mergeDurationMs)
- [x] Per-adapter diagnostic context

### UX Polish — COMPLETE
- [x] Calendar: region colors, dim past, vertical badges, grid lines, desktop side panel
- [x] Loading skeletons, dynamic page titles, region badges
- [x] Calendar export (Google Calendar URL + .ics download)
- [x] Admin: kennel merge UI with fuzzy duplicate prevention
- [x] Admin: slim source table, detail page tooltips
- [x] **Navigation pattern decision:** Misman sub-tabs (Attendance/Roster/History) vs Alert pill-filters (Open/Resolved/All) use intentionally different patterns — sub-tabs switch between distinct content views while pill-filters narrow a single list by status. The divergence is justified and should be preserved.

### Kennel Page Redesign — COMPLETE
- [x] 17 new nullable profile fields on Kennel model (schedule, social, details, flags)
- [x] QuickInfoCard component: schedule, hash cash + pay link, website, founded year, dog-friendly/walkers-welcome flags
- [x] SocialLinks component: pill-style linked buttons for Facebook, Instagram, X, Discord, mailing list, email
- [x] KennelStats component: total events, oldest event date, next run date
- [x] Redesigned `/kennels/[slug]` page with hero logo, quick info, social links, stats
- [x] Admin form expanded with Schedule, Social & Contact, Details sections (17 new fields)
- [x] Format helpers: `formatSchedule()`, `instagramUrl()`, `twitterUrl()`, `displayDomain()` + 15 tests
- [x] Seed data populated for 14 of 24 existing kennels

See [kennel-page-redesign-spec.md](kennel-page-redesign-spec.md) for full spec.

### Kennel Directory Redesign — COMPLETE
- [x] Richer cards: shortName as primary heading, schedule line, description snippet, founded year, RegionBadge
- [x] Next upcoming run per kennel (batch query, no N+1), highlighted blue if within 7 days
- [x] Filters: region multi-select, run day chips (Mon–Sun), frequency dropdown, "Has upcoming" toggle, country chips
- [x] Sort: A–Z (grouped by region) or Recently Active (flat list, next-event-date ascending)
- [x] URL persistence: all filter/sort state persisted via `window.history.replaceState()`
- [x] `formatDateShort()` helper, 14 new region colors (DC/DMV, Bay Area, London, Chicago, etc.)
- [x] Loading skeleton for kennel directory page
- [x] Removed subscriber count from cards (meaningless for new users)

### In-App Feedback — COMPLETE
- [x] "Send Feedback" dialog in app footer (signed-in users only)
- [x] Category dropdown (Bug Report, Feature Request, Question, Other) + title + description
- [x] Creates GitHub Issue via REST API with `user-feedback` + category labels
- [x] Auto-captures current page URL for bug context

### Cron & Infrastructure — COMPLETE
- [x] Vercel Cron daily scrapes (6:00 AM UTC) with CRON_SECRET auth
- [x] Per-source `scrapeFreq` with interval-based skip logic
- [x] Shared `scrapeSource()` for cron + admin routes
- [x] Vercel Web Analytics + Speed Insights integration

### Source Onboarding Wizard — COMPLETE
- [x] Admin "Add Source" wizard at `/admin/sources/new` (multi-phase guided setup)
- [x] Source type auto-detection from URL (Google Sheets, Calendar, Hash Rego, Meetup)
- [x] Config panels: Calendar, iCal, Google Sheets, Hash Rego, Meetup
- [x] Server-side config validation with ReDoS safety (safe-regex2)
- [x] Test Config preview: dry-run adapter fetch with diagnostic display
- [x] Gemini-enhanced kennel pattern suggestions for Calendar/iCal sources
- [x] Inline alias creation, kennel creation, source enable/disable
- [x] Source coverage dashboard at `/admin/sources/coverage`

See [config-driven-onboarding-plan.md](config-driven-onboarding-plan.md) for full design.

### AI Recovery Layer — COMPLETE
- [x] Gemini 2.0 Flash integration for self-healing scraper errors
- [x] Parse recovery with prompt sanitization and confidence tracking (`src/lib/ai/parse-recovery.ts`)
- [x] Applied to hashnyc, OFH3, EWH3, iCal adapters
- [x] Gemini column auto-detection for Google Sheets adapter
- [x] AI-assisted alert classification

### Event Reconciliation — COMPLETE
- [x] Stale event detection and cancellation when sources are disabled/modified (`src/pipeline/reconcile.ts`)
- [x] ReconcileSource field tracks last reconciliation per source

### Meetup Adapter — COMPLETE
- [x] Meetup.com public API adapter — no auth required (`src/adapters/meetup/adapter.ts`)
- [x] GroupUrlname auto-detection from URLs
- [x] Config validation for Meetup-specific fields
- Note: No live Meetup sources yet — adapter ready for onboarding via wizard

### User Feedback — COMPLETE
- [x] In-app "Send Feedback" dialog (bug report, feature request, question, other)
- [x] Auto-creates GitHub issues with `user-feedback` + category labels
- [x] Auto-captures current page URL for bug context

### Timezone Preferences — COMPLETE
- [x] User timezone preference storage (UserPreferences model, TimeDisplayPref enum)
- [x] Header timezone dropdown with regional options
- [x] Hareline and event card timezone-aware display (`src/lib/timezone.ts`)

### Codebase Refactoring (Phases 1-3) — COMPLETE
- [x] Shared adapter utilities (`src/adapters/utils.ts`): date parsing, field extraction
- [x] Function decomposition: long adapter functions split into focused helpers
- [x] Pattern standardization: ActionResult discriminated union, consistent error handling

### EventLink + Hash Rego Adapter — COMPLETE
- [x] EventLink model: extensible link table for external URLs on events (Hash Rego, Meetup, etc.)
- [x] HASHREGO adapter: index scraper + detail page parser, multi-day event splitting via seriesId
- [x] Merge pipeline: auto-creates EventLinks from externalLinks, first source "owns" sourceUrl
- [x] Series linking: multi-day events split into per-day records linked via parentEventId
- [x] Event detail page + sidebar panel render EventLink buttons
- [x] Seed: Hash Rego source with 7 kennel slugs (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3)

### Current Stats
- 79 kennels (with rich profiles: schedule, social, hash cash, flags), 238 aliases, 29 sources
- 21 regions across 6 metro areas: NYC/NJ/Philly (17 kennels), Boston (5), Chicago (11), DC/DMV (19), SF Bay Area (13), London/UK (10), + South Shore IN (1), Rumson NJ (1)
- 7 adapter types: HTML_SCRAPER (22 scrapers), GOOGLE_CALENDAR (5), GOOGLE_SHEETS (2), ICAL_FEED (3), HASHREGO (1), MEETUP (1), WORDPRESS_API (1)
- 22 models, 17 enums in Prisma schema
- 69 test files

---

## Priority 1: Expand Source Coverage

**Strategic rationale:** HashTracks' automated source engine is the primary competitive moat. Harrier Central requires kennel admins to manually enter every run — their 3-year-old open issue for recurring events (#309) proves manual entry doesn't scale. Every new source adapter widens this gap permanently. More sources = more kennels = more value for every user. This is the single highest-leverage activity.

**See:** [competitive-analysis.md](competitive-analysis.md) — Theme 1: Data Entry & Event Management Pain

### Next Source Targets

Regional research complete — see [kennel-research/](kennel-research/) for detailed per-kennel data.

**Completed regions:**
- [x] **DC/DMV area** (19 kennels, 8 sources) — EWH3, SHITH3, CCH3, W3H3, DCH4, WH4, BAH3, MVH3, OFH3, DCFMH3, GFH3, DCH3, OTH4, and more
  - Sources: Google Calendars, iCal feeds, WordPress/Blogspot scrapers, Hash Rego — see [dc-kennels.md](kennel-research/dc-kennels.md)
- [x] **Chicago area** (11 kennels, 3 sources) — CH3, TH3 + 9 via Chicagoland Calendar
  - Sources: Chicagoland Google Calendar + CH3/TH3 website scrapers — see [chicago-expanded.md](kennel-research/chicago-expanded.md)
- [x] **SF Bay Area** (13 kennels, 2 sources) — SFH3, GPH3, EBH3, SVH3, FHAC-U, FCH3, MarinH3, and more
  - Sources: SFH3 iCal feed + HTML hareline scraper, Hash Rego for FCH3 — see [sf-bay-area.md](kennel-research/sf-bay-area.md)
- [x] **London/UK** (10 kennels, 7 sources) — LH3, CityH3, WLH3, BarnesH3, OCH3, SLH3, EH3 + 3 directory-only
  - Sources: 7 HTML scrapers — see [london-kennels.md](kennel-research/london-kennels.md)

**Remaining opportunities:**
- [ ] **Hash Rego kennel directory** — scrape `/kennels/` page for new kennel discovery + auto-onboarding
- [ ] **gotothehash.net** — evaluate as a potential aggregator source (similar to hashnyc.com pattern)
- [ ] **half-mind.com event listings** — evaluate as supplementary discovery data
- [ ] **Meetup.com sources** — adapter built (`src/adapters/meetup/adapter.ts`), needs source onboarding for specific kennel Meetup groups
- [ ] Continue refining kennel resolver patterns as new sources reveal new name variants

**Implementation notes:**
- Follow [source-onboarding-playbook.md](source-onboarding-playbook.md) for each new source
- Config-driven Google Sheets adapter means zero code changes for similar spreadsheet sources
- HTML_SCRAPER sources require ~1-2 hours of adapter code + URL-based routing in registry
- Google Calendar sources require ~15 min of config + seed entry
- Always verify `kennelShortNames` in seed covers ALL kennels the source produces (source-kennel guard)

### Config-Driven Source Onboarding (Admin UI) — COMPLETE

See "Source Onboarding Wizard" in What's Built section above. The wizard supports all config-driven adapter types (Calendar, Sheets, iCal, Hash Rego, Meetup) with source type auto-detection, live preview, config validation, and Gemini-enhanced kennel pattern suggestions. HTML_SCRAPER sources still require adapter code but can have their Source record and kennel links created via the wizard.

### Historical Event Import

*Infrastructure complete (per-source `scrapeDays`). Remaining:*

- [ ] hashnyc.com: Test `?days=all` for full 8+ year archive import
- [ ] Boston Calendar: Verify 365-day window captures sufficient history
- [ ] Add admin "Import Full History" button per source
- [ ] Quality metrics dashboard: per-source event counts by year

---

## Priority 2: Strava Integration

**Strategic rationale:** Zero hashing platforms integrate with fitness tracking apps. Harrier Central, gotothehash.net, half-mind.com — none of them connect runs to GPS data. This is the feature that makes "The Strava of Hashing" literal, not just a tagline. The existing activity link field (manual URL paste, Sprint 5) proves user interest — OAuth automates what users already do manually.

**See:** [competitive-analysis.md](competitive-analysis.md) — "What HashTracks Has That HC Doesn't"

**Full implementation reference:** PRD Appendix C (Strava API Reference) in `HASHTRACKS_PRD.md`

- [ ] **Strava OAuth flow** — real redirect (not manual code copy from GAS prototype)
  - Redirect URI: `/api/auth/strava/callback`
  - Scope: `activity:read_all`
  - Store `refresh_token` server-side per user (never expose to client)
  - Token refresh: 6-hour lifetime, cache for 3 hours
  - New env vars: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
  - New schema: `StravaConnection` model (userId, accessToken, refreshToken, expiresAt, athleteId)

- [ ] **Activity history fetch + server-side cache**
  - `GET /api/v3/athlete/activities?after={unix}&before={unix}&per_page=50`
  - Timestamps are Unix seconds (not milliseconds)
  - Cache responses keyed by user + date range
  - Never call Strava on every page load — fetch once, cache, serve from cache

- [ ] **Auto-suggest matches**
  - Match Strava activities to canonical Events by date + region
  - Use `start_latlng` for location (not deprecated `location_city` fields)
  - Handle privacy zones: `start_latlng` returns null/[0,0] → fallback to timezone-based region
  - **Critical: `start_date_local` timezone bug** — extract date/time as strings, never parse through `new Date()`:
    ```typescript
    const activityDate = activity.start_date_local.substring(0, 10); // "2024-10-25"
    const activityTime = activity.start_date_local.substring(11, 16); // "14:30"
    ```

- [ ] **One-click attach** Strava link to attendance record
  - UI on logbook: "We found a Strava activity that matches this run — attach it?"
  - Normalize URL to canonical form: `https://www.strava.com/activities/{id}`

- [ ] **Out-of-town run discovery**
  - Strava activities in regions with no logged attendance → suggest logging
  - Feeds into "Log Unlisted Run" feature (Priority 4)

- [ ] **Rate limit handling**
  - 100 requests per 15 minutes, 1,000 per day
  - Batch fetch activities by date range (one API call per week, not per event)
  - Queue-based processing if needed for multi-user sync

---

## Priority 3: Misman as a Growth Lever

**Strategic rationale:** The Misman tool is already more capable than HC's paid kennel admin features (smart suggestions, roster groups, audit log, verification pipeline). HC charges for less capable tools. This is a B2B growth opportunity: approach kennel mismanagement directly with "replace your Google Sheet with this — it's free and tied to the event calendar."

**See:** [competitive-analysis.md](competitive-analysis.md) — "Misman as a Growth Lever vs. HC's Kennel Admin"

### Misman Experience Refinement
- [ ] End-to-end testing with real misman users (invite, onboard, record attendance, review history)
- [ ] Address UX friction discovered during real-world usage
- [ ] Mobile testing on actual devices (attendance form is the primary mobile use case)

### Milestone Watch (New — informed by HC analysis)

**Why:** HC does this and GMs rely on it. When a hasher is one run away from a milestone (68, 99, 149, etc.), mismanagement wants to know so they can prepare the down-down. Data already exists — `getHasherDetail()` computes per-hasher run counts.

- [ ] Compute milestone proximity for all attendees when loading attendance form
  - Query: count of CONFIRMED KennelAttendance records per hasher (roster group scope)
  - Milestones: 25, 50, 69, 100, 150, 200, 250, 300, 400, 500, 666, 700, 800, 900, 1000 (same as logbook)
  - Flag hashers where `count + 1` hits a milestone
- [ ] Display milestone alert badge on attendance form
  - Banner or badge next to hasher name: "🎉 69th run!" or "⚠️ Next run is #100"
  - Show on AttendanceRow and in SuggestionList chips
- [ ] Optional: milestone summary section on misman dashboard per kennel
  - "Upcoming milestones: Mudflap (99th), Just Simon (250th)"

**Implementation notes:**
- Pure function in `src/lib/misman/milestones.ts` — takes run count, returns next milestone and distance
- Server action in attendance actions to batch-compute for current event's attendees + suggestions
- UI: small badge component, similar to VerificationBadge pattern

### Misman Self-Service Kennel Profile Editing
- [ ] Allow mismans to edit their kennel's profile fields (schedule, social links, hash cash, etc.)
- [ ] Currently admin-only — extend to MISMAN role users for their own kennels
- [ ] Reuse admin KennelForm component with role-based field restrictions

### Misman Landing/Onboarding Page
- [ ] Dedicated page explaining misman features (separate from hasher-facing marketing)
- [ ] Speak to the mismanagement pain point: "Stop manually typing hash names in a spreadsheet"
- [ ] Highlight: mobile attendance form, smart suggestions, roster groups, audit trail
- [ ] Clear CTA: "Request misman access for your kennel" or "Invite your mismanagement team"

---

## Priority 4: User Onboarding & Self-Service

**Strategic rationale:** Reduce friction for new users to get value from the platform. HC's biggest user complaint is the inability to add runs or kennels without emailing the developers. HashTracks should make self-service effortless.

### Personal CSV Import

*Different from misman CSV import (Sprint 9c) — this is for individual hasher logbook history.*

- [ ] Upload page at `/logbook/import`
- [ ] Column mapping UI: user maps their columns to HashTracks fields (date, kennel, participation level, notes, strava URL)
- [ ] Kennel name normalization via alias matching (unmatched names flagged)
- [ ] Import preview + confirm: show matched events, flagged issues
- [ ] Batch create Attendance records for matching canonical events
- [ ] Manual entries for unmatched kennels (triggers KennelRequest)

**Implementation notes:**
- Reuse patterns from misman CSV import (`src/lib/misman/csv-import.ts` — parsing, fuzzy matching, record building)
- Key difference: personal import creates `Attendance` records (not `KennelAttendance`)
- Column mapping could use the same config JSON pattern as the Google Sheets adapter

### Log Unlisted Run

**Why:** Critical for traveling hashers (HC's primary use case) and for covering kennels without sources yet. Also generates KennelRequests that signal organic demand for new source coverage.

- [ ] User logs a run for a kennel/event not in the system
- [ ] Provides: kennel name, region, country, date, participation level, notes, activity link
- [ ] Creates Attendance record linked to a special "unlisted" event
- [ ] Triggers KennelRequest for admin review if kennel doesn't exist
- [ ] Admin can later link unlisted attendance to a real kennel/event when source is added

### Manual Event Submission

- [ ] Admin manual event creation (for kennels without scrapeable sources, like Rumson)
- [ ] User event submission form (verified users, MANUAL source type)
- [ ] Events appear immediately — no approval queue for v1

---

## Priority 5: Map-Based Discovery

**Strategic rationale:** HC's #1 user testimonial is a traveling hasher who searched by radius and found a run. HC has invested years in map performance, distance filtering, and geo exploration. This is the killer feature HashTracks is missing for the traveling hasher persona. The good news: no PostGIS needed — Event model already has `latitude`, `longitude` fields and client-side distance calculation is sufficient for v1.

**See:** [competitive-analysis.md](competitive-analysis.md) — Theme: Discovery Quality

- [x] **Map tab on Hareline** — Google Maps JS (`@vis.gl/react-google-maps`), region-colored pins (filled = precise location, hollow = region centroid), click pin → EventDetailPanel, all filters apply, URL-persisted view state
- [x] **Event detail map** — Google Maps Static API image on EventDetailPanel + standalone event page; clickable → opens Google Maps; coordinate extraction from `locationAddress` Google Maps URLs in merge pipeline
- [x] **EventLocationMap text-address fallback** — Works without lat/lng; falls back to `locationName` text address for Google Maps Static API center/markers parameter (covers all hashnyc.com events and text-only sources)
- [x] **Coordinate extraction from Maps URLs** — merge pipeline calls `extractCoordsFromMapsUrl()` on `locationAddress` (supports @lat,lng, ?q=, ll=, query= URL patterns), stores precise lat/lng on Event records
- [ ] **Map toggle on Kennel Directory** — interactive map with kennel pins (requires geocoding lat/lng on Kennel model)
- [ ] **"Near me" distance filtering on Hareline**
  - Browser geolocation API for current position
  - Client-side Haversine distance calculation (no PostGIS)
  - Distance slider: 10km / 25km / 50km / 100km / 250km
  - Fallback: text-based region filter when no geo data available

- [ ] **Travel Mode search** (future enhancement)
  - "Runs in [City/Region] between [Date A] and [Date B]"
  - Pairs with Log Unlisted Run for runs found while traveling

---

## Priority 6: PWA & Notifications

**Strategic rationale:** HC's v2.0 rewrite leaned heavily into push notifications — smarter timing (6 hours before), RSVP→check-in reminders. HashTracks can achieve this without a native app via PWA web push. This drives retention on already-engaged users.

**See:** [competitive-analysis.md](competitive-analysis.md) — HC v2.0 features

- [ ] **PWA manifest + service worker**
  - "Add to Home Screen" prompt on mobile
  - App-like experience without app store friction
  - Offline shell with "you're offline" state (events require network)

- [ ] **Web Push notifications** (via Push API + service worker)
  - Opt-in per notification type
  - Triggers:
    - "You RSVPed — check-in window is open" (event date has passed, user has INTENDING status)
    - "Run starts in 6 hours" for RSVPed events (HC's exact heuristic)
    - Misman: "Source health alert for your kennel" (opt-in power user)
    - Misman: "Pending confirmation waiting in your logbook"
  - Backend: store push subscription per user, send via web-push npm package
  - New schema: `PushSubscription` model (userId, endpoint, keys, createdAt)

---

## Priority 7: Social Visibility & Engagement

**Strategic rationale:** HC lets users see who RSVPed and added Trail Chat in v2.0. Full social features (activity feed, kudos, comments) are v2 scope, but lightweight social signals can drive engagement now.

### "Who's Going" RSVP Visibility

- [ ] Show count of hashers with INTENDING status on event cards and detail pages
- [ ] Expandable list showing who's going (hash names, opt-in — default show count only)
- [ ] Consider privacy toggle: users can choose to show their name or be anonymous in the count

**Implementation notes:**
- Query: `Attendance.where({ eventId, status: 'INTENDING' })` with user join for hash names
- UI: badge on event card ("3 going"), expandable section on event detail page
- Minimal effort — data already exists from Sprint 7

### Event Comments (Lightweight Social Test)

- [ ] Per-event comment thread on event detail page (no DMs)
- [ ] Moderation: misman/admin can delete comments
- [ ] Use cases: ride-sharing coordination, bag drop info, theme announcements
- [ ] Opt-in notifications for replies to your comment

**Implementation notes:**
- New schema: `EventComment` model (id, eventId, userId, content, createdAt, deletedAt)
- Server actions: createComment, deleteComment, getComments (paginated)
- Keep simple — no threading, no reactions, no rich text for v1

---

## Priority 8: Data Portability & Exports

**Strategic rationale:** HC advertises "email me an Excel spreadsheet anytime." Hashers love data ownership. Export builds trust and reduces lock-in anxiety.

### Logbook CSV Export
- [ ] Download button on `/logbook/stats`
- [ ] Columns: date, kennel, run number, participation level, notes, activity link, event title, hares
- [ ] Filter-aware: exports what the user is currently viewing (filtered by kennel, region, date range)

### Misman Attendance Export
- [ ] Download button on `/misman/[slug]/history`
- [ ] Columns: event date, run number, hasher hash name, hasher nerd name, paid, hare, virgin, visitor
- [ ] Per-event and full-history export options

### Per-Kennel Payment Link (Lightweight Hash Cash)

**Why:** HC's Hash Cash is a scope trap (generates significant support burden). But "how do I pay?" is a real question at every hash. A simple payment link URL per kennel gives hashers the info without building financial tools.

- [x] `hashCash` + `paymentLink` fields on Kennel model (Kennel Page Redesign)
- [x] Displayed on kennel page QuickInfoCard with "Pay online" link
- [x] Admin-editable in kennel settings form
- [ ] Display payment link on event detail page (when kennel has one configured)

---

## Priority 9: Additional Integrations & Depth

### Event Weather Integration — PARTIALLY COMPLETE

- [x] Weather forecast on upcoming event detail pages (0–10 days)
  - Google Weather API (`weather.googleapis.com/v1/forecast/days:lookup`), 30-min Next.js fetch cache
  - Displays: condition emoji, temperature range (°F/°C toggle), precipitation probability if ≥20%
  - Coordinate fallback: uses `REGION_CENTROIDS` when event has no precise lat/lng
  - Units preference: localStorage-persisted °F/°C toggle in header (`UnitsPreferenceProvider`)
- [ ] Compact weather badge on hareline event cards (icon + temp range)

### Additional Adapter Types
- [x] **iCal feed adapter** (`ICAL_FEED`): Live with SFH3 MultiHash source (11 Bay Area kennels)
- [x] **Hash Rego adapter** (`HASHREGO`): Live with 7 DC/Philly kennel slugs, multi-day splitting
- [x] **Meetup adapter** (`MEETUP`): Public API adapter built, no live sources yet
- [x] **WordPress REST API** (`WORDPRESS_API`): Shared utility for blog-based sources (EWH3, DCH4)
- [ ] **RSS/Atom adapter** (`RSS_FEED`): For kennels with blog-style event posts (WordPress blog scrapers already cover some of this)
- [ ] **hashnj.com HTML scraper**: Similar to hashnyc.com, different HTML structure
- [ ] **Gemini AI parsing**: For complex multi-day event narrative text (campout descriptions with per-day schedules)

### Event Series
*Schema fields exist on Event model: `isSeriesParent`, `parentEventId`. Scraper-side splitting + linking is complete (Hash Rego adapter). UI grouping deferred.*

- [x] Scraper support: multi-day events split into per-day records with `seriesId` → `parentEventId` linking
- [ ] Admin UI to link/unlink events in a series
- [ ] Grouped display in hareline (collapsible parent cards with children)
- [ ] Series detail page showing full weekend/campout schedule

### Logo Upload
- [ ] Image upload for kennel logos (currently URL-only field)
- [ ] Upload to cloud storage (Vercel Blob, S3, or Cloudinary)
- [ ] Image processing: resize + optimize for 64x64 display
- [ ] Update QuickInfoCard and hero section to use uploaded images

### SEO & Social Sharing
- [ ] Open Graph tags on event detail pages (title, description, kennel, date)
- [ ] OG tags on kennel pages (with logo image if available)
- [ ] Meta descriptions for search engines

### Calendar Feed Subscriptions (Per-Kennel)
- [ ] Subscribable calendar feed per kennel (auto-updating .ics URL)
- [ ] Users add once, events update automatically in their calendar app
- [ ] Builds on existing `src/lib/calendar.ts` infrastructure

---

## Long-Term: Social & Scale

### Social Features (PRD v2 — "The Circle")
- [ ] Activity feed (friends' check-ins)
- [ ] "On-On!" kudos reactions
- [ ] Comments on events (may ship earlier as Priority 7)
- [ ] Friend connections with privacy controls

### Hare Management & Nudging
**Informed by HC's "Hare Raising" tools — GMs struggle to fill hare slots.**

- [ ] "Hare needed" flag on future events
- [ ] Nudge hashers who haven't hared in N runs: "You've run 10 times since your last hare!"
- [ ] Hare volunteer signup from event detail page

### AI-Assisted Source Onboarding
- [ ] **Phase 1**: AI analyzes URL/HTML → proposes field mappings → human reviews
- [ ] **Phase 2**: AI generates adapter config JSON → human approves → preview → save
- [ ] **Phase 3**: Users submit source URLs → AI creates draft config → admin approves → live

### Infrastructure Scaling
- [ ] BullMQ + Redis (if needed at 50+ sources)
- [ ] PostGIS / geo queries (if client-side distance filtering proves insufficient)
- [ ] Per-source cron scheduling (requires Vercel Pro for sub-daily intervals)
- [ ] Staggered scrape timing to avoid rate limits

---

## Technical Debt & Hardening

- [ ] Performance: pagination, React Query caching on list views
- [ ] Rate limiting on public API routes
- [ ] Double-header handling (same kennel, same day, two events)
- [ ] Email/notification integration for source health alerts

### Admin UX Architecture

*Larger structural improvements to the admin section identified during PR #93 review. Each is a standalone PR.*

- [ ] **Admin landing/dashboard page** — central hub with at-a-glance source health, recent alerts, scrape activity, and quick-action links (currently admin lands on the sources list)
- [ ] **Breadcrumbs system** — consistent navigation breadcrumbs across admin section (e.g., Sources > Source Detail > Scrape Log) to improve wayfinding in nested views
- [ ] **Unified badge/status system** — consolidate health badges, alert severity badges, and source status indicators into shared components with consistent styling
- [ ] **Event page filter pattern consistency** — align hareline filters, admin event filters, and logbook filters to use the same filter bar component pattern for a cohesive UX

### Codebase Refactoring (Phase 4 — Structural Splits)

*Phases 1-3 complete (shared utilities, function decomposition, pattern standardization). Phase 4 items are lower-priority structural splits — each should be its own PR.*

- [ ] **Split large server action files** — one commit per file
  - `src/app/admin/kennels/actions.ts` (648 lines): CRUD vs profile fields vs helpers
  - `src/app/admin/alerts/actions.ts` (592 lines): Status lifecycle vs repair actions
  - `src/app/misman/[slug]/attendance/actions.ts` (700+ lines): Recording vs polling vs suggestions
- [ ] **Split large component files** — extract co-located sub-components
  - `src/components/admin/EventTable.tsx` (647 lines): Filter bar, table body, bulk actions
  - `src/components/admin/RosterGroupsAdmin.tsx` (582 lines): Group card, create form, pending queue
  - `src/components/admin/SourceTable.tsx` (517 lines): Row component, health badge, actions
  - `src/components/admin/KennelForm.tsx` (516 lines): Main form, alias manager, social links
  - `src/components/misman/ImportWizard.tsx` (502 lines): Per-step sub-components
- [ ] **Centralize `revalidatePath` strings** — create `src/lib/paths.ts` constants, replace 124 hardcoded calls

### Deferred (Low Priority)
- Per-kennel trust level overrides: allow different trust levels per source-kennel pair (e.g., Hash Rego high-trust for WH4 primary source, low-trust for BFM enrichment)
- Kennel Directory "Recently Active" sort: extend to include recent past events (currently only uses upcoming events)
- Location privacy / time-gated location reveal
- Hash cash amount tracking / ledger (boolean `paid` is sufficient)
- Auto-detect virgins from roster data
- Cross-kennel hasher directory
- Mobile native app (web-first + PWA is correct strategy)
- WebSocket/SSE for real-time attendance updates (polling is sufficient)
- Interactive songbook (HC #298 — cultural feature, low ROI)
- Trail Chat / full messaging (high complexity, event comments are the cheaper test)

---

## Scaling Trajectory

| Phase | Sources | Effort per Source | Code Changes |
|-------|---------|-------------------|--------------|
| **Manual** (HTML scrapers) | 29 | ~1-2 hours | Adapter code + seed + resolver |
| **Admin wizard** (COMPLETE) | 30-50 | ~5 min | None (form-based config for Calendar/Sheets/iCal/Meetup) |
| **AI-assisted** (Long-term) | 50+ | ~5 min review | None |
| **Community** (Long-term) | 100+ | ~1 min approval | None |

---

## Priority Summary

| # | Feature | Strategic Driver | Effort | HC Gap Exploited |
|---|---------|-----------------|--------|------------------|
| 1 | **Expand Source Coverage** (admin wizard COMPLETE) | Widen primary moat | Ongoing (new sources via wizard) | Manual data entry |
| 2 | **Strava Integration** (OAuth + auto-match) | Unique differentiator, no competitor has this | 2-3 sprints | Zero fitness integration |
| 3 | **Misman Growth Lever** (milestone watch, landing page, real-world testing) | B2B adoption, replace Google Sheets | 1 sprint | Paid kennel admin with less capability |
| 4 | **User Onboarding** (personal CSV import, log unlisted run, manual submission) | Reduce friction, serve traveling hashers | 1-2 sprints | Walled garden onboarding |
| 5 | **Map-Based Discovery** (map tab, near-me, travel mode) | Traveling hasher killer feature | 1 sprint | App-only proximity search |
| 6 | **PWA & Notifications** (web push, add-to-home-screen) | Retention, engagement loops | 1 sprint | Native app friction |
| 7 | **Social Visibility** (who's going, event comments) | Engagement, coordination | Small per feature | RSVP visibility, Trail Chat |
| 8 | **Data Portability** (CSV exports, payment links) | Trust, data ownership, lightweight Hash Cash | Small per feature | Excel export, Hash Cash |
| 9 | **Additional Integrations** (iCal, RSS, event series, SEO) | Coverage depth, discoverability | Varies | Feature parity |

---

## Reference

- [Source Onboarding Playbook](source-onboarding-playbook.md) — step-by-step guide for adding sources
- [Competitive Analysis](competitive-analysis.md) — Harrier Central analysis and strategic positioning
- [Kennel Page Redesign Spec](kennel-page-redesign-spec.md) — kennel profile enrichment and page redesign spec
- [Kennel Research](kennel-research/) — regional research for DC, Chicago, SF Bay, London kennels
- [Misman Attendance Requirements](misman-attendance-requirements.md) — kennel attendance management tool requirements and decisions
- [Misman Implementation Plan](misman-implementation-plan.md) — sprint plan for misman feature
- [Config-Driven Onboarding Plan](config-driven-onboarding-plan.md) — source onboarding wizard design (6-phase)
- [Test Coverage Analysis](test-coverage-analysis.md) — test coverage gap analysis and priorities
- [HASHTRACKS_PRD.md](../HASHTRACKS_PRD.md) — original product requirements document (includes Strava API reference in Appendix C)
- [HASHTRACKS_IMPLEMENTATION_PLAN.md](../HASHTRACKS_IMPLEMENTATION_PLAN.md) — original sprint plan (Sprints 1-4 complete, evolved beyond this plan)
