---
description: Regional kennel discovery and source research methodology for Hash House Harrier kennels
globs:
  - src/pipeline/kennel-discovery-ai.ts
  - src/pipeline/source-research.ts
  - src/app/admin/research/**
  - docs/kennel-research/**
---

# Kennel Discovery & Source Research

This skill provides the structured methodology for researching Hash House Harrier kennels in a target region. When researching a new region, follow this template — replacing `[REGION]` with the target area.

## Phase 1: Preparation & Deduplication

Before diving into web research, review your provided context:

1. **Existing Database Check:** Review `prisma/seed.ts`. Identify and list any kennels in the [REGION] that are *already* in the database. You will exclude these from your new research to avoid duplicating work.
2. **Review the Playbook:** Read `docs/source-onboarding-playbook.md` to understand the current best practices, known patterns, and adapter capabilities. Keep this in mind as you evaluate new sources.

## Phase 2: What I Need (New Kennels)

For each *new* kennel you find in the [REGION] area, provide:

### 1. Kennel Profile
- **Full name** (e.g., "Washington DC Hash House Harriers")
- **kennelCode** (e.g., "dch3") — a lowercase, URL-safe string that acts as the permanent database ID.
- **shortName** (e.g., "DCH3") — the display abbreviation.
- **Known aliases** — alternate names the community uses (nicknames, social media handles, older abbreviations).
- **Region** (city + state, e.g., "Washington, DC")
- **Country** (default "USA")
- **Links**: Website URL, Facebook URL, Instagram handle, Twitter/X handle, Discord URL.
- **Hashing schedule**: Day(s) of the week, frequency (weekly, biweekly, monthly, full moon), and typical start time.
- **Kennel Details**: Founded year, Hash Cash amount (e.g., "$8"), and whether they are explicitly dog-friendly or walker-friendly (if discoverable).
- **Lat/Long**: Recommended Lat/Long coordinates

### 2. Source Assessment
Evaluate ALL potential data sources for each kennel and classify them into supported HashTracks adapter types:

- **Type A: GOOGLE_CALENDAR:** Calendar ID (check embedded iframe `src` URLs). Note if it is multi-kennel (needs `kennelPatterns`).
- **Type B: GOOGLE_SHEETS:** Public Google Sheet URL and column layout.
- **Type C: MEETUP, HASHREGO, or RSS_FEED:** Group URL, slug, or feed URL.
- **Type D: ICAL_FEED (.ics):** URL of .ics file.
- **Type E: HTML_SCRAPER:** URL of the runs page. Can we extract events using simple CSS selectors?
- **Type F: STATIC_SCHEDULE:** For highly predictable schedules (e.g., Facebook-only kennels). Provide the recurrence rule pattern (e.g., `FREQ=WEEKLY;BYDAY=SA`).

### 3. Source Recommendation
Recommend the **best primary source** and any secondary sources. Prefer in this order:

1. `GOOGLE_CALENDAR` (Cleanest API)
2. `GOOGLE_SHEETS` / `HASHREGO` / `MEETUP` (Native structure)
3. `ICAL_FEED` / `RSS_FEED` (Standardized)
4. `HTML_SCRAPER` (Requires config/code)
5. `STATIC_SCHEDULE` (Fallback for predictable patterns)
6. `MANUAL` (No digital footprint, irregular schedule)

*Crucial:* If multiple kennels share a source (regional aggregator pattern), note this explicitly!

## Phase 3: Output Format

Structure your output exactly as follows:

### 1. Existing Data Check
- List of kennels already found in `prisma/seed.ts` for this region (will be skipped for onboarding).

### 2. Regional Summary
- Total *new* kennels found.
- Recommended onboarding order (Aggregators > High-quality APIs > HTML sites > Static schedules).
- Any regional aggregator sources discovered.

### 3. Per-Kennel Detail

---
**[shortName]** — [Full Name]
- **kennelCode**: [code]
- **Region**: [city, state]
- **Schedule**: [day(s), frequency, time]
- **Details**: [Founded year, Hash cash, Dog/Walker status]
- **Links**: [Web, FB, IG, etc.]
- **Aliases**: [list]

## **Best Source:** [Source Type + URL + brief technical notes]
**Secondary Source:** [if applicable]
**Notes:** [Onboarding gotchas, shared calendar notes, etc.]

### 4. Playbook Updates
Based on this research session, suggest any additions or modifications for `docs/source-onboarding-playbook.md`. Did we discover a new WordPress plugin pattern, a new type of scheduling quirk, or an edge case we should document? If nothing new was learned, simply state "No new playbook updates required."

### 5. Seed Data Block
Provide a consolidated block for `prisma/seed.ts`:

```typescript
// Kennels to add to prisma/seed.ts
const newKennels = [
  {
    kennelCode: "dch3",
    shortName: "DCH3",
    fullName: "Washington DC Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "https://...",
    facebookUrl: "https://...",
    scheduleDayOfWeek: "Saturday",
    scheduleTime: "3:00 PM",
    scheduleFrequency: "Weekly",
    foundedYear: 1972,
    hashCash: "$5",
    description: "Weekly Saturday runs in the DC area.",
  },
  // ... more kennels
];

// Aliases to add (KEYED BY KENNELCODE)
const newAliases: Record<string, string[]> = {
  "dch3": ["DC Hash", "Washington Hash", "DCH3", "DC H3"],
  // ... more aliases
};

// Sources to add (USES kennelCodes ARRAY)
const newSources = [
  {
    name: "DC Hash Calendar",
    url: "calendar-id@group.calendar.google.com", // or website URL
    type: "GOOGLE_CALENDAR", // HTML_SCRAPER, GOOGLE_SHEETS, ICAL_FEED, STATIC_SCHEDULE, etc.
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: {
        // e.g., defaultKennelTag: "DCH3"
        // or for STATIC_SCHEDULE: rrule: "FREQ=WEEKLY;BYDAY=SA", startTime: "15:00", etc.
    },
    kennelCodes: ["dch3"],
  },
  // ... more sources
];
```

## Important Context
- Existing adapters: `HTML_SCRAPER`, `GOOGLE_CALENDAR`, `GOOGLE_SHEETS`, `ICAL_FEED`, `HASHREGO`, `MEETUP`, `RSS_FEED`, and `STATIC_SCHEDULE`.
- `GenericHtmlAdapter` can scrape websites purely using a JSON config of CSS selectors.
- Multi-kennel Google Calendars require `kennelPatterns` mapping in the config.

## Key Files
- `src/pipeline/kennel-discovery-ai.ts` — AI discovery prompts and parsing
- `src/pipeline/source-research.ts` — URL discovery and classification
- `src/app/admin/research/actions.ts` — Server actions (approve/reject proposals)
- `src/lib/fuzzy.ts` — Fuzzy matching for dedup
- `docs/kennel-research/` — Completed regional research reports (Chicago, DC, SF Bay, London)
- `docs/source-onboarding-playbook.md` — Source onboarding best practices and patterns
