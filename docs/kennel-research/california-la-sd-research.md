# California LA / San Diego / OC — Research Findings

Research conducted 2026-03-20 via Chrome-assisted workflow. Ready for implementation.

## Regions to Add
- **California** STATE_PROVINCE (already added in this session)
- **Los Angeles, CA** METRO
- **Long Beach, CA** METRO
- **San Diego, CA** METRO (already exists as region)
- **Orange County, CA** METRO
- **San Luis Obispo, CA** METRO
- **Carlsbad, CA** METRO (for North County H3)

## Data Sources Identified

### Tier 1: Meetup (zero code)
- **SoCal Meetup**: `los-angeles-hash-house-harriers` (groupUrlname)
  - Covers: LAH3 (Sat 2pm) + LBH3 (Sun 10am winter / Thu 6:30pm summer)
  - $5 hash cash, 176 members, active with 2026 events
  - Note: This Meetup covers BOTH LAH3 and LBH3 — need `kennelPatterns` config

### Tier 1: HTML Scraper (new adapter needed)
- **sdh3.com/hareline.shtml** — Multi-kennel San Diego aggregator
  - Covers: SDH3, CLH3, NCH3, LJH3, Iron Rule, Humpin', Full Moon, Half-Assed, Mission Harriettes, Intergalactic, Temecula, others
  - HTML structure: `<dt class="hashEvent [KENNEL_CODE]">` elements
  - Rich data: date/time, hares, full address, map link, run fee, trail type, dog friendly, notes
  - Kennel filter links at top with kennel codes: SDH3, CLH3, NCH3, LJH3, IRH3, H4, FMH3, HAH3, MH4, DRH3, GFH3, HOTD, IGH3, PUH3, Pub, SFH3 (Stumblefoot), TH3 (Temecula), VBH3
  - Each event has: `<strong>Kennel Name</strong>`, `<span>date time</span>`, structured fields with `<strong>label:</strong>` pattern
  - **This is the highest-value new adapter** — one scraper covers 15+ SD kennels

### Tier 1: Google Calendar
- **CLH3 Calendar**: `412vhpm085a3qbe5sl14lujj48@group.calendar.google.com`
  - Note: Returned 0 events when queried — may need different time range or may be secondary to hareline

### Tier 2: HTML Scraper (secondary enrichment)
- **lbh3.org/hareline** — LBH3 single-kennel hareline
  - WordPress site with run numbers, dates, hares, locations
  - Structure: `<table>` with date, run#, name, hares, location columns
  - Good for enriching Meetup data with run numbers and hare names

### Tier 3: Static Schedule (for kennels not on sdh3 hareline)
- TDH3 (Throw Down) — Long Beach, biweekly 6:30pm (on lbh3.org/socal calendar)
- OCHHH — Orange County, monthly Sat 10am
- OC Hump Hash — Orange County, biweekly Wed 6:30pm
- SLOH3 — San Luis Obispo, biweekly Sat 2:15pm

## Kennels to Add

### Los Angeles Area
| kennelCode | shortName | fullName | region | schedule | hashCash | source |
|---|---|---|---|---|---|---|
| lah3 | LAH3 | Los Angeles Hash House Harriers | Los Angeles, CA | Sat 2-3pm, weekly | $5 | MEETUP |
| lbh3 | LBH3 | Long Beach Hash House Harriers | Long Beach, CA | Sun 10am (winter) / Thu 6:30pm (summer), weekly | $5 | MEETUP |
| tdh3-lb | TDH3 | Throw Down Hash House Harriers | Long Beach, CA | Biweekly 6:30pm | | STATIC_SCHEDULE |

### San Diego Area (from sdh3.com/hareline.shtml kennel filter)
| kennelCode | shortName | fullName | region | schedule | hashCash | source |
|---|---|---|---|---|---|---|
| sdh3 | SDH3 | San Diego Hash House Harriers | San Diego, CA | Fri 6:30pm + biweekly Sun 10am | $10 | HTML_SCRAPER (sdh3) |
| clh3-sd | CLH3 | California Larrikins Hash House Harriers | San Diego, CA | Mon 6:30pm, weekly | | HTML_SCRAPER (sdh3) |
| ljh3 | LJH3 | La Jolla Hash House Harriers | San Diego, CA | Mon 6pm, weekly | $8 | HTML_SCRAPER (sdh3) |
| nch3-sd | NCH3 | North County Hash House Harriers | San Diego, CA | Sat 10am, weekly | $8 | HTML_SCRAPER (sdh3) |
| irh3-sd | IRH3 | Iron Rule Hash House Harriers | San Diego, CA | Biweekly Fri 6pm | $8 | HTML_SCRAPER (sdh3) |
| humpin-sd | Humpin' | Humpin' Hash House Harriers | San Diego, CA | Sun, weekly | | HTML_SCRAPER (sdh3) |
| fmh3-sd | FMH3 | San Diego Full Moon Hash | San Diego, CA | Monthly, full moon evening | | HTML_SCRAPER (sdh3) |
| hah3-sd | HAH3 | Half-Assed Hash House Harriers | San Diego, CA | Monthly | | HTML_SCRAPER (sdh3) |
| mh4-sd | MH4 | Mission Harriettes | San Diego, CA | Monthly Wed evening | | HTML_SCRAPER (sdh3) |
| drh3-sd | DRH3 | San Diego Diaper Rash Hash | San Diego, CA | Monthly Sat 10am | | HTML_SCRAPER (sdh3) |

### Orange County
| kennelCode | shortName | fullName | region | schedule | hashCash | source |
|---|---|---|---|---|---|---|
| ochhh | OCHHH | Orange County Hash House Harriers | Orange County, CA | Monthly Sat 10am | | STATIC_SCHEDULE |
| ochump | OC Hump | OC Hump Hash House Harriers | Orange County, CA | Biweekly Wed 6:30pm | | STATIC_SCHEDULE |

### Central Coast
| kennelCode | shortName | fullName | region | schedule | hashCash | source |
|---|---|---|---|---|---|---|
| sloh3 | SLOH3 | San Luis Obispo Hash House Harriers | San Luis Obispo, CA | Biweekly Sat 2:15pm + biweekly Thu 6pm | | STATIC_SCHEDULE |

## sdh3.com HTML Structure Analysis

```html
<!-- Each event is a <dt> with kennel code in class -->
<dt style="padding:5px" class="hashEvent IRH3">
  <span style="float:right;...">
    <a href="/e/event-{YYYYMMDDHHMMSS}.shtml">Link</a>
    <a href="{mapUrl}">View Map</a>
    <a href="{kennelPage}"><img src="{logo}" alt="{kennelName}" /></a>
  </span>
  <strong>{Kennel Name} Hash</strong>
  <!-- Schedule info in onclick tooltip -->
  <span style="white-space:nowrap">{Day}, {Month} {DD}, {YYYY} {H:MM}{am/pm}</span>
  <div style="margin-left:25px"><span>
    {Event Title}<br />
    <strong>Hare(s):</strong> {hares}<br />
    <strong>Address:</strong> {address}<br />
    <strong>Map Link:</strong> <a href="{url}">{url}</a><br />
    <strong>Run Fee:</strong> ${amount}<br />
    <strong>Trail type:</strong> {A to A|A to B}<br />
    <strong>Dog friendly:</strong> {Yes|No}<br />
    <strong>Notes:</strong><br />{notes}
  </span></div>
</dt>
```

### Key parsing patterns:
- Kennel code: CSS class `hashEvent {CODE}` on `<dt>` element
- Kennel name: First `<strong>` child text
- Date/time: `<span style="white-space:nowrap">` text
- Fields: `<strong>Label:</strong> Value` pattern (same as SHITH3 adapter)
- Sections: `<h2>Hashes Today</h2>`, `<h2>Hashes Tomorrow</h2>`, etc.

### Kennel codes from filter links:
DRH3, FMH3, GFH3, HAH3, HOTD, H4, IGH3, IRH3, LJH3, CLH3, MH4, NCH3, PUH3, Pub, SDH3, SFH3 (Stumblefoot), TH3 (Temecula), VBH3

## Implementation Plan

1. **Add regions**: LA, Long Beach, OC, SLO metros + California→metro linking
2. **Add 15+ kennel records** with metadata
3. **Add Meetup source** for LAH3+LBH3 (kennelPatterns config)
4. **Build sdh3.com HTML scraper** — parse `<dt class="hashEvent {CODE}">` elements
5. **Add sdh3.com source** covering all SD kennels
6. **Add static schedules** for TDH3, OCHHH, OC Hump, SLOH3
7. **Tests**: HTML fixture with sample events, unit tests for date/field parsing
