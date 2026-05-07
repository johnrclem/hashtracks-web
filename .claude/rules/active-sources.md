---
description: Active data sources catalog — 189 sources across 27+ regions
globs:
  - src/adapters/**
  - prisma/seed.ts
  - src/pipeline/**
---

# Active Sources (189)

## NYC / NJ / Philly (9 sources)
- **hashnyc.com** -> HTML_SCRAPER -> 11 NYC-area kennels
- **Summit H3 Spreadsheet** -> GOOGLE_SHEETS -> 3 NJ kennels (Summit, SFM, ASSSH3)
- **Rumson H3 Static Schedule** -> STATIC_SCHEDULE -> Rumson H3
- **Princeton NJ Hash Calendar** -> GOOGLE_CALENDAR -> Princeton H3
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

## Colorado (6 sources)
- **Denver H3 Google Calendar** -> GOOGLE_CALENDAR -> DH3
- **Mile High Humpin Hash Calendar** -> GOOGLE_CALENDAR -> MiHiHuHa
- **Colorado H3 Aggregator Calendar** -> GOOGLE_CALENDAR -> BH3 (Boulder), MiHiHuHa (secondary)
- **Boulder H3 Website** -> HTML_SCRAPER -> BH3 (Boulder, primary; Divi/WordPress blog)
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

## Hong Kong (13 sources, 11 kennels)
- **HK H3 Homepage** -> HTML_SCRAPER -> hkh3 (founder, 1970, weekly Mon, men only)
- **HK H3 Static Schedule** -> STATIC_SCHEDULE -> hkh3 (recurring slot)
- **N2TH3 WordPress Blog** -> HTML_SCRAPER -> n2th3 (weekly Wed, day-of detail)
- **N2TH3 Static Schedule** -> STATIC_SCHEDULE -> n2th3 (recurring slot)
- **Kowloon H3 Hareline Sheet** -> GOOGLE_SHEETS -> kowloon-h3 (weekly Mon, 1970)
- **RS2H3 Hareline Sheet** -> GOOGLE_SHEETS -> rs2h3 (weekly Thu, men only)
- **Wanchai H3 Hareline Sheet** -> GOOGLE_SHEETS -> wanchai-h3 (weekly Sun, 1988)
- **Sek Kong H3 Hareline Sheet** -> GOOGLE_SHEETS -> sekkong-h3 (weekly Sun, 1974)
- **LSW Hareline** -> HTML_SCRAPER -> lsw-h3 (weekly Wed, 1979)
- **Ladies H4 Hareline** -> HTML_SCRAPER (DISABLED, Wix browserRender) -> lh4-hk (weekly Tue, 1971, women only)
- **HKFH3 Static Schedule** -> STATIC_SCHEDULE -> hkfh3 (monthly Fri)
- **Free China H3 Static Schedule** -> STATIC_SCHEDULE -> fch3-hk (monthly Sat, 1994)
- **Hebe H3 Static Schedule** -> STATIC_SCHEDULE -> hebe-h3 (3rd Sat monthly, 2019)

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

## South Carolina (11 sources)
- **Charleston Heretics Meetup** -> MEETUP -> CHH3
- **Charleston H3 Static Schedule** -> STATIC_SCHEDULE -> CH3-SC
- **BUDH3 Static Schedule** -> STATIC_SCHEDULE -> BUDH3
- **Columbian H3 Static Schedule (1st Sunday)** -> STATIC_SCHEDULE -> ColH3
- **Columbian H3 Static Schedule (3rd Sunday)** -> STATIC_SCHEDULE -> ColH3
- **Secession H3 Static Schedule** -> STATIC_SCHEDULE -> SecH3
- **Palmetto H3 Static Schedule** -> STATIC_SCHEDULE -> PalH3
- **Upstate H3 Static Schedule** -> STATIC_SCHEDULE -> UH3
- **GOTH3 Static Schedule** -> STATIC_SCHEDULE -> GOTH3
- **Grand Strand H3 Static Schedule** -> STATIC_SCHEDULE -> GSH3 (low-trust fallback)
- **Grand Strand H3 Facebook Hosted Events** -> FACEBOOK_HOSTED_EVENTS -> GSH3 (primary; T2c canary)

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

## Australia (8 sources — Phase 1a config-only + Phase 1b HTML scrapers)
- **Perth H3 Hareline** -> ICAL_FEED (The Events Calendar / Tribe plugin) -> perth-h3 (weekly Monday, WA)
- **Top End Hash Hareline** -> ICAL_FEED (Events Manager plugin) -> top-end-h3 (weekly Friday, Darwin NT)
- **Capital Hash Calendar** -> GOOGLE_CALENDAR -> capital-h3-au (weekly Monday, Canberra ACT)
- **Sydney H3 Website** -> HTML_SCRAPER (WordPress Cheerio, labeled `<p>` blocks) -> sh3-au (founded 1967, "Posh Hash", NSW)
- **Adelaide H3 AJAX Calendar** -> HTML_SCRAPER (wp-admin/admin-ajax.php JSON, Ajax Event Calendar plugin) -> ah3-au (weekly Monday, SA)
- **Gold Coast H3 Hareline** -> HTML_SCRAPER (WordPress HTML table) -> gch3-au (weekly Sunday, QLD)
- **Sydney Larrikins Hareline** -> HTML_SCRAPER (SSR DataTables table, 19 future runs) -> larrikins-au (weekly Tuesday, NSW)
- **Sydney Thirsty H3 Website** -> HTML_SCRAPER (Google Sites Cheerio, em-dash-delimited `<p>` blocks) -> sth3-au (weekly Thursday, NSW)

## Malaysia (7 sources — Phase 1: KL + Penang founder pack)
- **Mother Hash Website** -> HTML_SCRAPER (Google Sites, labeled-field parse) -> motherh3 (weekly Monday 18:00, **1938 — first hash kennel in the world**)
- **Petaling H3 Hareline** -> HTML_SCRAPER (Yii GridView, shared adapter) -> ph3-my (weekly Saturday, 1977, 1160+ runs)
- **KL Full Moon H3 Hareline** -> HTML_SCRAPER (Yii GridView, shared adapter) -> klfmh3 (monthly full moon, 1992)
- **KL Junior H3 Website** -> HTML_SCRAPER (WordPress REST API, body regex) -> kljhhh (monthly 1st Sunday, 1982)
- **Penang H3 Hareline** -> HTML_SCRAPER (goHash.app SSR, shared adapter) -> penangh3 (weekly Monday 17:30, 1965 — 3rd-oldest kennel ever)
- **HHH Penang Hareline** -> HTML_SCRAPER (goHash.app SSR, shared adapter) -> hhhpenang (weekly Thursday 17:30, 1972)
- **Kelana Jaya Harimau Blog** -> HTML_SCRAPER (Blogger API with Run#: title filter + dedup) -> kj-harimau (weekly Tuesday 18:00, 1996)

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
