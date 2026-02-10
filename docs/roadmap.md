# HashTracks Roadmap

Living document tracking what's been built, what's next, and where we're headed.

Last updated: 2026-02-09

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

### Historical Event Import
**Goal**: Import full event history from existing sources, not just recent events.

- [ ] Increase default scrape window from 90 days to 365 days for all sources
- [ ] Add `days` parameter to source config to allow per-source window customization
- [ ] hashnyc.com: Test `?days=all` for full 8+ year archive import
  - Quality control: spot-check events from each year for correct parsing
  - Consider batch processing (1 year at a time) to manage memory and error isolation
- [ ] Boston Calendar: API v3 supports `timeMin`/`timeMax` — extend to 2+ years
- [ ] Summit Sheets: Already processes all tabs; confirm data quality for older tabs (1980s-era data may have different column formats)
- [ ] Add admin UI controls: "Import full history" button per source with progress indicator
- [ ] Quality metrics dashboard: show per-source event counts by year, unmatched kennel tags, missing fields

### Source Change Detection & Monitoring
**Goal**: Detect when a source changes format and alert for human review.

- [ ] **Scrape health scoring**: Track success rate, event count trends, and field fill rates per scrape
  - If event count drops >50% compared to rolling average, flag as potential format change
  - If field fill rate drops (e.g., locations suddenly all empty), flag specific field
- [ ] **Structural change detection for HTML sources**: Hash the HTML structure (tag hierarchy) separately from content
  - Compare structural fingerprint between scrapes
  - If structure changes but content doesn't parse, trigger alert
- [ ] **Admin alerts page**: `/admin/alerts` showing flagged sources that need human review
  - Alert types: format change suspected, event count anomaly, new unmatched kennel tags, scrape failures
  - One-click actions: acknowledge, snooze, investigate (links to source detail + recent scrape logs)
- [ ] **Email/notification integration**: Send alerts to admin email when source health degrades
- [ ] **Graceful degradation**: When a scrape partially fails (some events parse, some don't), save what works and flag the rest rather than failing the entire scrape

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

### The Logbook (Attendance Tracking)
- [ ] "I Was There" check-in on event detail page
- [ ] Participation level: R / H / BH / DC / BM / W / C
- [ ] "My Runs" page with filters
- [ ] Stats dashboard: total runs, per-kennel, per-region, hare count
- [ ] Milestone markers (25th, 50th, 69th, 100th runs)
- [ ] Notes field and Strava URL attachment

### CSV Import (Bulk History)
- [ ] Upload CSV of past attendance
- [ ] Column mapping UI
- [ ] Kennel name normalization during import (alias matching)
- [ ] Preview matched events before saving

### Cron Scheduling
- [ ] Vercel Cron for automated daily scrapes
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

- [ ] Mobile responsiveness pass
- [ ] Error handling and loading states for all pages
- [ ] SEO basics (page titles, meta descriptions, OG tags)
- [ ] Performance: pagination, React Query caching
- [ ] Rate limiting on public API routes
- [ ] Double-header handling (same kennel, same day, two events)

---

## Reference

- [Source Onboarding Playbook](source-onboarding-playbook.md) — step-by-step guide for adding sources
- [HASHTRACKS_PRD.md](../HASHTRACKS_PRD.md) — original product requirements document
- [HASHTRACKS_IMPLEMENTATION_PLAN.md](../HASHTRACKS_IMPLEMENTATION_PLAN.md) — original sprint plan (Sprints 1-4 complete, evolved beyond this plan)
