---
description: Active data sources catalog — 73 sources across 11 regions
globs:
  - src/adapters/**
  - prisma/seed.ts
  - src/pipeline/**
---

# Active Sources (69)

## NYC / NJ / Philly (8 sources)
- **hashnyc.com** → HTML_SCRAPER → 11 NYC-area kennels
- **Summit H3 Spreadsheet** → GOOGLE_SHEETS → 3 NJ kennels (Summit, SFM, ASSSH3)
- **Rumson H3 Static Schedule** → STATIC_SCHEDULE → Rumson H3
- **BFM Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3
- **Philly H3 Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3
- **BFM Website** → HTML_SCRAPER → BFM
- **Philly H3 Website** → HTML_SCRAPER → Philly H3
- **Hash Rego** → HASHREGO → 8 kennels (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3)

## Massachusetts (4 sources)
- **Boston Hash Calendar** → GOOGLE_CALENDAR → 5 Boston kennels
- **Happy Valley H3 Static Schedule** → STATIC_SCHEDULE → HVH3
- **PooFlingers H3 Static Schedule** → STATIC_SCHEDULE → PooFH3
- **Northboro H3 Website** → HTML_SCRAPER (browser-rendered) → NbH3

## Chicago (3 sources)
- **Chicagoland Hash Calendar** → GOOGLE_CALENDAR → 11 Chicago-area kennels
- **Chicago Hash Website** → HTML_SCRAPER → CH3 (secondary)
- **Thirstday Hash Website** → HTML_SCRAPER → TH3 (secondary)

## DC / DMV (10 sources)
- **EWH3 Google Calendar** → GOOGLE_CALENDAR → EWH3
- **SHITH3 Google Calendar** → GOOGLE_CALENDAR → SHITH3
- **SHITH3 Website** → HTML_SCRAPER → SHITH3 (PHP REST API, secondary enrichment)
- **W3H3 Hareline Spreadsheet** → GOOGLE_SHEETS → W3H3 (West Virginia)
- **Charm City H3 iCal Feed** → ICAL_FEED → CCH3 (Baltimore)
- **BAH3 iCal Feed** → ICAL_FEED → BAH3 (Baltimore/Annapolis)
- **EWH3 WordPress Trail News** → HTML_SCRAPER → EWH3 (secondary)
- **DCH4 WordPress Trail Posts** → HTML_SCRAPER → DCH4
- **OFH3 Blogspot Trail Posts** → HTML_SCRAPER → OFH3
- **Hangover H3 DigitalPress Blog** → HTML_SCRAPER → H4

## SF Bay Area (2 sources)
- **SFH3 MultiHash iCal Feed** → ICAL_FEED → 13 SF Bay Area kennels
- **SFH3 MultiHash HTML Hareline** → HTML_SCRAPER → 13 SF Bay Area kennels (secondary)

## London / UK (7 sources)
- **London Hash Run List** → HTML_SCRAPER → LH3
- **City Hash Website** → HTML_SCRAPER → CityH3
- **West London Hash Website** → HTML_SCRAPER → WLH3
- **Barnes Hash Hare Line** → HTML_SCRAPER → BarnesH3
- **Old Coulsdon Hash Run List** → HTML_SCRAPER → OCH3
- **SLASH Run List** → HTML_SCRAPER → SLH3
- **Enfield Hash Blog** → HTML_SCRAPER → EH3

## Ireland (1 source)
- **Dublin H3 Website Hareline** → HTML_SCRAPER → DH3

## Florida (8 sources)
- **Miami H3 Meetup** → MEETUP → MH3
- **Key West H3 Google Calendar** → GOOGLE_CALENDAR → KWH3
- **O2H3 Google Calendar** → GOOGLE_CALENDAR → O2H3
- **West Central FL Hash Calendar** → HTML_SCRAPER → WCFH3 + FL kennels
- **Wildcard H3 Static Schedule** → STATIC_SCHEDULE → WildH3
- **H6 Static Schedule** → STATIC_SCHEDULE → H6
- **PBH3 Static Schedule** → STATIC_SCHEDULE → PBH3
- **GATR H3 Static Schedule** → STATIC_SCHEDULE → GATR

## Georgia (11 sources)
- **Savannah H3 Meetup** → MEETUP → SavH3
- **Atlanta Hash Board** → HTML_SCRAPER → ATL kennels
- **SCH3 Static Schedule** → STATIC_SCHEDULE → SCH3
- **HMH3 Static Schedule** → STATIC_SCHEDULE → HMH3
- **CUNT H3 ATL Static Schedule** → STATIC_SCHEDULE → CUNTH3
- **PFH3 Static Schedule** → STATIC_SCHEDULE → PFH3
- **AUGH3 Static Schedule** → STATIC_SCHEDULE → AUGH3
- **MGH4 Static Schedule** → STATIC_SCHEDULE → MGH4
- **W3H3 GA Static Schedule** → STATIC_SCHEDULE → W3H3-GA
- **CVH3 Static Schedule** → STATIC_SCHEDULE → CVH3
- **R2H3 Static Schedule** → STATIC_SCHEDULE → R2H3

## South Carolina (10 sources)
- **Charleston Heretics Meetup** → MEETUP → CHH3
- **Charleston H3 Static Schedule** → STATIC_SCHEDULE → CH3-SC
- **BUDH3 Static Schedule** → STATIC_SCHEDULE → BUDH3
- **Columbian H3 Static Schedule (1st Sunday)** → STATIC_SCHEDULE → ColH3
- **Columbian H3 Static Schedule (3rd Sunday)** → STATIC_SCHEDULE → ColH3
- **Secession H3 Static Schedule** → STATIC_SCHEDULE → SecH3
- **Palmetto H3 Static Schedule** → STATIC_SCHEDULE → PalH3
- **Upstate H3 Static Schedule** → STATIC_SCHEDULE → UH3
- **GOTH3 Static Schedule** → STATIC_SCHEDULE → GOTH3
- **Grand Strand H3 Static Schedule** → STATIC_SCHEDULE → GSH3

## New England (5 sources)
- **Von Tramp H3 Meetup** → MEETUP → VTH3 (Vermont)
- **Burlington H3 Website Hareline** → HTML_SCRAPER → BurH3 (Vermont)
- **RIH3 Static Schedule** → STATIC_SCHEDULE → RIH3 (Rhode Island)
- **RIH3 Website Hareline** → HTML_SCRAPER → RIH3 (Rhode Island)
- **Narwhal H3 Meetup (CTH3)** → MEETUP → CTH3 (Connecticut)

## Japan (4 sources)
- **Tokyo H3 Harrier Central** → HARRIER_CENTRAL → Tokyo H3
- **KFMH3 Google Calendar** → GOOGLE_CALENDAR → KFMH3 (Osaka, monthly full moon)
- **Kyoto H3 Google Calendar** → GOOGLE_CALENDAR → Kyoto H3
- **Osaka H3 Google Calendar** → GOOGLE_CALENDAR → Osaka H3

See `docs/source-onboarding-playbook.md` for how to add new sources.
See `docs/roadmap.md` for implementation roadmap.
