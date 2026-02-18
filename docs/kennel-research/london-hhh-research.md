# London (UK) Hash House Harriers — Kennel Research for HashTracks

**Researched:** 2026-02-17
**Region:** London, United Kingdom

---

## Regional Summary

- **Total kennels found:** 10 (7 weekly, 3 monthly/irregular)
- **Regional aggregator sites discovered:**
  - **LaSH (London Hashing Site)** — Google Sites page at `sites.google.com/site/londonhashingsite/` — appears to have a shared Google Calendar embedded, but the calendar content is user-edited and may not be reliably structured. More of a community noticeboard than a scraping-friendly aggregator.
  - **londonhash.org/theothers.php** — London Hash's "London Clubs" page lists all London-area kennels with schedules and links, but is a directory page, not an event feed.
  - **hhh.org.uk** — UK-wide directory (Google Sites based, map-based). No calendar feed.
  - **Makesweat.com** / **Hashtrash.org** — Platform used by City Hash (and potentially others) for event management and attendance tracking. Created by a City Hash member. Has structured event data but may require API investigation.
  - **Harrier Central** — Global hashing app with kennel/event data. Has an API but requires investigation.
- **No gotothehash.net coverage** for London found (US-focused).
- **half-mind.com** has contact listings for UK hashes but no calendar data.

### Recommended Onboarding Order

1. **City Hash (CH3)** — Best structured source via cityhash.org.uk (WordPress site with Makesweat-powered run list showing multiple upcoming runs with rich data)
2. **London Hash (LH3)** — londonhash.org/runlist.php has excellent structured run list with run numbers, dates, locations, hares, pub info
3. **West London Hash (WLH3)** — westlondonhash.com has WordPress-based run list with multiple upcoming runs
4. **Old Coulsdon Hash (OCH3)** — och3.org.uk has upcoming run list page
5. **Barnes Hash (BH3)** — barnesh3.com/HareLine.htm has a simple HTML table of upcoming runs
6. **SLASH (SLH3)** — hosted on londonhash.org subdomain, simple HTML table
7. **Enfield Hash (EH3)** — Blogspot blog with next-run posts (monthly)
8. **Catch the Hare (CH4)** — Minimal website, rarely updated, uses mailing list (monthly)
9. **FUKFM** — fukfmh3.co.uk (monthly full moon, low priority)
10. **CUNT H3** — Facebook-only (last resort)

---

## Per-Kennel Detail

---

### **LH3** — London Hash House Harriers

- Region: London, UK
- Schedule: Saturday (sometimes Sunday), 12:00 noon, weekly
- Website: https://www.londonhash.org/
- Facebook: https://www.facebook.com/groups/309871752440044/
- Instagram: @london_hash_house_harriers
- Aliases: LH3, London Hash, "London's first hash"
- Community size: ~33 average pack size (stated on website)
- Run count: Currently at run #2820+
- Notes: Founded 1975, celebrating 50th anniversary in 2025-2026. In summer they sometimes run Monday evenings at 7pm instead.

**Best Source:** HTML_SCRAPER — `https://www.londonhash.org/runlist.php`
- Static HTML (PHP-rendered server-side, no JS rendering needed)
- Shows ~50 upcoming runs with: run number, date, time, location (station + pub), hare name(s), travel info, theme/notes
- Structure: Series of `<div>` blocks with run data. Each run has a link to `nextrun.php?run=XXXX` for detail view.
- Fields: run number, day of week, date, time ("12 Noon for 12:30"), station, pub name + CAMRA link, hare(s), travel info, other info/theme

**Secondary Source:** Facebook group for event announcements

**Notes:**
- Very well-structured site with excellent historical data at `/hashtory.php`
- Run list is extensive (full year ahead), though most future runs have TBA details
- The site also hosts SLASH (South London) run lists at a subdomain

---

### **CH3** — City Hash House Harriers

- Region: London, UK (Zones 1-2)
- Schedule: Tuesday, 7:00 PM, weekly
- Website: https://cityhash.org.uk/
- Facebook: City Hash House Harriers (London) group
- Instagram: @cityhashhouseharriers
- Aliases: CH3, City Hash, City H3
- Community size: 30-40 runners per week (stated on FAQ)
- Run count: Currently at run #1909+

**Best Source:** HTML_SCRAPER — `https://cityhash.org.uk/`
- WordPress site with data powered by **Makesweat.com** (shown at bottom: "Proudly powered by Makesweat")
- The homepage shows the next run + 7-8 upcoming runs with: run number, title/theme, date, pub name + postcode, Google Maps link (lat/lng), nearest tube station, hare name, description
- Static HTML rendered server-side (data visible in view-source)
- Each run card has structured data including coordinates embedded in Google Maps links
- Fields: run number, date, pub name, postcode, station, hare, theme/description

**Secondary Source:** Makesweat.com (`makesweat.com/cityhash`) — Structured event/attendance platform, but returned 403 on fetch; may require investigation of their public API.

**Notes:**
- The Makesweat platform was created by a City Hash member ("Unprotected Cox from Cantab HHH & London City HHH"). It's a structured club management platform. If Makesweat has a public API or iCal export, this could be a higher-quality source than HTML scraping.
- Hashtrash.org aggregates data from Makesweat for display — worth investigating as a potential multi-kennel source.
- City Hash has a `/?refresh_run_list=1` endpoint suggesting the run list is dynamically populated from Makesweat data.

---

### **WLH3** — West London Hash House Harriers

- Region: London (West London), UK
- Schedule: Thursday, 7:00 PM meet / 7:15 PM start, weekly
- Website: https://westlondonhash.com/
- Facebook: West London Hash House Harriers
- Aliases: WLH3, West London Hash, WLH
- Community size: Not stated, but appears active with regular hares
- Run count: Currently at run #2081+

**Best Source:** HTML_SCRAPER — `https://westlondonhash.com/` (homepage) or `https://westlondonhash.com/runs/`
- WordPress site
- Shows 15+ upcoming runs with: run number, date, location/pub name, postcode, map link, station, hare, description
- Paginated (page 1 shows ~15 runs, page 2 has more)
- Each run is a WordPress post with a permalink (e.g., `/runs/run-number-2081-19-february-2026/`)
- Fields: run number (in title), date (in title), hare, pub/location, postcode, map link, station, description

**Secondary Source:** None identified (no Google Calendar found)

**Notes:**
- Very active WordPress site with run reports, photos, stats pages
- Approaching run 2100 — well-established
- Has a linked sidebar listing all London hashes

---

### **BH3** — Barnes Hash House Harriers

- Region: SW London / Surrey borders, UK
- Schedule: Wednesday, 7:30 PM, weekly
- Website: http://www.barnesh3.com/
- Facebook: Not found (likely exists)
- Aliases: BH3, Barnes Hash, Barnes H3
- Community size: Not stated
- Run count: Currently at run #2104+

**Best Source:** HTML_SCRAPER — `http://www.barnesh3.com/HareLine.htm`
- Very simple, static HTML page
- HTML table with upcoming runs: run number, date, hare name(s), location (pub name, postcode, directions), on-inn details
- Only shows ~8 upcoming runs at a time
- Very basic formatting — old-school HTML table
- Fields: run number, date, hare(s), pub/location with postcode, directions

**Secondary Source:** None identified

**Notes:**
- Minimal, old-school website. Territory is SW London and Surrey countryside — not always near public transport.
- Uses `www.mapmyrun.com` for hare route planning
- Runs cost £2 non-members, free for members (£20/year)
- Low priority due to basic site and smaller geographical overlap with central London

---

### **OCH3** — Old Coulsdon Hash House Harriers

- Region: East Surrey / South London / NW Kent, UK
- Schedule: Alternating Sunday mornings (11 AM) and Monday evenings (7:30 PM), weekly
- Website: http://www.och3.org.uk/
- Facebook: Not found publicly
- Aliases: OCH3, Old Coulsdon Hash, OC Hash
- Community size: Not stated
- Run count: Not visible from homepage

**Best Source:** HTML_SCRAPER — `http://www.och3.org.uk/upcoming-run-list.html`
- Simple static HTML site (appears to be Weebly/similar page builder)
- Has "Next Run Details" and "Upcoming Run List" pages
- Fields expected: date, day, location, hares (based on site structure)

**Secondary Source:** None identified

**Notes:**
- Runs cost £2 including beer and crisps
- Alternating schedule (Sun/Mon) makes this slightly more complex for calendar modeling
- Outer London / Surrey territory

---

### **SLH3** — SLASH (South London Hash House Harriers)

- Region: London (and beyond), UK
- Schedule: 2nd Saturday of the month, ~monthly
- Website: https://www.londonhash.org/slah3/runlist/slash3list.html (hosted on LH3 domain)
- Facebook: Not found
- Aliases: SLASH, SLH3, SLAH3, "Short runs, long pub crawls"
- Community size: Small (monthly kennel)
- Run count: Currently at run #320+

**Best Source:** HTML_SCRAPER — `https://www.londonhash.org/slah3/runlist/slash3list.html`
- Very simple static HTML table
- Shows annual run list with: run number, day, date, time, location, hare
- Last updated for 2022 — may be stale
- Fields: run number, day, date, time ("12 Noon"), location, hare

**Secondary Source:** None

**Notes:**
- Monthly kennel, lower event volume
- Run list appears to not be regularly updated (last entries from 2022 show "TBC")
- May primarily communicate via word of mouth / email
- Low priority for onboarding

---

### **EH3** — Enfield Hash House Harriers

- Region: North London (Enfield area), UK
- Schedule: 3rd Wednesday of each month, 7:30 PM
- Website: http://www.enfieldhash.org/ (Blogger/Blogspot)
- Facebook: Not found publicly
- Aliases: EH3, Enfield Hash
- Community size: 12-15 runners per trail (stated on site)
- Run count: Currently at run #265+

**Best Source:** HTML_SCRAPER — `http://www.enfieldhash.org/`
- Blogger/Blogspot blog
- Each blog post announces the next run with: date, pub name, station, directions
- Not a structured calendar — individual blog posts per run announcement
- Historical run list at `/p/where-we-have-run.html` with table of: run number, date, station, pub, hares, notes
- Fields per blog post: date, pub, station, P-trail info

**Secondary Source:** None

**Notes:**
- Monthly kennel, low volume (12 runs/year)
- Blog-style posts are harder to scrape reliably than structured pages
- Small pack size (12-15)
- Founded May 1999
- Low priority

---

### **CH4** — Catch the Hare Hash House Harriers

- Region: Greater London, UK
- Schedule: ~3rd Sunday of the month, 3:00 PM, monthly
- Website: http://www.catchtheharehash.org.uk/
- Facebook: Not found
- Aliases: CH4, Catch the Hare, CTH
- Community size: Not stated
- Run count: Currently at run #248+

**Best Source:** MANUAL (website + mailing list)
- Website is extremely basic and rarely updated (last update shows runs from June-September 2024)
- States: "This website is updated very occasionally. For all the Catch News, visit our email list."
- Uses FreeLists mailing list: `https://www.freelists.org/list/catchthehareh3/`
- Live hare format (random hare picked at the event)
- Fields on website: run number, date, location (pub, area)

**Secondary Source:** None

**Notes:**
- Very low priority — monthly, rarely-updated website, communication primarily via mailing list
- Live hare format is unique (hare picked at random from attendees)
- Low event volume

---

### **FUKFM** — First UK Full Moon Hash House Harriers

- Region: London & Home Counties, UK
- Schedule: Monthly (every full moon evening), 7:30 PM
- Website: https://fukfmh3.co.uk/
- Facebook: Not found
- Aliases: FUKFM, FUKFMH3, FUK Full Moon, First UK Full Moon
- Community size: Not stated
- Run count: Running since March 1990

**Best Source:** HTML_SCRAPER — `https://fukfmh3.co.uk/`
- Basic static HTML site
- Would need to check for run schedule/listings

**Secondary Source:** None

**Notes:**
- Monthly full moon hash, runs across London and Home Counties
- Founded in Essex in 1990
- Low priority due to monthly frequency and specialized format

---

### **CUNT H3** — Currently Unnamed North Thames Hash House Harriers

- Region: North of the Thames, London, UK
- Schedule: Fridays, monthly, 7:00 PM
- Website: None (Facebook only)
- Facebook: https://www.facebook.com/groups/1822849584637512
- Aliases: CUNT H3, Currently Unnamed North Thames
- Community size: Not stated

**Best Source:** MANUAL / Facebook only
- No website exists
- Facebook group is the sole communication channel
- Facebook event scraping is not viable (auth required, ToS violation)

**Secondary Source:** None

**Notes:**
- Drinking club format (pub trail between pubs, no running)
- Monthly, low volume
- Facebook-only = manual event submission required
- Lowest priority

---

## Additional London-Adjacent Kennels (Not Core London, But Worth Noting)

These are mentioned in London hash directories but run primarily outside London proper:

| Kennel | Day | Territory | Website |
|--------|-----|-----------|---------|
| Surrey H3 | Sunday | Surrey | surreyhashhouseharriers.com |
| Weybridge H3 | Tuesday | Surrey | weybridgehash.org.uk |
| Guildford H3 | Monday | Guildford | guildfordh3.org.uk |
| East Grinstead H3 | Alternate Sundays/Mondays | Sussex | egh3.org.uk |
| Westerham & North Kent H3 | 3rd Sunday | Kent | w-nk.org.uk |
| MASH (Greenwich) H3 | 2nd Sunday monthly | Greenwich | mash-hash.co.uk |
| London Bike Hash | Monthly weekends | Surrey | londonbikehash.com |
| Marlow H3 | Sunday mornings | Marlow | marlowh3otm.com |

These could be Phase 2 additions if London core goes well.

---

## Platform Investigation Notes

### Makesweat.com
- Created by a member of City Hash and Cambridge Hash
- Used by City Hash for event management, attendance, and payment
- City Hash's website pulls run data from Makesweat (WordPress integration)
- Hashtrash.org aggregates Makesweat data for hash-specific display
- **Action item:** Investigate whether Makesweat has a public API or iCal export. If so, this could be a structured source for any kennel that uses it, not just City Hash.

### Harrier Central
- Global hash app (iOS + Android) with kennel and event data
- Free for all kennels worldwide
- Created by two hashers (Tuna Melt and Opee — who are also LH3 hares based on the run list!)
- **Action item:** Investigate if Harrier Central has a public API. If London kennels post events there, it could be a multi-kennel aggregator source.

### UK Hash House Harriers (hhh.org.uk / ukh3.org.uk)
- National directory with map-based kennel finder
- Events page for major UK hashing events
- No calendar feed for weekly kennel runs
- Not useful as a data source for regular events

---

## Seed Data Block

```typescript
// Kennels to add to prisma/seed.ts
const newKennels = [
  {
    shortName: "LH3",
    fullName: "London Hash House Harriers",
    region: "London",
    country: "UK",
    website: "https://www.londonhash.org/",
    description: "London's first hash. Weekly Saturday runs at noon from locations across Greater London, all accessible by tube or train. Average pack size ~33.",
  },
  {
    shortName: "CH3",
    fullName: "City Hash House Harriers",
    region: "London",
    country: "UK",
    website: "https://cityhash.org.uk/",
    description: "Weekly Tuesday evening runs at 7pm from pubs in London Underground Zones 1-2. 5-8km trails with 30-40 runners per week.",
  },
  {
    shortName: "WLH3",
    fullName: "West London Hash House Harriers",
    region: "London",
    country: "UK",
    website: "https://westlondonhash.com/",
    description: "Weekly Thursday evening runs at 7:15pm from pubs across West London, accessible by tube or rail.",
  },
  {
    shortName: "BH3",
    fullName: "Barnes Hash House Harriers",
    region: "London",
    country: "UK",
    website: "http://www.barnesh3.com/",
    description: "Weekly Wednesday evening runs at 7:30pm in SW London and Surrey countryside.",
  },
  {
    shortName: "OCH3",
    fullName: "Old Coulsdon Hash House Harriers",
    region: "London",
    country: "UK",
    website: "http://www.och3.org.uk/",
    description: "Weekly runs alternating between Sunday mornings (11am) and Monday evenings (7:30pm) in east Surrey, south London, and NW Kent.",
  },
  {
    shortName: "SLH3",
    fullName: "SLASH (South London Hash House Harriers)",
    region: "London",
    country: "UK",
    website: "https://www.londonhash.org/slah3/runlist/slash3list.html",
    description: "Monthly hash on the 2nd Saturday. Short runs, long pub crawls.",
  },
  {
    shortName: "EH3",
    fullName: "Enfield Hash House Harriers",
    region: "London",
    country: "UK",
    website: "http://www.enfieldhash.org/",
    description: "Monthly hash on the 3rd Wednesday at 7:30pm in the parks and woods of north London. Pack size 12-15.",
  },
  {
    shortName: "CH4",
    fullName: "Catch the Hare Hash House Harriers",
    region: "London",
    country: "UK",
    website: "http://www.catchtheharehash.org.uk/",
    description: "Monthly live-hare hash, typically 3rd Sunday at 3pm. Hare picked at random from attendees.",
  },
  {
    shortName: "FUKFM",
    fullName: "First UK Full Moon Hash House Harriers",
    region: "London",
    country: "UK",
    website: "https://fukfmh3.co.uk/",
    description: "Monthly full moon evening hash covering London and Home Counties. Running since 1990.",
  },
  {
    shortName: "CUNTH3",
    fullName: "Currently Unnamed North Thames Hash House Harriers",
    region: "London",
    country: "UK",
    website: null,
    description: "Monthly Friday evening drinking-club-style pub trail north of the Thames. Facebook-only communication.",
  },
];

// Aliases to add
const newAliases: Record<string, string[]> = {
  "LH3": ["London Hash", "London H3", "London Hash House Harriers", "LH3"],
  "CH3": ["City Hash", "City H3", "City Hash House Harriers", "CH3", "cityhash"],
  "WLH3": ["West London Hash", "West London H3", "WLH3", "WLH"],
  "BH3": ["Barnes Hash", "Barnes H3", "BH3", "Barnes Hash House Harriers"],
  "OCH3": ["Old Coulsdon Hash", "Old Coulsdon H3", "OCH3", "OC Hash"],
  "SLH3": ["SLASH", "SLAH3", "SLH3", "South London Hash"],
  "EH3": ["Enfield Hash", "Enfield H3", "EH3"],
  "CH4": ["Catch the Hare", "CTH", "CH4"],
  "FUKFM": ["FUKFM", "FUKFMH3", "FUK Full Moon", "First UK Full Moon"],
  "CUNTH3": ["CUNT H3", "Currently Unnamed North Thames"],
};

// Sources to add
const newSources = [
  {
    name: "London Hash Run List",
    url: "https://www.londonhash.org/runlist.php",
    type: "HTML_SCRAPER",
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      // Static HTML, PHP-rendered. Parse run blocks containing:
      // run number (link text), date, time, station, pub (with CAMRA link),
      // hare names, travel info, notes.
      // Run blocks are structured divs/tables with consistent formatting.
      selectors: {}, // TODO: define after adapter analysis
    },
    kennelShortNames: ["LH3"],
  },
  {
    name: "City Hash Website",
    url: "https://cityhash.org.uk/",
    type: "HTML_SCRAPER",
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      // WordPress site powered by Makesweat. Homepage shows next run + upcoming runs.
      // Each run card has: title with run number + date + theme, pub name + postcode,
      // Google Maps link with lat/lng, tube station, hare name.
      // Run titles follow pattern: "City Hash R*n #XXXX [Theme] - DDth Mon YYYY"
      selectors: {}, // TODO: define after adapter analysis
    },
    kennelShortNames: ["CH3"],
  },
  {
    name: "West London Hash Website",
    url: "https://westlondonhash.com/",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    config: {
      // WordPress site. Homepage and /runs/ page show upcoming runs.
      // Each run is a WP post with: title containing run number + date + location,
      // hare name, pub/location with postcode, map link, station, description.
      // Paginated — may need to follow ?query-42-page=2 for more runs.
      selectors: {}, // TODO: define after adapter analysis
    },
    kennelShortNames: ["WLH3"],
  },
  {
    name: "Barnes Hash Hare Line",
    url: "http://www.barnesh3.com/HareLine.htm",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    config: {
      // Very simple static HTML table.
      // Columns: run number + date + hare(s) | location (pub, postcode, directions)
      // Shows ~8 upcoming runs. Old-school HTML.
      selectors: {}, // TODO: define after adapter analysis
    },
    kennelShortNames: ["BH3"],
  },
  {
    name: "Old Coulsdon Hash Run List",
    url: "http://www.och3.org.uk/upcoming-run-list.html",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    config: {
      // Simple static site (Weebly-style). Upcoming run list page.
      // Needs further investigation for HTML structure.
      selectors: {}, // TODO: investigate page structure
    },
    kennelShortNames: ["OCH3"],
  },
  {
    name: "SLASH Run List",
    url: "https://www.londonhash.org/slah3/runlist/slash3list.html",
    type: "HTML_SCRAPER",
    trustLevel: 5,
    scrapeFreq: "monthly",
    config: {
      // Very simple static HTML table hosted on LH3 domain.
      // Shows annual run schedule. May be stale (last updated 2022).
      selectors: {}, // TODO: define after adapter analysis
    },
    kennelShortNames: ["SLH3"],
  },
  // Enfield, Catch the Hare, FUKFM, and CUNT H3 are MANUAL sources:
  // - EH3: Blogspot blog, individual posts per run announcement
  // - CH4: Rarely-updated static site + FreeLists mailing list
  // - FUKFM: Basic static site, needs investigation
  // - CUNTH3: Facebook-only
];
```

---

## Key Differences from US Hashing

When building adapters for London kennels, note these UK-specific patterns:

1. **P-trail convention** — UK hashes mark a "P trail" (chalk P's) from the nearest train/tube station to the pub. This means "station" is a key field in event data (not typical in US hashes).
2. **Pub-centric** — All runs start and end at a pub. The pub name and postcode are primary location identifiers.
3. **Postcode format** — UK postcodes (e.g., "SW18 2SS", "KT20 7ES") are structured differently from US zip codes. These can be geocoded easily.
4. **Run numbering** — All London kennels use sequential run numbers prominently.
5. **"On Out" / "On Inn"** — UK term for the start time and return to pub respectively.
6. **Hash Cash** — UK hashes typically charge £2 per run.
7. **Summer schedule shifts** — London Hash (LH3) switches to Monday evenings in summer.
