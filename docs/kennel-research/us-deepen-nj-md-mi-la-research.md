# Deepening Coverage: NJ, MD, MI, LA — Kennel Research

Research date: 2026-04-08

## Summary

| State      | Existing | New Found | Tier 1 | Tier 2 | Tier 3 |
|------------|----------|-----------|--------|--------|--------|
| New Jersey | 4        | 5         | 1      | 2      | 2      |
| Maryland   | ~6       | 1         | 0      | 0      | 1      |
| Michigan   | 3        | 3         | 1      | 1      | 1      |
| Louisiana  | 2        | 3         | 1      | 1      | 1      |
| **Total**  | **~15**  | **12**    | **3**  | **4**  | **5**  |

Tier definitions:
- **Tier 1:** Active, scrapable source (website, Google Calendar, Meetup, etc.)
- **Tier 2:** Active, Facebook-only or limited web presence, potential STATIC_SCHEDULE
- **Tier 3:** Possibly inactive, no scrapable source, or niche/specialty kennel

---

## New Jersey (5 new kennels)

### Existing coverage (DO NOT add)
- `summit` — Summit H3 (North NJ, weekly)
- `sfm` — Summit Full Moon (North NJ, monthly)
- `asssh3` — All Seasons Summit Shiggy H3 (North NJ)
- `rumson` — Rumson H3 (Central Shore, weekly Saturday)

### New discoveries

#### 1. Princeton Hash House Harriers (PHHH) — Tier 1
- **Area:** Trenton/Princeton, Central NJ
- **Schedule:** 2nd Sunday of month
- **Website:** https://princetonol.com/groups/phhh/
- **Facebook:** https://www.facebook.com/groups/PrincetonHHH/events/
- **HashRego:** Listed (legacy)
- **Source type:** Website HTML scraper or STATIC_SCHEDULE (2nd Sunday monthly)
- **Proposed kennelCode:** `princeton-h3` (NOTE: `phhh` is taken by Phuket HHH)
- **Collision check:** No collision with `princeton-h3`
- **Notes:** Active kennel with a website. Monthly schedule makes STATIC_SCHEDULE viable, but website may have hareline details.

#### 2. NOSE Hash (North Of Seventy Eight) — Tier 2
- **Area:** North NJ (north of I-78)
- **Schedule:** Thursdays 7 PM (summer), Wednesdays 7 PM (winter)
- **Facebook:** https://www.facebook.com/groups/NOSEHash
- **Source type:** STATIC_SCHEDULE (weekly, seasonal day switch) or Facebook-only
- **Proposed kennelCode:** `nose-h3`
- **Collision check:** No collision
- **Notes:** Active weekly kennel in North NJ. Facebook-only presence. STATIC_SCHEDULE with seasonal day switching would work. Contact: anallickitall@gmail.com

#### 3. Jersey Devil Hash House Harriers (JDH3) — Tier 2
- **Area:** Pine Barrens / South NJ (south of Joint Base MDL). BFM lists them as "north Jersey" with trail running, but Summit site says Pine Barrens — likely trails in multiple NJ areas.
- **Schedule:** 4th Sunday of month
- **Facebook:** https://www.facebook.com/groups/159738971079187/
- **HashRego:** https://hashrego.com/kennels_legacy/JDH3
- **Source type:** STATIC_SCHEDULE (4th Sunday monthly) or HASHREGO
- **Proposed kennelCode:** `jdh3`
- **Collision check:** No collision
- **Notes:** Monthly kennel. HashRego legacy listing suggests they may use HashRego for events. STATIC_SCHEDULE is straightforward.

#### 4. Taco Tuesday H3 (TTH3) — Tier 3
- **Area:** South Jersey
- **Schedule:** Once per month (Tuesdays, exact week varies)
- **Facebook:** https://www.facebook.com/groups/147746729044643
- **Source type:** Facebook-only (no scrapable source)
- **Proposed kennelCode:** `tth3-nj` (NOTE: `tth3-fl` exists for Tampa Taco Tuesday)
- **Collision check:** Need `-nj` suffix to avoid Florida collision
- **Notes:** Monthly kennel with no website. Facebook-only. Listed by BFM as "always ends with tacos." Low priority.

#### 5. Bimbos of Jersey H3 (BJH3) — Tier 3
- **Area:** Central NJ (founded in Roosevelt, NJ)
- **Schedule:** Random Friday nights
- **Founded:** 2008
- **Contact:** BJH3@yahoogroups.com, clayslave@hotmail.com
- **Source type:** No scrapable source (YahooGroups is defunct)
- **Proposed kennelCode:** `bjh3`
- **Collision check:** No collision
- **Notes:** Founded 2008. "Random Friday nights" suggests irregular schedule. YahooGroups contact suggests potentially inactive. Low priority.

### Kennels NOT added (insufficient evidence or out of scope)
- **Dark City H3** — Listed on hashnj.com as "down the shore, 3rd Sunday." Website (gardnertrailrun.com) appears to be a trail running site, not hash-specific. Likely defunct or merged. Skipped.
- **Main Line H3** — Listed on BFM local kennels page as Philly suburbs, monthly Sundays. This is a Pennsylvania kennel, not NJ. Out of scope.

---

## Maryland (1 new kennel)

### Existing coverage (DO NOT add)
- `cch3` — Charm City H3 (Baltimore, biweekly)
- `bah3` — BAH3 (Baltimore/Annapolis, weekly Sunday)
- `ofh3` — Old Frederick H3 (Frederick, monthly)
- `smuttycrab` — SMUTTyCrab (Southern MD, biweekly)
- `hillbillyh3` — Hillbilly H3 (DC metro/Western MD overlap)
- Plus DC-area kennels that overlap into MD (DCH4, DCFMH3, MVH3, etc.)

### New discoveries

#### 1. Smutt Butts Full Moon H3 (SBFMH3) — Tier 3
- **Area:** Southern Maryland (same area as SMUTTyCrab)
- **Schedule:** Monthly, full moon
- **HashRego:** https://hashrego.com/events/sbfmh3-usa-nash-hash-2024-2024
- **Source type:** No scrapable source found. Likely coordinates via SMUTTyCrab channels.
- **Proposed kennelCode:** `sbfmh3`
- **Collision check:** No collision
- **Notes:** This appears to be the full-moon spinoff of SMUTTyCrab. Hosted USA Nash Hash 2024. Active but no independent web presence. Could add as a kennel record only, linked to SMUTTyCrab source eventually. Very low priority — essentially the same community as SMUTTyCrab.

### Research conclusions for Maryland
Maryland's hash scene is well-covered. The existing kennels (CCH3, BAH3, OFH3, SMUTTyCrab) plus DC-overlap kennels cover Baltimore, Annapolis, Frederick, and Southern MD. No Eastern Shore kennel was found. No new Tier 1 or Tier 2 kennels discovered. The only gap is SBFMH3 which is essentially SMUTTyCrab's full-moon variant.

---

## Michigan (3 new kennels)

### Existing coverage (DO NOT add)
- `moa2h3` — Motown Ann Arbor H3 (Detroit/Ann Arbor, weekly)
- `demon-h3` — DeMon H3 (Detroit Monday)
- `glh3` — Greater Lansing H3 (Lansing, biweekly)

### New discoveries

#### 1. Grand Rapids Hash House Harriers (GRH3) — Tier 1
- **Area:** Grand Rapids, MI (West Michigan)
- **Schedule:** Regular runs (frequency unclear from website — site shows 2010-2013 schedules, but Facebook group is active)
- **Website:** https://www.grh3.com/
- **Facebook:** https://www.facebook.com/groups/353624021377972/
- **Source type:** Facebook group (active) or website schedule page. Website may be stale (last schedule shown is 2013). Facebook is the primary coordination channel. Could try HTML_SCRAPER on website schedule page if it has future events, otherwise STATIC_SCHEDULE if regular pattern confirmed.
- **Proposed kennelCode:** `grh3`
- **Collision check:** No collision
- **Notes:** Grand Rapids is Michigan's 2nd largest city. The kennel has a website and Facebook group. Website appears dated (2010-era design, schedules through 2013), but Facebook group is active. eBay has GRH3 merchandise listed. This is the most impactful Michigan add — covers West Michigan.

#### 2. Cherry Capital Hash House Harriers — Tier 2
- **Area:** Traverse City, MI (Northern Lower Peninsula)
- **Schedule:** Unknown regularity (memorial hash documented Nov 2020)
- **Facebook:** https://www.facebook.com/groups/404147646276146/
- **Source type:** Facebook-only (no website found)
- **Proposed kennelCode:** `cch3-mi` (NOTE: `cch3` is taken by Charm City)
- **Collision check:** Need `-mi` suffix
- **Notes:** Listed on MoA2H3 website as a Michigan kennel. Facebook group exists. Activity level uncertain — the only documented event found was a 2020 memorial hash. Could be seasonal/occasional. Traverse City is a seasonal tourist area. Lower confidence in regular activity.

#### 3. Petoskey Hash House Harriers — Tier 3
- **Area:** Petoskey, MI (Northern Lower Peninsula)
- **Schedule:** Unknown
- **Facebook:** Listed on MoA2H3 site (Facebook group link)
- **Source type:** Facebook-only (no website found)
- **Proposed kennelCode:** `petoskey-h3`
- **Collision check:** No collision
- **Notes:** Listed on MoA2H3 website as a Michigan kennel. Very limited web presence. Petoskey is a small resort town (pop ~5,000). Likely seasonal or very infrequent. Lowest priority.

### Research conclusions for Michigan
Grand Rapids (GRH3) is the clear priority — it's Michigan's 2nd-largest metro and has both a website and active Facebook group. Cherry Capital (Traverse City) and Petoskey are Northern Michigan seasonal/occasional kennels with Facebook-only presence.

---

## Louisiana (3 new kennels)

### Existing coverage (DO NOT add)
- `noh3` — New Orleans H3 (weekly Saturday)
- `voodoo-h3` — Voodoo H3 (weekly Thursday)

### New discoveries

#### 1. Baton Rouge Hash House Harriers (BRH3) — Tier 1
- **Area:** Baton Rouge, LA
- **Website:** https://batonrougeh3.wordpress.com/
- **Calendar:** https://batonrougeh3.wordpress.com/calendar/
- **Facebook:** https://www.facebook.com/groups/batonrougeh3/
- **Source type:** WordPress blog (could use WordPress API or HTML scraper). Calendar page exists but was loading via JS when checked. Facebook group is active.
- **Proposed kennelCode:** `brh3-la` (NOTE: `brh3` is taken by Brooklyn H3)
- **Collision check:** Need `-la` suffix
- **Notes:** Baton Rouge is Louisiana's capital and 2nd-largest city. The kennel has a WordPress site with calendar. This is the highest-priority Louisiana add. Schedule frequency unclear from web research — likely biweekly or monthly.

#### 2. CoonASS Hash House Harriers — Tier 2
- **Area:** Lafayette, LA (Cajun Country)
- **Schedule:** Saturdays 4:00 PM - 7:00 PM
- **Website:** http://coonassh3.com/ (ECONNREFUSED — may be down)
- **Facebook:** https://www.facebook.com/groups/coonassh3/
- **Listed on:** Voodoo H3 "Other Kennels" page, LikeALocal Guide
- **Source type:** Facebook-only (website appears down). Could be STATIC_SCHEDULE if regular Saturday pattern.
- **Proposed kennelCode:** `coonass-h3`
- **Collision check:** No collision
- **Notes:** Lafayette kennel. Listed on Voodoo H3's other kennels page. Website was down when checked. Saturday 4-7 PM schedule from LikeALocal Guide. Active enough to be cross-listed. STATIC_SCHEDULE candidate if we confirm the frequency (every Saturday vs biweekly).

#### 3. Crescent Shiggy Hash House Harriers (CSH3) — Tier 2
- **Area:** New Orleans, LA
- **Website:** http://www.crescentshiggyh3.org/ (ECONNREFUSED — may be down)
- **Facebook:** https://www.facebook.com/crescentshiggyh3/
- **Listed on:** Voodoo H3 "Other Kennels" page
- **Source type:** Facebook-only (website down)
- **Proposed kennelCode:** `csh3`
- **Collision check:** No collision
- **Notes:** New Orleans shiggy (off-road/trail) kennel. Website was down when checked. Facebook page exists. Listed by Voodoo H3. Schedule unknown. This is a third New Orleans kennel alongside NOH3 and Voodoo. Lower priority since NOH3 and Voodoo already cover NOLA.

### Kennels NOT added (insufficient evidence)
- **NOLA Full Moon Hash House Harriers** — Listed on Voodoo H3's other kennels page with a Facebook group link. Full moon specialty kennel. Facebook-only, no website. Monthly full moon schedule. Very low priority — niche specialty kennel with no scrapable source. Skipped.
- **Full on Neon Bossier/Shreveport H3** — Only reference found was a name on LRH3's 50th anniversary attendee list. No website, no Facebook found, no schedule info. Likely very small/occasional. Skipped.

---

## Recommended Ship List

### Immediate (Tier 1 — have scrapable sources)
1. **Princeton H3** (`princeton-h3`) — STATIC_SCHEDULE (2nd Sunday monthly) or website scraper
2. **Grand Rapids H3** (`grh3`) — Facebook group or website schedule (needs further investigation of source viability)
3. **Baton Rouge H3** (`brh3-la`) — WordPress site with calendar

### Next wave (Tier 2 — STATIC_SCHEDULE candidates)
4. **NOSE Hash** (`nose-h3`) — STATIC_SCHEDULE (weekly, seasonal day switch Thu/Wed)
5. **Jersey Devil H3** (`jdh3`) — STATIC_SCHEDULE (4th Sunday monthly)
6. **CoonASS H3** (`coonass-h3`) — STATIC_SCHEDULE (Saturdays, frequency TBD)
7. **Crescent Shiggy H3** (`csh3`) — Facebook-only, schedule unknown

### Deferred (Tier 3 — low priority)
8. **Taco Tuesday H3 NJ** (`tth3-nj`) — Facebook-only, monthly
9. **Bimbos of Jersey H3** (`bjh3`) — Likely inactive
10. **Cherry Capital H3** (`cch3-mi`) — Seasonal/occasional, Facebook-only
11. **Petoskey H3** (`petoskey-h3`) — Very small/seasonal, Facebook-only
12. **Smutt Butts Full Moon H3** (`sbfmh3`) — SMUTTyCrab spinoff, no independent source

---

## Region/Source Notes

### New regions needed
- **Central NJ** — For Princeton H3 (Trenton/Princeton area)
- **Grand Rapids, MI** — For GRH3
- **Baton Rouge, LA** — For BRH3
- **Lafayette, LA** — For CoonASS H3 (if shipped)
- **Traverse City, MI** — For Cherry Capital (if shipped)

### Source considerations
- **Princeton H3:** Check if princetonol.com has a machine-readable hareline. If not, STATIC_SCHEDULE with `FREQ=MONTHLY;BYDAY=2SU`.
- **GRH3:** Website is very dated (2010-era). Facebook group is the real coordination channel. May need STATIC_SCHEDULE if no web hareline found.
- **BRH3:** WordPress site — could try WordPress REST API (`/wp-json/wp/v2/posts`) for event posts, or scrape the calendar page.
- **NOSE Hash:** STATIC_SCHEDULE with two rules: `FREQ=WEEKLY;BYDAY=TH` (May-Oct) and `FREQ=WEEKLY;BYDAY=WE` (Nov-Apr).
