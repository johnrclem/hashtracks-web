# Facebook hosted_events audit

> One-shot audit run on 2026-05-07 —
> identifies seeded kennels with a public Facebook Page exposing populated
> `/upcoming_hosted_events` and/or `/past_hosted_events` tabs, the data source
> the `FACEBOOK_HOSTED_EVENTS` adapter (PR #1292) consumes. Past tab adds
> historical-backfill awareness — a Page with 0 upcoming but 50 past is a
> real kennel that just hasn't scheduled the next trail yet. Re-run via
> `npx tsx scripts/audit-fb-hosted-events.ts`.

## Summary

- Kennels in seed with a populated `facebookUrl`: **159**
- Page-shape handles audited: **48**
- Skipped (not a Page-shape URL): **111**
  - `group`: 106
  - `shortlink`: 5

- Pages with **≥1 upcoming event** (active scaling targets): **6**
- Pages with **0 upcoming but ≥1 past** event (re-audit candidates — Page is real and used): **27**
- Pages with no events on either tab (likely dormant Pages): **15**

## Schema gap surfaced — multi-FB-URL kennels

`Kennel.facebookUrl` stores **one** Facebook surface per kennel today. Some kennels have **both** a Group and a Page, and they expose different content:

- **NYC H3** has Group `groups/nychash` (in seed as `facebookUrl`) AND Page `hashnyc` (NOT in seed). The Page exposes `/upcoming_hosted_events` (currently empty but reachable); the Group serves `/events` separately. We're storing one and missing the other entirely — and per this audit, Pages are the surface the FACEBOOK_HOSTED_EVENTS adapter can scrape.

Schema follow-up to track in `docs/event-schema-future-fields.md`:

- Promote `Kennel.facebookUrl` to a 1-to-many `KennelFacebookSurface` table or split into `facebookPageUrl` + `facebookGroupUrl` columns.
- Audit the 106 `/groups/...` skipped rows below for an associated Page handle (often `{kennelname}` or close to it). Some of those kennels probably have a Page with hosted_events we'd otherwise have shipped a source for.
- Source-row routing: a `FACEBOOK_HOSTED_EVENTS` source binds to the Page handle; a future paste-flow / Graph API source path binds to the Group. They're not interchangeable.

## Pages with upcoming events — seed candidates

Highest-leverage targets first. The `up`/`past` columns count events on each tab; `loc/lat` count events with structured location and lat-lng pair on the upcoming tab.

| Kennel | Handle | Region | up | past | loc | lat | Sample upcoming title |
|---|---|---|---:|---:|---:|---:|---|
| Hollyweird (`h6`) | [`HollyweirdH6`](https://www.facebook.com/HollyweirdH6/upcoming_hosted_events) | Miami, FL | 8 | 8 | 7 | 0 | Hollyweird Hash House Harriers HapPy Hour @ Lampost w/ LIGHT EM UP 4 V |
| Memphis H3 (`mh3-tn`) | [`MemphisH3`](https://www.facebook.com/MemphisH3/upcoming_hosted_events) | Memphis, TN | 8 | 8 | 4 | 0 | GyNO H3 - Harriette Happy Hour! |
| SOH4 (`soh4`) | [`soh4onon`](https://www.facebook.com/soh4onon/upcoming_hosted_events) | Syracuse, NY | 8 | 8 | 0 | 0 | Trail #832: TBD |
| PCH3 (`pch3`) | [`PCH3FL`](https://www.facebook.com/PCH3FL/upcoming_hosted_events) | Florida Panhandle | 2 | 8 | 2 | 0 | Drinking Practice With PCH3 |
| Dayton H4 (`dh4`) | [`DaytonHash`](https://www.facebook.com/DaytonHash/upcoming_hosted_events) | Dayton, OH | 1 | 8 | 0 | 0 | DH4 #1659 Hash (Run/Walk) |
| GSH3 (`gsh3`) | [`GrandStrandHashing`](https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events) | Myrtle Beach, SC | 1 | 8 | 1 | 0 | Trail #186…. Nuevo de Mayo |

## Pages with past events but no upcoming — re-audit candidates

These Pages are demonstrably active (kennel has hosted at least one trail recently) but no upcoming events are listed today. Worth re-checking on the 30/60/90 cadence — they're high-probability scaling targets the next time the kennel updates the calendar. Past-event count is also a rough liveness signal: a Page with 50 past hosted_events is more likely to publish future trails than one with 1.

| Kennel | Handle | Region | past | loc | lat | Sample past title |
|---|---|---|---:|---:|---:|---|
| Adelaide H3 (`ah3-au`) | [past](https://www.facebook.com/adelaidehash/past_hosted_events) · [up](https://www.facebook.com/adelaidehash/upcoming_hosted_events) | Adelaide, SA | 8 | 7 | 0 | 2400th run |
| AH3 (`ah3-hi`) | [past](https://www.facebook.com/AlohaH3/past_hosted_events) · [up](https://www.facebook.com/AlohaH3/upcoming_hosted_events) | Honolulu, HI | 8 | 0 | 0 | The Regerts Hash! |
| AUGH3 (`augh3`) | [past](https://www.facebook.com/augustaundergroundH3/past_hosted_events) · [up](https://www.facebook.com/augustaundergroundH3/upcoming_hosted_events) | Augusta, GA | 8 | 5 | 0 | Lake olmstead trash pickup |
| Berlin Full Moon (`bh3fm`) | [past](https://www.facebook.com/BerlinHashHouseHarriers/past_hosted_events) · [up](https://www.facebook.com/BerlinHashHouseHarriers/upcoming_hosted_events) | Berlin | 8 | 7 | 0 | Run #2320 |
| Berlin H3 (`berlinh3`) | [past](https://www.facebook.com/BerlinHashHouseHarriers/past_hosted_events) · [up](https://www.facebook.com/BerlinHashHouseHarriers/upcoming_hosted_events) | Berlin | 8 | 7 | 0 | Run #2320 |
| BurlyH3 (`burlyh3`) | [past](https://www.facebook.com/BurlingtonH3/past_hosted_events) · [up](https://www.facebook.com/BurlingtonH3/upcoming_hosted_events) | Vermont | 8 | 8 | 0 | Von Tramp and Burlington H3 Present Drunken Pilgrim — Saturday Run/Wal |
| Cape Fear H3 (`cfh3`) | [past](https://www.facebook.com/CapeFearH3/past_hosted_events) · [up](https://www.facebook.com/CapeFearH3/upcoming_hosted_events) | Wilmington, NC | 8 | 8 | 0 | CFH3 500th Campout |
| CBH3 (`cbh3-cm`) | [past](https://www.facebook.com/chiangmaihashhouseharriershhh/past_hosted_events) · [up](https://www.facebook.com/chiangmaihashhouseharriershhh/upcoming_hosted_events) | Chiang Mai | 8 | 8 | 0 | Diamond HHH Run#63 |
| CH3 (`ch3-cm`) | [past](https://www.facebook.com/chiangmaihashhouseharriershhh/past_hosted_events) · [up](https://www.facebook.com/chiangmaihashhouseharriershhh/upcoming_hosted_events) | Chiang Mai | 8 | 8 | 0 | Diamond HHH Run#63 |
| CH4 (`ch4-cm`) | [past](https://www.facebook.com/chiangmaihashhouseharriershhh/past_hosted_events) · [up](https://www.facebook.com/chiangmaihashhouseharriershhh/upcoming_hosted_events) | Chiang Mai | 8 | 8 | 0 | Diamond HHH Run#63 |
| Charm City H3 (`cch3`) | [past](https://www.facebook.com/CharmCityH3/past_hosted_events) · [up](https://www.facebook.com/CharmCityH3/upcoming_hosted_events) | Baltimore, MD | 8 | 6 | 0 | CCH3 #338 |
| CHH3 (`chh3`) | [past](https://www.facebook.com/charlestonheretics/past_hosted_events) · [up](https://www.facebook.com/charlestonheretics/upcoming_hosted_events) | Charleston, SC | 8 | 8 | 0 | The Kennel Gets Railed Trail |
| Cleveland H4 (`cleh4`) | [past](https://www.facebook.com/clevelandhash/past_hosted_events) · [up](https://www.facebook.com/clevelandhash/upcoming_hosted_events) | Cleveland, OH | 8 | 4 | 0 | CH4 Trail #8-something and some: Air Show Hash! |
| CSH3 (`csh3`) | [past](https://www.facebook.com/chiangmaihashhouseharriershhh/past_hosted_events) · [up](https://www.facebook.com/chiangmaihashhouseharriershhh/upcoming_hosted_events) | Chiang Mai | 8 | 8 | 0 | Diamond HHH Run#63 |
| ECH3 (`ech3-fl`) | [past](https://www.facebook.com/FWBAreaHHH/past_hosted_events) · [up](https://www.facebook.com/FWBAreaHHH/upcoming_hosted_events) | Florida Panhandle | 8 | 8 | 0 | Trail 1647, Now it's Drinking practice |
| FtH3 (`fth3`) | [past](https://www.facebook.com/FoothillH3/past_hosted_events) · [up](https://www.facebook.com/FoothillH3/upcoming_hosted_events) | Los Angeles, CA | 8 | 8 | 0 | C Blockers 91st Birthday Trail |
| HK H3 (`hkh3`) | [past](https://www.facebook.com/h4hongkonghash/past_hosted_events) · [up](https://www.facebook.com/h4hongkonghash/upcoming_hosted_events) | Hong Kong | 8 | 4 | 0 | Frogging it to Bastille |
| LVH3 (`lvh3-cin`) | [past](https://www.facebook.com/Licking-Valley-Hash-House-Harriers-841860922532429/past_hosted_events) · [up](https://www.facebook.com/Licking-Valley-Hash-House-Harriers-841860922532429/upcoming_hosted_events) | Cincinnati, OH | 8 | 8 | 0 | July LVH3 Hash |
| Madison H3 (`madisonh3`) | [past](https://www.facebook.com/madisonHHH/past_hosted_events) · [up](https://www.facebook.com/madisonHHH/upcoming_hosted_events) | Madison, WI | 8 | 6 | 0 | The Finnish Five |
| MiHiHuHa (`mihi-huha`) | [past](https://www.facebook.com/MileHighH3/past_hosted_events) · [up](https://www.facebook.com/MileHighH3/upcoming_hosted_events) | Denver, CO | 8 | 0 | 0 | MiHiHuHa #549: - The Next Last Annual Hot Wet Balls Trail |
| MoA2H3 (`moa2h3`) | [past](https://www.facebook.com/MOA2H3/past_hosted_events) · [up](https://www.facebook.com/MOA2H3/upcoming_hosted_events) | Detroit, MI | 8 | 8 | 0 | Just Lena's Virgin Haring! |
| Narwhal H3 (`narwhal-h3`) | [past](https://www.facebook.com/HashNarwhal/past_hosted_events) · [up](https://www.facebook.com/HashNarwhal/upcoming_hosted_events) | Connecticut | 8 | 7 | 0 | Trail #??: First of the Mohegan Trails (NOON START) |
| Norfolk H3 (`norfolkh3`) | [past](https://www.facebook.com/NorfolkH3/past_hosted_events) · [up](https://www.facebook.com/NorfolkH3/upcoming_hosted_events) | Norfolk | 8 | 5 | 0 | Wednesday run |
| RH3C (`renh3`) | [past](https://www.facebook.com/rh3columbus/past_hosted_events) · [up](https://www.facebook.com/rh3columbus/upcoming_hosted_events) | Columbus, OH | 8 | 6 | 0 | Renegade #294 an Immaculate Cock Production |
| Survivor H3 (`survivor-h3`) | [past](https://www.facebook.com/SurvivorH3/past_hosted_events) · [up](https://www.facebook.com/SurvivorH3/upcoming_hosted_events) | Florida Panhandle | 8 | 7 | 0 | Drinking Practice! |
| SWH3 (`swh3`) | [past](https://www.facebook.com/sirwaltersh3/past_hosted_events) · [up](https://www.facebook.com/sirwaltersh3/upcoming_hosted_events) | Raleigh, NC | 8 | 7 | 0 | SWH3 #1788 |
| Von Tramp H3 (`vth3`) | [past](https://www.facebook.com/vontramph3/past_hosted_events) · [up](https://www.facebook.com/vontramph3/upcoming_hosted_events) | Vermont | 8 | 7 | 0 | VTH3 Trail #092: Getting Litter-ally Trashed on Green Up Day — Saturda |

## Pages with no events on either tab — likely dormant

Public Pages that render cleanly but expose neither upcoming nor past hosted_events. Either the kennel doesn't use FB events at all (posts trails as regular FB posts), the Page predates FB Events as a feature, or the Page is abandoned. Lower-priority for re-audit.

| Kennel | Handle | Region |
|---|---|---|
| Agnews (`agnews`) | [`SIliconeValleyHash`](https://www.facebook.com/SIliconeValleyHash/upcoming_hosted_events) | San Jose, CA |
| Butterworth H3 (`butterworth-h3`) | [`butterworth.hashhouseharriers`](https://www.facebook.com/butterworth.hashhouseharriers/upcoming_hosted_events) | Butterworth, MY |
| Gulf Coast H3 (`gch3`) | [`GulfCoastHashHouseHarriers`](https://www.facebook.com/GulfCoastHashHouseHarriers/upcoming_hosted_events) | Mobile, AL |
| Halve Mein (`halvemein`) | [`AHHHinc`](https://www.facebook.com/AHHHinc/upcoming_hosted_events) | Capital District, NY |
| JB H3 (`jb-h3`) | [`tjbhhh`](https://www.facebook.com/tjbhhh/upcoming_hosted_events) | Johor Bahru, MY |
| KCH3 (`kch3`) | [`KansasCityH3`](https://www.facebook.com/KansasCityH3/upcoming_hosted_events) | Kansas City, MO |
| Kowloon H3 (`kowloon-h3`) | [`kowloonhash`](https://www.facebook.com/kowloonhash/upcoming_hosted_events) | Hong Kong |
| Larryville H3 (`lh3-ks`) | [`LarryvilleH3`](https://www.facebook.com/LarryvilleH3/upcoming_hosted_events) | Lawrence, KS |
| Little Rock H3 (`lrh3`) | [`littlerockhashhouseharriers`](https://www.facebook.com/littlerockhashhouseharriers/upcoming_hosted_events) | Little Rock, AR |
| MH3 (`mh3-mn`) | [`MinneapolisHashHouseHarriers`](https://www.facebook.com/MinneapolisHashHouseHarriers/upcoming_hosted_events) | Minneapolis, MN |
| O2H3 (`o2h3`) | [`OtherOrlandoH3`](https://www.facebook.com/OtherOrlandoH3/upcoming_hosted_events) | Orlando, FL |
| PalH3 (`palh3`) | [`PalmettoH3`](https://www.facebook.com/PalmettoH3/upcoming_hosted_events) | Columbia, SC |
| Rotten Groton H3 (`rgh3`) | [`rottengrotonh3`](https://www.facebook.com/rottengrotonh3/upcoming_hosted_events) | Connecticut |
| SF H3 (`sfh3`) | [`sfhash`](https://www.facebook.com/sfhash/upcoming_hosted_events) | San Francisco, CA |
| SVH3 (`svh3`) | [`SIliconeValleyHash`](https://www.facebook.com/SIliconeValleyHash/upcoming_hosted_events) | San Jose, CA |

## Skipped — not a Page-shape `facebookUrl`

Reasons in priority order. **Group** rows are the largest pool and are the natural target for the T2b admin paste-flow PR. **Shortlink** rows can be promoted into the Page bucket by following the `/share/` or `/p/` redirect to recover the canonical handle — out of scope for this audit.

| Kennel | URL | Reason |
|---|---|---|
| NYCH3 (`nych3`) | [link](https://www.facebook.com/groups/nychash) | group |
| GGFM (`ggfm`) | [link](https://www.facebook.com/groups/198849596348/) | group |
| Buffalo H3 (`bh3`) | [link](https://www.facebook.com/groups/1692560221019401/) | group |
| Rhode Island H3 (`rih3`) | [link](https://www.facebook.com/groups/120140164667510/) | group |
| NOSE H3 (`nose-h3`) | [link](https://www.facebook.com/groups/NOSEHash) | group |
| Rumson (`rumson`) | [link](https://www.facebook.com/p/Rumson-H3-100063637060523/) | shortlink |
| BFM (`bfm`) | [link](https://www.facebook.com/groups/bfmh3) | group |
| Chicago H3 (`ch3`) | [link](https://www.facebook.com/groups/10638781851/) | group |
| CFMH3 (`cfmh3`) | [link](https://www.facebook.com/groups/570636943051356/) | group |
| FCMH3 (`fcmh3`) | [link](https://www.facebook.com/groups/570636943051356/) | group |
| Big Dogs H3 (`bdh3`) | [link](https://www.facebook.com/groups/137255643022023/) | group |
| 2CH3 (`2ch3`) | [link](https://www.facebook.com/groups/secondcityhhh) | group |
| Whiskey Wed H3 (`wwh3`) | [link](https://www.facebook.com/groups/wwwhhh) | group |
| 4X2H4 (`4x2h4`) | [link](https://www.facebook.com/groups/833761823403207) | group |
| Ragtime H3 (`rth3`) | [link](https://www.facebook.com/groups/213336255431069/) | group |
| DLH3 (`dlh3`) | [link](https://www.facebook.com/groups/SouthShoreHHH/) | group |
| SHITH3 (`shith3`) | [link](https://www.facebook.com/groups/756148277731360/) | group |
| W3H3 (`w3h3`) | [link](https://www.facebook.com/groups/273947756839837/) | group |
| DCH4 (`dch4`) | [link](https://www.facebook.com/groups/dch4hashhouse) | group |
| OTH4 (`oth4`) | [link](https://www.facebook.com/share/g/6ZoFa1A5jD7Ukiv9/) | shortlink |
| DCRT (`dcrt`) | [link](https://m.facebook.com/groups/636027323156298/) | group |
| DCPH4 (`dcph4`) | [link](https://www.facebook.com/groups/DCPH4/) | group |
| East Bay H3 (`ebh3`) | [link](https://www.facebook.com/groups/Ebhhh/) | group |
| Surf City H3 (`sch3-ca`) | [link](https://www.facebook.com/groups/SurfCityH3/) | group |
| CUNTH3 (`cunth3`) | [link](https://www.facebook.com/groups/1822849584637512) | group |
| Dublin H3 (`dh3`) | [link](https://www.facebook.com/groups/dublinhashhouseharriers/) | group |
| Edinburgh H3 (`edinburghh3`) | [link](https://www.facebook.com/groups/1343234319067769/) | group |
| Glasgow H3 (`glasgowh3`) | [link](https://www.facebook.com/groups/glasgowh3/) | group |
| MTH3 (`mth3`) | [link](https://www.facebook.com/groups/4739194099/) | group |
| Bull Moon (`bullmoon`) | [link](https://www.facebook.com/groups/bullmoonh3/) | group |
| LVH3 (`lvh3`) | [link](https://www.facebook.com/groups/lvh3/) | group |
| H5 (`h5-hash`) | [link](https://www.facebook.com/groups/h5rocks) | group |
| Chain Gang (`chain-gang-hhh`) | [link](https://www.facebook.com/groups/2606571919485199) | group |
| Fort Eustis H3 (`feh3`) | [link](https://www.facebook.com/groups/forteustish3/) | group |
| BDSMH3 (`bdsmh3`) | [link](https://www.facebook.com/groups/291959117911692/) | group |
| Tidewater H3 (`twh3`) | [link](https://www.facebook.com/groups/SEVAHHH) | group |
| 7H4 (`7h4`) | [link](https://www.facebook.com/groups/41511405734/) | group |
| Charlotte H3 (`ch3-nc`) | [link](https://www.facebook.com/groups/CharlotteH3/) | group |
| Asheville H3 (`avlh3`) | [link](https://www.facebook.com/groups/avlh3/) | group |
| CTrH3 (`ctrh3`) | [link](https://www.facebook.com/groups/carolinatrashH3/) | group |
| Austin H3 (`ah3`) | [link](https://www.facebook.com/groups/austinh3/) | group |
| KAW!H3 (`kawh3`) | [link](https://www.facebook.com/groups/KAWH3/) | group |
| Houston H3 (`h4-tx`) | [link](https://www.facebook.com/groups/HoustonHash/) | group |
| BMH3 (`bmh3-tx`) | [link](https://www.facebook.com/groups/teambrassmonkey/) | group |
| Mosquito H3 (`mosquito-h3`) | [link](https://www.facebook.com/groups/MosquitoH3/) | group |
| Dallas H3 (`dh3-tx`) | [link](https://www.facebook.com/groups/1645429635716687) | group |
| San Antonio H3 (`sah3`) | [link](https://www.facebook.com/groups/355324508352374) | group |
| BJH3 (`bjh3`) | [link](https://www.facebook.com/groups/bjhash) | group |
| C2H3 (`c2h3`) | [link](https://www.facebook.com/groups/corpuschristih3/) | group |
| Miami H3 (`mia-h3`) | [link](https://www.facebook.com/groups/miami.hash.house.harriers) | group |
| Wildcard H3 (`wildcard-h3`) | [link](https://www.facebook.com/groups/373426549449867/) | group |
| Palm Beach H3 (`pbh3`) | [link](https://www.facebook.com/groups/pbhhh/) | group |
| Tampa Bay H3 (`tbh3-fl`) | [link](https://www.facebook.com/groups/908538665893063/) | group |
| Jolly Roger H3 (`jrh3`) | [link](https://www.facebook.com/groups/139148932829915/) | group |
| St Pete H3 (`sph3-fl`) | [link](https://www.facebook.com/groups/stpetehashhouseharriers/) | group |
| Circus H3 (`circus-h3`) | [link](https://www.facebook.com/groups/circushash/) | group |
| NSAH3 (`nsah3`) | [link](https://www.facebook.com/groups/NSAH3) | group |
| LUSH (`lush`) | [link](https://www.facebook.com/groups/324974571563311/) | group |
| B2BH3 (`b2b-h3`) | [link](https://www.facebook.com/groups/1387039994854156) | group |
| Lakeland H3 (`lh3-fl`) | [link](https://www.facebook.com/groups/283053549709909) | group |
| BARFH3 (`barf-h3`) | [link](https://www.facebook.com/groups/712867073080299) | group |
| Spring Brooks H3 (`sbh3`) | [link](https://www.facebook.com/groups/1704337600123871) | group |
| Taco Tuesday H3 (`tth3-fl`) | [link](https://www.facebook.com/groups/tacotuesdayh3private/) | group |
| BVDH3 (`bvd-h3`) | [link](https://www.facebook.com/groups/506635549502193/) | group |
| JaxH3 (`jax-h3`) | [link](https://www.facebook.com/groups/JaxH3/) | group |
| Savannah H3 (`savh3`) | [link](https://www.facebook.com/groups/savh3) | group |
| ColH3 (`colh3`) | [link](https://www.facebook.com/groups/columbianh3/) | group |
| Upstate H3 (`uh3`) | [link](https://www.facebook.com/p/Upstate-Hash-House-Harriers-100087329174970/) | shortlink |
| StumpH3 (`stumph3`) | [link](https://www.facebook.com/groups/stumptownh3) | group |
| DWH3 (`dwh3`) | [link](https://www.facebook.com/share/g/MQZCtzzVQChFkXSY/) | shortlink |
| SalemH3 (`salemh3`) | [link](https://www.facebook.com/groups/106108826725143) | group |
| Eugene H3 (`eh3-or`) | [link](https://www.facebook.com/groups/EugeneH3/) | group |
| COH3 (`coh3`) | [link](https://www.facebook.com/groups/527235744035261/) | group |
| Seattle H3 (`sh3-wa`) | [link](https://www.facebook.com/groups/25456554474/) | group |
| Rain City H3 (`rch3-wa`) | [link](https://www.facebook.com/groups/25456554474/) | group |
| CUNTh (`cunth3-wa`) | [link](https://www.facebook.com/share/g/T7Ccn7uC2zUwekBj/) | shortlink |
| Tacoma H3 (`th3-wa`) | [link](https://www.facebook.com/groups/468065553263804/) | group |
| SSH3 (`ssh3-wa`) | [link](https://www.facebook.com/groups/61039539820/) | group |
| DH3 (`dh3-co`) | [link](https://www.facebook.com/groups/278463172274450) | group |
| BH3 (`bh3-co`) | [link](https://www.facebook.com/groups/boulderh3/) | group |
| DIM (`dim-h3`) | [link](https://www.facebook.com/groups/2147541855493092/) | group |
| MVH3 (`mvh3-day`) | [link](https://www.facebook.com/groups/1703366143261426) | group |
| Sin City H4 (`sch4`) | [link](https://www.facebook.com/groups/114560698574609/) | group |
| Queen City H4 (`qch4`) | [link](https://www.facebook.com/groups/795791177265728/) | group |
| Tokyo H3 (`tokyo-h3`) | [link](https://www.facebook.com/groups/896005733756352) | group |
| F3H3* (`f3h3`) | [link](https://www.facebook.com/groups/f3hash) | group |
| Sumo H3 (`sumo-h3`) | [link](https://www.facebook.com/groups/397839143619015) | group |
| Samurai H3 (`samurai-h3`) | [link](https://www.facebook.com/groups/105343206188684) | group |
| Y2H3 (`yoko-yoko-h3`) | [link](https://www.facebook.com/groups/655500274478375) | group |
| Hayama 4H (`hayama-4h`) | [link](https://www.facebook.com/groups/166489046749822) | group |
| Kyoto H3 (`kyoto-h3`) | [link](https://www.facebook.com/groups/kyoh3) | group |
| Osaka H3 (`osaka-h3`) | [link](https://www.facebook.com/groups/550003685094291) | group |
| BMPH3 (`bmph3-be`) | [link](https://www.facebook.com/groups/BMPH3) | group |
| NOH3 (`noh3`) | [link](https://www.facebook.com/groups/NewOrleansHash) | group |
| Choo-Choo H3 (`choochooh3`) | [link](https://www.facebook.com/groups/choochooh3) | group |
| STLH3 (`stlh3`) | [link](https://www.facebook.com/groups/1665303950422211) | group |
| AH3 (`ah3-nl`) | [link](https://www.facebook.com/groups/AmsterdamH3) | group |
| CH3 (`ch3-dk`) | [link](https://www.facebook.com/groups/500981696677688/) | group |
| CH4 (`ch4-dk`) | [link](https://www.facebook.com/groups/500981696677688/) | group |
| BCH3 (`bch3`) | [link](https://www.facebook.com/groups/BrewCityH3/) | group |
| Calgary H3 (`ch3-ab`) | [link](https://www.facebook.com/groups/CalgaryHHH) | group |
| SaintlyH3 (`saintlyh3`) | [link](https://www.facebook.com/groups/444202485756219) | group |
| ABQ H3 (`abqh3`) | [link](https://www.facebook.com/groups/abqhhh) | group |
| Blooming Fools H3 (`bfh3`) | [link](https://www.facebook.com/groups/bloomingfools/) | group |
| SG Harriets (`sgharriets`) | [link](https://www.facebook.com/groups/49667691372/) | group |
| Kampong H3 (`kampong-h3`) | [link](https://www.facebook.com/groups/96654980525/) | group |
| Singapore Sunday H3 (`sh3-sg`) | [link](https://www.facebook.com/groups/singaporesundayhash/) | group |
| Hash House Horrors (`hhhorrors`) | [link](https://www.facebook.com/groups/688904981144056/) | group |
| Gold Coast H3 (`gch3-au`) | [link](https://www.facebook.com/groups/gch3thegourmehash) | group |
| BTH3 (`bth3`) | [link](https://www.facebook.com/groups/bangkokthursdayhash) | group |
| ASS H3 (`ass-h3`) | [link](https://www.facebook.com/groups/ASSH3) | group |

## Next steps

1. **Seed the top N event-producing Pages** as `FACEBOOK_HOSTED_EVENTS` sources, mirroring the GSH3 row in `prisma/seed-data/sources.ts`. The migration + adapter are already in main; only the seed rows are needed.
2. **Historical backfill** — the past-events table is the natural input for a separate one-shot script (per the Seletar pattern documented in the FB integration plan). For each Page with a meaningful past-event count, a backfill run pulls the full archive of `start_timestamp + name + event_place` triples and inserts them as confirmed historical Events at trustLevel 8. Out of scope for the cron path; tracked separately.
3. **Re-audit past-only Pages first** on the 30/60/90 cadence — they're demonstrably active and most likely to flip to having upcoming events. Past-only count itself is a rough liveness/popularity ranking.
4. **Resolve shortlink redirects** (the `/share/` / `/p/` skipped rows) to recover canonical handles. Cheap follow-up; small script that follows one HTTP 301 per row.
5. **Group-only kennels** (the `group` skipped rows) feed the T2b paste-flow PR backlog. They cannot be auto-scraped via the hosted_events route; they need admin paste or kennel-admin-installed Graph API.
6. **Multi-FB-URL kennel schema** — see "Schema gap surfaced" above. Tracked in `docs/event-schema-future-fields.md` as a follow-up.
