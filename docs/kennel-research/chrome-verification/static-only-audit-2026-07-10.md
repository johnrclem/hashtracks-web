# Chrome verification — static-schedule-only audit (2026-07-10)

Companion to `../static-only-audit.md`. These 22 kennels are **STATIC_SCHEDULE-only** and
came back **UNCONFIRMED / needs-FB-check** from headless research: their schedules live in
**closed Facebook groups/pages** that can't be read from a server. A Claude-in-Chrome
session (logged into Facebook, with web search) can finish the job.

## Paste-into-Chrome prompt

> You are verifying whether Hash House Harriers (H3) running kennels are still active, and
> looking for any machine-ingestable schedule source. Today is 2026-07-10. For **each**
> kennel below, open its Facebook URL (and search the web) and report:
>
> 1. **Activity** — the date of the most recent post/event you can see, then classify:
>    `ACTIVE` (post/event within ~6 months), `DORMANT` (6–24 mo), `DEAD` (>2 yr or group
>    gone), or `PRIVATE` (group exists but you can't see any dated content).
> 2. **Dynamic source** — does the group's About/link section or any pinned post point to a
>    **website, Google Calendar, Meetup, iCal feed, WordPress/blog, or Harrier Central**
>    page that lists dated runs? If yes, give the exact URL. Facebook itself does **not**
>    count. If there's nothing, say "Facebook-only".
> 3. **Schedule** — confirm or correct the day/time/cadence noted below.
>
> Output one line per kennel: `code — ACTIVE/DORMANT/DEAD/PRIVATE — last signal date — source URL or "FB-only" — schedule confirm/correct`.
>
> **What we already checked (don't repeat — these are dead ends):** dedicated websites,
> Google Calendar/iCal probes, Meetup, Harrier Central (hashruns.org), WordPress/Blogger
> APIs, and regional aggregators (atlantahash.com board, china.hash.cn/hkmacao,
> malaysiahash.com, nzhhh.nz, hashnj.com, eh3.org). Each note below says what's already
> ruled out — your job is the Facebook read + confirming the retire/keep call.

### Kennels

**Georgia / Atlanta**
- `cunth3-atl` — CUNT H3, Atlanta GA — FB: search "Atlanta Area Hash Yap Yap Room" / CUNT H3 · believed 1st Tuesday 19:00 · dedicated site `ruacunt.beernear.com` DEAD; not on atlantahash.com board.
- `hmh3` — Hog Mountain H3, N. Georgia — FB: tied to "Black Sheep H3 / Atlanta" scene · believed 1st Sunday 13:30 · schedule derives from Black Sheep; board unfetchable.
- `pfh3` — Peach Fuzz H3, Augusta GA — FB Page: facebook.com/peachfuzzh3 (+ group /groups/peachfuzzh3) · believed biweekly Wednesday 18:30 · **RETIRE CANDIDATE** — blog `pfh3.blogspot.com` abandoned Nov 2019. Is the FB Page still posting trails?
- `cvh3` — Chattahoochee Valley H3, Columbus GA — FB: facebook.com/CVHHH · believed biweekly Saturday 11:00 · `cvh3.org` DEAD.
- `r2h3` — Rumblin' Roman H3, Rome GA — FB: search "Rumblin Roman Hash" (group) · believed 2nd Saturday 14:30 · **RETIRE CANDIDATE** — Google Site abandoned ~2022, romehash.com cert error. (Note: "Rome Hash" #1050 on AllEvents is Rome, ITALY — ignore.)

**South Carolina**
- `budh3` — Beaufort Ugly Dog H3, Beaufort SC — FB: facebook.com/groups/beaufortuglydog · believed biweekly Saturday 15:00 · old Yahoo group dead.
- `ch3-sc` — Charleston H3, Charleston SC — FB: facebook.com/groups/charlestonhash · believed weekly Thursday 18:30 · `charlestonhash.com` DEAD. (Do NOT confuse with the separate, active "Charleston Heretics" Meetup.)
- `colh3` — Columbian H3, Columbia SC — FB: facebook.com/groups/columbianh3 (+ page facebook.com/CH3.SC) · believed 1st & 3rd Sunday · Google Site last updated Feb 2024 ("reorganizing"); HashRego profile dormant.
- `sech3` — Secession H3, Columbia SC — FB: facebook.com/groups (search "Secession Hash Columbia") · believed biweekly Saturday 15:00 · WordPress abandoned 2015, Meetup deleted.

**Florida**
- `pbh3` — Palm Beach H3, Wellington FL — FB: facebook.com/groups/pbhhh · believed weekly Wednesday 18:30 · **DORMANT** — last public signal 2023 (proboards); `pbh3.org` redirects to FB.
- `wildcard-h3` — Wildcard H3, Fort Lauderdale FL — FB: facebook.com/groups/373426549449867 · believed weekly Monday 18:30 · fllhash.com lists FB only.

**Massachusetts / NJ**
- `poofh3` — PooFlingers H3, New England — FB: facebook.com/groups/pooflingers · believed monthly 3rd Saturday 14:00 · not on Boston Hash calendar.
- `nose-h3` — NOSE H3, North NJ — FB: facebook.com/groups/NOSEHash (closed) · believed summer Thursdays / winter Wednesdays 19:00 · hashnj.com lists it active.

**Alberta**
- `saintlyh3` — Saintly H3, St. Albert AB — FB: facebook.com/groups/444202485756219 · believed weekly Wednesday 18:30 · confirmed NOT on the eh3.org Edmonton hareline.

**Hong Kong** (china.hash.cn/hkmacao confirms all three are live — Chrome should confirm recency + apply schedule fixes)
- `fch3-hk` — Free China H3, Wan Chai — FB: facebook.com/groups/freechinah3 · believed monthly Saturday 13:00 (Jaffe Rd & Fenwick St).
- `hebe-h3` — Hebe H3, Sai Kung — FB: facebook.com/groups/HebeH3 · **schedule fix: 3rd Saturday 15:00** (seed says 1st).
- `hkfh3` — HK Friday H3 — FB: facebook.com/groups/197105523127 · **schedule fix: 2nd/3rd Friday 19:00** (seed says 1st).

**Malaysia**
- `butterworth-h3` — Butterworth H3, Penang mainland — FB: facebook.com/butterworth.hashhouseharriers · believed weekly Wednesday 18:00. (Penang *island* clubs are different kennels.)
- `ipoh-h3` — Ipoh H3, Perak — FB: search "Ipoh Hash House Harriers" · believed weekly Monday 18:00 · blog dead 2013.
- `kluang-h3` — Kluang H3, Johor — FB: search "Kluang Hash" · believed weekly Wednesday 18:00.
- `jb-h3` — JB H3, Johor Bahru — FB: facebook.com/tjbhhh · believed weekly Saturday 17:00 · **chapter identity ambiguous** — confirm whether this is "JB City Hash" (Sat) vs original JBHHH (Wed).
- `kk-h3` — KK H3, Kota Kinabalu Sabah — FB: search "Kota Kinabalu HHH / K2 H4" · believed weekly Monday 16:30.

## Feed the results back

Save the Chrome output alongside this file, then update `../static-only-audit.md`:
- flip any `ACTIVE` kennels out of UNCONFIRMED,
- confirm/deny the two **RETIRE CANDIDATES** (`pfh3`, `r2h3`),
- apply the HK schedule fixes (`hebe-h3`, `hkfh3`) if a schedule edit PR is opened.
