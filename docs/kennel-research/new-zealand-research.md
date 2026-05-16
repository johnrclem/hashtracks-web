# New Zealand Kennel Research

**Date:** 2026-05-15
**Region:** New Zealand (greenfield — zero existing coverage)
**Total kennels discovered:** ~28 active, ~25 onboardable, 3–4 dormant
**Expected new sources after Phase 1–3:** 25–28

---

## Context

HashTracks has zero New Zealand coverage in prod. NZ has a small, tight-knit H3 scene spanning North + South Island with three dense metros (Auckland, Wellington, Christchurch) plus ~15 regional clubs. This is our first Oceania-completeness pass and pairs with the 9 existing AU kennels.

---

## National Aggregators & Cross-Platform Coverage

| Platform | Coverage | Use as source? |
|---|---|---|
| [nzhhh.nz](https://www.nzhhh.nz/directory-full) | 35–37 NZ clubs in static directory + Google My Map | **Metadata seed only** — `/whats-upcoming-in-clubs` is stale (last update ~mid-2023); no live event feed |
| Harrier Central (hashruns.org) | 1 NZ kennel (WHHH Wellington), zero events | **Skip** — registered but empty |
| HashRego | Same single WHHH stub, zero events | **Skip** |
| Meetup | Zero NZ hash groups | **Skip** — NZ coordinates via FB + email |
| [NZ kennel Google My Map](https://www.google.com/maps/d/viewer?mid=1Vn_hCkcB-hJyggjMJqcfX7E-_oko0sc) | Geocoded pins for every NZ kennel | Useful for **lat/lng backfill**, not events |

**Implication:** NZ onboarding is bottom-up (per-kennel), not aggregator-driven. No single national source unlocks 10+ kennels at once.

---

## Access Blockers (status)

1. ✅ **sporty.co.nz** (Capital H3, Mooloo HHH, Geriatrix H3) — Cloudflare Bot Fight Mode. **Resolved** in Phase 1.5-B via stealth-Playwright on the NAS browser-render service. All three kennels return real HTML in ~3-5 s via `browserRender()`.
2. **aucklandhussies.co.nz returns HTTP 403** — same WAF pattern but historically intermittent. Re-test with stealth-Playwright before Phase 2; if still blocked, fall back to STATIC_SCHEDULE.
3. **aucklandhashhouseharriers.co.nz TLS cert/SNI mismatch on `www.` host** — needs browserRender + apex domain test, or fall back to STATIC_SCHEDULE.
4. **Dead hosts** (50webs.com, mysite.com, webs.com, hashinwellington.co.nz, geriatrix.org.nz apex) — permanent fallback to STATIC_SCHEDULE.

---

## Region Hierarchy to Seed

Add to `src/lib/region.ts` (`regionNameToData`) and `COUNTRY_GROUP_MAP`:

- **New Zealand** — COUNTRY, ISO `NZ`, timezone `Pacific/Auckland`
- **Auckland** — METRO, parent New Zealand
- **Wellington** — METRO, parent New Zealand
- **Christchurch** — METRO, parent New Zealand
- **Hamilton / Waikato** — METRO
- **Tauranga / Bay of Plenty** — METRO
- **Rotorua** — METRO
- **Dunedin / Otago** — METRO
- **Nelson** — METRO
- **Napier-Hastings / Hawke's Bay** — METRO
- **New Plymouth / Taranaki** — METRO
- **Palmerston North / Manawatū** — METRO
- **Whangarei / Northland** — METRO
- **Invercargill / Southland** — METRO

Follow Singapore/Hong Kong pattern: country → metro, no state-province intermediate level.

---

## kennelCode Collision Notes

Every NZ kennel must use city-prefixed codes — common abbreviations collide:

| Collision | Existing | NZ alternative |
|---|---|---|
| AH3 | Aloha / Austin / Adelaide | `auckland-h3-nz` |
| WH3 | Wanchai HK | `wellington-h3` |
| CH3 | Charleston / Chicago / Charlotte | `christchurch-h3` |
| MH3 | Munich / Minneapolis / Miami / Mother | `mount-h3-nz` |
| DH3 | Denver / Dublin | `dunedin-h3` |
| TH3 | Thirstday Chicago / Tidewater | `t3h3-nz`, `tokoroa-h3` |
| BH3 | Berlin / Boulder / Buffalo | `bay-of-islands-h3` |
| FCH3 | Flour City / Foothill | n/a |
| H4 | Hangover / Houston / Hockessin | suffix country |

**Grep all proposed codes against `prisma/seed.ts` before Phase 2 commit** (per `feedback_collision_check` memory).

---

## Phase 1: High-Confidence Quick Wins (5 sources, 4 kennels)

These are ready to ship with no infra unlocks needed.

### 1. Garden City H3 (Christchurch) — `garden-city-h3`
- **Best source:** HTML_SCRAPER (GenericHtml config), WordPress table on https://gardencityhash.co.nz/
- **Verified:** 7 future events visible (#2355 → #2361, May 19 → June 16 2026, hares + locations populated)
- **Schedule:** Tuesday 6:30pm, founded 1984
- **Notes:** Spun out of CHH3 when it outgrew weekly capacity. Clean table layout, ideal first NZ HTML adapter.

### 2. Hibiscus H3 (Auckland North) — `hibiscus-h3`
- **Best source:** GOOGLE_SHEETS, sheet ID `1NcX991wiqvH0RmRzngaeFReeBKCTkJPxE1aoWIXYot8`, gid=1 (pubhtml)
- **Verified:** Sheet is published-to-web; columns need confirmation via CSV pull
- **Schedule:** Monday 6:30pm, founded 1987, Orewa/Hibiscus Coast
- **Notes:** Confirm column layout (date / hares / location / runNumber) before adapter config

### 3. Christchurch H3 — `christchurch-h3`
- **Best source 1:** STATIC_SCHEDULE — weekly Monday 18:30, $7 hash cash
- **Best source 2:** HTML_SCRAPER on https://christchurchhash.net.nz/events/ — special events (camps, weekends)
- **Verified:** Site live, 2 future special events (Blackball 13–15 Mar 2026, Winter Camp 10–12 Jul 2026)
- **Schedule:** Mon 6:30pm, founded 12 November 1979 — oldest South Island kennel
- **Notes:** Pattern: STATIC handles regular runs; HTML scraper enriches with non-weekly events. Similar to Rumson H3 + iCal pairing.

### 4. Tokoroa H3 — `tokoroa-h3`
- **Best source:** STATIC_SCHEDULE × 2 (mirrors Mosquito H3 / Columbian H3 pattern)
  - Wednesday 6pm (daylight savings season: Oct–Apr)
  - Sunday 4pm (winter season: May–Sep)
- **Schedule:** Founded 1983, restarted 2009
- **Notes:** Dual-schedule kennels need two STATIC_SCHEDULE rows with date-bounded RRULEs.

### 5. T3H3 — Thirsty Thursday Taniwha (Wellington) — `t3h3-nz`
- **Best source:** STATIC_SCHEDULE — 2nd Thursday monthly, 18:30
- **Schedule:** Founded 26 May 2016, ~5km, near public transport
- **Notes:** FB Page `facebook.com/ThirstyThursdayTaniwhaH3` may upgrade to FACEBOOK_HOSTED_EVENTS in Phase 4.

---

## Phase 2: sporty.co.nz Unlock — UNBLOCKED ✅

**Verdict:** The Phase 1.5 spike originally confirmed Cloudflare's Bot Fight Mode JS challenge defeated all three of our infrastructure paths (plain fetch, NAS residential proxy, NAS headless Playwright). The **Phase 1.5-B stealth upgrade** that landed alongside the spike (see [sporty-co-nz-spike.md](sporty-co-nz-spike.md) and `infra/browser-render/server.js`) adds `playwright-extra` + `puppeteer-extra-plugin-stealth` to the NAS browser-render service, plus a realistic Chrome 130 UA / 1440×900 viewport / `en-NZ` locale and per-`(hostname, UA)` `cf_clearance` cookie cache. Result: Cloudflare doesn't gate stealth-Chromium at all — the real HTML returns directly in ~3–5 s. All three sporty kennels are now scrapeable via `browserRender()`.

**Phase 2 PR** (follow-up after this stealth-upgrade lands) ships three `HTML_SCRAPER` adapters + kennel/source seed entries. Each kennel has a distinct page layout — they all share the same browser-render entry point but parse different DOM shapes.

### Capital H3 (Wellington) — `capital-h3-nz`
- Source: HTML_SCRAPER (browserRender) on `https://www.sporty.co.nz/capitalh3`
- Hareline lives on the homepage in a CMS "notices" panel (`<div id="notices-prevContent-*">`). Each row is a `<p>` of `<span>RUN# – DD MMM YYYY – LOCATION – HARE</span>`.
- Run cadence: weekly Monday 18:30. Founded 1981.

### Mooloo HHH (Hamilton) — `mooloo-h3`
- Source: HTML_SCRAPER (browserRender) on `https://www.sporty.co.nz/mooloohhh/UpCumming-Runs`
- Page is more newsletter than structured hareline — freeform `<p>` paragraphs with run lines like `25 May 2026 RUN# 1886 Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St. 6PM.` mixed with announcements. Lower fidelity than Capital or Geriatrix.
- Run cadence: **biweekly Monday 18:00 all year** (RRULE `FREQ=WEEKLY;BYDAY=MO;INTERVAL=2`). The page literally states "Changed to 6:00 PM trail starts ALL YEAR" and "every 2nd Monday". Founder of the Waikato hash scene.

### Geriatrix H3 (Wellington) — `geriatrix-h3`
- Source: HTML_SCRAPER (browserRender) on `https://www.sporty.co.nz/geriatrixhhh/Receding-Hareline/NewTab1` (NOT the homepage, which only shows "Next Run")
- 4-line repeating block per run: `<date>` / `Venue: …` / `Hare: …` / `Map: …` (with Google Maps URL).
- Run cadence: weekly Tuesday 18:30. Founded October 1985, **largest Wellington club** (30–40 weekly attendees) — highest-impact NZ unlock.

---

## Phase 3: STATIC_SCHEDULE Bulk Seed (~16 kennels)

No live feed available; ship as STATIC_SCHEDULE with manual schedule data from nzhhh.nz directory. Upgrade individual entries to FB / web later as opportunities arise.

| Kennel | kennelCode | Region | Schedule | Notes |
|---|---|---|---|---|
| Auckland H3 | `auckland-h3-nz` | Auckland | Mon 6:30pm | Founded 1970, NZ founder kennel. Website TLS broken — retry browserRender in Phase 4. |
| Auckland Hussies | `auckland-hussies` | Auckland | Tue 6:30pm | 1978, women's. Site 403. |
| Auckland Soroako | `auckland-soroako-h3` | Auckland | 3rd Thu monthly 6pm | Monthly RRULE |
| North Shore Hussies | `northshore-hussies` | Auckland | Wed 6:30pm | 1982, women's |
| NorWest HHH | `norwest-h3` | Auckland | Tue 6:30pm | 1988, host dead |
| Woeful H3 | `woeful-h3` | Auckland | Monthly near full moon | Lunar pattern — defer if RRULE awkward |
| Mount Hash | `mount-h3-nz` | Tauranga | Mon 6pm | ~1990, host dead |
| Rotorua H3 | `rotorua-h3` | Rotorua | Wed 5:30pm (winter)/6pm (summer) | 1994 |
| Whakatane H3 | `whakatane-h3` | Bay of Plenty | Mon 6pm | |
| Waitomo/Otorohanga H3 | `waitomo-h3` | Waikato | Wed 4pm | |
| Bay of Islands H3 | `bay-of-islands-h3` | Northland | Mon 5pm | Founded 2007 |
| Whangarei H3 | `whangarei-h3` | Northland | Tue 6:15pm | |
| Mangawhai Heads H3 | `mangawhai-h3` | Northland | Sat 3pm | Founded 2006, FB Page (Phase 4) |
| Matarangi H3 | `matarangi-h3` | Coromandel | Last Sat monthly | Founded 2021 |
| Pania Plodders | `pania-plodders-h3` | Napier | Sun 2pm | 1984 |
| Energy H3 | `energy-h3` | New Plymouth | Mon 6:30pm | 1988 |
| Palmerston North H3 | `palmerston-north-h3` | Palmerston North | Mon 6:30pm | 2,260+ runs |
| WHHH | `wellington-h3` | Wellington | Mon 6:30pm | 1976, 2nd hash in NZ, 50-yr jubilee Feb 2026. Site dead. |
| Wellington Ladies H3 | `wellington-ladies-h3` | Wellington | Wed 6:30pm | November 1978 |
| SAM H3 | `sam-h3-nz` | Wellington | Sat 8am | Saturday morning |
| Wellington Bikers Hash | `wellington-bikers-h3` | Wellington | 2nd Sun monthly bike | May not fit "running" — defer |
| Nelson H3 | `nelson-h3` | Nelson | Mon 6:30pm | 1979, oldest SI per NZHHH; host dead |
| Dunedin H3 | `dunedin-h3` | Dunedin | 2nd Sun monthly 4pm | 1982 |
| Otepoti H3 | `otepoti-h3` | Dunedin | Unknown — needs FB probe | FB Page `facebook.com/dunedinNZhash` may unlock FACEBOOK_HOSTED_EVENTS |
| Southern Flyers | `southern-flyers-h3` | Invercargill | Mon 6pm | 1982 |

---

## Phase 4: FB Page Audit for FACEBOOK_HOSTED_EVENTS Upgrades

For kennels with a real FB **Page** (not Group), test `/upcoming_hosted_events` after Phase 3. Candidates:

- Otepoti H3 — `facebook.com/dunedinNZhash`
- Mooloo Hash — `facebook.com/mooloohhh` (secondary to sporty.co.nz)
- Capital HHH — `facebook.com/Capitalhhh`
- T3H3 — `facebook.com/ThirstyThursdayTaniwhaH3`
- Mangawhai Heads, Mount Hash, Tokoroa — verify Page vs Group first

---

## Kennels Skipped (dormant / in recess / not regular)

- Taupo H3 — "not regularly active"
- Auckland Veterans — lead contact passed Oct 2025
- Gisborne First Light — "in recess"
- Takaka H3 — "by request" only
- Masterton H3 — no schedule listed, may be dormant

Revisit in 6 months.

---

## Recommended Onboarding Sequence

1. ✅ **Phase 1** (PR #1434, 7 sources, 6 kennels) — shipped: region hierarchy + first NZ adapters.
2. ✅ **Phase 1.5 sporty.co.nz spike** — completed: identified Cloudflare Bot Fight Mode as the blocker. See [sporty-co-nz-spike.md](sporty-co-nz-spike.md).
3. ✅ **Phase 1.5-B stealth-Playwright NAS upgrade** (PR #1450) — added `playwright-extra` + stealth plugin to the NAS browser-render service. All three sporty.co.nz kennels now return real HTML via `browserRender()` in ~3–5 s.
4. **Phase 2** — Capital H3 / Mooloo HHH / Geriatrix H3 HTML_SCRAPER adapters + kennel/source seed entries. Three distinct page layouts (see Phase 2 section above). Ships as the follow-up PR after Phase 1.5-B lands.
5. **Phase 3 STATIC bulk** — single PR with the ~16 remaining static schedules from `nzhhh.nz`. Can ship in parallel with Phase 2 since it touches different kennels.
6. **Phase 4 FB Page audit** — after Phase 3 lands, probe each STATIC kennel's FB page for `/upcoming_hosted_events` and upgrade to FACEBOOK_HOSTED_EVENTS where supported.

**Open questions for user:**
- Does NZ region hierarchy match the proposed metros, or roll smaller towns up into broader regions (e.g. all of Northland under one metro)?
- Wellington Bikers Hash — does a "bike hash" count as in-scope for HashTracks, or skip?
