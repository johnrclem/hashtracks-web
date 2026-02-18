# Chicago Area Hash House Harriers — Kennel Research for HashTracks

**Date:** February 17, 2026
**Region:** Chicago, IL (Chicagoland)
**Researcher:** Claude (via web research)

---

## Regional Summary

- **Total kennels found:** 11 (10 in Chicago proper + 1 in NW Indiana but listed as Chicagoland)
- **Regional aggregator discovered:** ✅ Google Calendar covering all Chicagoland kennels — **highest value source**
- **Secondary aggregator:** hhhinchicago.com (Bushman H3/Full Moon operator's site with a receding hareline for all area kennels)
- **Tertiary aggregator:** brownbearsw.com/freecal/hashcal (free web calendar, sparsely updated)

### Recommended Onboarding Order

1. **Chicagoland Google Calendar** (aggregator — covers all ~11 kennels with one source)
2. **chicagohash.org** (CH3 WordPress site — richest individual kennel data, good HTML structure)
3. **chicagoth3.com** (TH3 WordPress site — weekly kennel, good HTML structure)
4. **4x2h4.org** (4X2 H4 website — monthly, has future runs page)
5. **whiskeywednesdayhash.org** (WWH3 — monthly, basic site)
6. **hhhinchicago.com** (Bushman/Full Moon aggregator — semi-structured text)
7. Facebook-only kennels: Big Dogs, Second City, Ragtime, Duneland (manual/last resort)

---

## Regional Aggregator Sources

### 🌟 Chicagoland Google Calendar (PRIMARY AGGREGATOR)

- **Calendar ID:** `30c33n8c8s46icrd334mm5p3vc@group.calendar.google.com`
- **Embed URL:** `https://calendar.google.com/calendar/u/0/embed?src=30c33n8c8s46icrd334mm5p3vc@group.calendar.google.com&ctz=America/Chicago`
- **Maintained by:** "Snatchsquatch" (active CH3/TH3 member, current as of 2026)
- **Coverage:** All Chicagoland hash kennels
- **Source Type:** GOOGLE_CALENDAR (multi-kennel aggregator)
- **Notes:** Linked from chicagohash.org's "Chicagoland Hash Calendar" page. This is the single highest-value source — one adapter serves all 11 kennels. Event titles likely contain kennel identifiers (e.g., "CH3 #2580", "TH3 #1060", "BDH3", "BMH3", "CFMH3", etc.). Need to configure `kennelPatterns` to extract kennel affiliation from event titles.

### HHHinChicago.com (SECONDARY AGGREGATOR)

- **URL:** https://www.hhhinchicago.com/
- **Receding Hareline:** https://www.hhhinchicago.com/chicago-area-receding-hareline.php
- **Area Calendar:** https://www.hhhinchicago.com/area-calendar.php
- **Maintained by:** "Horn-E" (Chicago Full Moon / Bushman H3 organizer)
- **Coverage:** All Chicago area hashes listed as courtesy — highlights Moon Hashes and Bushman
- **Source Type:** HTML_SCRAPER candidate (but loosely structured text, not tabular)
- **Notes:** Semi-structured free text with upcoming runs for all kennels. Updates appear weekly via email blast. The area calendar page uses a static HTML table. Could be scraped but data quality is lower than the Google Calendar. Also references brownbearsw.com/freecal/hashcal.

### BrownBear Calendar (TERTIARY)

- **URL:** https://www.brownbearsw.com/freecal/hashcal
- **Source Type:** Third-party hosted calendar (not Google Calendar — proprietary BrownBear software)
- **Notes:** Currently very sparse (only showing Thirstday H3 entries for Feb 2026). Appears under-maintained compared to the Google Calendar. Lower priority.

---

## Per-Kennel Detail

---

### **CH3** — Chicago Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Weekly — Sundays at 2:00 PM (winter/fall), Mondays at 7:00 PM (summer). They also have numerous special event hashes on various days.
- **Website:** https://chicagohash.org/
- **Facebook:** https://www.facebook.com/groups/10638781851/
- **Aliases:** CH3, Chicago Hash, Chicago H3
- **Approximate size:** 10-15 regulars, up to 30 in summer (per hhhinchicago.com)
- **Founded:** June 19, 1978 (oldest kennel in Chicago)
- **Run count:** ~2580+ as of Feb 2026

**Source Assessment:**

- **Source A (Website):** chicagohash.org is a WordPress blog. Individual runs are blog posts with structured content: run number in the title (e.g., "CH3 #2580"), date, venue name + address, hare(s), hash cash, transit info, event name, shag wagon availability. Posts are in reverse chronological order on the homepage. Static HTML (WordPress-rendered, no JS required). The hareline page (https://chicagohash.org/hare-line/) and run history page (https://chicagohash.org/hare-line/hash-run-history/) provide additional structured data.
- **Source B (Google Calendar):** Covered by the Chicagoland aggregator calendar above.
- **Source E (Facebook):** Facebook group exists but is supplementary to the website.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** HTML_SCRAPER on chicagohash.org (WordPress blog posts — rich field extraction: date, run#, venue, hares, hash cash)
**Notes:** CH3 is the anchor kennel. Their website is the most data-rich individual source in the region. The WordPress post structure is consistent and scrapable. They also link to the Chicagoland Google Calendar. The GM at one point requested hhhinchicago.com not list them, so there may be some political sensitivity around aggregation — the Google Calendar (maintained by a CH3 member) is likely the politically safest route.

---

### **TH3** — Thirstday Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Weekly — Every Thursday, 7:00 PM meet, 7:30 PM on-out
- **Website:** https://chicagoth3.com/
- **Facebook:** (linked from chicagoth3.com sidebar)
- **Aliases:** TH3, Thirstday H3, Thirstday Hash, Thursday Hash
- **Approximate size:** Not listed; well-established weekly kennel
- **Founded:** 2003

**Source Assessment:**

- **Source A (Website):** chicagoth3.com is a WordPress blog. Posts follow a consistent template: "TH3 #[number] – [date]" as the title, with HARE, WHERE, WHEN, HASH CASH, WALKER'S TRAIL fields in the post body. Static HTML. The "TH3 Hareline" page (https://chicagoth3.com/more-upcumming-hashes/) lists upcoming runs. The site was last updated with runs through Oct 2024 (run #1060) — may be less actively updated than CH3's site. The Google Calendar is likely more current.
- **Source B (Google Calendar):** Covered by Chicagoland aggregator.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** HTML_SCRAPER on chicagoth3.com (WordPress blog — same pattern as CH3 but appears less actively maintained)
**Notes:** Second most active kennel (weekly). Website update lag is a concern — last blog posts are from Sept 2024 despite the kennel being active. The Google Calendar is the more reliable real-time source.

---

### **CFMH3** — Chicago Full Moon Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Monthly — Evenings near the full moon (day of week varies). Founded 1987.
- **Website:** https://www.hhhinchicago.com/ (shared site with Bushman H3)
- **Facebook:** https://www.facebook.com/groups/570636943051356/ (shared group with First Crack)
- **Aliases:** CFMH3, Chicago Full Moon H3, Full Moon Hash, Moon Hash

**Source Assessment:**

- **Source A (Website):** hhhinchicago.com is a Yola-hosted site with semi-structured text. The receding hareline page lists upcoming runs for all Chicago kennels in free-text format. Not easily machine-parseable.
- **Source B (Google Calendar):** Covered by Chicagoland aggregator.
- **Source E (Facebook):** Primary communication channel. The Facebook group is shared with First Crack of the Moon H3.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** MANUAL / Facebook
**Notes:** Moon hashes run on variable days (depending on lunar cycle), making calendar data essential. The hhhinchicago.com site is the de facto aggregator for the community but its free-text format is hard to parse programmatically.

---

### **FCMH3** — First Crack of the Moon Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Monthly — Evenings near the new moon (day of week varies)
- **Website:** None (shares hhhinchicago.com with CFMH3/Bushman)
- **Facebook:** https://www.facebook.com/groups/570636943051356/ (shared with CFMH3)
- **Aliases:** FCMH3, First Crack H3, First Crack of the Moon

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** MANUAL / Facebook
**Notes:** Sister kennel to CFMH3. Same Facebook group. Runs on new moon rather than full moon. Variable day schedule.

---

### **BDH3** — Big Dogs Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Monthly — 2nd Saturday, afternoon
- **Website:** None
- **Facebook:** https://www.facebook.com/groups/137255643022023/
- **Aliases:** BDH3, Big Dogs H3, Big Dogs Hash

**Source Assessment:**

- **Source E (Facebook):** Facebook group is the only listed source. Events posted there.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** MANUAL / Facebook-only
**Notes:** Off-the-beaten-path trails, may be city or suburbs. Facebook-only means no direct automated scraping possible for a secondary source.

---

### **BMH3** — Bushman Hash House Harriers

- **Region:** Chicago, IL (trails in Cook County Forest Preserves)
- **Country:** USA
- **Schedule:** Monthly — 3rd Saturday, afternoon
- **Website:** https://www.hhhinchicago.com/ (shared with CFMH3)
- **Facebook:** (not separately listed; uses hhhinchicago.com)
- **Aliases:** BMH3, Bushman H3, Bushman Hash, "The Greatest Hash"

**Source Assessment:**

- **Source A (Website):** hhhinchicago.com (shared site — see CFMH3 notes above).
- **Source B (Google Calendar):** Covered by Chicagoland aggregator.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** hhhinchicago.com (semi-structured text)
**Notes:** All-woods trails in forest preserves. Bushman and Full Moon/First Crack share the hhhinchicago.com infrastructure.

---

### **2CH3** — Second City Hash House Harriers

- **Region:** Chicago, IL (trails typically further from city center)
- **Country:** USA
- **Schedule:** Irregular / as-desired basis (no fixed schedule)
- **Website:** None (had a blog at blog.secondcityh3.org but current status unclear)
- **Facebook:** https://www.facebook.com/groups/secondcityhhh
- **Aliases:** 2CH3, Second City H3, Second City Hash

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** MANUAL / Facebook-only
**Notes:** Runs on an as-desired basis — not a fixed schedule. Watch Facebook group for announcements. May be less active than other kennels.

---

### **WWH3** — Whiskey Wednesday Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Monthly — Last Wednesday evening, 7:00 PM
- **Website:** http://www.whiskeywednesdayhash.org/
- **Facebook:** https://www.facebook.com/groups/wwwhhh
- **Aliases:** WWH3, Whiskey Wednesday H3, Whiskey Wednesday Hash, WWW H3

**Source Assessment:**

- **Source A (Website):** whiskeywednesdayhash.org exists and has FAQ and other-hashes pages. Need to verify if it has an active hareline/event listing page.
- **Source B (Google Calendar):** Covered by Chicagoland aggregator.
- **Source E (Facebook):** Facebook group available.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** Facebook / website (if event listings exist)
**Notes:** Free to runners (no hash cash). Features whiskey in addition to beer. Monthly cadence means fewer events to track.

---

### **4X2H4** — 4x2 Hash House Harriers and Harriettes

- **Region:** Chicago, IL (always within 2400 N, 2400 W, 2400 S boundaries)
- **Country:** USA
- **Schedule:** Monthly — 1st Tuesday, 6:30 PM meet, 7:00 PM on-out
- **Website:** https://www.4x2h4.org/
- **Facebook:** https://www.facebook.com/groups/833761823403207
- **Aliases:** 4X2H4, 4x2 H4, Four by Two H4

**Source Assessment:**

- **Source A (Website):** 4x2h4.org is a Wix/Squarespace-style site with a "Future Runs" page (https://www.4x2h4.org/futureruns) and "Past Runs" page. Data fields: run number, hare, location. Likely JS-rendered (modern framework).
- **Source B (Google Calendar):** Covered by Chicagoland aggregator.

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** Website (if scrapable — may need browser rendering)
**Notes:** $2 hash cash (cheapest in Chicago). 4 miles, 2 beers, brief circle. Good beginner kennel. The "H4" designation (instead of H3) is intentional — denotes a slightly different format.

---

### **RTH3** — Ragtime Hash House Harriers

- **Region:** Chicago, IL
- **Country:** USA
- **Schedule:** Various Saturdays, late morning (brunch hash)
- **Website:** None
- **Facebook:** https://www.facebook.com/groups/213336255431069/
- **Aliases:** RTH3, Ragtime H3, Ragtime Hash

**Best Source:** GOOGLE_CALENDAR (via Chicagoland aggregator)
**Secondary Source:** MANUAL / Facebook-only
**Notes:** Brunch hash — attendees bring appetites and champagne. No fixed schedule (various Saturdays). Facebook-only for direct sourcing.

---

### **DLH3** — Duneland Hash House Harriers

- **Region:** South Shore, IN (NW Indiana — Chicago suburb/exurb)
- **Country:** USA
- **Schedule:** Not clearly listed; appears irregular
- **Website:** None
- **Facebook:** https://www.facebook.com/groups/SouthShoreHHH/
- **Aliases:** DLH3, Duneland H3, South Shore HHH

**Best Source:** GOOGLE_CALENDAR (if included in Chicagoland aggregator — needs verification)
**Secondary Source:** MANUAL / Facebook-only
**Notes:** Listed as a Chicagoland kennel by both chicagohash.org and chicagoth3.com, despite being in Indiana. Borderline for Chicago-area scope. May or may not be included in the Chicagoland Google Calendar — needs verification.

---

## Kennel Abbreviation Reference (from community sources)

The 4x2h4.org "Other Hashes" page and whiskeywednesdayhash.org both confirm these canonical abbreviations:

| Short Name | Full Name |
|---|---|
| CH3 | Chicago Hash House Harriers |
| TH3 | Thirstday Hash House Harriers |
| CFMH3 | Chicago Full Moon Hash House Harriers |
| FCMH3 | First Crack of the Moon Hash House Harriers |
| BDH3 | Big Dogs Hash House Harriers |
| BMH3 | Bushman Hash House Harriers |
| 2CH3 | Second City Hash House Harriers |
| WWH3 | Whiskey Wednesday Hash House Harriers |
| 4X2H4 | 4x2 Hash House Harriers and Harriettes |
| RTH3 | Ragtime Hash House Harriers |
| DLH3 | Duneland Hash House Harriers |

---

## Seed Data Block

```typescript
// ============================================================
// Kennels to add to prisma/seed.ts
// ============================================================
const newKennels = [
  {
    shortName: "CH3",
    fullName: "Chicago Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: "https://chicagohash.org/",
    description: "Chicago's original kennel (est. 1978). Weekly Sunday afternoon runs (winter) / Monday evening runs (summer) through city streets, alleys, parks, and forest preserves.",
  },
  {
    shortName: "TH3",
    fullName: "Thirstday Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: "https://chicagoth3.com/",
    description: "Weekly Thursday evening hash. 7PM meet, 7:30 on-out. Urban trails accessible via public transit. 'The Best Reason to Call in Sick on Fridays.'",
  },
  {
    shortName: "CFMH3",
    fullName: "Chicago Full Moon Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: "https://www.hhhinchicago.com/",
    description: "Monthly hash near the full moon (est. 1987). Day of week varies with the lunar cycle. Intimate group, laid-back circle, mostly North Side Chicago.",
  },
  {
    shortName: "FCMH3",
    fullName: "First Crack of the Moon Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: null,
    description: "Monthly hash near the new moon. Sister kennel to Chicago Full Moon H3. Day of week varies with the lunar cycle.",
  },
  {
    shortName: "BDH3",
    fullName: "Big Dogs Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: null,
    description: "Monthly 2nd Saturday afternoon hash. Off-the-beaten-path trails in city or suburbs.",
  },
  {
    shortName: "BMH3",
    fullName: "Bushman Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: "https://www.hhhinchicago.com/",
    description: "Monthly 3rd Saturday afternoon hash. All-woods trails in Cook County Forest Preserves. Claims to be 'The Greatest Hash.' Bring high socks.",
  },
  {
    shortName: "2CH3",
    fullName: "Second City Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: null,
    description: "Runs on an as-desired basis (no fixed schedule). Trails typically further from city center, requiring a short drive or train ride.",
  },
  {
    shortName: "WWH3",
    fullName: "Whiskey Wednesday Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: "http://www.whiskeywednesdayhash.org/",
    description: "Monthly last Wednesday evening hash. Features whiskey in addition to beer. Trails within Chicago city limits. Free to runners.",
  },
  {
    shortName: "4X2H4",
    fullName: "4x2 Hash House Harriers and Harriettes",
    region: "Chicago, IL",
    country: "USA",
    website: "https://www.4x2h4.org/",
    description: "Monthly 1st Tuesday evening hash. $2 hash cash, ~4 mile trail, 2 beers, brief circle. Always starts within 2400 N, 2400 W, 2400 S boundaries.",
  },
  {
    shortName: "RTH3",
    fullName: "Ragtime Hash House Harriers",
    region: "Chicago, IL",
    country: "USA",
    website: null,
    description: "Brunch hash on various Saturdays, late morning. Bring your appetite and champagne.",
  },
  {
    shortName: "DLH3",
    fullName: "Duneland Hash House Harriers",
    region: "South Shore, IN",
    country: "USA",
    website: null,
    description: "NW Indiana hash considered part of the Chicagoland hashing community. Irregular schedule.",
  },
];

// ============================================================
// Aliases to add
// ============================================================
const newAliases: Record<string, string[]> = {
  CH3: ["Chicago Hash", "Chicago H3", "Chicago HHH", "CH3"],
  TH3: ["Thirstday Hash", "Thirstday H3", "Thursday Hash", "TH3"],
  CFMH3: ["Chicago Full Moon Hash", "Chicago Full Moon H3", "Full Moon Hash", "CFMH3"],
  FCMH3: ["First Crack of the Moon", "First Crack H3", "FCMH3", "New Moon Hash"],
  BDH3: ["Big Dogs Hash", "Big Dogs H3", "BDH3"],
  BMH3: ["Bushman Hash", "Bushman H3", "BMH3", "The Greatest Hash"],
  "2CH3": ["Second City Hash", "Second City H3", "2CH3"],
  WWH3: ["Whiskey Wednesday Hash", "Whiskey Wednesday H3", "WWH3", "WWW H3"],
  "4X2H4": ["4x2 Hash", "4x2 H4", "Four by Two", "4X2H4"],
  RTH3: ["Ragtime Hash", "Ragtime H3", "RTH3", "Brunch Hash"],
  DLH3: ["Duneland Hash", "Duneland H3", "South Shore HHH", "DLH3"],
};

// ============================================================
// Sources to add
// ============================================================
const newSources = [
  // ── PRIMARY: Chicagoland Google Calendar Aggregator ──
  {
    name: "Chicagoland Hash Calendar",
    url: "30c33n8c8s46icrd334mm5p3vc@group.calendar.google.com",
    type: "GOOGLE_CALENDAR",
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      calendarId: "30c33n8c8s46icrd334mm5p3vc@group.calendar.google.com",
      timeZone: "America/Chicago",
      // TODO: Inspect actual calendar events to determine title patterns
      // Expected patterns based on kennel naming conventions:
      kennelPatterns: {
        CH3: ["CH3", "Chicago H3", "Chicago Hash"],
        TH3: ["TH3", "Thirstday"],
        CFMH3: ["CFMH3", "Full Moon", "CFM"],
        FCMH3: ["FCMH3", "First Crack", "FCM"],
        BDH3: ["BDH3", "Big Dogs"],
        BMH3: ["BMH3", "Bushman"],
        "2CH3": ["2CH3", "Second City"],
        WWH3: ["WWH3", "Whiskey Wed"],
        "4X2H4": ["4X2", "4x2"],
        RTH3: ["RTH3", "Ragtime"],
        DLH3: ["DLH3", "Duneland"],
      },
      defaultKennelTag: "CH3", // Fallback if no pattern matches
    },
    kennelShortNames: [
      "CH3",
      "TH3",
      "CFMH3",
      "FCMH3",
      "BDH3",
      "BMH3",
      "2CH3",
      "WWH3",
      "4X2H4",
      "RTH3",
      "DLH3",
    ],
  },

  // ── SECONDARY: CH3 WordPress Website ──
  {
    name: "Chicago Hash Website",
    url: "https://chicagohash.org/",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    config: {
      // WordPress blog post scraper
      // Homepage shows upcoming + past runs as blog posts
      // Each post title: "CH3 #[number]" or event name
      // Post body contains: Venue, Hare, Event, Transit, Hash Cash, Shag Wagon
      // Paginated: /page/2/, /page/3/, etc. (169+ pages of history)
      siteType: "wordpress_blog",
      listUrl: "https://chicagohash.org/",
      postSelector: "article", // Each run is an <article> element
      fields: {
        title: "h2.entry-title",
        date: ".entry-date",
        // Body content has structured fields as bold labels
        // e.g., "Venue:", "Hare:", "Hash Cash:", etc.
      },
    },
    kennelShortNames: ["CH3"],
  },

  // ── SECONDARY: TH3 WordPress Website ──
  {
    name: "Thirstday Hash Website",
    url: "https://chicagoth3.com/",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    config: {
      siteType: "wordpress_blog",
      listUrl: "https://chicagoth3.com/",
      // Post title format: "TH3 #[number] – [date]"
      // Body: HARE, WHERE, WHEN, HASH CASH, WALKER'S TRAIL
      // Note: Site appears to lag behind actual events (last posts Sep/Oct 2024)
      // Use primarily for historical data; Google Calendar for current events
    },
    kennelShortNames: ["TH3"],
  },

  // ── TERTIARY: 4x2 H4 Website ──
  {
    name: "4x2 H4 Website",
    url: "https://www.4x2h4.org/futureruns",
    type: "HTML_SCRAPER",
    trustLevel: 5,
    scrapeFreq: "weekly",
    config: {
      // Modern JS-rendered site (likely Wix/Squarespace)
      // May require browser rendering — verify with view-source
      // Future Runs page lists upcoming hares and locations
      requiresJsRendering: true, // Needs verification
    },
    kennelShortNames: ["4X2H4"],
  },
];
```

---

## Onboarding Notes & Gotchas

### Google Calendar Aggregator — Critical Next Steps

The Chicagoland Google Calendar is the clear winner for initial onboarding. Before building the adapter config:

1. **Fetch sample events** via the Google Calendar API to inspect actual event title/description formats
2. **Map kennel patterns** — the `kennelPatterns` config above is estimated based on community naming conventions. Actual calendar entries may use different prefixes.
3. **Check if Duneland H3 is included** — it's an Indiana kennel and may not appear in the calendar
4. **Check for special events** — CH3 runs multi-day events (Anthrax, Memorial Day, Power of the Pussy) that may have different title patterns

### CH3 Schedule Complexity

CH3 has a **seasonal schedule flip:**
- **Winter/Fall:** Sundays at 2:00 PM
- **Summer:** Mondays at 7:00 PM

The Google Calendar will reflect this naturally, but any hareline scraper needs to account for it.

### Moon Hash Scheduling

CFMH3 and FCMH3 run on **variable days** dictated by the lunar cycle. There is no fixed day-of-week. The Google Calendar is essential for these kennels since you can't predict their schedule from a pattern.

### Political Sensitivity

The CH3 GM apparently requested at some point that hhhinchicago.com not list CH3 runs. The Chicagoland Google Calendar is maintained by "Snatchsquatch," who appears to be a well-connected member of both CH3 and TH3 — this source is likely politically neutral/accepted.

### Facebook-Only Kennels

Five kennels (Big Dogs, Second City, Ragtime, Duneland, and partially First Crack) are **Facebook-only** for direct event data. The Google Calendar aggregator is the only automated path to their data. If a kennel's events don't appear in the Google Calendar, they'll need manual submission or user-contributed events.

### Whiskey Wednesday — No Hash Cash

WWH3 is free to runners (no hash cash). This is unusual and may be worth noting in event descriptions.

### 4x2 H4 Naming

Note the "H4" designation — this kennel intentionally uses H4 instead of H3. Ensure the data model accommodates this variant.

---

## Nearby Non-Chicago Illinois Kennels (Future Expansion)

These are **not** Chicagoland kennels but are listed on chicagohash.org as Illinois hashes. All are Facebook-only:

| Kennel | Region | Facebook |
|---|---|---|
| Bell-Scott H3 | St. Louis metro (IL side) | fb.com/groups/169448849862103/ |
| Peoria H3 | Peoria, IL | fb.com/groups/PeoriaH3 |
| Quad Cities H3 | Quad Cities, IL/IA | fb.com/groups/413296825594/ |
| Springfield H3 | Springfield, IL | fb.com/groups/430452360445600/ |
| Urbana-Champaign H3 | Champaign, IL | www.fuch3.com |

Of these, **Urbana-Champaign H3** (fuch3.com) has a real website with schedule info (Saturdays 4PM summer / 2PM winter, plus Thursday full moon hashes). Could be a future onboarding candidate.
