# HashTracks Roadmap

Living document tracking what's been built, what's next, and where we're headed.

Last updated: 2026-02-12

---

## What's Built (Sprints 1-4 + Polish)

### Core Platform
- [x] Next.js 16 App Router, Prisma 7, Clerk auth, Railway PostgreSQL, Vercel deployment
- [x] Kennel directory with subscriptions, profiles, admin tools
- [x] Source engine: adapter framework, merge pipeline, fingerprint dedup, kennel resolver
- [x] Hareline: list/calendar views, filters (region, kennel, day, scope), URL persistence
- [x] Master-detail layout: event list + detail panel on desktop, full-page on mobile
- [x] Admin UI: source management, manual scrape trigger, scrape logs, source health

### Data Sources (3 live)
- [x] **hashnyc.com** (HTML Scraper) — 11 NYC-area kennels
- [x] **Boston Hash Calendar** (Google Calendar API) — 5 Boston kennels
- [x] **Summit H3 Spreadsheet** (Google Sheets) — 3 NJ kennels (Summit, SFM, ASSSH3)

### Current Stats
- 23 kennels, 74 aliases, 3 sources, 19 source-kennel links
- 3 adapter types: HTML_SCRAPER, GOOGLE_CALENDAR, GOOGLE_SHEETS

---

## Near-Term: Source Scaling & Data Quality

### Historical Event Import — Sprint 7 (Infra COMPLETE)
**Goal**: Import full event history from existing sources, not just recent events.

- [x] Add `scrapeDays` field to Source model for per-source window configuration
- [x] Cron uses per-source `scrapeDays` instead of hardcoded 90 days
- [x] Admin UI pre-fills lookback from source config
- [x] Seed: hashnyc/Boston → 365 days, Summit → 9999 (all tabs)
- [ ] hashnyc.com: Test `?days=all` for full 8+ year archive import
  - Quality control: spot-check events from each year for correct parsing
  - Consider batch processing (1 year at a time) to manage memory and error isolation
- [ ] Boston Calendar: Verify 365-day window captures sufficient history
- [ ] Add admin "Import Full History" button per source
- [ ] Quality metrics dashboard: show per-source event counts by year, unmatched kennel tags, missing fields

### Source Change Detection & Monitoring — COMPLETE
**Goal**: Detect when a source changes format and alert for human review.

- [x] **Scrape health scoring**: Rolling-window analysis (last 10 scrapes) for event count trends and field fill rates
  - Event count drop >50% → WARNING alert; drop to 0 → CRITICAL alert
  - Field fill rate drop >30pp from baseline → WARNING alert (per-field)
- [x] **Structural change detection for HTML sources**: SHA-256 hash of tag hierarchy (table structure, CSS classes, child tag patterns)
  - Compares fingerprint between scrapes, alerts on structural changes
- [x] **Admin alerts page**: `/admin/alerts` with filter tabs (Active, Open, Acknowledged, Snoozed, Resolved, All)
  - 6 alert types: event count anomaly, field fill drop, structure change, scrape failure, consecutive failures, unmatched tags
  - Actions: acknowledge, snooze (24h/7d), resolve, investigate (link to source detail)
  - Alert badge count on admin nav tab
- [x] **Graceful degradation**: Per-event error tracking in merge pipeline (capped at 50 errors), partial success saves what works
- [x] **Alert deduplication**: Upserts against existing open alerts; respects snooze windows
- [x] **Source detail integration**: Open alerts stat card + recent alerts section on source detail page
- [ ] **Email/notification integration**: Send alerts to admin email when source health degrades (deferred)

### Config-Driven Source Onboarding (Admin UI)
**Goal**: Add new Google Sheets sources without code changes.

- [ ] Admin UI page: "Add Source" form at `/admin/sources/new`
  - Select adapter type (HTML_SCRAPER, GOOGLE_CALENDAR, GOOGLE_SHEETS)
  - For Google Sheets: paste sheet URL, auto-extract sheet ID
  - Column mapping interface: fetch first 5 rows, show column preview, let admin map fields
  - Kennel tag rule builder: define default kennel, special run mappings
  - Start time rules: day-of-week → time mapping
- [ ] Preview mode: show first 10 parsed events before saving
  - Highlight any parsing issues (bad dates, missing fields, unmatched kennels)
- [ ] Auto-detect columns from CSV headers when possible
- [ ] Create new kennels and aliases inline during source setup
- [ ] Save config to `Source.config` JSON — no code deployment needed

### Additional Adapter Types
- [ ] **iCal feed adapter** (`ICAL_FEED`): For kennels that publish `.ics` calendar files
- [ ] **hashnj.com HTML scraper**: Similar to hashnyc.com but different HTML structure
- [ ] **RSS/Atom adapter** (`RSS_FEED`): For kennels with blog-style event posts
- [ ] **Manual event form** (`MANUAL`): Admin and verified user event submission

---

## Mid-Term: User Features

### The Logbook (Attendance Tracking) — Sprint 5 COMPLETE
- [x] "I Was There" one-click check-in (past events only, defaults to RUN)
- [x] Participation level selector: R / H / BH / DC / BM / W / C
- [x] Edit/delete attendance with dialog
- [x] Activity link field (any URL — Strava, Garmin, AllTrails, etc.)
- [x] Notes field for personal trail notes
- [x] Attendance badges on hareline event cards and detail panel
- [x] Check-in from both event detail page and master-detail panel
- [x] "My Runs" page (`/logbook`) with filters (region, kennel, level)
- [x] Stats dashboard (`/logbook/stats`): totals, per-kennel, per-region, per-level breakdowns
- [x] Milestone markers (25, 50, 69 "Nice.", 100, 150, 200, 250, 300, 400, 500, 666 "Devilish", 700, 800, 900, 1000)

### "I'm Going" RSVP — Sprint 7 COMPLETE
- [x] **AttendanceStatus enum**: INTENDING / CONFIRMED — separate from ParticipationLevel
- [x] **"I'm Going" toggle button** on future events (authenticated users)
- [x] **"Going" blue badge** on event cards and logbook entries
- [x] **"Confirm" button** appears after event passes for INTENDING records
- [x] **checkIn() auto-upgrade**: Existing INTENDING → CONFIRMED on check-in
- [x] **Stats filter**: Only CONFIRMED records counted in stats/milestones
- [x] **Event detail counts**: Separate "X checked in · Y going" display

### Logbook — Next Up
- [ ] **Log Unlisted Run**: Manual event entry for runs not in the database (one-off events, traveling, etc.)
- [ ] **Admin-editable participation levels**: Migrate enum to reference table for custom levels per community
- [ ] **"Beez There" checkbox**: Optional flag on attendance (nice-to-have, deferred from Sprint 5)

### CSV Import (Bulk History)
- [ ] Upload CSV of past attendance
- [ ] Column mapping UI
- [ ] Kennel name normalization during import (alias matching)
- [ ] Preview matched events before saving

### Cron Scheduling — COMPLETE
- [x] Vercel Cron for automated daily scrapes (6:00 AM UTC)
- [x] Shared `scrapeSource()` for cron and admin routes
- [x] CRON_SECRET auth on cron endpoint
- [ ] Per-source schedule configuration
- [ ] Staggered timing to avoid rate limits

---

## Long-Term: AI-Assisted Onboarding

**Goal**: Minimize manual work for adding new sources.

### Phase 1: AI Structure Analysis
- [ ] Point AI at a URL or Google Sheet → it analyzes the HTML/CSV structure
- [ ] AI proposes field mappings (date, kennel, hares, location, etc.)
- [ ] AI identifies kennel name patterns and suggests tag extraction rules
- [ ] Human reviews proposed mappings in the admin UI

### Phase 2: Semi-Automated Onboarding
- [ ] AI generates adapter config JSON automatically
- [ ] Human reviews and approves config
- [ ] Preview events parsed with proposed config
- [ ] One-click save and initial scrape

### Phase 3: Community-Driven Growth
- [ ] Users submit source URLs for their kennel
- [ ] AI pre-processes and creates draft source config
- [ ] Admin approves with minimal review
- [ ] New source goes live immediately

---

## Scaling Trajectory

| Phase | Sources | Effort per Source | Code Changes |
|-------|---------|-------------------|--------------|
| **Today** (manual) | 3 | ~1-2 hours | Adapter code + seed + resolver |
| **Config-driven** | 10-20 | ~15 min | Seed only (for Sheets-type) |
| **AI-assisted** | 50+ | ~5 min review | None |
| **Community** | 100+ | ~1 min approval | None |

---

## Technical Debt & Polish

### Sprint 6: UX Polish — COMPLETE
- [x] **Detail panel dismiss button**: X button + Escape key to close sidebar panel
- [x] **"Add to Calendar" button**: Google Calendar URL + .ics download on event detail page and panel
- [x] **Loading skeletons**: Hareline, logbook, and kennel detail pages
- [x] **Dynamic page titles**: Context-aware browser tab titles for all pages
- [x] **Color-coded region badges**: Curated color palette per region on event cards and logbook

### Admin Sources Polish — COMPLETE
- [x] **Slimmed list table**: Truncated URLs, friendly type labels, relative timestamps, kebab overflow menu
- [x] **Detail page tooltips**: All action buttons labeled, "Lookback: 90 days" visible label
- [x] **Detail page layout**: Type badge in header, frequency surfaced in stats grid

### Calendar View Improvements — COMPLETE
- [x] **Show all events**: Calendar bypasses upcoming/past filter — navigate freely to any month
- [x] **Region color coding**: Calendar badges match list view region colors
- [x] **Dim past days**: Past days rendered at 50% opacity for visual distinction
- [x] **Vertical badge stacking**: Max 2 badges per cell + "+N more" overflow indicator
- [x] **Grid lines**: Subtle 1px lines between calendar cells via gap-as-border technique
- [x] **Side panel on desktop**: Day detail panel as sticky sidebar on large screens

### Remaining Polish
- [ ] Mobile responsiveness pass
- [ ] Performance: pagination, React Query caching
- [ ] Rate limiting on public API routes
- [ ] Double-header handling (same kennel, same day, two events)

---

## Reference

- [Source Onboarding Playbook](source-onboarding-playbook.md) — step-by-step guide for adding sources
- [HASHTRACKS_PRD.md](../HASHTRACKS_PRD.md) — original product requirements document
- [HASHTRACKS_IMPLEMENTATION_PLAN.md](../HASHTRACKS_IMPLEMENTATION_PLAN.md) — original sprint plan (Sprints 1-4 complete, evolved beyond this plan)
