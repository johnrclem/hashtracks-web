# HashTracks Roadmap

Living document tracking what's been built, what's next, and where we're headed.

Last updated: 2026-02-16

---

## What's Built

### Core Platform (Sprints 1-4 + Polish)
- [x] Next.js 16 App Router, Prisma 7, Clerk auth, Railway PostgreSQL, Vercel deployment
- [x] Kennel directory with subscriptions, profiles, admin tools
- [x] Source engine: adapter framework, merge pipeline, fingerprint dedup, kennel resolver
- [x] Hareline: list/calendar views, filters (region, kennel, day, scope), URL persistence
- [x] Master-detail layout: event list + detail panel on desktop, full-page on mobile
- [x] Admin UI: source management, manual scrape trigger, scrape logs, source health

### Data Sources (7 live)
- [x] **hashnyc.com** (HTML Scraper) — 11 NYC-area kennels
- [x] **Boston Hash Calendar** (Google Calendar API) — 5 Boston kennels
- [x] **Summit H3 Spreadsheet** (Google Sheets) — 3 NJ kennels (Summit, SFM, ASSSH3)
- [x] **BFM Google Calendar** (Google Calendar API) — BFM (Philadelphia)
- [x] **Philly H3 Google Calendar** (Google Calendar API) — Philly H3
- [x] **BFM Website** (HTML Scraper) — benfranklinmob.com + special events page
- [x] **Philly H3 Website** (HTML Scraper) — hashphilly.com/nexthash/

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

### Cron & Infrastructure — COMPLETE
- [x] Vercel Cron daily scrapes (6:00 AM UTC) with CRON_SECRET auth
- [x] Per-source `scrapeFreq` with interval-based skip logic
- [x] Shared `scrapeSource()` for cron + admin routes

### Current Stats
- 24 kennels, 82 aliases, 7 sources, 25 source-kennel links
- 3 adapter types: HTML_SCRAPER, GOOGLE_CALENDAR, GOOGLE_SHEETS
- 21 models, 16 enums in Prisma schema
- 585 tests across 34 test files

---

## Immediate: Early Adopter Success

*Focus: Polish the misman experience, get feedback, expand source coverage.*

### Misman Experience Refinement
**Goal**: Make the attendance management tool bulletproof for first misman users.

- [ ] End-to-end testing with real misman users (invite, onboard, record attendance, review history)
- [ ] Address UX friction discovered during real-world usage
- [ ] Mobile testing on actual devices (attendance form is the primary mobile use case)

### In-App Feedback — COMPLETE
**Goal**: Capture feedback from early adopters without requiring GitHub accounts.

- [x] "Send Feedback" dialog in app footer (signed-in users only)
- [x] Category dropdown (Bug Report, Feature Request, Question, Other) + title + description
- [x] Creates GitHub Issue via REST API with `user-feedback` + category labels
- [x] Auto-captures current page URL for bug context
- [x] Leverages existing `GITHUB_TOKEN` and issue creation pattern from alert actions
- Upgrade path: Canny free tier when user base grows beyond ~20

### Expand Source Coverage
**Goal**: Add more kennels and regions to increase platform value.

- [ ] Identify next batch of kennels to onboard (DC, Chicago, other regions)
- [ ] Add new sources using existing adapter types (HTML, Calendar, Sheets)
- [ ] Continue refining kennel resolver patterns as new sources reveal new name variants

---

## Near-Term: User Onboarding & Growth

### Personal CSV Import
**Goal**: Let individual users backfill their own logbook from personal spreadsheets.

*Different from misman CSV import — this is for individual hasher history.*

- [ ] Upload page at `/logbook/import`
- [ ] Column mapping UI: user maps their columns to HashTracks fields (date, kennel, participation level, notes, strava URL)
- [ ] Kennel name normalization via alias matching (unmatched names flagged)
- [ ] Import preview + confirm: show matched events, flagged issues
- [ ] Batch create Attendance records for matching canonical events
- [ ] Manual entries for unmatched kennels (triggers KennelRequest)

### Log Unlisted Run
**Goal**: Remove friction for traveling hashers and one-off events.

- [ ] User logs a run for a kennel/event not in the system
- [ ] Provides: kennel name, region, country, date, participation level, notes
- [ ] Creates attendance record + KennelRequest for admin review
- [ ] Admin can later link to a real kennel/event when source is added

### Manual Event Submission
**Goal**: Cover Facebook-only kennels and user-submitted events.

- [ ] Admin manual event creation (for kennels without scrapeable sources, like Rumson)
- [ ] User event submission form (verified users, MANUAL source type)
- [ ] Events appear immediately — no approval queue for v1

### SEO & Social Sharing
**Goal**: Improve discoverability via link sharing.

- [ ] Open Graph tags on event detail pages (title, description, kennel, date)
- [ ] OG tags on kennel pages
- [ ] Meta descriptions for search engines
- [ ] Page titles already implemented (Sprint 6)

---

## Mid-Term: Integrations & Depth

### Strava Integration (PRD Phase 5)
**Goal**: Automate the connection between Strava activities and hash attendance.

*Detailed implementation reference in [PRD Appendix C](../HASHTRACKS_PRD.md).*

- [ ] Strava OAuth flow (real redirect — not manual code copy)
- [ ] Activity history fetch + server-side cache
- [ ] Auto-suggest matches: Strava activity overlapping event by date + region
- [ ] One-click attach Strava link to attendance record
- [ ] Out-of-town run discovery (Strava activities in regions with no logged attendance)
- [ ] Batch processing with rate limit awareness (100 req/15min, 1000 req/day)

### Event Series
**Goal**: Support multi-day events (weekends, campouts, Fearadelphia, etc.).

*Schema fields already exist on Event model: `isSeriesParent`, `parentEventId`.*

- [ ] Admin UI to link/unlink events in a series
- [ ] Grouped display in hareline (parent event with collapsible children)
- [ ] Series detail page showing full weekend/campout schedule
- [ ] Scraper support: detect multi-day events during parsing

### Config-Driven Source Onboarding (Admin UI)
**Goal**: Add new Google Sheets/Calendar sources without code changes.

- [ ] Admin "Add Source" form at `/admin/sources/new`
- [ ] For Google Sheets: paste URL, auto-extract sheet ID, column mapping with preview
- [ ] Kennel tag rule builder, start time rules
- [ ] Preview mode: show first 10 parsed events before saving
- [ ] Save config to `Source.config` JSON — no code deployment needed

### Additional Adapter Types
- [ ] **iCal feed adapter** (`ICAL_FEED`): For kennels with `.ics` calendar files
- [ ] **RSS/Atom adapter** (`RSS_FEED`): For kennels with blog-style event posts
- [ ] **hashnj.com HTML scraper**: Similar to hashnyc.com, different HTML structure

### Historical Event Import
*Infrastructure complete (per-source `scrapeDays`). Remaining:*

- [ ] hashnyc.com: Test `?days=all` for full 8+ year archive import
- [ ] Boston Calendar: Verify 365-day window captures sufficient history
- [ ] Add admin "Import Full History" button per source
- [ ] Quality metrics dashboard: per-source event counts by year

### Misman Extensions
- [ ] **CSV export**: Export attendance history to CSV
- [ ] **"Beez There" checkbox**: Optional flag on attendance
- [ ] **Admin-editable participation levels**: Migrate enum to reference table

---

## Long-Term: Social & Scale

### Social Features (PRD v2)
- [ ] Activity feed (friends' check-ins)
- [ ] "On-On!" kudos reactions
- [ ] Comments on events
- [ ] Friend connections with privacy controls

### AI-Assisted Source Onboarding
**Goal**: Minimize manual work for adding new sources.

- [ ] **Phase 1**: AI analyzes URL/HTML → proposes field mappings → human reviews
- [ ] **Phase 2**: AI generates adapter config JSON → human approves → preview → save
- [ ] **Phase 3**: Users submit source URLs → AI creates draft config → admin approves → live

### Infrastructure Scaling
- [ ] BullMQ + Redis (if needed at 50+ sources)
- [ ] PostGIS / geo queries (distance-based event search)
- [ ] Per-source cron scheduling (requires Vercel Pro for sub-daily intervals)
- [ ] Staggered scrape timing to avoid rate limits

---

## Technical Debt & Hardening

- [ ] Performance: pagination, React Query caching on list views
- [ ] Rate limiting on public API routes
- [ ] Double-header handling (same kennel, same day, two events)
- [ ] Email/notification integration for source health alerts

### Deferred (Low Priority)
- Location privacy / time-gated location reveal
- Hash cash amount tracking
- Auto-detect virgins from roster data
- Cross-kennel hasher directory
- Mobile native app
- WebSocket/SSE for real-time attendance updates

---

## Scaling Trajectory

| Phase | Sources | Effort per Source | Code Changes |
|-------|---------|-------------------|--------------|
| **Today** (manual) | 7 | ~1-2 hours | Adapter code + seed + resolver |
| **Config-driven** | 10-20 | ~15 min | Seed only (for Sheets/Calendar) |
| **AI-assisted** | 50+ | ~5 min review | None |
| **Community** | 100+ | ~1 min approval | None |

---

## Reference

- [Source Onboarding Playbook](source-onboarding-playbook.md) — step-by-step guide for adding sources
- [Misman Attendance Requirements](misman-attendance-requirements.md) — kennel attendance management tool requirements and decisions
- [Misman Implementation Plan](misman-implementation-plan.md) — sprint plan for misman feature
- [HASHTRACKS_PRD.md](../HASHTRACKS_PRD.md) — original product requirements document
- [HASHTRACKS_IMPLEMENTATION_PLAN.md](../HASHTRACKS_IMPLEMENTATION_PLAN.md) — original sprint plan (Sprints 1-4 complete, evolved beyond this plan)
