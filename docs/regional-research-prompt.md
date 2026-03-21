# Regional Kennel Research Prompt (Chrome-Assisted)

Use this prompt in a Claude Code session with Chrome access. Replace `[REGION]` with the target region (e.g., "Portland, Oregon", "Denver, Colorado", "Minneapolis, MN").

---

## The Prompt

You are researching Hash House Harriers kennels in the **[REGION]** area to help me onboard them as data sources for HashTracks. You have access to Chrome browser automation tools — use them to visit websites, extract data, and verify information directly.

**Required reading before starting:**
1. Read `prisma/seed.ts` — identify kennels already in the database for this region (skip these)
2. Read `docs/source-onboarding-playbook.md` — understand adapter types, config shapes, and onboarding patterns

This is a **3-stage workflow**. Complete each stage fully and present results before moving to the next.

---

### Stage 1: Discovery & Triage

**Goal**: Find all kennels in the region, verify they're active, identify the best source type for each.

#### Step 1.1: Check Existing Coverage
Read `prisma/seed.ts` and the production database and list any kennels already in the database for [REGION]. These will be skipped.

#### Step 1.2: Aggregator-First Discovery
Check these aggregator sources FIRST — they often cover multiple kennels at once:

1. **HashRego**: Open `https://hashrego.com/events` in Chrome. Scan the index table for any kennels in or near [REGION]. Note their kennel slugs (e.g., "BFMH3", "EWH3") — these can be scraped with zero new code using the HASHREGO adapter.
   
2. **Half-Mind.com**: Open `https://half-mind.com/regionalwebsite/index.php` in Chrome. Scan the index table for any kennels in or near [REGION]. Look for kennels and links to their data sources.

3. **Meetup**: Search `https://www.meetup.com/find/?keywords=hash+house+harriers&location=[REGION]` in Chrome. Note any active groups with upcoming events. Extract the `groupUrlname` from each group's URL.

4. **Regional Google Calendar**: Search the web for "[REGION] hash house harriers calendar" or "[REGION] hash calendar". If a regional aggregator calendar exists, visit the page in Chrome and extract the Google Calendar ID:
   - Use `javascript_tool` to run: `Array.from(document.querySelectorAll('iframe[src*="calendar.google.com"]')).map(f => f.src)`
   - Extract all `src=` parameters from the iframe URL — shared calendars often embed multiple calendar IDs in one iframe. Use `new URL(f.src).searchParams.getAll('src')` to get all of them.
   - Note which kennels share this calendar

5. **JS-Rendered Calendar Aggregators**: The iframe check in #4 only finds embedded Google Calendar iframes. Some sites use custom JavaScript frontends that call the Google Calendar API directly (no iframes). For any regional kennel website, also check subpages like `/calendar/`, `/socal/`, `/events/`, `/schedule/`:
   - Run via `javascript_tool`:
     ```javascript
     // Check for external JS files that might contain calendar config
     const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
     const pageText = document.documentElement.outerHTML;
     const calIds = pageText.match(/[a-zA-Z0-9._%-]+@group\.calendar\.google\.com/g);
     JSON.stringify({ externalScripts: scripts.filter(s => /index|calendar|events/i.test(s)), googleCalendarIds: calIds });
     ```
   - If calendar IDs are found, fetch the external JS file and look for a `calendars` array with `id` and `summary` fields — each entry is a per-kennel Google Calendar
   - Example: lbh3.org/socal uses a custom JS frontend (`index.js`) aggregating 31 per-kennel Google Calendars with zero iframes

#### Step 1.3: Web Search for Remaining Kennels
Search the web for additional kennels in [REGION] not found via aggregators. Try searches like:
- "[REGION] hash house harriers"
- "[REGION] HHH"
- "[REGION] drinking club with a running problem"
- "hash [city name]"

#### Step 1.4: Quick Chrome Verification (per kennel)
For each discovered kennel, visit their website (if found) in Chrome and check:

1. **Activity status**: Are there dated events within the last 6 months?
   - ACTIVE: Events in last 6 months
   - DORMANT: 6-12 month gap
   - INACTIVE: >12 months or no dated content

2. **Source type discovery** — run this **mandatory escalation check** on every kennel website:
   ```javascript
   // Run via javascript_tool on the kennel's website
   const results = {
     googleCalendar: Array.from(document.querySelectorAll('iframe[src*="calendar.google.com"]')).map(f => f.src),
     googleCalendarApi: document.documentElement.outerHTML.match(/[a-zA-Z0-9._%-]+@group\.calendar\.google\.com/g) || [],
     googleSheets: Array.from(document.querySelectorAll('iframe[src*="docs.google.com/spreadsheets"]')).map(f => f.src),
     googleSheetsInPage: document.documentElement.outerHTML.match(/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/g) || [],
     icalLinks: Array.from(document.querySelectorAll('a[href*=".ics"], a[href^="webcal:"]')).map(a => a.href),
     meetupLinks: Array.from(document.querySelectorAll('a[href*="meetup.com"]')).map(a => a.href),
     sheetsLinks: Array.from(document.querySelectorAll('a[href*="docs.google.com/spreadsheets"]')).map(a => a.href),
     hashRegoLinks: Array.from(document.querySelectorAll('a[href*="hashrego.com"]')).map(a => a.href),
   };
   JSON.stringify(results, null, 2);
   ```
   **CRITICAL**: Do NOT recommend HTML_SCRAPER if any of the above returns results. Always prefer structured sources. The `googleCalendarApi` check catches JS-rendered calendar pages that don't use iframes (e.g., lbh3.org/socal). The `googleSheets`/`googleSheetsInPage` checks catch embedded Google Sheets harelines — some sites use double-iframe chains (page → iframe → Google Sheet) where only the intermediate iframe reveals the Sheet ID (e.g., wh3.org/harelines/).

3. **Tier classification**:
   - **Tier 1**: Structured source found (Calendar, Meetup, iCal, Sheets, HashRego) — config-only onboarding
   - **Tier 2**: HTML event table/list found, no structured source — needs adapter config or code
   - **Tier 3**: Facebook-only with known schedule pattern — STATIC_SCHEDULE
   - **Skip**: Inactive, dormant, or no verifiable web presence

#### Stage 1 Output

Present results in this exact format:

```text
## Existing Coverage
- [List kennels already in seed.ts for this region]

## Aggregator Sources Found
- [Any regional Calendar, HashRego kennels, shared Meetup groups found in Step 1.2]

## New Kennels Discovered

| # | Kennel | Status | Tier | Best Source | Source URL/ID | Confidence | Notes |
|---|--------|--------|------|-------------|---------------|------------|-------|
| 1 | FOO H3 | ACTIVE | 1    | GOOGLE_CAL  | abc@group...  | HIGH       | Calendar embed on /hareline |
| 2 | BAR H3 | ACTIVE | 2    | HTML_SCRAPER| barh3.com/runs| MED        | Event table, no Calendar found |
| 3 | BAZ H3 | DORMANT | Skip | —           | —             | —          | Last event Aug 2025 |

Tier legend:
- Tier 1: Structured source (Calendar, Meetup, iCal, Sheets) — config-only onboarding
- Tier 2: HTML scraper needed — requires adapter config or new code
- Tier 3: Static schedule — Facebook-only, known recurrence pattern
- Skip: Inactive/dormant
```

**STOP HERE. Present this table and wait for the user to tell you which kennels to proceed with.**

---

### Stage 2: Deep Extraction

For each kennel the user approved, perform thorough Chrome-based extraction.

#### Calendar ID Extraction Protocol
1. Navigate to the kennel website's calendar/hareline/schedule page
2. Run via `javascript_tool`:
   ```javascript
   Array.from(document.querySelectorAll('iframe[src*="calendar.google.com"]'))
     .flatMap(f => {
       const url = new URL(f.src);
       return url.searchParams.getAll('src');
     });
   ```
3. Each value is a `calendarId` — these go in the source config. If base64-encoded, decode with `atob()`.
4. Also check for linked feeds:
   ```javascript
   ({
     ical: Array.from(document.querySelectorAll('a[href*=".ics"], a[href^="webcal:"]')).map(a => a.href),
     meetup: Array.from(document.querySelectorAll('a[href*="meetup.com"]')).map(a => a.href),
     sheets: Array.from(document.querySelectorAll('a[href*="docs.google.com/spreadsheets"]')).map(a => a.href),
   });
   ```
5. If a multi-kennel calendar, note which kennels share it (check event titles for kennel name patterns)

#### Meetup Verification Protocol
1. Navigate to the Meetup group page in Chrome
2. Check "Upcoming events" — count and note dates
3. Extract `groupUrlname` from the URL path
4. Read a few event titles to determine the kennel tag

#### Activity Verification Protocol
1. For Calendar embeds: navigate forward in the calendar widget — are there upcoming events?
2. For websites: look for dated events in the last 90 days
3. For Meetup: check "Upcoming events" count
4. For Facebook pages: check most recent post date
5. Classification: ACTIVE (90 days), DORMANT (6-12 months), INACTIVE (>12 months)

#### Metadata Extraction Protocol
For each kennel, gather from their website, Facebook, and any other pages:
1. **Founded year** — check About/Info/FAQ pages
2. **Hash cash** — entry fee amount (e.g., "$8", "$5")
3. **Schedule** — day of week, frequency (weekly/biweekly/monthly), typical start time
4. **Social links** — Facebook, Instagram, X/Twitter, Discord URLs
5. **Dog/walker friendly** — if mentioned on the site
6. **Aliases** — abbreviations, nicknames, social media handles used for the kennel
7. **Description** — Write a 1-2 sentence description for every kennel. Use info from the website About page if available. If not, write a factual description from schedule + location info (e.g., "Weekly Saturday afternoon trail running and drinking club in the Portland metro area. Dog-friendly."). Keep tone consistent across the region.

#### Stage 2 Output

Present per-kennel detail cards:

```text
---
**[shortName]** — [Full Name]
- **kennelCode**: [lowercase, URL-safe permanent ID, e.g., "fooh3"]
- **Region**: [city, state]
- **Schedule**: [day(s), frequency, time]
- **Details**: Founded [year], Hash cash [$X], [Dog/Walker friendly if known]
- **Description**: "[1-2 sentence description]"
- **Links**: Web: [url], FB: [url], IG: [handle], X: [handle]
- **Aliases**: [list]
- **Best Source**: [Type] — [URL/ID] — [technical notes]
- **Secondary Source**: [if applicable]
- **Chrome Evidence**: [What was verified — e.g., "Calendar embed found on /events, calendarId=abc@group.calendar.google.com, 3 upcoming events visible"]
---
```

**Present all detail cards and wait for user confirmation before generating seed data.**

---

### Stage 3: Seed Data Generation

Produce copy-paste-ready blocks for both `src/lib/region.ts` (regions) and `prisma/seed.ts` (kennels, aliases, sources). Follow the exact patterns used in those files.

#### Regions (`src/lib/region.ts` `REGION_SEED_DATA`, if new regions needed)
```typescript
// New regions for [REGION] — add to REGION_SEED_DATA in src/lib/region.ts
{
  name: "Oregon",
  country: "USA",
  level: "STATE_PROVINCE",
  timezone: "America/Los_Angeles",
  abbrev: "OR",
  colorClasses: "bg-indigo-100 text-indigo-700",
  pinColor: "#6366f1",
  centroidLat: 44.0,
  centroidLng: -120.5,
},
{
  name: "Portland, OR",
  country: "USA",
  timezone: "America/Los_Angeles",
  abbrev: "PDX",
  colorClasses: "bg-indigo-100 text-indigo-700",
  pinColor: "#6366f1",
  centroidLat: 45.52,
  centroidLng: -122.68,
  aliases: ["Portland, Oregon"],
},
// Also add to stateMetroLinks in prisma/seed.ts:
// "Oregon": ["Portland, OR", ...],
// And to regionNameToData in src/lib/region.ts:
// "Portland, OR": "Oregon",
```

#### Kennels
```typescript
// [REGION] Kennels
{
  kennelCode: "fooh3",
  shortName: "FOO H3",
  fullName: "Foo Hash House Harriers",
  region: "Portland, OR",
  country: "USA",
  website: "https://fooh3.com",
  facebookUrl: "https://facebook.com/groups/fooh3",
  instagramHandle: "fooh3",
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "3:00 PM",
  scheduleFrequency: "Weekly",
  foundedYear: 1985,
  hashCash: "$5",
  description: "Weekly Saturday afternoon trail running and drinking club in the Portland metro area. Dog-friendly with A-to-B trails through Forest Park.",
},
```

#### Aliases (keyed by kennelCode)
```typescript
// [REGION] Aliases
"fooh3": ["Foo Hash", "FOO H3", "Portland Hash", "FooHHH"],
```

#### Sources (uses kennelCodes array)
```typescript
// [REGION] Sources
{
  name: "Foo H3 Google Calendar",
  url: "fooh3calendar@group.calendar.google.com",
  type: "GOOGLE_CALENDAR" as const,
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    calendarId: "fooh3calendar@group.calendar.google.com",
    defaultKennelTag: "FOO H3",
  },
  kennelCodes: ["fooh3"],
},
// For multi-kennel calendars, use kennelPatterns:
{
  name: "[Region] Hash Calendar",
  url: "regioncalendar@group.calendar.google.com",
  type: "GOOGLE_CALENDAR" as const,
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    calendarId: "regioncalendar@group.calendar.google.com",
    kennelPatterns: [
      ["FOO|Foo Hash", "FOO H3"],
      ["BAR|Bar Hash", "BAR H3"],
    ],
    defaultKennelTag: "FOO H3",
  },
  kennelCodes: ["fooh3", "barh3"],
},
// For Meetup:
{
  name: "Foo H3 Meetup",
  url: "https://www.meetup.com/foo-hash-house-harriers/",
  type: "MEETUP" as const,
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    groupUrlname: "foo-hash-house-harriers",
    kennelTag: "FOO H3",
  },
  kennelCodes: ["fooh3"],
},
// For Static Schedule (Facebook-only):
{
  name: "Bar H3 Static Schedule",
  url: "https://www.facebook.com/groups/barh3",
  type: "STATIC_SCHEDULE" as const,
  trustLevel: 3,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    rrule: "FREQ=WEEKLY;BYDAY=SA",
    kennelTag: "BAR H3",
    defaultTitle: "Bar H3 Weekly Hash",
    startTime: "15:00",
    defaultLocation: "TBA — check Facebook group",
  },
  kennelCodes: ["barh3"],
},
```

#### Notes Section
At the end, include:
- Any kennels that need new HTML scraper adapter code (not just config)
- Any kennelCode conflicts with existing kennels (use region suffixes like `-or`, `-co` to resolve)
- Any multi-kennel sources that should be onboarded first (aggregator-first strategy)
- Recommended onboarding order

---

### Stage 4: Gap Validation

After onboarding is complete, cross-reference against Half-Mind.com to verify no major kennels were missed:

1. Open `https://half-mind.com/regionalwebsite/p_list1.php?state=[STATE_ABBREV]` in Chrome
2. Compare active kennels listed against what was just onboarded
3. For any active kennel NOT in the database, note it with status and whether a source exists
4. Present findings to the user — they may choose to add more kennels or defer

This step catches kennels that don't appear on aggregators, Meetup, or web searches but are still active in the hashing community. Example: California gap check revealed Sacramento (2 kennels), Santa Barbara (2 kennels), and Bakersfield as notable omissions from the initial onboarding of 21 kennels.

---

## Adapter Type Quick Reference

| Type | When to Use | Config Shape | Code Needed? |
|------|-------------|-------------|--------------|
| `GOOGLE_CALENDAR` | Embedded Google Calendar iframe | `{ calendarId, defaultKennelTag }` or `{ calendarId, kennelPatterns: [["regex", "TAG"]] }` | No |
| `MEETUP` | Meetup.com group | `{ groupUrlname, kennelTag }` | No |
| `ICAL_FEED` | .ics feed URL | `{ kennelPatterns?, defaultKennelTag?, skipPatterns? }` | No |
| `GOOGLE_SHEETS` | Published Google Sheet | `{ sheetId, columns: {...}, kennelTagRules: {...} }` | No |
| `HASHREGO` | Listed on hashrego.com | `{ kennelSlugs: ["SLUG1", "SLUG2"] }` | No |
| `STATIC_SCHEDULE` | Facebook-only, predictable schedule | `{ rrule, kennelTag, defaultTitle, startTime, defaultLocation }` | No |
| `HTML_SCRAPER` | Website with event table/list | Varies — may use GenericHtmlAdapter config or need custom adapter | Maybe |

**Source priority** (always prefer higher):
1. GOOGLE_CALENDAR — cleanest API, richest data
2. GOOGLE_SHEETS / HASHREGO / MEETUP — native structure
3. ICAL_FEED — standardized format
4. HTML_SCRAPER (GenericHtmlAdapter) — config-driven CSS selectors
5. HTML_SCRAPER (custom adapter) — requires new code
6. STATIC_SCHEDULE — fallback for Facebook-only kennels

**CAUTION on STATIC_SCHEDULE**: Before defaulting to STATIC_SCHEDULE, check whether a regional calendar aggregator covers the kennel. In California, 4 kennels initially planned as STATIC_SCHEDULE turned out to have real Google Calendar data via a regional aggregator (lbh3.org/socal). STATIC_SCHEDULE should be a true last resort — only use it when no calendar, Meetup, iCal, or aggregator source exists.

**CRITICAL RULE**: Before recommending HTML_SCRAPER for ANY kennel, you MUST have already checked for embedded Google Calendar, iCal links, Meetup links, and Google Sheets links using the JavaScript snippet in Stage 1. Only recommend HTML_SCRAPER if none were found.
