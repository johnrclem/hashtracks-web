# HashTracks Kennel Research: Washington DC / DMV (DC, Maryland, Virginia)

**Research Date:** February 17, 2026  
**Researcher:** Claude (automated web research)

---

## Regional Summary

- **Total kennels found:** 19 active kennels + 2 occasional/special-purpose groups
- **Regional aggregator(s):** dchashing.org (static schedule listing, not a calendar); DCFMH3 Google Sites (monthly full moon calendar + Tour Duh Hash schedule); HashRego.com (multiple kennels use it for event registration)
- **No single multi-kennel calendar aggregator** equivalent to hashnyc.com was found. Unlike NYC, the DC area lacks a unified Google Calendar or single-page calendar covering all kennels. Each kennel maintains its own web presence independently.

### Recommended Onboarding Order

1. **EWH3** — Google Calendar (2 calendar IDs confirmed) + WordPress scraping + HashRego
2. **SHITH3** — Google Calendar (confirmed calendar ID) + custom website scraping
3. **CCH3** — iCal feed (WordPress All-in-One Event Calendar) + Meetup
4. **W3H3** — Google Sheets hareline (confirmed public spreadsheet)
5. **DCH4** — WordPress post scraping (very active, 2299+ trails, weekly posts)
6. **WH4** — HashRego events page (primary source)
7. **OFH3** — Blogspot scraping (monthly posts, well-structured)
8. **Remaining kennels** — Facebook-only or minimal web presence (manual/community submission)

### HashRego as a Platform Source

HashRego (hashrego.com) is used by multiple DC kennels for event registration: EWH3, WH4, GFH3, DCH4, DCFMH3, and others. HashRego provides embeddable iframes and kennel-specific event listing URLs (`hashrego.com/kennels/{KENNEL}/events`). **Investigating HashRego as a source type (potential API or scraping target) could unlock many DC kennels at once.** This is analogous to the aggregator pattern—one adapter for many kennels.

---

## Per-Kennel Detail

---

### **EWH3** — Everyday is Wednesday Hash House Harriers
- Region: Washington, DC
- Schedule: Thursday, weekly, 6:45 PM (pack away 7:15 PM)
- Website: https://www.ewh3.com/
- Facebook: https://groups.google.com/forum/#!forum/ewh3 (Google Group); Discord: https://tinyurl.com/ewh3discord
- Aliases: EWH3, "Everyday is Wednesday", "Every day is Wednesday"
- Founded: December 1999
- Community Size: One of the largest DC kennels; trail #1506 as of Feb 2026

**Best Source:** GOOGLE_CALENDAR  
- Calendar IDs: `ewh3harerazor@gmail.com` (hare line / trail dates) and `ewh3brewmeister@gmail.com` (brew crew)  
- Found embedded on https://www.ewh3.com/trail-info/hare-line/  
- Embed URL: `https://calendar.google.com/calendar/u/0/embed?src=ewh3harerazor@gmail.com&src=ewh3brewmeister@gmail.com&ctz=America/New_York`  
- The harerazor calendar is the primary one for trail events

**Secondary Source:** HTML_SCRAPER (WordPress)  
- URL: https://www.ewh3.com/ (category: Trail News)  
- WordPress blog posts with structured trail info (run number, date, metro station, hares, distances, on-after)  
- Static HTML, Cheerio-compatible  
- Also links to HashRego for registration: `hashrego.com/kennels/EWH3/events`

**Notes:** Very well-organized kennel with rich data per event. Google Calendar is cleanest path. WordPress scraping would provide additional enrichment data (trail descriptions, distances, metro stations).

---

### **SHITH3** — So Happy It's Tuesday Hash House Harriers
- Region: Fairfax, VA / Northern Virginia / DC Metro
- Schedule: Tuesday, weekly, 6:30 PM (hares away 7:00 PM)
- Website: https://shith3.com/
- Facebook: https://www.facebook.com/groups/756148277731360/
- Aliases: SHITH3, SHIT H3, "S.H.I.T. H3", "So Happy It's Tuesday"
- Founded: September 2002
- Community Size: Trail #1194 as of Feb 2026

**Best Source:** GOOGLE_CALENDAR  
- Calendar ID: `jackschitt.shit@gmail.com`  
- Found linked on shith3.com: `https://www.google.com/calendar/embed?src=jackschitt.shit%40gmail.com&ctz=America/New_York`

**Secondary Source:** HTML_SCRAPER  
- URL: https://shith3.com/ (custom PHP site)  
- Shows next trail with structured fields: trail number, hare(s), location, date, time, distances, description, start address, on-after  
- JavaScript-rendered modal for trail details; may need to assess if data is in source HTML or loaded dynamically

**Notes:** Google Calendar is the cleanest path. The website's "next trail" section appears to contain dynamic data that may require browser rendering.

---

### **CCH3** — Charm City Hash House Harriers
- Region: Baltimore, MD
- Schedule: Biweekly, alternating Friday 7:00 PM and Saturday afternoons
- Website: https://charmcityh3.com/
- Facebook: https://www.facebook.com/CharmCityH3
- Meetup: https://www.meetup.com/Charm-City-Hash-House-Harriers/
- Aliases: CCH3, "Charm City Hash", "Charm City H3"

**Best Source:** ICAL_FEED  
- iCal URL: `http://charmcityh3.com/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true`  
- WordPress All-in-One Event Calendar plugin  
- Also subscribable via Google Calendar and Outlook (links on site)

**Secondary Source:** HTML_SCRAPER (WordPress calendar page)  
- URL: https://charmcityh3.com/calendar-2/  
- Shows upcoming events with dates, times, and titles

**Notes:** The iCal feed is the best structured option. Also on Meetup which could be a secondary source. Note: CCH3 is technically Baltimore, not DC proper, but is part of the DC-area hashing ecosystem per dchashing.org.

---

### **W3H3** — Wild and Wonderful Wednesday Hash House Harriers
- Region: Jefferson County, WV (Harpers Ferry area)
- Schedule: Wednesday, weekly, 6:09 PM
- Website: https://sites.google.com/view/w3h3
- Facebook: https://www.facebook.com/groups/273947756839837/
- Aliases: W3H3, "Wild and Wonderful Wednesday"
- Trail #350 as of Feb 2026

**Best Source:** GOOGLE_SHEETS  
- Hareline spreadsheet: `https://docs.google.com/spreadsheets/d/19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI/edit#gid=0`  
- Contains hare signup info; need to verify columns for date, location, hare names

**Secondary Source:** GOOGLE_SHEETS (Hash/Hare Counts)  
- `https://docs.google.com/spreadsheets/d/1yR5cjyNG4TtCfAqDNshegOy-WjC9CR7ES19IbcRiDZI/edit#gid=0`  

**Notes:** Google Sites page with trail info posted directly on home page. The Google Sheets hareline is config-driven (zero code changes needed with existing adapter). Also has a related "Moonshiners" full moon hiking hash (MsH3) and "Chicken Power Team" kids' trail.

---

### **DCH4** — DC Harriettes and Harriers Hash House
- Region: Washington, DC Metro
- Schedule: Saturday, weekly, 2:00 PM (daylight saving) / 3:00 PM (standard time)
- Website: https://dch4.org/
- Facebook: https://www.facebook.com/groups/dch4hashhouse
- Aliases: DCH4, "DC Harriettes", "Harriettes and Harriers"
- Founded: 1978 (first co-ed DC kennel)
- Community Size: Trail #2299 as of Feb 2026; very active

**Best Source:** HTML_SCRAPER (WordPress)  
- URL: https://dch4.org/ (main page) and https://dch4.org/hairline/ (receding hareline)  
- WordPress blog posts, one per trail  
- Fields per post: trail number, date, time, start location, hares, hash cash, distances, shiggy rating, dog/stroller friendly, on-after  
- Static HTML, Cheerio-compatible  
- 433 pages of trail posts (extensive history)

**Secondary Source:** HashRego events (for special events)

**Notes:** Very well-structured WordPress posts. Among the most active DC kennels. Custom scraper would have high ROI given weekly posting cadence.

---

### **WH4** — White House Hash House Harriers
- Region: Washington, DC / Northern Virginia
- Schedule: Sunday, weekly. 3:00 PM (Labor Day to Memorial Day) / 5:00 PM (Memorial Day to Labor Day)
- Website: https://whitehousehash.com/
- Aliases: WH4, "White House Hash", "White House H3"
- Founded: June 1987
- Community Size: Trail #2100+ (one of the largest DC kennels)

**Best Source:** HashRego  
- URL: https://hashrego.com/kennels/WH4/events  
- All upcoming trails are listed here  
- WH4 website links directly to HashRego for all trail info  

**Secondary Source:** HTML_SCRAPER (whitehousehash.com)  
- GoDaddy/Squarespace-style site  
- Limited structured data on main site; "Next Trail" section and Hareline page

**Notes:** WH4 is almost entirely dependent on HashRego for event data. Investigating HashRego scraping/API would unlock this kennel. The website itself has minimal event data.

---

### **BAH3** — Baltimore Annapolis Hash House Harriers
- Region: Baltimore / Annapolis, MD
- Schedule: Sunday, weekly, 3:00 PM
- Website: https://www.bah3.org/
- Aliases: BAH3, "Baltimore Annapolis Hash"
- Google Group: bah3-list (https://groups.google.com/g/bah3-list)

**Best Source:** HTML_SCRAPER (Google Sites)  
- URL: https://www.bah3.org/hare-line  
- Google Sites page; likely static HTML  
- Need to verify what structured fields are available per event

**Secondary Source:** None identified  

**Notes:** Google Sites with minimal styling. May have limited structured data. Would need to inspect hare line page directly for event listing format.

---

### **MVH3** — Mount Vernon Hash House Harriers
- Region: Washington, DC Metro
- Schedule: Saturday, weekly, 10:00 AM
- Website: http://www.dchashing.org/mvh3/
- Aliases: MVH3, "Mount Vernon Hash"
- Founded: December 1985
- Google Group: mvhhh+subscribe@googlegroups.com

**Best Source:** HTML_SCRAPER  
- URL: http://www.dchashing.org/mvh3/  
- Hosted on dchashing.org  
- Appears to show next trail info only  

**Notes:** MVH3 primarily communicates via Google Group email list and Facebook. Limited web presence. May be best served as MANUAL source with community submission until more data discovered.

---

### **OTH4** — Over the Hump Hash House Harriers
- Region: Washington, DC Metro
- Schedule: Sunday 2:00 PM (biweekly) + Wednesday 7:00 PM
- Website: https://sites.google.com/site/othhhh/ (requires Google login!)
- Facebook: https://www.facebook.com/share/g/6ZoFa1A5jD7Ukiv9/
- Aliases: OTH4, "Over the Hump"
- Founded: March 1991

**Best Source:** MANUAL (Facebook)  
- Google Sites page requires authentication — NOT publicly accessible  
- Primary communication appears to be via Facebook group

**Notes:** The Google Sites page is locked behind Google auth, making it unusable for automated scraping. Facebook-only for event data. Founded 1991, one of the older DC kennels.

---

### **OFH3** — Old Frederick Hash House Harriers
- Region: Frederick, MD
- Schedule: 2nd Saturday of each month, 10:30 AM sign-in, 11:00 AM hares away
- Website: https://www.ofh3.com/ (Blogspot)
- Aliases: OFH3, "Old Frederick Hash"
- Founded: ~2000
- Trail #396 as of Mar 2026

**Best Source:** HTML_SCRAPER (Blogspot/Blogger)  
- URL: https://www.ofh3.com/  
- One blog post per trail, monthly cadence  
- Fields: description, hares, date, time, cost, location, trail type, distances, shiggy rating, on-after  
- RSS feed available: https://www.ofh3.com/feeds/posts/default  
- Static HTML, Cheerio-compatible

**Notes:** Well-structured blog posts. RSS feed could be an alternative to HTML scraping. Monthly posting makes this low-volume but very clean data.

---

### **DCFMH3** — DC Full Moon Hash House Harriers
- Region: Washington, DC Metro
- Schedule: Monthly, Friday/Saturday (varies), on or near the full moon
- Website: https://sites.google.com/site/dcfmh3/home
- Email: dcfullmoonh3@gmail.com
- Aliases: DCFMH3, "DC Full Moon"

**Best Source:** HTML_SCRAPER (Google Sites)  
- URL: https://sites.google.com/site/dcfmh3/home/dc-kennel-calendar  
- Contains full 2026 schedule with dates, host kennels, and locations  
- Static HTML, Cheerio-compatible  

**Notes:** Monthly event, hosted by rotating DC kennels. The "DC Kennel Calendar" page also contains the "PUD JAM Matrix" and links to all DC area kennels—useful as a reference but not a structured data source. Events are also on HashRego.

---

### **SMUTTyCrab** — SMUTTy Crab Hash House Harriers
- Region: Southern Maryland
- Schedule: Every other Saturday, 1:00 PM
- Website: http://smuttycrabh3.com/
- Email: smuttycrabh3@gmail.com (or info@smuttycrabh3.com)
- Aliases: SMUTTy Crab, "SMUTT", "Southern Maryland Un-Athletic Tippling Trailblazers"
- Founded: December 2007

**Best Source:** HTML_SCRAPER  
- URL: http://smuttycrabh3.com/on-on--to-the-next-trail.html  
- GoDaddy/Weebly-style site  
- Need to verify what structured data is on the "next trail" page

**Notes:** Minimal web presence. May only show next trail info. Could be MANUAL source.

---

### **HillbillyH3** — Hillbilly Hash House Harriers
- Region: DC Metro / Maryland (trails near Point of Rocks, MD area)
- Schedule: Twice monthly, Sunday, ~12:00 PM (meet at "1169", hares away ~12:45)
- Website: https://sites.google.com/site/hillbillyh3/home
- Aliases: Hillbilly H3, "Hillbilly Hash"

**Best Source:** HTML_SCRAPER (Google Sites)  
- URL: https://sites.google.com/site/hillbillyh3/home  
- Need to verify event listing structure

**Notes:** Low-frequency (twice monthly). Google Sites page. Limited web data discovered.

---

### **DCRT** — DC Red Tent Harriettes
- Region: Washington, DC
- Schedule: Monthly, Sunday, 10:00 AM
- Website: https://sites.google.com/site/dcredtent/ (ladies only)
- Facebook: https://m.facebook.com/groups/636027323156298/
- Aliases: DC Red Tent, DCRT, "Red Tent H3"

**Best Source:** MANUAL (Facebook)  
- Google Sites page exists but may have limited event data  
- Primary communication via Facebook group

**Notes:** Ladies-only kennel. Monthly. Low priority for automated scraping.

---

### **H4** — Hangover Hash House Harriers
- Region: Washington, DC Metro
- Schedule: Monthly, Sunday, 10:00 AM (hares away 10:00, pack away 10:15)
- Website: https://hangoverhash.com/ and https://hangoverhash.digitalpress.blog/
- Aliases: H4, "Hangover Hash", "Hangover H3"
- Founded: ~2012
- Trail #209+ as of Oct 2025

**Best Source:** HTML_SCRAPER  
- URL: https://hangoverhash.digitalpress.blog/ (DigitalPress blog)  
- Trail posts with structured info (trail number, date, hash cash, distances, hares, location, on-after)  
- Each trail has its own page (e.g., /209/, /205/)

**Notes:** Monthly cadence. Blog posts are well-structured. May also be on HashRego for special events.

---

### **FUH3** — Fredericksburg Urban Hash House Harriers
- Region: Fredericksburg, VA
- Schedule: Every other Saturday, 3:00 PM
- Website: https://fuh3.net/
- Meetup: https://www.meetup.com/meetup-group-xxcniptw/ (NOTE: this Meetup URL actually points to cHARLOTtesville H3; FUH3's own Meetup may differ)
- Aliases: FUH3, "Fredericksburg Urban Hash", "FXBG H3"

**Best Source:** HTML_SCRAPER  
- URL: https://fuh3.net/  
- Weebly-style site  
- Need to verify event listing structure

**Notes:** On the fringe of the DC metro area (Fredericksburg is ~50 miles south). Biweekly, every other Saturday. Part of the Tour Duh Hash rotation.

---

### **GFH3** — Great Falls Hash House Harriers
- Region: Great Falls / Herndon, VA
- Schedule: Wednesday 7:00 PM (Spring/Summer), Saturday 3:00 PM (Fall/Winter)
- Website: http://www.gfh3.org/ (may be down/unreliable)
- HashRego: https://hashrego.com/kennels/GFH3/events
- Aliases: GFH3, "Great Falls Hash"
- Founded: May 1982

**Best Source:** HashRego  
- URL: https://hashrego.com/kennels/GFH3/events  
- GFH3's website appears to be unreliable; HashRego is primary event source

**Notes:** One of the older DC kennels (1400+ runs). Website gfh3.org may be down. HashRego is the most reliable source.

---

### **DCH3** — DC Hash House Harriers (Men's Hash)
- Region: Washington, DC
- Schedule: Monday 7:00 PM (Summer), Saturday 3:00 PM
- Website: None (email only: singletonwilliam832@gmail.com / lorense.knowland@gmail.com)
- Aliases: DCH3, "DC Hash", "the Men's Hash"
- Founded: 1972/1973 (the ORIGINAL DC kennel)

**Best Source:** MANUAL  
- No website, no calendar, email-only contact  
- The oldest DC kennel but operates informally

**Notes:** Men-only. The original DC Hash (founded by Tumblin' Bill Panton). No automated data source possible. Would require manual event submission or community sourcing.

---

### Peripheral/Occasional Kennels

**Teddy's Ruff Riders Hares and Hounds**
- Schedule: Quarterly, various days
- Facebook: https://www.facebook.com/teddysroughriders/
- Notes: Rated G, family/kids-friendly. Quarterly only. MANUAL source.

**DC Powder/Pedal/Paddle Hounds (DCPH4)**
- Facebook: https://www.facebook.com/groups/DCPH4/
- Notes: Multi-sport hash (skiing, biking, paddling). Various schedule. MANUAL source.

---

## Regional Aggregator Check

| Source | URL | Type | Value |
|--------|-----|------|-------|
| dchashing.org | http://www.dchashing.org/ | Static HTML listing | LOW — schedule/links only, no dated events |
| DCFMH3 Calendar | https://sites.google.com/site/dcfmh3/home/dc-kennel-calendar | Google Sites HTML | MEDIUM — annual full moon schedule + PUD JAM matrix |
| Tour Duh Hash | https://sites.google.com/site/dcfmh3/home/dc-tour-duh-hash | Google Sites HTML | MEDIUM — annual multi-kennel event (9 days, all kennels) |
| HashRego | hashrego.com/kennels/{KENNEL}/events | Web platform | HIGH — multiple DC kennels use it; potential unified adapter |
| gotothehash.net | http://gotothehash.net | International directory | LOW — directory, not event calendar |
| half-mind.com | http://half-mind.com/regionalwebsite/p_list1.php?state=DC | Directory | LOW — 9 DC kennels listed, contact info only |

**Key Finding:** HashRego is the de facto aggregator for DC-area hash events. Kennels confirmed on HashRego: EWH3, WH4, GFH3, DCH4, DCFMH3. Building a HashRego adapter (HTML scraper or potential API) would be the highest-leverage investment for the DC region.

---

## Seed Data Block

```typescript
// Kennels to add to prisma/seed.ts
const newKennels = [
  {
    shortName: "EWH3",
    fullName: "Everyday is Wednesday Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "https://www.ewh3.com/",
    description: "Weekly Thursday evening hash in DC. One of the largest and most active DC kennels.",
  },
  {
    shortName: "SHITH3",
    fullName: "So Happy It's Tuesday Hash House Harriers",
    region: "Fairfax, VA",
    country: "USA",
    website: "https://shith3.com/",
    description: "Weekly Tuesday evening hash in the Northern Virginia / DC Metro area. All live trails.",
  },
  {
    shortName: "DCH4",
    fullName: "DC Harriettes and Harriers Hash House",
    region: "Washington, DC",
    country: "USA",
    website: "https://dch4.org/",
    description: "Weekly Saturday afternoon hash. First co-ed kennel in DC, founded 1978.",
  },
  {
    shortName: "WH4",
    fullName: "White House Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "https://whitehousehash.com/",
    description: "Weekly Sunday hash in the DC/NoVA area. Founded June 1987.",
  },
  {
    shortName: "BAH3",
    fullName: "Baltimore Annapolis Hash House Harriers",
    region: "Baltimore, MD",
    country: "USA",
    website: "https://www.bah3.org/",
    description: "Weekly Sunday 3PM hash in the Baltimore/Annapolis area.",
  },
  {
    shortName: "CCH3",
    fullName: "Charm City Hash House Harriers",
    region: "Baltimore, MD",
    country: "USA",
    website: "https://charmcityh3.com/",
    description: "Biweekly hash in Baltimore city, alternating Fridays and Saturdays.",
  },
  {
    shortName: "MVH3",
    fullName: "Mount Vernon Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "http://www.dchashing.org/mvh3/",
    description: "Weekly Saturday 10AM hash in the DC metro area. Founded December 1985.",
  },
  {
    shortName: "OTH4",
    fullName: "Over the Hump Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: null,
    description: "Biweekly Sunday 2PM and Wednesday 7PM hashes. Founded March 1991.",
  },
  {
    shortName: "GFH3",
    fullName: "Great Falls Hash House Harriers",
    region: "Great Falls, VA",
    country: "USA",
    website: "http://www.gfh3.org/",
    description: "Seasonal schedule: Wednesday evenings (spring/summer), Saturday afternoons (fall/winter). Founded May 1982.",
  },
  {
    shortName: "OFH3",
    fullName: "Old Frederick Hash House Harriers",
    region: "Frederick, MD",
    country: "USA",
    website: "https://www.ofh3.com/",
    description: "Monthly hash on the 2nd Saturday in western Maryland. Founded ~2000.",
  },
  {
    shortName: "DCFMH3",
    fullName: "DC Full Moon Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "https://sites.google.com/site/dcfmh3/home",
    description: "Monthly Friday/Saturday evening hash on or near the full moon. Hosted by rotating DC kennels.",
  },
  {
    shortName: "SMUTTyCrab",
    fullName: "SMUTTy Crab Hash House Harriers",
    region: "Southern Maryland",
    country: "USA",
    website: "http://smuttycrabh3.com/",
    description: "Biweekly Saturday 1PM hash in Southern Maryland. Founded December 2007.",
  },
  {
    shortName: "HillbillyH3",
    fullName: "Hillbilly Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "https://sites.google.com/site/hillbillyh3/home",
    description: "Twice-monthly Sunday hash in the DC metro / western Maryland area.",
  },
  {
    shortName: "DCRT",
    fullName: "DC Red Tent Harriettes",
    region: "Washington, DC",
    country: "USA",
    website: "https://sites.google.com/site/dcredtent/",
    description: "Monthly Sunday 10AM ladies-only hash.",
  },
  {
    shortName: "H4",
    fullName: "Hangover Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: "https://hangoverhash.com/",
    description: "Monthly Sunday 10AM hash. Hashing the PUDJAM area since 2012.",
  },
  {
    shortName: "FUH3",
    fullName: "Fredericksburg Urban Hash House Harriers",
    region: "Fredericksburg, VA",
    country: "USA",
    website: "https://fuh3.net/",
    description: "Biweekly Saturday 3PM hash in Fredericksburg, VA.",
  },
  {
    shortName: "W3H3",
    fullName: "Wild and Wonderful Wednesday Hash House Harriers",
    region: "Harpers Ferry, WV",
    country: "USA",
    website: "https://sites.google.com/view/w3h3",
    description: "Weekly Wednesday 6:09PM hash in Jefferson County, West Virginia.",
  },
  {
    shortName: "DCH3",
    fullName: "DC Hash House Harriers",
    region: "Washington, DC",
    country: "USA",
    website: null,
    description: "The original DC kennel (founded 1972). Men only. Monday evenings (summer) and Saturday afternoons.",
  },
];

// Aliases to add
const newAliases: Record<string, string[]> = {
  "EWH3": ["Everyday is Wednesday", "Every day is Wednesday", "EWH3"],
  "SHITH3": ["SHIT H3", "S.H.I.T. H3", "So Happy It's Tuesday", "SHITH3"],
  "DCH4": ["DC Harriettes", "DC Harriettes and Harriers", "Harriettes and Harriers", "DCH4"],
  "WH4": ["White House Hash", "White House H3", "White House", "WH4"],
  "BAH3": ["Baltimore Annapolis Hash", "Baltimore Annapolis", "BAH3"],
  "CCH3": ["Charm City Hash", "Charm City H3", "Charm City", "CCH3"],
  "MVH3": ["Mount Vernon Hash", "Mount Vernon", "MVH3"],
  "OTH4": ["Over the Hump", "OTH4"],
  "GFH3": ["Great Falls Hash", "Great Falls", "GFH3"],
  "OFH3": ["Old Frederick Hash", "Old Frederick", "OFH3"],
  "DCFMH3": ["DC Full Moon", "DC Full Moon Hash", "DCFMH3"],
  "SMUTTyCrab": ["SMUTTy Crab", "SMUTT", "Smutty Crab H3"],
  "HillbillyH3": ["Hillbilly Hash", "Hillbilly H3"],
  "DCRT": ["DC Red Tent", "Red Tent H3", "Red Tent Harriettes"],
  "H4": ["Hangover Hash", "Hangover H3", "Hangover"],
  "FUH3": ["Fredericksburg Urban Hash", "FXBG H3", "FUH3"],
  "W3H3": ["Wild and Wonderful Wednesday", "W3H3"],
  "DCH3": ["DC Hash", "DC Hash House Harriers", "the Men's Hash", "DCH3"],
};

// Sources to add
const newSources = [
  // === GOOGLE CALENDAR SOURCES ===
  {
    name: "EWH3 Harerazor Calendar",
    url: "ewh3harerazor@gmail.com",
    type: "GOOGLE_CALENDAR",
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      defaultKennelTag: "EWH3",
    },
    kennelShortNames: ["EWH3"],
  },
  {
    name: "SHIT H3 Calendar",
    url: "jackschitt.shit@gmail.com",
    type: "GOOGLE_CALENDAR",
    trustLevel: 7,
    scrapeFreq: "daily",
    config: {
      defaultKennelTag: "SHITH3",
    },
    kennelShortNames: ["SHITH3"],
  },

  // === GOOGLE SHEETS SOURCES ===
  {
    name: "W3H3 Hareline Spreadsheet",
    url: "https://docs.google.com/spreadsheets/d/19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI/edit#gid=0",
    type: "GOOGLE_SHEETS",
    trustLevel: 6,
    scrapeFreq: "daily",
    config: {
      // Column mapping TBD — need to inspect spreadsheet columns
      sheetId: "19mNka1u64ZNOHS7z_EoqRIrAOdqg5HkY9Uk8u6LwAsI",
    },
    kennelShortNames: ["W3H3"],
  },

  // === ICAL SOURCES ===
  {
    name: "Charm City H3 iCal Feed",
    url: "http://charmcityh3.com/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true",
    type: "ICAL",
    trustLevel: 7,
    scrapeFreq: "daily",
    config: {
      defaultKennelTag: "CCH3",
    },
    kennelShortNames: ["CCH3"],
  },

  // === HTML SCRAPER SOURCES ===
  {
    name: "EWH3 WordPress Trail News",
    url: "https://www.ewh3.com/",
    type: "HTML_SCRAPER",
    trustLevel: 8,
    scrapeFreq: "daily",
    config: {
      adapter: "ewh3-wordpress",
      // WordPress blog posts, Trail News category
      // Structured fields: run number, date, metro, hares, distances
    },
    kennelShortNames: ["EWH3"],
  },
  {
    name: "DCH4 WordPress Trail Posts",
    url: "https://dch4.org/",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    config: {
      adapter: "dch4-wordpress",
      // WordPress blog posts, Trail Info category
      // Structured fields: trail number, date, time, location, hares, distances
    },
    kennelShortNames: ["DCH4"],
  },
  {
    name: "OFH3 Blogspot Trail Posts",
    url: "https://www.ofh3.com/",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    config: {
      adapter: "ofh3-blogspot",
      // Blogspot posts, one per trail, monthly
      // Structured fields: description, hares, date, time, cost, location, distances
      rssFeed: "https://www.ofh3.com/feeds/posts/default",
    },
    kennelShortNames: ["OFH3"],
  },
  {
    name: "Hangover H3 DigitalPress Blog",
    url: "https://hangoverhash.digitalpress.blog/",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    config: {
      adapter: "hangover-digitalpress",
      // Blog posts, one per trail, monthly
    },
    kennelShortNames: ["H4"],
  },

  // === MANUAL / FACEBOOK-ONLY SOURCES ===
  // DCH3 — No web presence (email only)
  // OTH4 — Google Sites requires auth; Facebook only
  // DCRT — Facebook group primary
  // MVH3 — Google Group email list primary
  // SMUTTyCrab — Minimal website
  // HillbillyH3 — Google Sites, limited data
  // GFH3 — Website unreliable; HashRego primary
  // FUH3 — Weebly site; limited data
];
```

---

## Appendix: HashRego Investigation Notes

HashRego (hashrego.com) appears to be the most promising "hidden aggregator" for the DC region. Multiple kennels use it for event registration and embed its iframes on their own websites.

**Known DC kennel pages on HashRego:**
- `hashrego.com/kennels/EWH3/events`
- `hashrego.com/kennels/WH4/events`
- `hashrego.com/kennels/GFH3/events`
- `hashrego.com/kennels/DCH4/events` (special events)
- `hashrego.com/kennels/DCFMH3/events` (full moon events)

**Technical observations:**
- Each event has a unique slug (e.g., `hashrego.com/events/ewh3-1506-...`)
- Event listing iframes are available: `hashrego.com/kennels/{KENNEL}/eventlistiframe`
- Events include: date, time, location, description, registration list, hares
- No public API documented, but the iframe/embed pattern suggests structured data behind it

**Recommendation:** Investigate HashRego as a potential HTML_SCRAPER source type. A single adapter scraping `hashrego.com/kennels/{KENNEL}/events` pages could serve 5+ DC kennels. This could be expanded nationally as HashRego is used by kennels across the US.

---

## Appendix: Key Contacts & Community Resources

- **dchashing.org webmaster:** HardDrive — Mr.harddrive@gmail.com (NJ-based, founded site in '94)
- **PUD JAM hotline:** 202-PUD-JAM-0 (202-783-5260) — recorded hash schedule info
- **Tour Duh Hash:** Annual 9-day event visiting every DC kennel (June 2026: June 6-14)
- **DC Red Dress Run:** Annual charity event (separate from regular kennel hashing)
