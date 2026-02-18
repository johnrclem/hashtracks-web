# San Francisco Bay Area — Hash House Harriers Kennel Research

## Regional Summary

**Total kennels found:** ~20 (12 active/regular, 8+ specialty/occasional/inactive)

**🏆 MAJOR FINDING — Regional Aggregator: SFH3.com (MultiHash Web Technologies)**

The SF Bay Area hash scene is served by a **single unified platform** called **MultiHash Web Technologies** (built by *Q Laboratories*). This platform powers multiple domains:
- **sfh3.com** — primary hub, hosts hareline for ~24 kennel tags
- **svh3.com** — Silicone Valley H3 (separate domain, same platform)
- **ebh3.com** — East Bay H3 (separate domain, same platform)
- **gypsiesh3.com** — Gypsies in the Palace H3 (separate domain, same platform)

All four domains share the same backend and expose the same data in multiple formats:
1. **iCal feed:** `https://www.sfh3.com/calendar` — returns `.ics` with ALL kennels' events
2. **HTML hareline:** `https://www.sfh3.com/runs?kennels=all` — table with kennel filter tabs
3. **Per-run pages:** `https://www.sfh3.com/runs/{id}` — individual event details
4. **Per-run iCal:** `https://www.sfh3.com/runs/{id}.ics` — single event export
5. **Mobile app:** MultiHash app (iOS/Android) covers all Bay Area kennels

This is analogous to hashnyc.com for NYC — **one adapter can serve ~20 kennels**.

### Kennel Tags on SFH3.com Platform
The hareline filter lists these kennel identifiers:
`SFH3 | BARH3 | FCH3 | FMH3 | 26.2H3 | GPH3 | EBH3 | Marin H3 | VMH3 | SVH3 | FHAC-U | Agnews | FHAgnews | CLIT | MWH3 | Pirate H3 | BABE H3 | BCH3 | CAN'd H3 | WFF | Hand Pump | Workday | SacH3 | (Other)`

### Recommended Onboarding Order

1. **SFH3.com iCal feed** (aggregator — covers ~20 kennels in one source)
2. **SFH3.com HTML scraper** (fallback/enrichment — structured table data)
3. **Individual kennel websites** (only needed for kennels NOT on the platform, e.g., Winers H3)
4. **Facebook-only kennels** (manual/last resort)

---

## Per-Kennel Detail

---

### **SFH3** — San Francisco Hash House Harriers
- Region: San Francisco, CA
- Schedule: **Weekly, Monday, 6:15 PM** (running starts 6:30–6:45 PM)
- Website: https://www.sfh3.com
- Facebook: https://www.facebook.com/sfhash
- Twitter/X: https://x.com/sfh3
- Aliases: SFH3, SF Hash, San Francisco H3, San Francisco Hash
- Community size: ~40–60 per run (established 1982, run #2285+ as of Feb 2026)
- Notes: The flagship Bay Area kennel. Hosts the aggregator website.

**Best Source:** iCal feed at `https://www.sfh3.com/calendar` (aggregator, covers all kennels)
**Secondary Source:** HTML scraper on `https://www.sfh3.com/runs?kennels=all` (structured table: Run#, When, Hare, Where, What)
**Notes:** The iCal SUMMARY field contains kennel-prefixed event names (e.g., "SFH3 #2302", "SVH3 #1273"). This is the primary kennel-identification pattern. The DESCRIPTION field contains hare names. GEO field contains lat/lng. URL field links back to the run detail page.

---

### **GPH3** — Gypsies in the Palace Hash House Harriers
- Region: San Francisco, CA
- Schedule: **Weekly, Thursday, 6:15 PM**
- Website: https://www.gypsiesh3.com (redirects to MultiHash platform)
- Twitter/X: https://x.com/gypsiesh3
- Facebook: Unknown (likely exists)
- Aliases: GPH3, Gypsies H3, Gypsies, GIP H3
- Community size: Unknown (long-running kennel)
- Notes: Traditional Thursday night hash in SF. Has its own domain but runs on MultiHash platform.

**Best Source:** SFH3.com aggregator (iCal/HTML)
**Secondary Source:** Own domain gypsiesh3.com (same platform, same data)
**Notes:** Listed as "GPH3" in the hareline filter.

---

### **EBH3** — East Bay Hash House Harriers
- Region: Oakland / East Bay, CA
- Schedule: **Biweekly, Sunday, 1:00 PM**
- Website: https://www.ebh3.com (MultiHash platform)
- Facebook: https://www.facebook.com/groups/Ebhhh/
- Mailing list: https://mail.ebh3.com/mailman/listinfo/ebh3-hashers
- Aliases: EBH3, East Bay H3, East Bay Hash
- Community size: Unknown (run #1159+ as of Feb 2026 — long-running)
- Hash cash: $6

**Best Source:** SFH3.com aggregator (iCal/HTML)
**Secondary Source:** Own domain ebh3.com (same platform data)
**Notes:** Also has its own /calendar endpoint on ebh3.com.

---

### **SVH3** — Silicone Valley Hash House Harriers
- Region: San Jose / South Bay / Peninsula, CA (San Jose to Menlo Park)
- Schedule: **Biweekly, Saturday, ~2:00–3:00 PM**
- Website: https://svh3.com (MultiHash platform)
- Facebook: https://www.facebook.com/SIliconeValleyHash
- Twitter/X: https://x.com/SiliconValleyH3
- Mailing list: https://mailhost.svh3.com/mailman/listinfo/svh3-we_got_the_runs
- Aliases: SVH3, Silicone Valley H3, Silicon Valley Hash, SV Hash
- Community size: Unknown (run #1266+ as of Feb 2026)
- Hash cash: $6

**Best Source:** SFH3.com aggregator (iCal/HTML)
**Secondary Source:** Own domain svh3.com (same platform data, also has /calendar)
**Notes:** Note the deliberate misspelling "Silicone" (not "Silicon"). SVH3 is the hub for South Bay hashing — its site also shows FHAC-U and Agnews runs.

---

### **FHAC-U** — FHAC-U Hash House Harriers
- Region: South Bay / Peninsula, CA (San Jose area)
- Schedule: **Biweekly, Thursday, 6:30 PM** (alternates with Agnews)
- Website: https://svh3.com (shared with SVH3, same platform)
- Aliases: FHAC-U, FHACU
- Community size: Unknown
- Hash cash: $7
- Notes: "Traditional hash" — shorter trails, more pubs. Shares the SVH3 community.

**Best Source:** SFH3.com aggregator (iCal SUMMARY pattern: "FHAC-U #567")
**Notes:** Runs alternate Thursdays with Agnews. Listed separately in hareline filter. Run numbers visible in iCal (e.g., "FHAC-U #561").

---

### **Agnews** — Agnews State Hash House Harriers
- Region: South Bay / Peninsula, CA (San Jose area)
- Schedule: **Biweekly, Thursday, 6:30 PM** (alternates with FHAC-U)
- Website: https://svh3.com (shared with SVH3, same platform)
- Aliases: Agnews, Agnews State H3, Agnews H3
- Community size: Unknown
- Notes: Longer trails, more family-friendly. Alternates weeks with FHAC-U.

**Best Source:** SFH3.com aggregator (iCal SUMMARY pattern: "Agnews #1515")
**Notes:** Run #1509+ as of Feb 2026.

---

### **Marin H3** — Marin Hash House Harriers
- Region: Marin County, CA (also ventures into Sonoma)
- Schedule: **Monthly, Saturday, 1:00 PM**
- Website: None (email list only: magoo AT gmail.com); runs listed on sfh3.com
- Facebook: Unknown
- Aliases: Marin H3, Marin Hash, MarinH3
- Community size: Unknown (run #290+ as of early 2026)

**Best Source:** SFH3.com aggregator (iCal SUMMARY pattern: "Marin H3 #292")
**Notes:** No dedicated website. All event data lives on the SFH3.com platform. Email contact for mailing list.

---

### **FCH3** — Fog City Hash House Harriers
- Region: San Francisco, CA
- Schedule: **Irregular/Monthly** (weekend events, special runs)
- Website: None dedicated; events on sfh3.com and hashrego.com
- HashRego: https://hashrego.com/kennels/FCH3 (for weekend event registration)
- Aliases: FCH3, Fog City H3, Fog City Hash
- Notes: LGBTQ-friendly kennel. Hosts special events like "Drunkards & Dragons" weekend, Groundhog Day trail. Uses HashRego for event registration.

**Best Source:** SFH3.com aggregator (iCal SUMMARY pattern: "FCH3" prefix)
**Secondary Source:** HashRego (for special events/registration — not easily scrapeable)
**Notes:** The FCH3 Groundhog Day event on the SFH3 front page shows this kennel is active but irregular. Not to be confused with "Flour City H3" (Rochester, NY) which also uses "FCH3."

---

### **FMH3** — Full Moon Hash (San Francisco)
- Region: San Francisco, CA
- Schedule: **Monthly, on the full moon**
- Website: None dedicated; runs listed on sfh3.com
- Aliases: FMH3, Full Moon H3, SF Full Moon Hash
- Notes: Classic monthly full-moon hash. Previously known as "San Francisco Full Moon Zombies HHH" per the half-mind database.

**Best Source:** SFH3.com aggregator (iCal SUMMARY pattern: "FMH3")
**Notes:** Appears in the hareline filter but events are infrequent.

---

### **BARH3** — Bay Area Rabble Hash
- Region: San Francisco / Oakland Bay Area, CA
- Schedule: **Weekly, Wednesday, 6:30 PM** (starts at various BART stations)
- Website: None; Twitter/X is primary communication
- Twitter/X: https://x.com/BARH3
- Aliases: BARH3, Bay Area Rabble, BAR H3
- Notes: Bar-to-bar live hare hash. Starts at BART stations (Oakland 12th St, Montgomery, Rockridge, downtown Berkeley).

**Best Source:** SFH3.com aggregator (listed in hareline filter as "BARH3")
**Notes:** Primarily social-media driven. Twitter account shows run announcements.

---

### **MWH3** — Muir Woods Hash
- Region: Marin County, CA (Muir Woods area)
- Schedule: **Annual** (Anti-Ranger run in August)
- Website: http://www.mwh3.com (may be defunct)
- Aliases: MWH3, Muir Woods H3, Muir Woods Hash
- Notes: Annual/special event hash, not a regular recurring kennel.

**Best Source:** SFH3.com aggregator (if events are listed)
**Notes:** Very low frequency. May not warrant individual kennel record unless active.

---

### **Winers H3** — Winers Hash House Harriers
- Region: Sonoma / Napa County, CA (wine country)
- Schedule: **Biweekly, Monday, 6:30 PM**
- Website: http://www.vinetrade.com/hhh/ (likely defunct/old)
- Phone: (707) 793-2148
- Aliases: Winers H3, Winers Hash, Sonoma County Winers, Wine Country Hash
- Notes: **NOT on the SFH3.com platform.** This kennel runs independently in Sonoma/Napa wine country.

**Best Source:** Unknown — likely Facebook-only or email list
**Notes:** Referenced on the SFH3 old links page but not in the MultiHash hareline filter. May require manual data entry or separate source discovery. Also known as "Sonoma County HHH" per the half-mind worldwide database.

---

### Specialty/Occasional Kennels (on SFH3.com platform)

These appear in the hareline filter but are specialty, occasional, or sub-kennels:

| Tag | Likely Full Name | Notes |
|-----|-----------------|-------|
| **26.2H3** | Marathon Hash | Likely special marathon-themed events |
| **VMH3** | Unknown | Possibly "Victory March H3" or similar |
| **FHAgnews** | Combined FHAC-U + Agnews | Joint events |
| **CLIT** | Unknown | Specialty hash |
| **Pirate H3** | Pirate Hash | Themed/specialty hash |
| **BABE H3** | Unknown | Possibly women's hash |
| **BCH3** | Unknown | Possibly "Bay City H3" |
| **CAN'd H3** | Unknown | Possibly "California Night Drinking" or similar |
| **WFF** | Unknown | Specialty/themed |
| **Hand Pump** | Hand Pump Workday | Trail maintenance at McLaren Park (monthly Sat 9:30AM) |
| **Workday** | (Same as Hand Pump) | Trail work, not a traditional hash |
| **SacH3** | Sacramento H3 | Sacramento, CA — outside core Bay Area |

**Notes:** These specialty kennels share the SFH3.com platform and will automatically be captured by the aggregator source. They can be added as kennel records later once their activity levels and identities are confirmed.

---

## Source Assessment

### Source Type D: iCal Feed (PRIMARY — HIGHEST VALUE)

**URL:** `https://www.sfh3.com/calendar`

**Technical Details:**
- Returns standard iCal (`.ics`) format (`MIME: text/calendar; charset=utf-8`)
- `PRODID: icalendar-ruby`
- `CALSCALE: GREGORIAN`
- `X-WR-CALNAME: SFH3 Calendar`
- Contains events from ALL kennels on the platform (~20+ kennel tags)
- Each `VEVENT` includes:
  - `SUMMARY`: Kennel-prefixed name, e.g., `"SFH3 #2302"`, `"SVH3 #1273"`, `"Marin H3 #292"`, `"FHAC-U #567"`, `"Agnews #1515"`, `"FCH3 2/2(2) Tutu Groundhog Day Trail"`
  - `DTSTART` / `DTEND`: Full datetime with timezone (`America/Los_Angeles`)
  - `LOCATION`: Start location text
  - `GEO`: Latitude;Longitude
  - `DESCRIPTION`: Hare name(s) and notes
  - `URL`: Link to run detail page on sfh3.com
  - `UID`: `com.sfh3.calendar.run-{id}-2`
- Covers future events (hareline) — appears to show ~6+ months out
- Also includes past events in the feed

**Kennel identification pattern in SUMMARY:**
```
"SFH3 #2302"          → kennel: SFH3, run number: 2302
"SVH3 #1273"          → kennel: SVH3, run number: 1273
"Marin H3 #292"       → kennel: Marin H3, run number: 292
"FHAC-U #567"         → kennel: FHAC-U, run number: 567
"FHAC-U: BAWC 5"      → kennel: FHAC-U, special event
"Agnews #1515"        → kennel: Agnews, run number: 1515
"Hand Pump Workday"   → kennel: Hand Pump (trail maintenance)
```

**Regex pattern for parsing:**
```
/^(SFH3|SVH3|EBH3|GPH3|FCH3|FMH3|BARH3|Marin H3|MWH3|FHAC-U|Agnews|FHAgnews|CLIT|26\.2H3|VMH3|Pirate H3|BABE H3|BCH3|CAN'd H3|WFF|Hand Pump|SacH3)[\s:#]*(.*)$/
```

**Assessment:** This is a **gold-standard** source — structured iCal with multi-kennel coverage, geo coordinates, and direct API-style access with no authentication. It's similar in value to the hashnyc.com aggregator you already have.

---

### Source Type A: HTML Scraper (SECONDARY — enrichment)

**URL:** `https://www.sfh3.com/runs?kennels=all`

**Technical Details:**
- Static HTML (data is in the page source, no JS rendering needed)
- Table structure with columns: Run#, When, Hare, Where, What
- Kennel filter tabs at the top of the page
- Each row links to a detail page (`/runs/{id}`)
- Location column contains Google Maps links with lat/lng
- Can be filtered per-kennel: `?kennel=sfh3`, `?kennel=14` (for FCH3), etc.
- Shows upcoming runs plus historical runs by year range

**Assessment:** Good fallback/enrichment source. The HTML table is clean and parseable with Cheerio. The per-kennel filtering is useful for targeted scraping.

---

### Source Type F: HashRego (SUPPLEMENTARY)

**URL:** `https://hashrego.com/kennels/FCH3` (and similar)

**Technical Details:**
- HashRego is a platform for hash event registration
- Provides embeddable iframes for event listings and details
- Used by FCH3 for weekend events
- Has per-kennel event listing: `hashrego.com/kennels/{KENNEL}/events`
- **No public API** documented, but iframe endpoints exist

**Assessment:** Useful for special events/weekends that may not appear on the regular hareline. Lower priority than the iCal feed.

---

## Regional Aggregator Check

| Source | Type | Covers | Status |
|--------|------|--------|--------|
| **sfh3.com** | MultiHash platform (iCal + HTML) | ~20 Bay Area kennels | ✅ Active, best source |
| gotothehash.net | Directory | Bay Area kennels listed | ❌ Directory only, no calendar data |
| half-mind.com | Directory/contact list | California kennels listed | ❌ Directory only, 409 error on fetch |
| hashrego.com | Event registration | FCH3, FMH3 (special events) | ⚠️ Supplementary, special events only |

**Conclusion:** SFH3.com is THE aggregator for the Bay Area. There is no separate aggregator site like hashnyc.com — instead, the MultiHash platform serves this role through sfh3.com directly.

---

## Seed Data Block

```typescript
// Kennels to add to prisma/seed.ts
const newKennels = [
  {
    shortName: "SFH3",
    fullName: "San Francisco Hash House Harriers",
    region: "San Francisco, CA",
    country: "USA",
    website: "https://www.sfh3.com",
    description: "Weekly Monday evening runs in San Francisco since 1982",
  },
  {
    shortName: "GPH3",
    fullName: "Gypsies in the Palace Hash House Harriers",
    region: "San Francisco, CA",
    country: "USA",
    website: "https://www.gypsiesh3.com",
    description: "Weekly Thursday evening hash in San Francisco",
  },
  {
    shortName: "EBH3",
    fullName: "East Bay Hash House Harriers",
    region: "Oakland, CA",
    country: "USA",
    website: "https://www.ebh3.com",
    description: "Biweekly Sunday afternoon runs in the East Bay",
  },
  {
    shortName: "SVH3",
    fullName: "Silicone Valley Hash House Harriers",
    region: "San Jose, CA",
    country: "USA",
    website: "https://svh3.com",
    description: "Biweekly Saturday afternoon runs from South Bay to mid-peninsula",
  },
  {
    shortName: "FHAC-U",
    fullName: "FHAC-U Hash House Harriers",
    region: "San Jose, CA",
    country: "USA",
    website: "https://svh3.com",
    description: "Biweekly Thursday evening traditional hash in the South Bay, alternating with Agnews",
  },
  {
    shortName: "AGNEWS",
    fullName: "Agnews State Hash House Harriers",
    region: "San Jose, CA",
    country: "USA",
    website: "https://svh3.com",
    description: "Biweekly Thursday evening hash in the South Bay, alternating with FHAC-U",
  },
  {
    shortName: "MARINH3",
    fullName: "Marin Hash House Harriers",
    region: "Marin County, CA",
    country: "USA",
    website: null,
    description: "Monthly Saturday afternoon hash in Marin County",
  },
  {
    shortName: "FCH3",
    fullName: "Fog City Hash House Harriers",
    region: "San Francisco, CA",
    country: "USA",
    website: null,
    description: "LGBTQ-friendly hash in San Francisco with irregular/monthly events",
  },
  {
    shortName: "FMH3",
    fullName: "San Francisco Full Moon Hash",
    region: "San Francisco, CA",
    country: "USA",
    website: null,
    description: "Monthly full-moon hash in San Francisco",
  },
  {
    shortName: "BARH3",
    fullName: "Bay Area Rabble Hash",
    region: "San Francisco, CA",
    country: "USA",
    website: null,
    description: "Weekly Wednesday evening bar-to-bar live hare hash in the Bay Area",
  },
  {
    shortName: "MWH3",
    fullName: "Muir Woods Hash",
    region: "Marin County, CA",
    country: "USA",
    website: null,
    description: "Annual Anti-Ranger run in Muir Woods area",
  },
  {
    shortName: "WINERS",
    fullName: "Winers Hash House Harriers",
    region: "Sonoma County, CA",
    country: "USA",
    website: null,
    description: "Biweekly Monday evening hash in Sonoma/Napa wine country",
  },
];

// Aliases to add
const newAliases: Record<string, string[]> = {
  "SFH3": ["SF Hash", "San Francisco Hash", "SFH3", "SF H3"],
  "GPH3": ["Gypsies H3", "Gypsies in the Palace", "GIP H3", "Gypsies Hash", "GPH3"],
  "EBH3": ["East Bay Hash", "East Bay H3", "EBH3", "EB Hash"],
  "SVH3": ["Silicone Valley H3", "Silicon Valley Hash", "SV Hash", "SVH3"],
  "FHAC-U": ["FHAC-U", "FHACU", "FHAC-U H3"],
  "AGNEWS": ["Agnews", "Agnews State H3", "Agnews Hash", "Agnews H3"],
  "MARINH3": ["Marin H3", "Marin Hash", "Marin HHH"],
  "FCH3": ["Fog City H3", "Fog City Hash", "FCH3"],
  "FMH3": ["Full Moon H3", "SF Full Moon", "Full Moon Hash", "FMH3"],
  "BARH3": ["Bay Area Rabble", "BAR H3", "BARH3"],
  "MWH3": ["Muir Woods H3", "Muir Woods Hash", "MWH3"],
  "WINERS": ["Winers H3", "Winers Hash", "Sonoma County Winers", "Wine Country Hash"],
};

// Sources to add
const newSources = [
  {
    name: "SFH3 MultiHash iCal Feed",
    url: "https://www.sfh3.com/calendar",
    type: "ICAL", // or "HTML_SCRAPER" depending on your adapter types
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      // iCal adapter config
      format: "ics",
      kennelPatterns: {
        "SFH3": ["^SFH3\\s"],
        "GPH3": ["^GPH3\\s"],
        "EBH3": ["^EBH3\\s"],
        "SVH3": ["^SVH3\\s"],
        "FHAC-U": ["^FHAC-U"],
        "AGNEWS": ["^Agnews\\s"],
        "MARINH3": ["^Marin H3\\s"],
        "FCH3": ["^FCH3\\s"],
        "FMH3": ["^FMH3\\s"],
        "BARH3": ["^BARH3\\s"],
        "MWH3": ["^MWH3\\s"],
      },
      // SUMMARY field format: "{KENNEL} #{RUN_NUMBER}: {TITLE}" or "{KENNEL} #{RUN_NUMBER}"
      // DESCRIPTION field: "Hare: {HARE_NAME}\n{NOTES}"
      // GEO field: "{LAT};{LNG}"
      // LOCATION field: start location text
      // URL field: link to run detail page
    },
    kennelShortNames: [
      "SFH3", "GPH3", "EBH3", "SVH3", "FHAC-U", "AGNEWS",
      "MARINH3", "FCH3", "FMH3", "BARH3", "MWH3",
    ],
  },
  {
    name: "SFH3 MultiHash HTML Hareline",
    url: "https://www.sfh3.com/runs?kennels=all",
    type: "HTML_SCRAPER",
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      // HTML table scraper config
      // Table columns: Run# | When | Hare | Where | What
      // Where column contains Google Maps links with lat/lng in query param
      // Kennel filter is in URL: ?kennel=sfh3, ?kennel=14, etc.
      // Each row links to /runs/{id} detail page
      selectors: {
        table: "table",
        rows: "tr",
        runNumber: "td:nth-child(1)",
        date: "td:nth-child(2)",
        hare: "td:nth-child(3)",
        location: "td:nth-child(4)",
        title: "td:nth-child(5)",
      },
    },
    kennelShortNames: [
      "SFH3", "GPH3", "EBH3", "SVH3", "FHAC-U", "AGNEWS",
      "MARINH3", "FCH3", "FMH3", "BARH3", "MWH3",
    ],
  },
];
```

---

## Onboarding Implementation Notes

### 1. New Adapter Needed: iCal (`.ics`) Parser

Your existing adapter types are `HTML_SCRAPER`, `GOOGLE_CALENDAR`, and `GOOGLE_SHEETS`. The SFH3 iCal feed is neither a Google Calendar nor a standard HTML page — it's a raw `.ics` file served over HTTP.

**Options:**
- **Option A (recommended):** Add a new `ICAL` adapter type using an npm library like `ical.js` or `node-ical`. The feed is a simple HTTP GET — no auth needed.
- **Option B:** Convert the iCal URL to a Google Calendar by importing it, then use the existing `GOOGLE_CALENDAR` adapter. However, this adds a dependency on Google Calendar sync.
- **Option C:** Use the HTML scraper on the hareline page instead. This works but provides less structured data than the iCal feed.

### 2. Kennel Short Name Mapping

The iCal SUMMARY field uses kennel prefixes that need to be mapped to your kennel short names. Some mapping considerations:

| iCal SUMMARY prefix | Your short name | Notes |
|---------------------|----------------|-------|
| `SFH3` | `SFH3` | Direct match |
| `SVH3` | `SVH3` | Direct match |
| `EBH3` | `EBH3` | Direct match |
| `GPH3` | `GPH3` | Direct match |
| `Marin H3` | `MARINH3` | Space in source, no space in short name |
| `FHAC-U` | `FHAC-U` | Hyphen in name |
| `Agnews` | `AGNEWS` | Case difference |
| `FCH3` | `FCH3` | Direct match |
| `FMH3` | `FMH3` | Direct match |
| `BARH3` | `BARH3` | Direct match |
| `MWH3` | `MWH3` | Direct match |

### 3. Winers H3 — Separate Source Needed

The Winers Hash is NOT on the SFH3.com platform. They are an independent Sonoma County kennel. Their old website (vinetrade.com/hhh) is likely defunct. This kennel may be Facebook-only or email-list-only, making it a MANUAL source for now.

### 4. Hand Pump / Workday — Special Case

"Hand Pump Workday" events are trail maintenance work parties at McLaren Park, not traditional hashes. They show up monthly on Saturdays at 9:30 AM. You may want to exclude these or tag them as "trail work" rather than "hash run."

### 5. Sacramento H3 — Out of Core Region

SacH3 (Sacramento) is listed in the hareline filter but is outside the core Bay Area. Include it if you want to expand to NorCal, but it's geographically separate (~90 miles from SF).

### 6. Platform Notes

The MultiHash platform is actively maintained and the URLs are stable. The iCal feed URL has been consistent. Individual kennel domains (sfh3.com, svh3.com, ebh3.com, gypsiesh3.com) all resolve to the same backend. The platform also has a mobile app.
