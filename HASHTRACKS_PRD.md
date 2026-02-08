# HashTracks: Product Requirements & Project Plan

**Date:** February 6, 2026
**Status:** Approved for Implementation (v2 — Revised)

---

## 1. Executive Summary

**Vision:** To build the "Strava of Hashing" — a community-first platform where hashers discover upcoming runs ("The Hareline"), track their attendance history ("The Logbook"), and interact socially ("The Circle" — v2).

**Current State:** A robust single-user Google Apps Script tool ("Personal Scraper") with proven scraping, Strava integration, kennel management, and batch review workflows.

**Target State (v1):** A scalable, multi-user web platform focused on **solo hashers** — enabling run discovery via pre-seeded scrapers and effortless attendance logging.

**v2 Target:** Social features (feeds, kudos, comments), kennel admin tools, scribe verification, RSVP.

**Core Value Prop (v1):**
1. **Aggregated Discovery:** One calendar for all kennels — browse NYC, Boston, NJ, Philly, Chicago events in one place.
2. **Effortless Logging:** "I was there" check-ins with participation level, Strava URL, and personal notes.
3. **Personal Stats:** Run counts, kennel breakdowns, milestones (69th, 100th, etc.).
4. **Global Kennel Directory:** Browse and subscribe to kennels worldwide.

---

## 2. Core Concepts & Terminology

* **Hasher:** The user. Has a "Hash Name" (public, primary identity) and "Nerd Name" (real name, private by default).
* **Kennel:** The organization hosting runs (e.g., "New York City H3"). Has a canonical short name ("NYCH3"), full name, region, and aliases.
* **Kennel Alias:** Alternate names for the same kennel. "NYC", "NYCH3", "NYC Hash", "New York City Hash House Harriers" all map to the same kennel record. Critical for de-duplication and import matching.
* **Run Number:** Sequential identifier per kennel (e.g., "NYCH3 #2385"). Not globally unique — each kennel has its own numbering. Optional for some events (special events, campouts).
* **Hares:** 1-3 people who set the trail for a specific event. Event-level data (who organized it), distinct from attendance data (who showed up).
* **Participation Level:** How the user participated in an event:
  * **R** — Run (standard trail participation)
  * **H** — Hare (set the trail)
  * **BH** — Bag Hero (carried the beer/supplies)
  * **DC** — Drink Check (manned a beer stop on trail)
  * **BM** — Beer Mile (beer mile event)
  * **W** — Walk/Crawl (walked or crawled the trail)
  * **C** — Circle Only (attended post-trail circle but not the trail)
* **Beez There:** Boolean — was someone "named" (received their hash name for the first time) at this event while the user was present? A social milestone tracked per attendance record.
* **Source:** A data provider (e.g., `hashnyc.com`, `hashrego.com`, Google Calendar ID).
  * *One Source can feed multiple Kennels (Aggregator pattern).* hashnyc.com feeds ~11 NYC-area kennels.
  * *One Kennel can have multiple Sources.* Summit H3 has both hashnj.com and a Google Sheet.
* **Raw Import:** Unprocessed data scraped/fetched from a Source. Immutable — never edited by users or the merge pipeline.
* **Canonical Event:** The single "Golden Record" displayed to users, formed by merging/de-duplicating Raw Imports using a `kennel + date` composite key.
* **Event Series:** A Parent event (e.g., "Fearadelphia Weekend") containing Child events (e.g., "Friday Pub Crawl", "Saturday Trail").

---

## 3. Target Personas & User Stories

### Persona 1: "Regular Hasher"
*Hashes 1-2x/week with home kennel(s), occasionally travels.*

* "I want to see what NYC hash events are coming up this month"
* "I went to BrH3 last Wednesday — let me log it"
* "I hashed in Chicago last weekend, I need to add that run manually"
* "How many NYCH3 runs have I done total?"
* "Who were the hares for last week's Knick run?"

### Persona 2: "Traveling Hasher"
*Hashes in different cities/countries, wants to track everywhere.*

* "I'm visiting DC next week — what kennels run there?"
* "I did 3 hashes in London — none of them are in the system yet"
* "I want to request that London H3 be added as a kennel"
* "Show me all my runs outside my home region"

### Persona 3: "Completionist"
*Wants to backfill years of attendance history.*

* "I have 5 years of runs in a spreadsheet — I want to import them"
* "Let me browse NYCH3 events from 2020 and mark which ones I attended"
* "I hared BrH3 #400 — let me set my participation level to H"

---

## 4. Data Model (Prisma Schema)

### The "Triad" Architecture
We distinguish between the input (Raw) and the output (Canonical):

1. **`Source` table:** Configuration for a scraper/adapter (URL, Type, Frequency, Health).
2. **`RawEvent` table:** Immutable record of exactly what the scraper found. Never edited by users.
3. **`Event` (Canonical) table:** The display record. Formed by merging RawEvents. De-duplicated by `kennel + date`.

### Full Schema

```prisma
// ── USERS ──

model User {
  id            String   @id @default(cuid())
  clerkId       String   @unique
  hashName      String?  // Public display name (primary identity)
  nerdName      String?  // Real name (private by default)
  email         String   @unique
  bio           String?
  homeKennels   UserKennel[]
  attendances   Attendance[]
  hareCredits   EventHare[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model UserKennel {
  id        String         @id @default(cuid())
  userId    String
  kennelId  String
  role      UserKennelRole @default(MEMBER)
  user      User           @relation(fields: [userId], references: [id])
  kennel    Kennel         @relation(fields: [kennelId], references: [id])
  createdAt DateTime       @default(now())

  @@unique([userId, kennelId])
}

enum UserKennelRole {
  MEMBER    // Subscribed hasher
  ADMIN     // Can edit kennel details (v2)
  SCRIBE    // Can verify attendance (v2)
}

// ── KENNELS ──

model Kennel {
  id          String        @id @default(cuid())
  shortName   String        @unique // "NYCH3"
  fullName    String        // "New York City Hash House Harriers"
  region      String        // "New York City, NY"
  country     String        @default("USA")
  description String?
  website     String?
  aliases     KennelAlias[]
  sources     SourceKennel[]
  events      Event[]
  members     UserKennel[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

model KennelAlias {
  id        String @id @default(cuid())
  kennelId  String
  alias     String // "NYC Hash", "HashNYC", "NYC", etc.
  kennel    Kennel @relation(fields: [kennelId], references: [id])

  @@unique([kennelId, alias])
  @@index([alias])
}

// ── SOURCES ──

model Source {
  id            String       @id @default(cuid())
  name          String       // "HashNYC Website"
  url           String       // "https://hashnyc.com"
  type          SourceType
  config        Json?        // Adapter-specific config (CSS selectors, calendar ID, sheet ID, etc.)
  trustLevel    Int          @default(5) // 1-10 scale
  scrapeFreq    String       @default("daily") // "hourly", "daily", "weekly"
  lastScrapeAt  DateTime?
  lastSuccessAt DateTime?
  healthStatus  SourceHealth @default(UNKNOWN)
  kennels       SourceKennel[]
  rawEvents     RawEvent[]
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
}

enum SourceType {
  HTML_SCRAPER     // hashnyc.com, hashnj.com — HTTP fetch + HTML parsing
  GOOGLE_CALENDAR  // bostonhash@gmail.com — Calendar API v3
  GOOGLE_SHEETS    // Summit H3 spreadsheet — Sheets API v4
  ICAL_FEED        // .ics URL — parse with ical.js
  RSS_FEED         // RSS/Atom feed
  JSON_API         // HashRego API (if available)
  MANUAL           // User-submitted events
}

enum SourceHealth {
  HEALTHY    // Last scrape succeeded
  DEGRADED   // Scrape succeeded but fewer events than expected
  FAILING    // Last N scrapes failed
  STALE      // No scrape attempted in >7 days
  UNKNOWN    // Never scraped
}

model SourceKennel {
  id        String @id @default(cuid())
  sourceId  String
  kennelId  String
  source    Source @relation(fields: [sourceId], references: [id])
  kennel    Kennel @relation(fields: [kennelId], references: [id])

  @@unique([sourceId, kennelId])
}

// ── EVENTS ──

model RawEvent {
  id          String   @id @default(cuid())
  sourceId    String
  rawData     Json     // Exact data as scraped — immutable
  fingerprint String   // Hash of key fields for change detection
  scrapedAt   DateTime @default(now())
  processed   Boolean  @default(false)
  eventId     String?  // Link to canonical Event after processing
  source      Source   @relation(fields: [sourceId], references: [id])
  event       Event?   @relation(fields: [eventId], references: [id])

  @@index([sourceId, scrapedAt])
  @@index([fingerprint])
}

model Event {
  id              String      @id @default(cuid())
  kennelId        String
  date            DateTime    // Event date (date portion, in event's local timezone)
  dateUtc         DateTime?   // Same moment in UTC (for cross-timezone queries)
  timezone        String?     // IANA timezone (e.g., "America/New_York")
  runNumber       Int?        // Kennel-specific sequential number (e.g., 2385)
  title           String?     // Trail/event name
  description     String?
  haresText       String?     // Display text: "Mudflap, Just Simon"
  locationName    String?     // Start location name
  locationAddress String?
  latitude        Float?
  longitude       Float?
  startTime       String?     // Local time string (e.g., "18:30") — NOT a timestamp
  sourceUrl       String?     // Link to original event page
  trustLevel      Int         @default(5)
  isSeriesParent  Boolean     @default(false)
  parentEventId   String?
  status          EventStatus @default(CONFIRMED)

  kennel      Kennel      @relation(fields: [kennelId], references: [id])
  parentEvent Event?      @relation("EventSeries", fields: [parentEventId], references: [id])
  childEvents Event[]     @relation("EventSeries")
  rawEvents   RawEvent[]
  hares       EventHare[]
  attendances Attendance[]
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@unique([kennelId, date]) // De-duplication key
  @@index([date])
  @@index([kennelId, date])
}

enum EventStatus {
  CONFIRMED
  TENTATIVE
  CANCELLED
}

model EventHare {
  id       String   @id @default(cuid())
  eventId  String
  hareName String   // Display name (always populated)
  userId   String?  // Optional link to User record (if hare has an account)
  role     HareRole @default(HARE)
  event    Event    @relation(fields: [eventId], references: [id])
  user     User?    @relation(fields: [userId], references: [id])

  @@index([eventId])
}

enum HareRole {
  HARE
  CO_HARE
  LIVE_HARE
}

// ── ATTENDANCE ──

model Attendance {
  id                 String             @id @default(cuid())
  userId             String
  eventId            String
  participationLevel ParticipationLevel @default(RUN)
  stravaUrl          String?
  beezThere          Boolean            @default(false)
  notes              String?            // User's personal notes
  isVerified         Boolean            @default(false) // Verified by scribe (v2)
  verifiedBy         String?            // Scribe user ID (v2)

  user    User    @relation(fields: [userId], references: [id])
  event   Event   @relation(fields: [eventId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, eventId])
}

enum ParticipationLevel {
  RUN          // R - Standard trail participation
  HARE         // H - Set the trail
  BAG_HERO     // BH - Carried the beer
  DRINK_CHECK  // DC - Manned a beer stop
  BEER_MILE    // BM - Beer mile event
  WALK         // W - Walk/Crawl
  CIRCLE_ONLY  // C - Circle only (no trail)
}

// ── KENNEL REQUESTS ──

model KennelRequest {
  id          String        @id @default(cuid())
  userId      String
  kennelName  String
  region      String?
  country     String?
  sourceUrl   String?       // Website, Facebook page, etc.
  notes       String?
  status      RequestStatus @default(PENDING)
  resolvedAt  DateTime?
  createdAt   DateTime      @default(now())
}

enum RequestStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### Schema Design Notes

* **`Event.date` + `Event.startTime` are separate** because many sources only provide date, not time. `startTime` is a string ("18:30") not a DateTime — combining with timezone into a proper timestamp happens at display time.
* **`@@unique([kennelId, date])` on Event** enforces de-duplication. The rare edge case of double-headers (same kennel runs twice in one day) requires admin intervention to temporarily relax the constraint.
* **`EventHare` hybrid model:** `hareName` is always populated from scraper data. `userId` is optionally linked when the hare has a HashTracks account. This avoids requiring hares to sign up before their name appears on events.
* **`KennelAlias` table** enables fuzzy matching during import and scraping without polluting the Kennel table. When a scraper encounters "NYC Hash" it can resolve to NYCH3 via alias lookup.
* **`RawEvent.fingerprint`** is a hash of key fields (date, kennel tag, run number, title) used for change detection — avoids re-processing unchanged events on each scrape.

---

## 5. Functional Requirements (v1)

### A. The Hareline (Discovery)

* **Global Calendar:** Aggregated view of all active sources, showing upcoming and past events.
* **Views:** List view (default), calendar month view.
* **Filtering:** By region, kennel, day of week.
* **My Kennels:** Users subscribe to home kennel(s). Hareline defaults to subscribed kennels.
* **Event Detail Page:** Date, kennel, run number, hares, description, location, source link.
* **Kennel Directory:** Browse all kennels, grouped by region. See event count, subscriber count.
* **Location Privacy:**
  * Support for "Location TBA" — reveal address X hours before start (source config).
  * Display region-level info when specific location is hidden.

### B. The Logbook (Attendance Tracking)

* **"I Was There" Check-In:**
  * Available on any event page (past events).
  * Retroactive — user can check in at any time after the event (no time window).
  * Sets: participation level, Strava URL (manual paste), beez, notes.
* **My Runs View:** List of all attended events, filterable by kennel, region, date range.
* **Stats Dashboard:**
  * Total runs, runs per kennel, runs per region.
  * Milestones: 25th, 50th, 69th, 100th, etc.
  * Hare count (times the user was a hare).
* **Log Unlisted Run:** User can log a run for a kennel NOT in the system.
  * Provides kennel name, region, country, date, participation level.
  * Triggers a `KennelRequest` for admin review.
* **CSV/Spreadsheet Import:** Bulk import from personal spreadsheets for history backfill.
  * Column mapping UI (map user's columns to HashTracks fields).
  * Kennel name normalization via alias matching.
  * Preview + confirm before import.

### C. Data Ingestion & Source Management

* **Multi-Source Adapter Framework:**
  * Pluggable adapters per `SourceType` (see Source Adapter Catalog below).
  * Each adapter: fetch → parse → emit `RawEvent[]`.
  * Scheduled via cron (not BullMQ initially — simpler ops).
* **Raw → Canonical Merge Pipeline:**
  * De-duplication key: `kennel_id + date`.
  * New RawEvent with matching canonical Event → update Event fields (hares, description, etc.) based on source trust level.
  * New RawEvent with no match → create new canonical Event.
  * Fingerprint-based change detection — skip re-processing unchanged events.
* **Source Health Monitoring:**
  * Track `lastScrapeAt`, `lastSuccessAt`, `healthStatus`.
  * Admin dashboard showing source health at a glance.
  * Alert on `FAILING` or `STALE` status.
* **Admin-Only Source Management:**
  * Root admin creates/edits sources and assigns kennel relationships.
  * Users can suggest new sources via a simple form (creates `KennelRequest`).
* **Manual Event Submission:**
  * Any verified user can submit an event (flagged as `MANUAL` source type).
  * Appears immediately — no admin approval required (v1 simplicity).

### D. User Identity & Kennel Subscriptions

* **Clerk Authentication:**
  * Google OAuth, email/password.
  * Hash name is the primary public identity (not real name).
  * Nerd name (real name) is optional and private by default.
* **Profile Page:**
  * Hash name, bio, home kennels.
  * Run stats and milestones.
  * Attendance history (public by default, can be set to private).
* **My Kennels:**
  * Subscribe to kennels to personalize Hareline default view.
  * Browse kennel directory to discover new kennels.
* **Kennel Request Workflow:**
  * User submits: kennel name, region, country, source URL (website/Facebook), notes.
  * Admin reviews, creates kennel + source if approved.
  * User notified of resolution.

---

## 6. Source Adapter Catalog

### Adapter Types

| Adapter Type | Source Example | Technique | Complexity |
|:---|:---|:---|:---|
| HTML Scraper | hashnyc.com, hashnj.com | HTTP fetch + Cheerio (server-side DOM) | Medium — fragile to HTML changes |
| Google Calendar | bostonhash@gmail.com | Calendar API v3 | Low — structured data |
| Google Sheets | Summit H3 spreadsheet | Sheets API v4 | Low — structured data |
| iCal Feed | (various) | Fetch .ics, parse with ical.js | Low |
| RSS/Atom Feed | (various) | Fetch + parse XML | Low |
| JSON API | HashRego (TBD) | REST API if available | Low |
| AI Parser | Arbitrary event page | Fetch HTML + Gemini extraction | Medium — needs prompt engineering |
| Manual | Rumson H3 (Facebook-only) | User submits event via form | N/A |

### Key Lesson from Current System

Most hash sites are simple HTML tables that don't require JavaScript rendering. **Playwright (headless browser) is overkill for most sources.** Use HTTP fetch + Cheerio as the default scraping approach. Reserve Playwright for JavaScript-rendered sites only — it has significant memory/CPU requirements in serverless environments.

### Adapter Interface

Each adapter implements:
```typescript
interface SourceAdapter {
  type: SourceType;
  fetch(source: Source): Promise<RawEventData[]>;
}

interface RawEventData {
  date: string;         // YYYY-MM-DD
  kennelTag: string;    // Raw kennel identifier from source
  runNumber?: number;
  title?: string;
  description?: string;
  hares?: string;
  location?: string;
  startTime?: string;   // HH:MM (local time)
  sourceUrl?: string;
}
```

### Kennel Tag Resolution

When a scraper emits a `kennelTag` (e.g., "NYC Hash", "Knickerbocker"), the merge pipeline resolves it to a canonical `Kennel` record via:
1. Exact match on `Kennel.shortName`
2. Case-insensitive match on `KennelAlias.alias`
3. If no match → flag for admin review

**Lesson:** Kennel name normalization is harder than it looks. The current GAS system has a two-level pipeline (regex extraction → alias matching → canonical short name → display tag). Each step can fail independently. Build robust logging for unmatched kennel tags.

---

## 7. Technical Architecture

### Stack Selection: T3 Stack

* **Frontend:** **Next.js (App Router)** + **React**
  * *UI Library:* Tailwind CSS + ShadcnUI
* **Backend API:** **Next.js API Routes** (Serverless)
* **Database:** **PostgreSQL**
  * *ORM:* **Prisma** (Type-safe database access)
  * *Note:* PostGIS deferred — use text-based region filtering initially. Add geo queries (distance-based event search) if needed later.
* **Authentication:** **Clerk** (Handles 2FA, sessions, Google OAuth, user management)
* **Scraping:** **HTTP fetch + Cheerio** (default). Playwright only for JS-rendered sites.
* **AI Integration:** **Google Gemini API** (via Google AI SDK) — for AI-based event parsing.
* **Scheduled Jobs:** **Vercel Cron** (or equivalent) — simple cron-based scraping.
  * *BullMQ + Redis deferred* — add queue infrastructure when needed for 50+ sources.

### Infrastructure

* **Vercel:** Frontend & API hosting
* **Railway or Supabase:** Managed PostgreSQL
* **Redis (deferred):** Add when queue-based processing is needed

### Architecture Decisions

| Decision | Rationale |
|:---|:---|
| No BullMQ at launch | Cron-based scraping is simpler to operate. Queue adds value at 50+ sources, not 5-10. |
| No PostGIS at launch | Text-based region filtering handles "show me NYC kennels." Geo queries (distance-based search) can be added later. |
| Cheerio over Playwright | Most hash sites are static HTML. Cheerio is 100x lighter. Playwright reserved for SPAs. |
| Clerk over custom auth | Hashing community doesn't need custom auth flows. Clerk handles OAuth, sessions, 2FA. |
| `startTime` as string | Many sources provide only "6:30 PM" without a full ISO timestamp. Storing as string avoids forced timezone conversion. |
| Date + kennel de-dup | Simpler than run-number-based de-dup (not all sources have run numbers). Handles 99%+ of cases. |

---

## 8. Launch Kennel List

### Pre-Seeded Kennels (v1 Launch)

| Kennel | Short Name | Region | Source Type | Source URL |
|:---|:---|:---|:---|:---|
| New York City H3 | NYCH3 | New York City, NY | HTML Scraper | hashnyc.com |
| Brooklyn H3 | BrH3 | New York City, NY | HTML Scraper | hashnyc.com |
| New Amsterdam H3 | NAH3 | New York City, NY | HTML Scraper | hashnyc.com |
| Knickerbocker H3 | Knick | New York City, NY | HTML Scraper | hashnyc.com |
| Long Island Lunatics | LIL | Long Island, NY | HTML Scraper | hashnyc.com |
| Queens Black Knights | QBK | New York City, NY | HTML Scraper | hashnyc.com |
| Staten Island H3 | SI | New York City, NY | HTML Scraper | hashnyc.com |
| Columbia H3 | Columbia | New York City, NY | HTML Scraper | hashnyc.com |
| Harriettes H3 | Harriettes | New York City, NY | HTML Scraper | hashnyc.com |
| GGFM H3 | GGFM | New York City, NY | HTML Scraper | hashnyc.com |
| NAWW H3 | NAWWH3 | New York City, NY | HTML Scraper | hashnyc.com |
| Boston H3 | BoH3 | Boston, MA | Google Calendar | bostonhash@gmail.com |
| Boston Ballbuster | BoBBH3 | Boston, MA | Google Calendar | TBD |
| Beantown H3 | Beantown | Boston, MA | Google Calendar | TBD |
| Boston Moon | Bos Moon | Boston, MA | Google Calendar | TBD |
| Summit H3 | Summit | New Jersey | Sheets + HTML | spreadsheet + hashnj.com |
| Rumson H3 | Rumson | New Jersey | Manual (Facebook) | facebook.com/... |
| Ben Franklin Mob | BFM | Philadelphia, PA | TBD | TBD |
| Chicago H3 | CH3 | Chicago, IL | TBD | TBD |

**Note:** hashnyc.com is a single source feeding ~11 kennels (the "aggregator" pattern). The HTML scraper must extract a kennel tag from each event row and resolve it to the correct Kennel record.

---

## 9. Implementation Roadmap

*Phases represent rough sequencing, not fixed-duration sprints.*

### Phase 1: Foundation
- [ ] Initialize Next.js project (`hashtracks-web`)
- [ ] Setup Clerk authentication (hash name as primary identity, nerd name private)
- [ ] Design & apply Prisma schema (all tables from Section 4)
- [ ] Setup PostgreSQL database
- [ ] Build admin dashboard (kennel CRUD, source CRUD, kennel request queue)
- [ ] Seed launch kennels from Section 8 table
- [ ] Seed kennel aliases from current GAS system's Kennels tab

### Phase 2: The Source Engine
- [ ] Build adapter framework (pluggable adapter per SourceType)
- [ ] Implement HTML scraper adapter (port hashnyc.com parser from GAS `scrapeNYCHistorical()`)
- [ ] Implement Google Calendar adapter (port Boston parser from GAS `getBostonCalendarEvents()`)
- [ ] Implement Google Sheets adapter (Summit H3 spreadsheet)
- [ ] Build Raw → Canonical merge pipeline (date + kennel de-dup, fingerprint change detection)
- [ ] Implement kennel tag resolution (short name match → alias match → flag for review)
- [ ] Source health monitoring (dashboard + status tracking)
- [ ] Manual event submission form
- [ ] Scheduled scraping via Vercel Cron

### Phase 3: The Hareline
- [ ] Build public calendar UI (list view + calendar month view)
- [ ] Implement filtering (region, kennel, day of week)
- [ ] Build "My Kennels" subscription system and personalized default view
- [ ] Build event detail page (hares, location, run number, source link)
- [ ] Build kennel directory page (browse by region, see stats)
- [ ] Build kennel detail page (upcoming events, past events, subscriber count)

### Phase 4: The Logbook
- [ ] Build "I was there" check-in on event detail page
- [ ] Participation level selector (R/H/BH/DC/BM/W/C)
- [ ] Beez checkbox
- [ ] Strava URL field (manual paste — no OAuth yet)
- [ ] Notes field
- [ ] Build "My Runs" view (attendance list, filterable)
- [ ] Build stats dashboard (total runs, per-kennel, milestones)
- [ ] Build "Log a run" for unlisted events + kennel request workflow
- [ ] Build CSV/spreadsheet import for history backfill

### Phase 5: Strava Integration
- [ ] Strava OAuth flow (real redirect — not manual code copy like current GAS system)
- [ ] Activity history fetch + server-side cache
- [ ] Auto-suggest matches (Strava activity overlapping canonical event by date + region)
- [ ] One-click attach Strava link to attendance record
- [ ] Out-of-town run discovery (Strava activities in regions with no logged attendance)
- [ ] Batch processing with rate limit awareness (100 req/15min, 1000 req/day)

### v2: Social & Kennel Admin (Deferred)
- [ ] Activity feed (friends' check-ins)
- [ ] "On-On!" kudos reactions
- [ ] Comments on events
- [ ] Kennel Admin role (edit kennel details, manage sources)
- [ ] Scribe role (verify attendance, digital check-in)
- [ ] RSVP ("Going", "Maybe") — only if differentiated from Facebook Events
- [ ] Friend connections with privacy controls

---

## 10. Known Integration Gotchas

### Strava API

| Gotcha | Detail |
|:---|:---|
| **Timezone bug** | `start_date_local` contains local time despite the `Z` (UTC) suffix. Never parse through `new Date()`. Extract hours/minutes directly from the string. |
| **Deprecated location fields** | `location_city` and `location_state` always return `null` (deprecated Dec 2016). Use `start_latlng` + reverse geocoding instead. |
| **Rate limits** | 100 requests per 15 minutes, 1,000 per day. Always batch-fetch and cache server-side. Never call per-event. |
| **Privacy zones** | `start_latlng` returns null/[0,0] if activity starts in a privacy zone. Fallback: timezone-based region inference. |

### HTML Scraping

| Gotcha | Detail |
|:---|:---|
| **Three types of HTML entities** | Named (`&amp;`), numeric decimal (`&#8217;`), numeric hex (`&#x2019;`). All three need separate decoding passes. A single regex misses edge cases. |
| **Regex alternation ordering** | Longer strings must appear before shorter substrings: "Knickerbocker" before "Knick", "Long Island" before "LIL". The first match wins. |
| **Immutable raw data** | Scraper output should be stored as `RawEvent` with immutable `rawData`. Never modify scraped data — it's your debugging audit trail. |
| **Multi-kennel sources** | hashnyc.com contains events for ~11 different kennels in one HTML table. The scraper must extract a kennel tag per row and resolve it via alias matching. |

### Google Calendar

| Gotcha | Detail |
|:---|:---|
| **Empty descriptions** | Event descriptions are often empty or HTML-heavy. Titles are more reliable for extracting hare names (look for parenthesized names). |
| **Calendar ID changes** | Calendar IDs may change if the calendar owner migrates. Source health monitoring should detect unexpected empty scrape results. |

### Timezone Handling

| Gotcha | Detail |
|:---|:---|
| **Store both formats** | Store UTC timestamp AND original IANA timezone on Event. Display in event's local timezone by default. |
| **`startTime` as string** | Many sources provide only "6:30 PM" without a full ISO timestamp. Storing as a string avoids forced timezone conversion that may introduce errors. |
| **Cross-timezone queries** | Use `dateUtc` for "show me all events next week" queries where the viewer is in a different timezone than the event. |

---

## 11. v2 Roadmap Preview

Features explicitly deferred from v1 to maintain focus:

| Feature | Why Deferred | Dependency |
|:---|:---|:---|
| Social feed | Engagement feature — needs active users first | v1 Logbook |
| Kudos / Comments | Same as feed | v1 Logbook |
| RSVP | Competes with Facebook Events — needs differentiation strategy | v1 Hareline |
| Kennel Admin role | Admin-seeded is sufficient for launch | v1 Kennels |
| Scribe / Verified attendance | Requires kennel admin buy-in | v2 Kennel Admin |
| BullMQ + Redis | Cron is sufficient for <50 sources | v1 Source Engine |
| PostGIS / Geo queries | Text-based region filtering is sufficient | v1 Hareline |
| Source governance (crowdsourcing) | Admin-only + user suggestions is sufficient | v1 Source Engine |
| Friend connections | Social feature | v2 Social |
| Mobile app (native) | Responsive web is sufficient for v1 | v1 complete |

---

## 12. Risks & Mitigation

| Risk | Mitigation Strategy |
|:---|:---|
| **Scraper rot** (sites changing HTML) | Source health dashboard with `lastSuccessAt` tracking; stale data alerts; `RawEvent` immutability for debugging; fingerprint-based change detection. |
| **De-dup false merges** (double-headers) | Date + kennel key handles 99%+ of cases. Admin override for the rare double-header. Log all merge decisions for debugging. |
| **Cold start** (empty platform) | Pre-seeded 15-20 kennels at launch; CSV import for power users; target existing hash community channels (Facebook groups, email lists). |
| **Strava rate limits** | Batch fetch + server-side caching. Never call Strava per-event. Cache activities keyed by date. |
| **Strava timezone bug** | Extract time from ISO string directly — never parse through `Date`. Documented in gotchas section. |
| **Facebook-only kennels** | Manual event submission flow. "Request kennel" workflow for admin to investigate. No automated Facebook scraping (ToS issues). |
| **International timezone complexity** | Store UTC + original timezone on every Event. Display in event's local timezone. `startTime` as string avoids conversion errors. |
| **Kennel name chaos** | `KennelAlias` table for fuzzy matching. Admin-seeded canonical names. Normalization pipeline with logging for unmatched tags. |
| **Auth complexity** | Offload completely to Clerk. Don't roll custom auth. |
| **Scope creep into social** | Social features explicitly deferred to v2 with clear boundary in this PRD. |
| **Privacy concerns** | Hash name as primary identity. Nerd name optional and private. Attendance history privacy toggle on profile. |

---

# Implementation Reference Appendices

> These appendices document battle-tested implementation details from the working Google Apps Script prototype. They are intended as a porting guide for whoever builds the HashTracks web app — read these before writing any adapter code.

---

## Appendix A: hashnyc.com HTML Scraper Reference

This is the most complex adapter and the first one to port. hashnyc.com is a single-page site that lists past runs for ~11 NYC-area kennels in one HTML table.

### A.1 URL Construction

| Mode | URL | When to Use |
|:---|:---|:---|
| Catchup (recent) | `https://hashnyc.com/?days={N}&backwards=true` | Fetching last N days of runs. Calculate N as days between start date and today + 2 buffer days. |
| Lookback (full) | `https://hashnyc.com/?days=all&backwards=true` | Fetching deep historical data. Returns all runs back to ~2016. |

**Fetch options:**
```javascript
{
  muteHttpExceptions: true,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HashTracks-Scraper)' },
  validateHttpsCertificates: true
}
```

No authentication required. No JavaScript rendering required — plain HTTP fetch + HTML parsing is sufficient. Use Cheerio (Node.js) or equivalent, not Playwright.

### A.2 HTML Structure

```
<table class="past_hashes">
  <tr><th>Date</th><th>Details</th>...</tr>     ← Header row (skip)
  <tr id="2024oct30">                            ← Data rows, newest first
    <td>October 30, 2024</td>                    ← Cell 0: Date
    <td>NYCH3 Run #2385: Halloween Trail...</td> ← Cell 1: Details (kennel, run#, description)
    <td>Mudflap, Just Simon</td>                 ← Cell 2+: Hares (variable position)
    <td class="onin">...</td>                    ← Cell with class "onin" (on-in info)
  </tr>
  ...more rows in reverse chronological order...
</table>
```

**Key structural facts:**
- Table has CSS class containing `past_hashes`
- Rows are in **reverse chronological order** (newest first) — this enables early termination
- First row is a header row (contains `<th>` tags) — skip it
- Each data row has at least 2 `<td>` cells: date (index 0) and details (index 1)
- Row `id` attribute encodes the date: `id="2024oct30"` (year + abbreviated month + day)
- The cell immediately before a `class="onin"` cell usually contains hare names

### A.3 Field Extraction

#### Year

Extract year using a three-step priority chain (stop at first success):

1. **Row `id` attribute:** Regex `id="(\d{4})[\w]+(\d{1,2})"` — e.g., `id="2024oct30"` → year `2024`
2. **Date cell HTML:** Regex `(\d{4})` — find 4-digit number in raw HTML
3. **Cleaned date text:** Same regex on `cleanCellContent(dateCellHtml)` output

If no year found, skip the row entirely. Stop parsing if year < 2016 (no older data exists).

#### Date (Month + Day)

```
Regex: /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?/i
```

Matches: "October 30", "Jan 5th", "December 1st", etc.

**Month mapping** (case-insensitive, supports both full and abbreviated):
```javascript
{ jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11 }
```

**Date construction — use UTC noon to avoid DST issues:**
```javascript
const utcDate = new Date(Date.UTC(parseInt(year), monthIndex, parseInt(day), 12, 0, 0));
const formattedDate = formatAsISO(utcDate); // "2024-10-30"
```

Using UTC noon (12:00:00) prevents DST boundary shifts from changing the calendar date.

#### Kennel Name

Two-stage regex extraction from the detail cell text:

**Stage 1 — Anchored to start of text:**
```
/^(NYC|NYCH3|Brooklyn|BrH3|NASS|NAH3|New Amsterdam|GGFM|NAWW|LIL|Long Island|
Special|Queens|Staten Island|SI|Knickerbocker|Knick|Harriettes|Columbia|QBK|
Queens Black Knights|Drinking Practice)\s*(?:(?:Run|Trail|#)\s*(\d+))?/i
```

**Stage 2 — Anywhere in text (no `^` anchor):**
Same pattern list but searches anywhere, requires `Run|Trail|#` + digits after the kennel name.

**Stage 3 — Fallback:**
Search for just a run number (`/(?:Run|Trail|#)\s*(\d+)/i`) and default kennel to `NYCH3`.

**Regex ordering is critical.** In alternation patterns, longer strings must come before shorter substrings:
- `Knickerbocker` before `Knick`
- `Queens Black Knights` before `Queens`
- `New Amsterdam` before `NAH3`
- `Staten Island` before `SI`
- `Long Island` before `LIL`

After extraction, pass through `mapKennelTag()` to normalize to canonical short tag.

#### Run Number

```
Pattern: /(?:Run|Trail|#)\s*(\d+)/i
```

Captures from: "Run 2385", "Trail 100", "#2385". Extracted as string, not integer (some events have no run number).

#### Hares

Three-tier extraction (stop at first success):

1. **Exact pattern:** Cell content immediately before a cell with `class="onin"`:
   ```
   /<td>([^<]+)<\/td>\s*<td class="onin">/i
   ```

2. **Broader pattern** with negative lookahead to allow nested HTML:
   ```
   /<td[^>]*>((?:[^<]|<(?!\/td))+)<\/td>\s*<td[^>]*class="onin"/i
   ```
   If result > 100 chars, attempt to extract proper-case names at end of string. If still too long, use "See Description".

3. **Cell iteration:** Check remaining cells (index 2+) for short text containing commas, "and", or "&" — likely hare name patterns.

4. **Default:** `"N/A"`

#### Source URL

Extract `href` from `<a>` tag in the detail cell:
```
/<a\s+[^>]*?href=(["'])(.*?)\1/i
```

Resolve relative URLs against base `https://hashnyc.com/`.

### A.4 HTML Entity Decoding

Three types must all be handled, in this order:

```javascript
// 1. Named entities
text = text.replace(/&nbsp;/gi, ' ')
           .replace(/&amp;/gi, '&')
           .replace(/&lt;/gi, '<')
           .replace(/&gt;/gi, '>')
           .replace(/&quot;/gi, '"')
           .replace(/&#0?39;/gi, "'");

// 2. Hex numeric entities (&#x2019; → ')
text = text.replace(/&#x([0-9a-fA-F]+);/g, (m, hex) =>
  String.fromCharCode(parseInt(hex, 16))
);

// 3. Decimal numeric entities (&#8217; → ')
text = text.replace(/&#(\d+);/g, (m, dec) =>
  String.fromCharCode(parseInt(dec, 10))
);

// 4. Strip remaining HTML tags
text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
           .replace(/<style[\s\S]*?<\/style>/gi, '')
           .replace(/<br\s*\/?>/gi, ' ')
           .replace(/<[^>]+>/g, ' ')
           .replace(/\s+/g, ' ').trim();
```

### A.5 Performance Optimization

Since rows are in reverse chronological order (newest first):

```javascript
// Skip rows NEWER than target range — continue to next row
if (runDate > endDate) continue;

// Stop at rows OLDER than target range — break entire loop
if (runDate < startDate) {
  break; // NOT continue — no more valid rows exist after this point
}
```

This provides 50-75% faster parsing for historical lookback queries by avoiding hundreds of irrelevant old rows.

### A.6 Run ID Format

```
nyc-{kenneltag}-{YYYYMMDD}-{suffix}
```

- `kenneltag`: Lowercased, alphanumeric only (e.g., `nych3`, `brh3`)
- `YYYYMMDD`: Date with dashes removed
- `suffix`: Run number if available, otherwise first 10 alphanumeric chars of description, otherwise `"run"`

Example: `nyc-nych3-20241030-2385`

### A.7 Aggregator Pattern

hashnyc.com is **one source** that feeds **~11 distinct kennels**. The kennel is determined per-row by parsing the detail cell text. In the HashTracks data model, this means:

- One `Source` record for hashnyc.com
- 11 `SourceKennel` join records linking it to each kennel
- Each `RawEvent` gets the kennel extracted during parsing, then linked to the correct `Kennel` during the merge pipeline

This same pattern applies to the Boston calendar (one source, 5 kennels).

---

## Appendix B: Boston Google Calendar Adapter Reference

The Boston hash community uses a shared public Google Calendar instead of a website. One calendar contains events for 5+ kennels.

### B.1 Calendar Access

| Field | Value |
|:---|:---|
| Calendar ID | `bostonhash@gmail.com` |
| Access method (GAS) | `CalendarApp.getCalendarById(id).getEvents(start, end)` |
| Access method (HashTracks) | Google Calendar API v3 REST: `GET /calendars/{calendarId}/events` |
| Authentication | Public calendar — no OAuth needed for read access |

### B.2 Hash Event Filtering

Not all calendar events are hash runs. Filter by checking title and description against these keywords:

```javascript
const hashKeywords = [
  'hash', 'h3', 'run', 'trail', 'kennel', 'circle',
  'on-on', 'hare', 'bh3', 'bobbh3', 'moon', 'beantown', 'taco'
];
const isHashEvent = hashKeywords.some(kw =>
  title.toLowerCase().includes(kw) || description.toLowerCase().includes(kw)
);
```

Skip non-matching events (e.g., social gatherings, non-hash calendar entries).

### B.3 Kennel Extraction from Title

**Primary regex** (anchored to start of title):
```
/^(BH3|Beantown|Boston\s+Ballbuster|BoBBH3|Moon|Moom|Pink\s+Taco)\s*(?:(?:Trail|Run|#)\s*(\d+))?\s*[:\-]?\s*/i
```

**Keyword fallback** (when no prefix match):
```javascript
if (title.includes('bobbh3') || desc.includes('ballbuster')) return 'BoBBH3';
if (title.includes('moon') || title.includes('moom'))        return 'Bos Moon';
if (title.includes('pink taco'))                              return 'Pink Taco';
if (title.includes('beantown'))                               return 'Beantown';
return 'BoH3'; // Default
```

Note: "Moom" is an intentional alternate spelling used by the Boston Moon Hash.

### B.4 Hare Extraction — Three-Function Chain

#### Function 1: `extractHaresFromDescription(description)`

Parses event description HTML. Three patterns in priority order:

1. **"Hare(s):" with colon/dash:**
   ```
   /(?:^|\n|\.\s*|;\s*|--\s*)Hares?\s*[:\-]\s*([^\n.;]+)/i
   ```
   Strip trailing "Bag car:" or "Stash car:" from the match.

2. **"Hare(s)" without colon:**
   ```
   /(?:^|\n|\.\s*|;\s*|--\s*)Hares?\s+([^\n.;]+)/i
   ```
   Must be < 100 characters.

3. **"Who:" or "Who?" (BH3 structured format):**
   ```
   /\bWho\s*[:\?]\s*([^\n]+)/i
   ```
   Strip field labels that follow: Where, When, Bag car, Stash car, Hash cash, Promises, Lies, How much.
   Filter out false positives: skip if starts with "that" or "you".

**Pre-processing:** Convert HTML to plain text: `</p><p>` and `<br>` → newlines, strip other tags, decode `&nbsp;` and `&amp;`.

#### Function 2: `extractHaresFromTitle(title)`

Fallback when description returns "N/A". Two patterns:

1. **Parenthesized names** (most reliable):
   ```
   /\(([^)]+)\)/g
   ```
   Skip known non-hare content: "early start", "cancelled", kennel abbreviations.
   Example: `"BH3: Sleigh Hash! (Muddy and Flapjack) #2781"` → `"Muddy and Flapjack"`

2. **Beantown bare format:**
   ```
   /Beantown\s*#\s*\d+\s+([A-Z][A-Za-z\s&']+)$/
   ```
   Example: `"Beantown #268 Buttler"` → `"Buttler"`

#### Function 3: Mystery Hare Fallback

```javascript
if (hares === 'N/A' && description.toLowerCase().includes('mystery hare')) {
  hares = 'Mystery Hare';
}
```

### B.5 Run Number Extraction

Three-tier pattern matching on combined title + description text:

1. **Kennel-specific:** `/(?:BH3|Boston\s*H3|BoBBH3|Moon|Moom|Beantown)\s*#\s*(\d+)/i`
2. **Generic hash-mark:** `/#\s*(\d{3,4})\b/i` — only accept numbers 100-3000
3. **Keyword-based:** `/(?:Run|Trail)\s+(\d{3,4})\b/i` — same 100-3000 range

### B.6 Description Formatting

Append time and location to the parsed title for display:

```javascript
const timeStr = formatTime(event.startTime); // "6:30pm"
description = `${title} (${timeStr})`;
if (location) description += ` @ ${location}`;
```

### B.7 Run ID Format

```
bost-{kenneltag}-{YYYYMMDD}-{suffix}
```

Suffix fallback: if no run number and no description snippet, hash the calendar event ID to generate a unique hex suffix.

### B.8 Source URL

Construct from calendar event ID:
```javascript
const sourceUrl = `https://www.google.com/calendar/event?eid=${base64Encode(eventId)}`;
```

### B.9 Limitations

- **No deep history:** Google Calendar only reliably stores recent and future events. Historical data is limited.
- **Look Back exclusion:** The GAS prototype intentionally excludes Boston from Look Back mode (historical review) because the calendar doesn't have deep archives like hashnyc.com.
- **HTML in descriptions:** Calendar event descriptions are often HTML-heavy with inline styles. Always strip tags before pattern matching.

---

## Appendix C: Strava API Reference

### C.1 OAuth Token Management

| Field | Value |
|:---|:---|
| Token refresh endpoint | `https://www.strava.com/oauth/token` |
| Grant type | `refresh_token` |
| Token lifetime | 6 hours (Strava-issued) |
| Cache duration | 3 hours (10,800 seconds) — refresh before expiry |
| Required scope | `activity:read_all` |

```javascript
// Token refresh request
const payload = {
  client_id: config.clientId,
  client_secret: config.clientSecret,
  grant_type: 'refresh_token',
  refresh_token: config.refreshToken
};
// POST to https://www.strava.com/oauth/token
// Cache the access_token for 10800 seconds
```

**Required credentials** (stored server-side, never exposed to client):
- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REFRESH_TOKEN`

### C.2 Activity Fetch

```
GET https://www.strava.com/api/v3/athlete/activities
  ?after={unix_seconds}
  &before={unix_seconds}
  &per_page=50
Authorization: Bearer {access_token}
```

- Timestamps are **Unix seconds** (not milliseconds): `Math.floor(date.getTime() / 1000)`
- `per_page=50` is the practical max for this endpoint
- Returns all activity types (Run, Ride, Walk, etc.) — filter client-side if needed

### C.3 The `start_date_local` Bug

**This is the single most important Strava gotcha.**

The `start_date_local` field returns an ISO 8601 string with a `Z` (UTC) suffix, but the value is actually in the athlete's **local timezone**:

```
API returns:  "start_date_local": "2024-10-25T14:30:00Z"
Actual meaning: 2:30 PM in athlete's local timezone (e.g., EDT)
NOT meaning:    2:30 PM UTC
```

**Correct handling — extract as string, never parse through Date:**
```javascript
// CORRECT: String extraction
const activityDate = activity.start_date_local.substring(0, 10); // "2024-10-25"
const activityTime = activity.start_date_local.substring(11, 16); // "14:30"

// WRONG: This shifts the time by timezone offset
const broken = new Date(activity.start_date_local); // DO NOT DO THIS
```

### C.4 Deprecated Location Fields

Since December 2016, these fields always return `null`:
- `location_city`
- `location_state`
- `location_country`

The `timezone` field reflects the athlete's **home timezone setting**, not the activity location.

**Use `start_latlng` instead** — see reverse geocoding below.

### C.5 Reverse Geocoding (GPS → City, State)

```javascript
// Input: start_latlng = [42.3601, -71.0589]
// Use Google Maps Geocoding API (or Maps.newGeocoder() in GAS)

// Parse response for:
// City:  "locality" or "sublocality" component → long_name
// State: "administrative_area_level_1" component → short_name (for abbreviation)
// Result: "Boston, MA"
```

**Edge cases requiring fallback:**

| Scenario | `start_latlng` value | Fallback |
|:---|:---|:---|
| Privacy zone | `null` or `[0, 0]` | Parse timezone: `America/New_York` → `"New York"` |
| Indoor activity | `null` | Same timezone fallback |
| Geocoding API failure | Valid coords | Return empty string; manual URL entry still works |

### C.6 Rate Limits

| Limit | Value |
|:---|:---|
| Short-term | 100 requests per 15 minutes |
| Daily | 1,000 requests per day |

**Mitigation strategies:**
- Batch fetch activities by date range (one API call per day/week, not per event)
- Cache responses server-side keyed by user + date range
- Never call Strava API on every page load — fetch once, cache, serve from cache

### C.7 URL Validation & Normalization

Accept multiple URL formats, normalize to canonical form:

```javascript
// Input patterns:
"https://www.strava.com/activities/12345678"       // Standard
"https://strava.app.link/.../activities/12345678"  // App shortlink
"strava.com/activities/12345678"                    // No protocol

// Output (always):
"https://www.strava.com/activities/12345678"

// Validation regex:
/strava\.com\/activities\/(\d+)/i
```

---

## Appendix D: Kennel Name Normalization Reference

### D.1 Normalization Pipeline

When a kennel name arrives from any source (scraper, calendar, AI import, user input), normalize through this pipeline:

```
Input: "New York City Hash House Harriers"
  ↓
Step 1: Check Kennel + KennelAlias tables (exact match on shortName, fullName, or alias)
  → Found "NYCH3" ✓ DONE
  ↓ (not found)
Step 2: Partial match on fullName (contains / is-contained-by)
  → Found? Return short tag
  ↓ (not found)
Step 3: Pattern matching via mapKennelTag() fallback (see D.2)
  → Found? Return short tag
  ↓ (not found)
Step 4: Return input as-is + log as unmapped kennel
```

### D.2 Pattern Matching Rules (`mapKennelTag`)

22 kennel patterns checked in this order (order matters for substring conflicts):

```javascript
// 1. Check multi-word / longer patterns FIRST
if (input.includes('ballbuster') || input.includes('bobbh3'))  → 'BoBBH3'
if (input.startsWith('brooklyn') || input.startsWith('brh3'))  → 'BrH3'
if (input.startsWith('naww') || input.includes('naww #'))      → 'NAWWH3'
if (input.startsWith('nass') || input.startsWith('nah3'))      → 'NAH3'

// 2. Then shorter / more generic patterns
if (input.startsWith('nyc') || input.startsWith('nych3'))      → 'NYCH3'
if (input.startsWith('boston') || input.startsWith('bh3'))      → 'BoH3'
if (input.includes('moon') || input.includes('moom'))          → 'Bos Moon'
if (input.includes('pink taco'))                                → 'Pink Taco'
if (input.includes('beantown'))                                 → 'Beantown'
if (input.includes('queens'))                                   → 'QBK'
if (input.includes('drinking practice'))                        → 'Drinking Practice (NYC)'
if (input.includes('knick'))                                    → 'Knick'   // After Knickerbocker
if (input.includes('long island') || input.includes('lil'))    → 'LIL'
if (input.includes('columbia'))                                 → 'Columbia'
if (input.includes('ggfm'))                                     → 'GGFM'
if (input.includes('harriettes'))                               → 'Harriettes'
if (input.includes('staten island') || input.includes('si'))   → 'SI'
if (input.includes('special'))                                  → 'Special (NYC)'

// 3. Generic cleanup fallback
strip trailing #NNN, trailing :-, trailing "Hash"/"H3"
```

**Regex ordering rules:**
- `Knickerbocker` must match before `Knick` (substring)
- `Queens Black Knights` must match before `Queens` (substring)
- `Brooklyn` uses `startsWith` to avoid matching "East Brooklyn" etc.
- `Boston` uses `startsWith` to avoid false matches in descriptions

### D.3 Complete Kennel Mapping Table

| Short | Full Name | Aliases |
|:---|:---|:---|
| NYCH3 | New York City Hash House Harriers | NYC, HashNYC, NYC Hash, NYCH3, New York Hash |
| BoH3 | Boston Hash House Harriers | Boston, BH3, BoH3, Boston Hash |
| BrH3 | Brooklyn Hash House Harriers | Brooklyn, BrH3, Brooklyn Hash |
| BoBBH3 | Boston Ballbuster Hash House Harriers | Ballbuster, BoBBH3, Boston Ballbuster, Ballbuster Hash |
| NAWWH3 | North American Woman Woman Hash | NAWW, NAWWH3, NAWW Hash |
| NAH3 | New Amsterdam Hash House Harriers | New Amsterdam, NAH3, NASS, New Amsterdam Hash |
| QBK | Queens Black Knights Hash House Harriers | Queens Black Knights, QBK, QBK Hash, Queens, Queens Hash |
| LIL | Long Island Lunatics Hash House Harriers | Long Island Lunatics, LIL, Long Island, LI Hash, Lunatics |
| BFM | Ben Franklin Mob H3 | Ben Franklin Mob, BFM, BFM H3, Philadelphia Hash |
| Bos Moon | Boston Moon Hash | Moon, Moom, Boston Moon, Bos Moon, Bos Moom |
| Pink Taco | Pink Taco Hash House Harriers | Pink Taco, Pink Taco Hash |
| Beantown | Beantown Hash House Harriers | Beantown, Beantown Hash |
| Knick | Knickerbocker Hash House Harriers | Knick, Knickerbocker, Knickerbocker Hash |
| Columbia | Columbia Hash House Harriers | Columbia, Columbia Hash |
| GGFM | GGFM Hash House Harriers | GGFM, GGFM Hash |
| Harriettes | Harriettes Hash House Harriers | Harriettes, Harriettes Hash |
| SI | Staten Island Hash House Harriers | Staten Island, SI, SI Hash, Staten Island Hash |
| Drinking Practice (NYC) | NYC Drinking Practice | Drinking Practice, NYC Drinking Practice, NYC DP, DP |

### D.4 New Kennel Auto-Detection

When an unmapped kennel name is encountered:

1. **Generate short name:** Strip "Hash", "House", "Harriers", "H3" → extract initials → add "H3" suffix if original had it
   - `"Ben Franklin Mob H3"` → strip → `"Ben Franklin Mob"` → initials `"BFM"` → `"BFMH3"`

2. **Generate aliases:** `[fullName, initials, initialsH3]` with dedup

3. **Log for permanent mapping:** Write a copy-paste-ready code snippet to the debug log, including the suggested mapping object and instructions for making it permanent

### D.5 Region Fallback Map

When a kennel has no events with region data yet:

```javascript
{
  'NYCH3':   'New York City, NY',    'BoH3':    'Boston, MA',
  'BrH3':    'Brooklyn, NY',         'BoBBH3':  'Boston, MA',
  'NAWWH3':  'New York City, NY',    'NAH3':    'New York City, NY',
  'QBK':     'New York City, NY',    'LIL':     'Long Island, NY',
  'BFM':     'Philadelphia, PA',     'Bos Moon': 'Boston, MA',
  'Pink Taco': 'Boston, MA',         'Beantown': 'Boston, MA',
  'Knick':   'New York City, NY',    'Columbia': 'New York City, NY',
  'GGFM':    'New York City, NY',    'Harriettes': 'New York City, NY',
  'SI':      'New York City, NY'
}
```

---

## Appendix E: AI/LLM Integration Reference (Gemini)

### E.1 Model Configuration

| Field | Value |
|:---|:---|
| Model | `gemini-2.5-flash` (configurable) |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` |
| Temperature | `0.1` (deterministic output for structured extraction) |
| Max output tokens | `4096` (Gemini 2.5 has extensive thinking tokens that count against this) |
| Auth | API key as query parameter: `?key={API_KEY}` |

### E.2 Intent Parsing Prompt

Used to classify user input and extract structured data:

```
Parse user input for hash run tracking system.

User may provide:
1. Event page URLs (hashnyc.com, etc.)
2. Strava activity URLs
3. Plain text notes about runs

Extract:
- eventUrls: Array of event/hash webpage URLs
- stravaUrls: Array of Strava activity URLs
- textNotes: Plain text descriptions
- intent: Brief summary
- confidence: high|medium|low

User input:
"""
{userInput}
"""

Respond in JSON format only.
```

### E.3 Run Matching Prompt

Used to match Strava activities to scraped event data:

```
Match Strava activities to event runs based on date and location.
- If dates match exactly, high confidence
- If dates within 1 day and locations match, medium confidence
- If user mentions run without Strava, note that

Output JSON:
{
  "mergedRuns": [{
    "date", "trailName", "region", "country", "kennelName",
    "stravaLink", "matchConfidence": "high|medium|low",
    "source": "event+strava|event-only|strava-only|text-note",
    "conflicts": ["..."]
  }],
  "summary": "...",
  "needsReview": true/false
}
```

**Post-processing:** Always normalize `kennelName` through the kennel normalization pipeline (Appendix D) after LLM output.

### E.4 Model Deprecation Handling

Gemini models get deprecated. The GAS prototype handles this by:

1. Detecting deprecation errors in API response
2. Calling the ListModels API to discover available Flash models
3. Suggesting the newest available model to the user
4. Falling back gracefully with user guidance

For HashTracks, pin to a specific model version and monitor Gemini API changelogs.

---

## Appendix F: Data Merging & Deduplication Patterns

### F.1 Standard Run Object Schema

All source adapters must produce objects matching this shape:

```typescript
interface ScrapedRun {
  id: string;          // Unique ID: "{source}-{kennel}-{YYYYMMDD}-{suffix}"
  date: string;        // ISO format: "2024-10-30"
  kennel: string;      // Normalized short tag: "NYCH3"
  runNumber: string;   // Sequential number or empty string
  hares: string;       // Comma-separated names, "N/A", or "See Description"
  description: string; // Trail name, time, location details
  region: string;      // "New York City, NY"
  country: string;     // "USA"
  sourceUrl: string;   // Link to original event page
}
```

### F.2 ID Prefix Convention

Each source adapter uses a distinct prefix to prevent cross-source ID collisions:

| Source | Prefix | Example |
|:---|:---|:---|
| hashnyc.com | `nyc-` | `nyc-nych3-20241030-2385` |
| Boston Calendar | `bost-` | `bost-boh3-20241030-2781` |
| Manual entry | `manual-` | `manual-bfm-20241030-run` |
| AI import | `ai-` | `ai-nych3-20241030-halloween` |

### F.3 Multi-Source Merge Pattern

```javascript
let allRuns = [];

// Fetch each source independently with try/catch
// One failing source must NOT block others
try {
  allRuns = allRuns.concat(scrapeNYC(startDate, endDate));
} catch (e) { errors.push(`NYC: ${e.message}`); }

try {
  allRuns = allRuns.concat(fetchBoston(startDate, endDate));
} catch (e) { errors.push(`Boston: ${e.message}`); }

// Dedup using Set for O(1) lookup
const uniqueRuns = [];
const seenIds = new Set();
for (const run of allRuns) {
  if (run?.id && run?.date && run?.kennel && !seenIds.has(run.id)) {
    uniqueRuns.push(run);
    seenIds.add(run.id);
  }
}

// Sort chronologically
uniqueRuns.sort((a, b) => a.date.localeCompare(b.date));
```

**Key principles:**
- Each source fetched in its own try/catch — one failure doesn't block others
- Dedup on `run.id` using `Set` for O(1) lookup
- Keep first occurrence of duplicate IDs
- Filter out malformed runs (missing id, date, or kennel)
- Sort by date string (ISO format sorts lexicographically)

### F.4 Date Comparison Safety

When comparing dates for filtering or range checks, **always normalize to UTC noon**:

```javascript
const dateA = new Date(dateStringA);
dateA.setUTCHours(12, 0, 0, 0); // Normalize to UTC noon

const dateB = new Date(dateStringB);
dateB.setUTCHours(12, 0, 0, 0);

const isSameDay = dateA.getTime() === dateB.getTime();
```

This prevents DST boundary shifts from causing off-by-one-day errors. A date at midnight EST could shift to the previous day when converted to UTC; noon is always safe.

### F.5 Progressive Chunking for Storage Limits

The GAS prototype stores run batches in UserProperties (9KB limit). The chunking strategy applies to any system with payload size constraints:

```
Try full dataset → if too large:
  Try 90-day chunk → if too large:
    Try 60-day chunk → if too large:
      Try 30-day chunk → if too large:
        Try 15-day chunk → error
```

**Bidirectional chunking:**
- **Forward (catchup):** Start from oldest date, chunk forward. User reviews oldest runs first.
- **Backward (lookback):** Start from newest date, chunk backward. User reviews most recent historical runs first.

For HashTracks with PostgreSQL, this limitation goes away — but the pattern is useful for API response pagination or batch processing.
