---
description: Active data sources catalog — 169 sources across 26+ regions
globs:
  - src/adapters/**
  - prisma/seed.ts
  - src/pipeline/**
---

# Active Sources (169)

## NYC / NJ / Philly (8 sources)
- **hashnyc.com** -> HTML_SCRAPER -> 11 NYC-area kennels
- **Summit H3 Spreadsheet** -> GOOGLE_SHEETS -> 3 NJ kennels (Summit, SFM, ASSSH3)
- **Rumson H3 Static Schedule** -> STATIC_SCHEDULE -> Rumson H3
- **BFM Google Calendar** -> GOOGLE_CALENDAR -> BFM, Philly H3
- **Philly H3 Google Calendar** -> GOOGLE_CALENDAR -> BFM, Philly H3
- **BFM Website** -> HTML_SCRAPER -> BFM
- **Philly H3 Website** -> HTML_SCRAPER -> Philly H3
- **Hash Rego** -> HASHREGO -> 8 kennels (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3)

## Massachusetts (4 sources)
- **Boston Hash Calendar** -> GOOGLE_CALENDAR -> 5 Boston kennels
- **Happy Valley H3 Static Schedule** -> STATIC_SCHEDULE -> HVH3
- **PooFlingers H3 Static Schedule** -> STATIC_SCHEDULE -> PooFH3
- **Northboro H3 Website** -> HTML_SCRAPER (browser-rendered) -> NbH3

## Chicago (3 sources)
- **Chicagoland Hash Calendar** -> GOOGLE_CALENDAR -> 11 Chicago-area kennels
- **Chicago Hash Website** -> HTML_SCRAPER -> CH3 (secondary)
- **Thirstday Hash Website** -> HTML_SCRAPER -> TH3 (secondary)

## DC / DMV (10 sources)
- **EWH3 Google Calendar** -> GOOGLE_CALENDAR -> EWH3
- **SHITH3 Google Calendar** -> GOOGLE_CALENDAR -> SHITH3
- **SHITH3 Website** -> HTML_SCRAPER -> SHITH3 (PHP REST API, secondary enrichment)
- **W3H3 Hareline Spreadsheet** -> GOOGLE_SHEETS -> W3H3 (West Virginia)
- **Charm City H3 iCal Feed** -> ICAL_FEED -> CCH3 (Baltimore)
- **BAH3 iCal Feed** -> ICAL_FEED -> BAH3 (Baltimore/Annapolis)
- **EWH3 WordPress Trail News** -> HTML_SCRAPER -> EWH3 (secondary)
- **DCH4 WordPress Trail Posts** -> HTML_SCRAPER -> DCH4
- **OFH3 Blogspot Trail Posts** -> HTML_SCRAPER -> OFH3
- **Hangover H3 DigitalPress Blog** -> HTML_SCRAPER -> H4

## SF Bay Area (3 sources)
- **SFH3 MultiHash iCal Feed** -> ICAL_FEED -> 13 SF Bay Area kennels
- **SFH3 MultiHash HTML Hareline** -> HTML_SCRAPER -> 13 SF Bay Area kennels (secondary)
- **Surf City H3 Google Calendar** -> GOOGLE_CALENDAR -> SCH3 (Santa Cruz)

## Southern California (12 sources)
- **LAH3 Google Calendar** -> GOOGLE_CALENDAR -> LAH3
- **LBH3 Google Calendar** -> GOOGLE_CALENDAR -> LBH3
- **TDH3 Google Calendar** -> GOOGLE_CALENDAR -> TDH3
- **GAL Google Calendar** -> GOOGLE_CALENDAR -> GAL
- **SUPH3 Google Calendar** -> GOOGLE_CALENDAR -> SUPH3
- **Foothill H3 Google Calendar** -> GOOGLE_CALENDAR -> FtH3
- **East LA H3 Google Calendar** -> GOOGLE_CALENDAR -> ELAH3
- **Signal Hill H3 Google Calendar** -> GOOGLE_CALENDAR -> SGH3
- **OCHHH Google Calendar** -> GOOGLE_CALENDAR -> OCHHH
- **OC Hump Google Calendar** -> GOOGLE_CALENDAR -> OC Hump
- **SLOH3 Google Calendar** -> GOOGLE_CALENDAR -> SLOH3
- **SDH3 Hareline** -> HTML_SCRAPER -> 10 San Diego kennels + 7,649 historical events

## Washington (6 sources)
- **WA Hash Google Calendar** -> GOOGLE_CALENDAR -> 12 Seattle-area kennels
- **SH3 Hareline Sheet** -> GOOGLE_SHEETS -> SH3 (Seattle)
- **PSH3 Hareline Sheet** -> GOOGLE_SHEETS -> PSH3 (Puget Sound)
- **RCH3 Hareline Sheet** -> GOOGLE_SHEETS -> RCH3 (Rain City)
- **SeaMon H3 Hareline Sheet** -> GOOGLE_SHEETS -> SeaMon
- **Leap Year H3 Hareline Sheet** -> GOOGLE_SHEETS -> Leap Year

## Colorado (5 sources)
- **Denver H3 Google Calendar** -> GOOGLE_CALENDAR -> DH3
- **Mile High Humpin Hash Calendar** -> GOOGLE_CALENDAR -> MiHiHuHa
- **Colorado H3 Aggregator Calendar** -> GOOGLE_CALENDAR -> BH3 (Boulder), MiHiHuHa (secondary)
- **Fort Collins H3 Google Calendar** -> GOOGLE_CALENDAR -> FCH3
- **Colorado Springs H3 Calendar** -> GOOGLE_CALENDAR -> PPH4, Kimchi, DIM (3 CS kennels)

## Kansas (2 sources)
- **Tornado Alley H3 Google Calendar** -> GOOGLE_CALENDAR -> TAH3 (Wichita)
- **Larryville H3 Google Calendar** -> GOOGLE_CALENDAR -> LH3 (Lawrence)

## Minnesota (1 source)
- **Minneapolis H3 Calendar** -> GOOGLE_CALENDAR -> MH3, T3H3

## Michigan (3 sources)
- **MoA2H3 Google Calendar** -> GOOGLE_CALENDAR -> MoA2H3 (Detroit/Ann Arbor)
- **DeMon H3 Google Calendar** -> GOOGLE_CALENDAR -> DeMon (Detroit Monday)
- **GLH3 Google Calendar** -> GOOGLE_CALENDAR -> GLH3 (Greater Lansing)

## Arizona (4 sources)
- **Phoenix H3 Events** -> ICAL_FEED -> LBH, Hump D, Wrong Way, FDTDD (4 Phoenix kennels)
- **jHavelina H3 Google Calendar** -> GOOGLE_CALENDAR -> jHav (Tucson)
- **Mr. Happy's H3 Google Calendar** -> GOOGLE_CALENDAR -> Mr. Happy's (Tucson)
- **Pedal Files Bash Google Calendar** -> GOOGLE_CALENDAR -> Pedal Files (Tucson bike hash)

## Hawaii (2 sources)
- **Aloha H3 Google Calendar** -> GOOGLE_CALENDAR -> AH3, H5 (2 Honolulu kennels)
- **Honolulu H5 Google Calendar** -> GOOGLE_CALENDAR -> H5

## London / UK (7 sources)
- **London Hash Run List** -> HTML_SCRAPER -> LH3
- **City Hash Website** -> HTML_SCRAPER -> CityH3
- **West London Hash Website** -> HTML_SCRAPER -> WLH3
- **Barnes Hash Hare Line** -> HTML_SCRAPER -> BarnesH3
- **Old Coulsdon Hash Run List** -> HTML_SCRAPER -> OCH3
- **SLASH Run List** -> HTML_SCRAPER -> SLH3
- **Enfield Hash Blog** -> HTML_SCRAPER -> EH3

## Scotland (2 sources)
- **Glasgow H3 Hareline** -> HTML_SCRAPER (GenericHtml) -> Glasgow H3
- **Edinburgh H3 Hareline** -> HTML_SCRAPER -> Edinburgh H3

## Bristol (1 source)
- **West of England Hash Run List** -> HTML_SCRAPER (GenericHtml) -> Bristol H3, GREY, BOGS

## Ireland (1 source)
- **Dublin H3 Website Hareline** -> HTML_SCRAPER -> DH3

## Germany (4 sources)
- **Berlin H3 iCal Feed** -> ICAL_FEED -> BH3, BH3FM (2 Berlin kennels)
- **Stuttgart H3 Google Calendar** -> GOOGLE_CALENDAR -> SH3, DST, FM, SUPER (4 Stuttgart kennels)
- **Munich H3 Hareline Sheet** -> GOOGLE_SHEETS -> MH3 (Munich)
- **Frankfurt H3 Hareline** -> HTML_SCRAPER -> FH3, FFMH3, SHITS, DOM, Bike Hash (5 Frankfurt kennels)

## Florida (8 sources)
- **Miami H3 Meetup** -> MEETUP -> MH3
- **Key West H3 Google Calendar** -> GOOGLE_CALENDAR -> KWH3
- **O2H3 Google Calendar** -> GOOGLE_CALENDAR -> O2H3
- **West Central FL Hash Calendar** -> HTML_SCRAPER -> WCFH3 + FL kennels
- **Wildcard H3 Static Schedule** -> STATIC_SCHEDULE -> WildH3
- **H6 Static Schedule** -> STATIC_SCHEDULE -> H6
- **PBH3 Static Schedule** -> STATIC_SCHEDULE -> PBH3
- **GATR H3 Static Schedule** -> STATIC_SCHEDULE -> GATR

## Georgia (11 sources)
- **Savannah H3 Meetup** -> MEETUP -> SavH3
- **Atlanta Hash Board** -> HTML_SCRAPER -> ATL kennels
- **SCH3 Static Schedule** -> STATIC_SCHEDULE -> SCH3
- **HMH3 Static Schedule** -> STATIC_SCHEDULE -> HMH3
- **CUNT H3 ATL Static Schedule** -> STATIC_SCHEDULE -> CUNTH3
- **PFH3 Static Schedule** -> STATIC_SCHEDULE -> PFH3
- **AUGH3 Static Schedule** -> STATIC_SCHEDULE -> AUGH3
- **MGH4 Static Schedule** -> STATIC_SCHEDULE -> MGH4
- **W3H3 GA Static Schedule** -> STATIC_SCHEDULE -> W3H3-GA
- **CVH3 Static Schedule** -> STATIC_SCHEDULE -> CVH3
- **R2H3 Static Schedule** -> STATIC_SCHEDULE -> R2H3

## South Carolina (10 sources)
- **Charleston Heretics Meetup** -> MEETUP -> CHH3
- **Charleston H3 Static Schedule** -> STATIC_SCHEDULE -> CH3-SC
- **BUDH3 Static Schedule** -> STATIC_SCHEDULE -> BUDH3
- **Columbian H3 Static Schedule (1st Sunday)** -> STATIC_SCHEDULE -> ColH3
- **Columbian H3 Static Schedule (3rd Sunday)** -> STATIC_SCHEDULE -> ColH3
- **Secession H3 Static Schedule** -> STATIC_SCHEDULE -> SecH3
- **Palmetto H3 Static Schedule** -> STATIC_SCHEDULE -> PalH3
- **Upstate H3 Static Schedule** -> STATIC_SCHEDULE -> UH3
- **GOTH3 Static Schedule** -> STATIC_SCHEDULE -> GOTH3
- **Grand Strand H3 Static Schedule** -> STATIC_SCHEDULE -> GSH3

## Texas (8 sources)
- **Austin H3 Calendar** -> GOOGLE_CALENDAR -> AH3
- **Keep Austin Weird H3 Calendar** -> GOOGLE_CALENDAR -> KAW!H3
- **Houston Hash Calendar** -> GOOGLE_CALENDAR -> H4
- **Brass Monkey H3 Blog** -> HTML_SCRAPER (Blogger API) -> BMH3
- **Mosquito H3 Static Schedule (1st Wed)** -> STATIC_SCHEDULE -> Mosquito H3
- **Mosquito H3 Static Schedule (3rd Wed)** -> STATIC_SCHEDULE -> Mosquito H3
- **DFW Hash Calendar** -> HTML_SCRAPER (PHP calendar) -> DH3, DUHHH, NODUHHH, FWH3
- **Corpus Christi H3 Calendar** -> GOOGLE_CALENDAR -> C2H3

## Upstate New York (6 sources)
- **Flour City H3 Google Calendar** -> GOOGLE_CALENDAR -> FCH3 (Rochester)
- **SOH4 Website** -> HTML_SCRAPER (RSS+iCal) -> SOH4 (Syracuse)
- **Halve Mein Website** -> HTML_SCRAPER (PHP table) -> HMHHH (Capital District)
- **IH3 Website Hareline** -> HTML_SCRAPER (WordPress hare-line) -> IH3 (Ithaca)
- **Buffalo H3 Google Calendar** -> GOOGLE_CALENDAR -> BH3 (Buffalo)
- **Hudson Valley H3 Meetup** -> MEETUP -> HVH3-NY (Hudson Valley)

## Pennsylvania (outside Philly) (6 sources)
- **Pittsburgh Hash Calendar** -> GOOGLE_CALENDAR -> PGH H3 (Pittsburgh)
- **Iron City H3 iCal Feed** -> ICAL_FEED -> ICH3 (Pittsburgh)
- **Nittany Valley H3 Calendar** -> GOOGLE_CALENDAR -> NVHHH (State College)
- **LVH3 Hareline Calendar** -> GOOGLE_CALENDAR -> LVH3 (Lehigh Valley)
- **Reading H3 Localendar** -> ICAL_FEED -> RH3 (Reading)
- **H5 Google Calendar** -> GOOGLE_CALENDAR -> H5 (Harrisburg)

## Delaware (1 source)
- **Hockessin H3 Website** -> HTML_SCRAPER -> H4 (Wilmington)

## Alabama (3 sources)
- **Mutha Rucker H3 Google Calendar** -> GOOGLE_CALENDAR -> MRH3 (Enterprise)
- **Gulf Coast H3 Google Calendar** -> GOOGLE_CALENDAR -> GCH3 (Mobile)
- **Hash Rego (extended)** -> HASHREGO -> WSH3 (Birmingham, annual SOEX) + MRH3 (secondary)

## Indiana (2 sources)
- **Blooming Fools H3 Website** -> HTML_SCRAPER -> BFH3 (Bloomington, ~year of trails from inline `<script type="text/plain">`)
- **IndyScent H3 Upcumming Hashes** -> HTML_SCRAPER -> IndyH3 (Indianapolis) + THICC H3 (kennelPatterns routing, WordPress Pages API)

## Tennessee (1 source)
- **Choo-Choo H3 Website** -> HTML_SCRAPER (via fetchTribeEvents utility, The Events Calendar REST API) -> choochooh3 (Chattanooga)

## West Virginia (2 sources)
- **Morgantown H3 Google Calendar** -> GOOGLE_CALENDAR -> mh3-wv (Morgantown)
- **Morgantown H3 Harrier Central** -> HARRIER_CENTRAL -> mh3-wv (Morgantown)

## Arkansas (2 sources)
- **Little Rock H3 Static Schedule (Sunday)** -> STATIC_SCHEDULE -> lrh3 (weekly Sunday 15:00, historic exception, FB-posted locations)
- **Little Rock H3 Static Schedule (Wednesday)** -> STATIC_SCHEDULE -> lrh3 (weekly Wednesday 19:00, historic exception, FB-posted locations)

## Singapore (7 sources)
- **Singapore Sunday H3 Harrier Central** -> HARRIER_CENTRAL -> sh3-sg (alternate Sundays, kennel ID SH3-SG)
- **Lion City H3 Website** -> HTML_SCRAPER (custom, WordPress posts via fetchWordPressPosts) -> lch3 (weekly Friday)
- **Kampong H3 Website** -> HTML_SCRAPER (custom, "Next Run" block) -> kampong-h3 (monthly 3rd Saturday)
- **HHHS Father Hash Static Schedule** -> STATIC_SCHEDULE -> hhhs (weekly Monday 18:00, historic exception, 2nd hash kennel in the world founded 1962)
- **Singapore Harriets Static Schedule** -> STATIC_SCHEDULE -> sgharriets (weekly Wednesday 18:00, historic exception, oldest women's hash in Asia founded 1973, FB-coordinated)
- **Hash House Horrors Hareline** -> HTML_SCRAPER (custom, WordPress.com Public API via fetchWordPressComPage) -> hhhorrors (alt Sundays 16:30, children's hash)
- **Seletar H3 PWA** -> HTML_SCRAPER (custom, JSON API to HashController.php) -> seletar-h3 (weekly Tuesday 18:00, founded 1980, men only, 14+ future runs visible)

## Virginia (outside DC metro) (9 sources)
- **Richmond H3 Google Calendar** -> GOOGLE_CALENDAR -> RH3 (Richmond)
- **Richmond H3 Meetup** -> MEETUP -> RH3 (Richmond)
- **Fort Eustis H3 Google Calendar** -> GOOGLE_CALENDAR -> FEH3 (Hampton Roads)
- **Fort Eustis H3 Meetup** -> MEETUP -> FEH3 (Hampton Roads)
- **BDSM H3 Meetup** -> MEETUP -> BDSMH3 (Hampton Roads)
- **cHARLOTtesville H3 Meetup** -> MEETUP -> CvilleH3 (Charlottesville)
- **FUH3 Static Schedule** -> STATIC_SCHEDULE -> FUH3 (Fredericksburg)
- **Tidewater H3 Static Schedule** -> STATIC_SCHEDULE -> TH3 (Hampton Roads)
- **Seven Hills H3 Static Schedule** -> STATIC_SCHEDULE -> 7H4 (Lynchburg)

## North Carolina (6 sources)
- **SWH3 Google Calendar** -> GOOGLE_CALENDAR -> SWH3 (Raleigh)
- **Carolina Larrikins Google Calendar** -> GOOGLE_CALENDAR -> Larrikins (Raleigh)
- **Charlotte H3 Meetup** -> MEETUP -> CH3 (Charlotte)
- **Asheville H3 Meetup** -> MEETUP -> AVLH3 (Asheville)
- **Cape Fear H3 Website** -> HTML_SCRAPER -> CFH3 (Wilmington, NC)
- **Carolina Trash H3 Meetup** -> MEETUP -> CTrH3 (Fayetteville)

## New England (5 sources)
- **Von Tramp H3 Meetup** -> MEETUP -> VTH3 (Vermont)
- **Burlington H3 Website Hareline** -> HTML_SCRAPER -> BurH3 (Vermont)
- **RIH3 Static Schedule** -> STATIC_SCHEDULE -> RIH3 (Rhode Island)
- **RIH3 Website Hareline** -> HTML_SCRAPER -> RIH3 (Rhode Island)
- **Narwhal H3 Meetup (CTH3)** -> MEETUP -> CTH3 (Connecticut)

## Japan (4 sources)
- **Tokyo H3 Harrier Central** → HARRIER_CENTRAL → Tokyo H3
- **KFMH3 Google Calendar** → GOOGLE_CALENDAR → KFMH3 (Osaka, monthly full moon)
- **Kyoto H3 Google Calendar** → GOOGLE_CALENDAR → Kyoto H3
- **Osaka H3 Google Calendar** → GOOGLE_CALENDAR → Osaka H3

See `docs/source-onboarding-playbook.md` for how to add new sources.
See `docs/roadmap.md` for implementation roadmap.
