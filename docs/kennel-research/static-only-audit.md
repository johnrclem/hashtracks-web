# Static-Schedule-Only Kennel Audit

**Date:** 2026-07-10
**Scope:** Every kennel in the production Railway DB whose **only enabled source** is a
`STATIC_SCHEDULE` (RRULE-generated placeholder events, `trustLevel: 3` — the
Facebook-only last resort). Goal: (a) confirm each kennel is actually still active, and
(b) find a real dynamic source we could pull from instead.

**Method:** DB query for static-only kennels → per-kennel web research (activity signal +
source-escalation probe: GCal > Meetup > iCal > Harrier Central > WordPress/Blogger API >
HTML page). Candidate sources were fetched live to confirm they return real events.
Facebook/Instagram pages are activity evidence but **not** ingestable sources.

> **This audit document itself makes no code, seed, or schema changes** — it's the input
> to onboarding/retirement decisions. (The accompanying PR does act on one finding by
> onboarding GATR H3; everything else here is assessment pending follow-up.)

Query used (re-runnable):
```sql
SELECT k.region, k."shortName", k."kennelCode"
FROM "Kennel" k
JOIN "SourceKennel" sk ON sk."kennelId" = k.id
JOIN "Source" s ON s.id = sk."sourceId"
WHERE s.enabled = true
GROUP BY k.id
HAVING bool_and(s.type = 'STATIC_SCHEDULE');   -- 32 rows
```

---

## Headline results

- **32 kennels** are static-schedule-only in prod.
- **Dynamic source found & live-verified: 3 kennels** — `gatr-h3` (WordPress.com API,
  **HIGH**), `mgh4` + `w3h3-ga` (one shared HTML page on mgh4.com, **MED**, currently
  dormant).
- **Weak/fragile HTML only: 1** — `hvh3` (undated "upcumming runs" page).
- **Ruled out on re-check: `budapest-h3`** — DORMANT (last signal Oct 2025, ~9 mo old);
  its `.org` has no DNS at all (dead direct + residential + VPN) and it announces via a
  Google Group. Keep static.
- **24 kennels are Facebook/Instagram-only** — no ingestable upgrade exists today; keep
  STATIC_SCHEDULE. (Plus `budapest-h3` — Google Group / dead DNS — and `hvh3`, whose only
  machine-readable surface is a fragile undated HTML page; both also stay static.)
- **Retirement — resolved by the Chrome pass (see below): `pfh3` DEAD (retire confirmed;
  last FB post Aug 2022).** `r2h3` **ambiguous** — private group exists but no posts in the
  last month; needs a member's view before cutting.
- **Bonus — schedule corrections** discovered for 3 HK kennels (see table notes).
- **Facebook-only kennels were Chrome-verified 2026-07-10** — see the next section; many
  prior `UNCONFIRMED`/`DORMANT` rows are now confirmed **ACTIVE**.

---

## Chrome verification (2026-07-10)

Full Facebook + web pass over all 22 FB-only kennels in a logged-in browser — only
publicly visible text, no private-group joins or privacy bypass, no photo collection. For
private groups, FB's public **Activity** panel ("posts in the last month") is the liveness
signal even when individual posts aren't visible.

> **Correction:** an earlier automated skim read `pfh3`'s *obfuscated* FB timestamps as
> current-summer. A proper session shows its last post is **Aug 8 2022** — `pfh3` is
> **DEAD (retire)**, not active. FB date obfuscation is why activity-panel counts (not
> individual post dates) are the reliable signal.

**Retirements:** `pfh3` **DEAD** (last post Aug 2022) — **retire confirmed**. `r2h3`
**ambiguous** — a private group exists (`/groups/781136165728313`, 115 members, "2nd
Saturday of each month" in its description) but shows *no posts in the last month*; needs a
member's view before cutting.

**Confirmed ACTIVE (flip out of UNCONFIRMED/DORMANT):**

| kennel | signal | notes |
|---|---|---|
| `pbh3` | 15 today / **800 last month** (1.6K members) | was DORMANT → ACTIVE |
| `colh3` | 6 today / **628 last month** | private, very active |
| `saintlyh3` | 8 today / **710 last month** | private |
| `sech3` | 11 last month (`/groups/SHHHCOLA`) | flip out of UNCONFIRMED |
| `hkfh3` | 43 last month | HK Friday Hash; schedule 2nd/3rd Fri consistent |
| `wildcard-h3` | 4 today / 108 last month | ⚠️ group is "**South Florida HHH**", not Wildcard-specific — verify identity |
| `hebe-h3` | public group, comment ≈May 2026 | **schedule fix confirmed: monthly Saturday 15:00** (per About) |
| `nose-h3` | 2 last month | low but alive |
| `kluang-h3` | 1 last month (`/groups/Kluangh3`) | — |
| `butterworth-h3` | last post ~Jun 19 2026 | weekly Wed not precisely confirmable |
| `ipoh-h3` | 2026 committee + Jul-2026 album | bio **confirms "every Monday 6:00pm"** (matches seed) |
| `jb-h3` | runs May 2026 + Oct/Nov 2025 (#2902/#2904) | ⚠️ **identity: original JBHHH (1968), runs WEDNESDAYS** — seed's "JB City Hash / Saturday 17:00" is a mismatch to fix |
| `kk-h3` | K2 H4 tagged in Jun–Jul 2026 posts | ⚠️ old page ran **Fridays** (not seed's Monday 16:30); multiple KK kennels — needs confirmation |
| `fch3-hk` | active per china.hash.cn | group not publicly visible this session |
| `poofh3` | Von Tramp IG (~May 2026) hosted them; Happy Valley directory lists active | no direct FB group visible |
| `kuching-h3` | scene active (Interhash 2028) | — |

**DEAD / unresolved:** `pfh3` (retire), `cvh3` (CVHHH page gone, HashRego empty, cvh3.org
dead; cadence "biweekly Saturdays"), `budh3` (unfindable), `ch3-sc` (folded — the only
active Charleston kennel is the excluded Heretics; charlestonhash.com dead), `cunth3-atl`
(unfindable; site dead). `hmh3` remains **unconfirmed** — no dedicated page; activity only
inferable from Black Sheep H3 (active).

**Schedule corrections to apply** (independent of source changes): `hebe-h3` → monthly
Saturday **15:00** (confirmed); `hkfh3` → **2nd/3rd Friday** 19:00 (consistent). **Flag for
human confirmation before a schedule PR:** `jb-h3` (→ JBHHH / **Wednesday**, not Saturday
17:00) and `kk-h3` (→ possibly **Friday**, not Monday 16:30) — both reverse what the seed
notes currently claim.

---

## Per-kennel table

Activity: **ACTIVE** (signal ≤6 mo) · **DORMANT** (6–24 mo) · **DEAD** (>2 yr / folded) ·
**UNCONFIRMED** (closed FB only, no datable signal).
Action: **ONBOARD** (build the found source) · **KEEP** (static, no better option) ·
**VERIFY** (needs Chrome/FB check) · **RETIRE?** (candidate for removal).

> **Note:** the **Chrome verification (2026-07-10)** section above is the current status of
> truth for the Facebook-only kennels — where a row below still reads `UNCONFIRMED`, that
> section supersedes it (most flipped to **ACTIVE**; `pfh3` → **DEAD/RETIRE**).

| Region | Kennel | code | Activity | Best dynamic source | Action |
|---|---|---|---|---|---|
| Atlanta, GA | CUNT H3 | `cunth3-atl` | UNCONFIRMED (board scene active 2026-07) | none — **confirmed not on atlantahash.com board** (no Tuesday forum; title search = 0, via VPN egress); dedicated site dead | VERIFY / KEEP |
| Atlanta, GA | HMH3 (Hog Mountain) | `hmh3` | UNCONFIRMED (board scene active 2026-07) | none — **confirmed not a board forum** (piggybacks Black Sheep Sunday; title search = 0, via VPN egress) | VERIFY / KEEP |
| Augusta, GA | Peach Fuzz H3 | `pfh3` | **DEAD** (Chrome: FB Page last post Aug 8 2022; blog dead 2019) | NONE | **RETIRE** |
| Boston, MA | PooFH3 (PooFlingers) | `poofh3` | UNCONFIRMED | NONE — Facebook-only | VERIFY / KEEP |
| Budapest | Budapest H3 | `budapest-h3` | **DORMANT** (last signal #1853 Oct 2025, ~9 mo old — no signal since Jan 2026) | none usable — `budapesthashhouseharriers.org` **domain has no DNS** (dead direct + residential + VPN); announces via Google Group (not ingestable) | KEEP (recheck domain) |
| Butterworth, MY | Butterworth H3 | `butterworth-h3` | UNCONFIRMED | NONE — Facebook-only | VERIFY / KEEP |
| Charleston, SC | BUDH3 | `budh3` | UNCONFIRMED | NONE — FB-only (old Yahoo group dead) | VERIFY / KEEP |
| Charleston, SC | Charleston H3 | `ch3-sc` | UNCONFIRMED | NONE — `charlestonhash.com` DEAD; FB-only | VERIFY / KEEP |
| Columbia, SC | ColH3 (Columbian) | `colh3` | UNCONFIRMED (Google Site "reorganizing", last upd Feb 2024) | HashRego profile exists but dormant (LOW) | VERIFY / KEEP |
| Columbia, SC | SecH3 (Secession) | `sech3` | UNCONFIRMED | none — WordPress **abandoned 2015**, Meetup deleted | VERIFY / KEEP |
| Columbus, GA | CVH3 (Chattahoochee Valley) | `cvh3` | UNCONFIRMED | NONE — `cvh3.org` DEAD; FB-only. **Not on Atlanta board** (Columbus ≠ Atlanta metro; title search = 0, via VPN egress) | VERIFY / KEEP |
| Edmonton, AB | SaintlyH3 | `saintlyh3` | UNCONFIRMED | NONE — FB-only (eh3.org hareline does **not** list Saintly) | VERIFY / KEEP |
| Hamilton, NZ | Tokoroa H3 | `tokoroa-h3` | **ACTIVE** (committee named Feb 2026) | NONE — Facebook-only | KEEP |
| Hong Kong | Free China H3 | `fch3-hk` | UNCONFIRMED (directory-confirmed live) | NONE — Facebook-only | VERIFY / KEEP |
| Hong Kong | Hebe H3 | `hebe-h3` | UNCONFIRMED (directory-confirmed live) | NONE — FB-only · **fix schedule: 3rd Sat (not 1st)** | VERIFY / KEEP+fix |
| Hong Kong | HKFH3 (HK Friday) | `hkfh3` | UNCONFIRMED (directory-confirmed live) | NONE — FB-only · **fix schedule: 2nd/3rd Fri (not 1st)** | VERIFY / KEEP+fix |
| Ipoh, MY | Ipoh H3 | `ipoh-h3` | UNCONFIRMED | NONE — blog dead 2013; FB-only | VERIFY / KEEP |
| Johor | Kluang H3 | `kluang-h3` | UNCONFIRMED | NONE — directory/FB-only | VERIFY / KEEP |
| Johor Bahru, MY | JB H3 | `jb-h3` | UNCONFIRMED | NONE — FB-only (chapter identity ambiguous — see notes) | VERIFY / KEEP |
| Kota Kinabalu, MY | KK H3 | `kk-h3` | UNCONFIRMED | NONE — Facebook-only | VERIFY / KEEP |
| Kuching, MY | Kuching H3 | `kuching-h3` | **ACTIVE** (scene won Interhash 2028 bid, Jun 2026) | NONE — Facebook-only | KEEP |
| Little Rock, AR | Little Rock H3 | `lrh3` | **ACTIVE** (Green Dress wknd Mar 2026) | NONE — `lrhash.com` static, weekly hareline on FB only | KEEP |
| Macon, GA | MGH4 | `mgh4` | **DORMANT** (last run Jul 19 2025) | **HTML** — `mgh4.com/page/next-hash` — MED (verified live) | ONBOARD (shared w/ w3h3-ga) |
| Macon, GA | W3H3 | `w3h3-ga` | **DORMANT** (last run Oct 29 2025) | **HTML** — `mgh4.com/page/next-hash` — MED (verified live) | ONBOARD (shared w/ mgh4) |
| Miami, FL | Palm Beach H3 | `pbh3` | **ACTIVE** (Chrome: private group, 800 posts/last month) | NONE — Facebook-only | KEEP |
| Miami, FL | Wildcard H3 | `wildcard-h3` | UNCONFIRMED | NONE — Facebook-only | VERIFY / KEEP |
| New Jersey | Rumson | `rumson` | **ACTIVE** (2,500th run Feb/Mar 2026) | NONE — FB-only (RunSignUp for annual events only) | KEEP |
| North NJ | NOSE H3 | `nose-h3` | UNCONFIRMED (hashnj.com directory listed) | NONE — closed FB group | VERIFY / KEEP |
| Orlando, FL | GATR H3 | `gatr-h3` | **ACTIVE** (run #343, Jun 2026) | ✅ **WordPress.com API** — `public-api.wordpress.com/wp/v2/sites/gatrh3.wordpress.com/posts` — **HIGH (verified: API `found`=36, adapter parsed 18 events from the latest 20 posts)** | **ONBOARDED** (static disabled) |
| Pioneer Valley, MA | HVH3 (Happy Valley) | `hvh3` | ACTIVE-ish (undated #401–402, likely 2025–26) | HTML — `happyvalleyh3.org/upcumming-runs/` — LOW (undated, fragile) | KEEP (or fragile scrape) |
| Rome, GA | R2H3 (Rumblin' Roman) | `r2h3` | **AMBIGUOUS** (Chrome: private group `/groups/781136165728313`, 115 members, "2nd Saturday" — but no posts in last month; site dead ~2022) | NONE — Facebook-only | VERIFY (member) — do not auto-retire |
| Wellington, NZ | T3H3 | `t3h3-nz` | **ACTIVE** (Jul 2026 event; nzhhh.nz confirms) | NONE — Facebook-only | KEEP |

---

## Recommended onboarding queue (cheapest wins first)

1. **GATR H3 (`gatr-h3`) — WordPress.com API — HIGH confidence. ✅ DONE (this PR).**
   `public-api.wordpress.com/wp/v2/sites/gatrh3.wordpress.com/posts` reports `found`=36
   posts (latest 2026-06-04); the adapter requests the newest 20 and parsed 18 events,
   each with run number (title `GATRH3 #NNN`), date, start time, address, length, cost.
   Because the real cadence is ~monthly on **varying** Saturdays — not the seeded "3rd
   Saturday" — a fixed static RRULE would phantom on the wrong dates, so the trust-3
   static source was **disabled** rather than kept as a fallback (the blog is
   authoritative). Seeded as a trust-7 HTML_SCRAPER.

2. **MGH4 (`mgh4`) + W3H3 (`w3h3-ga`) — one HTML adapter on `mgh4.com` — MED.**
   `https://mgh4.com/page/next-hash` (and `/page/hareline`) is a BlogEngine.NET page
   carrying dated runs for **both** Macon kennels with time + location. One config-driven
   or bespoke HTML scraper feeds both. **Caveat:** the site itself says "we are having
   trouble getting people to hare trails" and the latest posted runs are stale
   (MGH4 Jul 2025, W3H3 Oct 2025) — onboard, but expect thin/dormant output; keep the
   static fallback beneath it.

3. ~~**Budapest H3 (`budapest-h3`) — self-hosted WordPress.**~~ **Ruled out (2026-07-10).**
   `budapesthashhouseharriers.org` has **no DNS at all** — no A record, no NS record —
   confirmed unreachable direct, via residential relay, and via VPN egress. The club is
   active (runs through Oct 2025) but announces via a Google Group
   (`groups.google.com/g/budapesthhh`), which we can't ingest. Keep STATIC_SCHEDULE;
   re-check the domain later (it may have simply lapsed).

## Keep-static (Facebook-only, no ingestable source) — 24 kennels

`cunth3-atl`, `hmh3`, `poofh3`, `butterworth-h3`, `budh3`, `ch3-sc`, `colh3`, `sech3`,
`cvh3`, `saintlyh3`, `tokoroa-h3`, `fch3-hk`, `hebe-h3`, `hkfh3`, `ipoh-h3`, `kluang-h3`,
`jb-h3`, `kk-h3`, `kuching-h3`, `lrh3`, `pbh3`, `wildcard-h3`, `nose-h3`, `t3h3-nz`.
(`hvh3` also effectively belongs here unless the fragile undated HTML page is worth a
scraper.) These have live/plausible activity but publish schedules only in closed
Facebook groups, which the merge pipeline can't ingest — STATIC_SCHEDULE stays the right
call.

## Candidates for retirement (verify on Facebook first)

- **R2H3 (`r2h3`)** — official Google Site abandoned ~2022, `romehash.com` cert error,
  only a private FB group. No activity signal in >2 years.
- **Peach Fuzz H3 (`pfh3`)** — Blogspot abandoned Nov 2019; a FB *Page* exists but no
  readable recent post. Trending dead.

Both should be confirmed via Facebook (Chrome pass) before removing — a live FB group
would flip them back to KEEP.

## Schedule corrections to apply (independent of source changes)

These static RRULEs are wrong per directory/club data found during research — worth fixing
even while staying on STATIC_SCHEDULE:

- **`hebe-h3`** — currently 1st Saturday; should be **3rd Saturday** 15:00 (Sai Kung).
- **`hkfh3`** — currently 1st Friday; drifts **2nd/3rd Friday** 19:00.
- **`fch3-hk`** — confirm monthly Saturday 13:00 (typically 1st Sat), Jaffe Rd & Fenwick St.

## Notes / caveats worth carrying forward

- **`malaysiahash.com` is not a source.** It's a stale Yii directory (last-updated stamps
  2014–2017) with standing cadence but **no next-run dates** — cannot back an adapter for
  any of the 6 MY kennels, and its "Active" flags are too old to serve as activity proof.
- **No shared Hong Kong hash calendar exists.** `china.hash.cn/hkmacao` is a flat directory
  (confirms the 3 HK kennels are live, refines their schedules) but publishes no feed.
- **`jb-h3` chapter identity is ambiguous** — the seeded Saturday 17:00 aligns with "JB City
  Hash" (Sat 5:30pm), while the *original* JBHHH is a Wednesday mixed hash. Resolve which
  chapter this kennel represents before any schedule edit.
- **Atlanta board (`board.atlantahash.com`) — checked via the VPN-relay egress**
  (`egress: "vpn"`, the same path the "Atlanta Hash Board" scraper uses; OVH blocks
  datacenter *and* residential IPs). The board is active (latest post 2026-07-08) but its
  phpBB forums are strictly the 9 day-of-week kennels the existing scraper already reads
  (Atlanta/Pinelake Sat, Blacksheep/SOB/Wheelhopper Sun, Moonlite Mon, DUFF Wed, SLUT Thu,
  Southern Coven/Happy Hour Fri). **CUNT H3 (no Tuesday forum), HMH3/Hog Mountain (no forum
  — runs the Sunday after the first Black Sheep trail), and CVH3 (Columbus, not Atlanta
  metro) are NOT board forums** and returned 0 title-search hits — routing them through the
  Atlanta Hash Board scraper would capture nothing. Static schedules stay; per-kennel
  activity still needs a Facebook check (Chrome pass).
