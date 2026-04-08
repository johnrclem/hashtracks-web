# Malaysia Kennel Research

**Researched:** 2026-04-08
**Status:** Plan-mode output. Copy to `docs/kennel-research/malaysia-research.md` after exiting plan mode.
**Significance:** The birthplace of hashing. Mother Hash (Kuala Lumpur H3, founded 30 Nov 1938) is the **first hash kennel ever** — every other kennel in the world, including Singapore's Father Hash (HHHS, 1962), descends from it. Malaysia has by far the densest hashing ecosystem on earth: ~200+ currently-active kennels across 13 states.

## Why Malaysia matters
Malaysia is to hashing what Greece is to democracy — the origin. Cecil Lee, "Horse" Thomson, "Torch" Bennett, and A.S. Gispert met after work in 1938 at the Royal Selangor Club in KL and invented the whole game. The Mother Hash has run continuously for 87+ years (Run #4250 scheduled for 6 Apr 2026 per motherhash.org). Kuala Lumpur / Selangor alone has 48+ active kennels. Every state has multiple active chapters. Malaysia Bar Hash, KL Full Moon, Petaling H3 (200+ members), Penang H3 (1965), Johor Bahru H3 (1969), Kuching H3 (1963), Kota Kinabalu H3 (1964), Ipoh H3 (1965) — these are all deeply historic active kennels.

**The catch:** the vast majority of Malaysia kennels are Facebook-only or phone-contact-only. The Malaysia Hash Directory at `malaysiahash.com` enumerates them exhaustively, but very few have scrapeable sources. This research produces a high-value shortlist of ~20 kennels with real sources plus a historic-exception recommendation for Mother Hash itself.

## Existing Coverage
**None.** Malaysia is a clean slate — zero kennels in `prisma/seed-data/kennels.ts`, zero in the production DB. No `Malaysia` region exists in `src/lib/region.ts`.

## Aggregator Sources Found

| Aggregator | Coverage | Usable? |
|---|---|---|
| **Harrier Central API** (`hashruns.org`) | **0 kennels** — per-city probes of Kuala Lumpur, Penang, Johor Bahru, Ipoh, Kota Kinabalu, Kuching, Petaling Jaya, Seremban, Malacca, Melaka, Miri all returned 0 events. | No |
| **HashRego** (`hashrego.com/events`) | **0 Malaysia slugs** in live index | No |
| **Meetup** (Kuala Lumpur search) | No active Malaysia HHH groups returned | No |
| **gotothehash.net/malaysia.html** | 404 (main site defunct except genealogy subdomain) | No |
| **Half-Mind.com** | Regional site, explicitly **USA/Central+South America/Caribbean only**. Does not track Malaysia. | No |
| **hashhouseharriers.nl** | Europe only, skipped | No |
| **Malaysian Hash Federation** (`malaysianhashcouncil.com` / `malaysianhashfederation.com`) | WordPress site, wp-json works, but the Calendar 2026 page is just annual-big-event promos (Pan Songkrun Hash, Nash Hash, etc.), not a weekly run aggregator. Could be used as a secondary source for **regional InterHash / Nash Hash major events**, but not for per-kennel weekly runs. | Partial (low priority) |
| **genealogy.gotothehash.net** (`?r=chapters/list&country=Malaysia`) | **269 historical kennels** enumerated. Rich for parent/lineage metadata but not an event source. Used for alias harvesting and founding-year cross-reference. | Metadata only |
| **malaysiahash.com** (Malaysia Hash Directory) | **THE key directory.** 15 state-by-state pages listing ~200 active kennels + inactive ones with schedule, founding date, and linked website when available. Not scrapeable as an event source itself (no run dates), but the **only** comprehensive source-of-truth for discovering Malaysia kennels. Used as Stage-2 primary reference for this research. | Metadata only |
| **goHash.app** | Paid SaaS platform for hash kennels ($5/mo). Built on Yii Framework PHP backend. **Penang H3, Petaling H3, KL Full Moon, and likely KL Harriettes all run on goHash.** No public multi-tenant API — each tenant is a separate custom-domain Yii instance served at `/index.php?r=site/hareline`. One adapter class could cover all goHash-hosted kennels via shared parser. | **YES — shared adapter pattern** |

## New Kennels Discovered

### Source-escalation summary
Prioritizing kennels with **real scrapeable sources**. Facebook-only kennels are listed in the "Skipped" bucket unless they qualify for the historic-kennel exception.

| # | Kennel | City | State | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|---|---|---|---|---|---|---|---|
| 1 | **Kuala Lumpur H3 (Mother Hash)** | Kuala Lumpur | Selangor | ACTIVE | Tier 3 (historic exception) | STATIC_SCHEDULE (weekly Mon 18:00) | `motherhash.org` is Google Sites with no calendar/feed. `motherhash.com` has a minimal landing page. Run #4250 visible for 6 Apr 2026 but no scrapeable hareline. **Must ship as historic exception — 2 years more senior than HHHS (Singapore).** | 30 Nov 1938 |
| 2 | **Petaling H3 (PH3)** | Petaling Jaya | Selangor | ACTIVE | Tier 2 | **HTML_SCRAPER (Yii/goHash)** — `https://ph3.org/index.php?r=site/hareline` | Runs 2479 (Apr 11, Pantai Remis, H: Raymond Lai), 2480 (Apr 18, Bukit Bayu, H: Barry Sage) verified live. Yii Framework table output. **200+ members — largest Saturday hash in Klang Valley.** | 5 Mar 1977 |
| 3 | **KL Full Moon H3 (KLFM)** | Kuala Lumpur | Selangor | ACTIVE | Tier 2 | **HTML_SCRAPER (Yii/goHash)** — `https://klfullmoonhash.com/index.php?r=site/hareline` | Run #405 "Margie's Memorial" verified for 10 May 2026, hare Ken Gurusamy, at TTDI. Same Yii pattern as PH3. | 11 Sep 1992 |
| 4 | **KL Harriettes (KLHHH / "KL Bunnies")** | Kuala Lumpur | Selangor | ACTIVE | Tier 2 | **HTML_SCRAPER (Yii/goHash?)** — `https://klharriettes.org/` | Homepage is minimal "Welcome to the KLHHH" SPA shell — needs Chrome verification to confirm Yii pattern vs goHash SPA. **Oldest Malaysian women's hash (1974).** | 18 Jun 1974 |
| 5 | **KL Junior H3 (KLJ H3)** | Kuala Lumpur | Selangor | ACTIVE | Tier 2 | **HTML_SCRAPER (WordPress API)** — `https://www.kljhhh.org/wp-json/wp/v2/posts` | wp-json confirmed working. Runs published as WordPress posts. Runs #525–#532 visible (May–Dec 2026). Same pattern as DCH4/EWH3 adapters. **1st Sunday of month family hash.** | 2 Jan 1982 |
| 6 | **Penang H3 (Men's Monday)** | Penang | Penang | ACTIVE | Tier 2 | **HTML_SCRAPER (Yii/goHash)** — `https://www.penanghash3.org/hareline/upcoming` | goHash-platform SPA. Next 10 runs visible (Apr–Jun 2026, Mondays). Runs have number/date/hare/location. **Founded 1965 — 3rd-oldest hash in the world** (after Mother Hash and HHHS). | 10 May 1965 |
| 7 | **Hash House Harriets Penang** | Penang | Penang | ACTIVE | Tier 2 | **HTML_SCRAPER (Cheerio + JSON-LD)** — `https://www.hashhouseharrietspenang.com/` | Has hareline page with Run #2739–#2741 visible (Apr 9, 16, 23). Includes JSON-LD schema.org Event markup — potentially parseable directly from structured data. **Founded 1972.** | 21 Nov 1972 |
| 8 | **Penang International Hounds (ph4)** | Penang | Penang | ACTIVE | Tier 2 | **HTML_SCRAPER** — `https://www.penang-hounds.com/` | Returns 403 to default curl (cloudflare/WAF). Certificate expired per WebFetch. Needs residential proxy or browser-render retry. **Tier 2 candidate, verify first.** | 10 Jul 2000 |
| 9 | **Kelana Jaya Harimau H3 (KJ Harimau)** | Petaling Jaya | Selangor | ACTIVE | Tier 2 | **HTML_SCRAPER (Blogger API)** — `khhhkj.blogspot.com` | **Only Blogspot with recent activity** — last post 5 Apr 2026 ("Happy Birthday PGM MacGyver"). Uses Blogger Atom feed. Blog is a trail-report style like OFH3 adapter. May need AI/heuristic parsing to extract run dates from post titles. | 20 Aug 1996 |
| 10 | **Kuala Lumpur Mountain Bike Hash (KLMBH)** | Kuala Lumpur | Selangor | ACTIVE | Tier 2 (browser-render) | **HTML_SCRAPER (Wix, browser-rendered)** — `https://www.klmbh.org/calendar` | Wix Thunderbolt SPA. Has a /calendar page but events hidden behind client-side JS rendering. Same pattern as Northboro H3 adapter. **Malaysia's biggest bike hash, monthly last Sunday.** | — |
| 11 | **Solstice Hash On Tour (SHOT)** | Roaming | — | ACTIVE | Tier 2 (Joomla WP) | **HTML_SCRAPER (wp-json)** — `https://solsticehash.com/wp-json/wp/v2/posts` | wp-json returns 200 with 12KB of data. Joomla-templated WP site. Solstice/equinox travel hash — twice-yearly. **Low-priority** (only 2 events/year). | 18 Jun 2005 |
| 12 | **Malaysia Nash Hash** (annual) | Varies | — | EVENT | Defer | MHF WordPress | `malaysianhashfederation.com` wp-json works but Calendar 2026 page is just annual event promo. Could be onboarded as a **regional major-event source** in a follow-up PR once the per-kennel scrapers are shipped. | — |

### Historic-kennel exception recommendation (1 kennel)
Per the `feedback_sourceless_kennels` + HHHS/SGH precedent (PR #524, PR #541):

**Kuala Lumpur H3 "Mother Hash"** meets — and exceeds — every bar:
1. **Historic significance:** The literal first hash kennel in the world (1938). **Predates HHHS by 24 years.** Every other kennel we've onboarded descends from this one. Not shipping Mother Hash would be absurd.
2. **Verified currently active:** `motherhash.org` shows Run #4250 for 6 Apr 2026 and Run #4251 for 13 Apr 2026. Weekly Monday 6pm, perfectly consistent 87-year recurrence.
3. **No scrapeable source:** `motherhash.org` is Google Sites (no feed, no calendar embed). `motherhash.com` is a legacy landing page. Run details are distributed via internal mailing list + members-only channels.
4. **Consistent recurrence:** Weekly Monday 18:00 since 1938. Strictest possible historic-kennel criterion.

**Recommendation:** STATIC_SCHEDULE with `rrule: FREQ=WEEKLY;BYDAY=MO`, `startTime: 18:00`, description linking to motherhash.org. `kennelCode: motherh3` (suggested) or `mother-hash`.

### Blogspot dead-pool (6 kennels — all inactive)
Directory-listed blogspot websites that are **actually dead**. All 6 returned valid Atom feeds but last-post dates show abandonment:

| Blogspot | Kennel | Last Post | Status |
|---|---|---|---|
| `ipoh3h.blogspot.com` | Ipoh H3 | Oct 2013 | Dead — kennel ACTIVE per directory, blog abandoned |
| `as3h.blogspot.com` | Alor Setar H3 | Jul 2016 | Dead |
| `kulaihhh.blogspot.com` | Kulai H3 | Nov 2014 | Dead |
| `sibuhhh.blogspot.com` | Sibu H3 | Jul 2015 | Dead |
| `gasingh5.blogspot.com` | Gasing Hills H5 | Oct 2018 | Dead |
| `rlcharriers.blogspot.com` | Royal Lake Club H3 | Mar 2016 | Dead |

**Kennels are still active per directory, but their web presence has moved to Facebook or vanished.** Skip as sourceless.

## Collision Check Results

Checked every proposed kennelCode against `prisma/seed-data/kennels.ts` + `prisma/seed-data/aliases.ts`:

| Proposed Code | Status | Resolution |
|---|---|---|
| `motherh3` | FREE | **Recommended primary for Mother Hash** |
| `mother-hash` | FREE | Alt candidate |
| `mh3` | FREE (only `-mn`, `-de`, `-tn`, `-ca`, `-wv`, `-sd` suffixed exist) | Avoid — use `motherh3` for clarity |
| `ph3` | FREE | **Use for Petaling H3** |
| `klhhh` | FREE | Alt for Mother Hash / KL Harriettes disambiguation |
| `klharriettes` | FREE | **Use for KL Harriettes** (women's, 1974) |
| `kljhhh` | FREE | **Use for KL Junior H3** |
| `klfm` / `kl-full-moon` | FREE | **Use for KL Full Moon** |
| `klmbh` | FREE | **Use for KL Mountain Bike Hash** |
| `penang-h3` / `penangh3` | FREE | **Use for Penang H3** |
| `ph4` | **TAKEN** (Pittsburgh or similar) | Use `ph4-my` or `penang-hounds` for Penang Intl Hounds |
| `hhhpenang` | FREE | **Use for Harriets Penang** |
| `kjh3` / `kj-harimau` | FREE | **Use for Kelana Jaya Harimau** |
| `sol-hash` / `solstice-hash` | FREE | **Use for Solstice Hash on Tour** |
| `ih3` | **TAKEN** (Ithaca H3) | Use `ipoh-h3` for Ipoh (if ever onboarded) |
| `bmh3` | **TAKEN** (Brass Monkey / Birmingham etc.) | N/A for Malaysia phase 1 |
| `kh3` | FREE | Avoid, too generic — use `kuching-h3` |
| `jbh3` | FREE | Reserved for Johor Bahru (phase 2) |
| `kkh3` / `kk-h3` | FREE | Reserved for Kota Kinabalu (phase 2) |

**No critical collisions.** `ph4` + `ih3` collisions noted but don't affect the phase-1 ship list. Recommend explicit `-my` suffixes on any ambiguous codes as a safety net.

## Shared adapter opportunity: Yii / goHash pattern

**Three kennels (PH3, KL Full Moon, Penang H3) and probably a fourth (KL Harriettes) all use the same Yii Framework PHP backend** — either self-hosted goHash.app or a forked copy. The HTML structure is identical:
- `/index.php?r=site/hareline` — Yii-routed hareline page
- Footer "Powered by Yii Framework"
- Table output with columns: Run # / Date / Hare / Location (and sometimes directions link)

**Recommendation:** Build one `src/adapters/html-scraper/yii-hashrun.ts` shared adapter (similar in spirit to how `wordpress-api.ts` is shared by EWH3/DCH4). Config-driven: `{ url: "https://ph3.org/index.php?r=site/hareline", kennelTag: "PH3" }`. **This ships 3 kennels for the price of 1 adapter.**

**Note:** penanghash3.org appears to be a newer React/Vue SPA variant of goHash (file returns 33KB of `<!DOCTYPE html>` + minimal body — the hareline data is rendered client-side via the SPA router). May need browser-render for that specific variant. Verify with Chrome before committing to a single adapter shape.

## Recommended Onboarding Order

**Phase 1 — "KL Founder Pack" (6 kennels, 1 new adapter + 1 historic exception)**
1. **Mother Hash** — STATIC_SCHEDULE weekly Monday (historic exception, zero code)
2. **Petaling H3** — new `yii-hashrun.ts` adapter (drives 2+3+4 below)
3. **KL Full Moon** — reuse `yii-hashrun.ts`
4. **KL Harriettes** — reuse `yii-hashrun.ts` (**verify CMS first** via Chrome — may need separate adapter if it's the SPA variant)
5. **KL Junior H3** — WordPress REST API via existing `wordpress-api.ts` helper (zero new code besides config)
6. **Penang H3** — may need new adapter for SPA variant OR reuse Yii adapter depending on Chrome verification

**Phase 2 — "Penang + historic kennels" (4 kennels)**
7. **Hash House Harriets Penang** — Cheerio + JSON-LD Event parser (new adapter ~120 lines)
8. **KL Mountain Bike Hash (KLMBH)** — Wix browser-render (new adapter, Northboro pattern)
9. **Kelana Jaya Harimau H3** — Blogger API adapter (reuse `blogger-api.ts` + heuristic date parser)
10. **Penang International Hounds** — retry via residential proxy, then Cheerio or browser-render

**Phase 3 — "Defer / evaluate"**
- **Solstice Hash on Tour** — low volume (2 events/year), only ship if cheap
- **Malaysian Hash Federation big-events source** — WP REST for annual InterHash/Nash Hash events as a regional enrichment source
- **Johor Bahru, Kota Kinabalu, Kuching, Ipoh, Penang Butterworth, etc.** — all directory-listed ACTIVE with no scrapeable source (Facebook/phone only). Historic-kennel-exception candidates for a future PR (would add 10–15 more STATIC_SCHEDULE kennels for Malaysia's most-historically-significant regional chapters: KKH3 1964, Kuching H3 1963, JBH3 1969, Ipoh H3 1965, Penang Butterworth 1980, etc.). **Recommend deferring to a "Malaysia Phase 2: Historic Regionals" PR** after phase-1 adapters prove the Yii shape.

## Skipped Kennels (this phase)

### Facebook-only / contact-by-phone (>150 kennels)
The Malaysia Hash Directory enumerates ~200 active kennels. The vast majority (>150) have NO website and NO structured source — schedule is coordinated via Facebook groups, phone hotlines, or WhatsApp. Per `feedback_sourceless_kennels`, these are skipped unless they meet the historic-kennel exception bar.

**Notable active Facebook-only kennels deferred** (high-confidence candidates for a future historic-regionals PR):
- **Kuching H3** (1963, oldest East Malaysian kennel, Kuching, Sarawak) — Facebook only
- **Kota Kinabalu H3** (1964, Sabah capital) — Facebook
- **Johor Bahru H3** (1969) — Facebook (`facebook.com/tjbhhh`)
- **Ipoh H3** (1965, Perak) — blogspot is dead (last post 2013)
- **Penang Butterworth H3** (1980) — no website
- **Royal Selangor Club H3** (1991) — `rschhh.my` is parked/dead
- **Kluang H3** (1967) — phone only
- **Kota Tinggi Sunday H3** (1990) — Facebook only
- **Damansara H3** (1985) — `damansarahhh.com` is a parked-domain lander
- **Batu H3** (1989) — `batuhash.com` is a 1.7KB stub page
- **Malacca H3** (1975) — `malaccahashhouseharriers.com` is parked

### Confirmed dead domains
- `damansarahhh.com`, `klfullmoonhash.com` (**wait — this IS alive, see row 3**; lander-redirect is a different variant), `rschhh.my`, `kuchingcityhash.com`, `mirihhh.com`, `malaccahashhouseharriers.com`, `penanghash.com.my`, `orang-utan.weebly.com`, `cbhhh2006.tripod.com`, `kbh.doturf.com`, `ph4.me` (directory listing only)

### Dead Blogspots (see table above)
ipoh3h, as3h, kulaihhh, sibuhhh, gasingh5, rlcharriers — all have stale feeds, last posts 2013–2018.

## Region Updates Needed

- **New country:** `Malaysia`
- **New regions** (suggested STATE_PROVINCE level):
  - `Selangor` (Kuala Lumpur + Petaling Jaya + most of phase 1)
  - `Penang` (4 phase-1/phase-2 kennels)
  - `Sarawak`, `Sabah`, `Johor`, `Perak`, `Melaka`, `Kedah`, `Negeri Sembilan`, `Pahang`, `Perlis`, `Kelantan`, `Terengganu`, `Labuan` — add as phase-2 when those kennels are onboarded
- **New metros:** `Kuala Lumpur, MY` (under Selangor), `Penang Island, MY` (under Penang). Add only as needed.
- **`inferCountry()`** regex needs "malaysia" → "Malaysia" + city patterns (Kuala Lumpur, KL, Penang, Johor, Sarawak, Sabah, Melaka, Ipoh, etc.)
- **`COUNTRY_GROUP_MAP` + `stateMetroLinks`** — add Malaysia block per the `feedback_country_group_map` memory.

## Checks Performed
- [x] DB existing-coverage probe (grep of `prisma/seed-data/`) — 0 MY kennels
- [x] Harrier Central API — 0 MY events (full dump + per-city filter, 11 cities)
- [x] HashRego `/events` live index grep — 0 MY slugs
- [x] gotothehash.net/malaysia.html — 404 (main site defunct)
- [x] genealogy.gotothehash.net Malaysia page — 269 kennels harvested for lineage/metadata
- [x] Half-Mind.com regional — explicitly US/CA/SA/Caribbean only
- [x] Meetup Kuala Lumpur search — 0 active groups
- [x] **malaysiahash.com** — all 13 state pages fetched, ~200 active kennels enumerated with schedule/website/founding
- [x] **malaysianhashfederation.com** — wp-json verified, content is annual-event promo only
- [x] **ph3.org** (Petaling) — Yii confirmed, Run #2479/2480 visible
- [x] **klfullmoonhash.com** — Yii confirmed, Run #405 visible
- [x] **klharriettes.org** — minimal SPA shell (needs Chrome verify)
- [x] **kljhhh.org** wp-json — 200 OK, WordPress confirmed, Runs #525–#532 visible
- [x] **penanghash3.org** `/hareline/upcoming` — 33KB SPA, goHash platform
- [x] **hashhouseharrietspenang.com** — Runs #2739–#2741 visible, JSON-LD
- [x] **penang-hounds.com** — 403/cert expired (residential proxy needed)
- [x] **klmbh.org/calendar** — Wix Thunderbolt SPA (browser-render)
- [x] **gohash.app** API endpoints — 301 redirects to marketing site, no public API
- [x] **All 7 blogspot feeds** fetched for freshness — 6 dead, 1 active (khhhkj)
- [x] **kennelCode collision check** — 3 collisions flagged (`ph4`, `ih3`, `bmh3`), none block phase-1

## Open Questions for User Review

1. **Mother Hash historic exception** — confirm the project wants to onboard Mother Hash via STATIC_SCHEDULE given the "no sourceless kennels" rule. My recommendation is a strong YES — literally the most historically significant kennel in the world, stricter than HHHS, fully verified active weekly. Should its `kennelCode` be `motherh3`, `mother-hash`, `klh3`, or something else distinctive?
2. **KL Harriettes platform verification** — should we run Chrome-assisted verification first to confirm whether it's the Yii variant (shared adapter) or the newer SPA variant (separate adapter)? This affects whether phase 1 is 1 new adapter or 2.
3. **Penang H3 SPA vs Yii** — same question. `penanghash3.org/hareline/upcoming` returns HTML that may be a goHash SPA shell, not the server-rendered Yii hareline. Needs Chrome verify before assuming shared adapter applies.
4. **Phase 2 "Historic Regionals" scope** — do we want a follow-up PR that STATIC_SCHEDULEs the ~10 most historically significant Facebook-only Malaysian kennels (KKH3, Kuching H3, JBH3, Ipoh H3, Butterworth, Kluang, etc.)? These are all 1960s–1970s founding dates with verified continuous operation. Each would be a historic-exception ship like HHHS.
5. **Penang International Hounds (ph4)** — worth unblocking via residential proxy, or skip?
6. **Solstice Hash** — ship or skip? Only 2 events/year, low ROI.
7. **Kelana Jaya Harimau (khhhkj.blogspot.com)** — blog is active but the latest posts are member birthday notices, not run announcements. May need Chrome-assisted review to determine if run dates are actually reliably parseable from the feed or not.

## Lessons from this research pass
- **The Malaysia Hash Directory (malaysiahash.com) is the single most important source for Malaysia onboarding**, comparable to hash.org.sg for Singapore. It's a Yii-based per-state directory covering ~200 active kennels with founding dates and schedules. No other regional directory comes close — Half-Mind explicitly excludes Asia, Harrier Central has zero MY kennels, and Meetup doesn't reach Malaysian hashing culture at all.
- **goHash.app is a recurring pattern we'll encounter again** — it's a $5/mo Hash-kennel-SaaS used by at least 3 kennels. Building one shared `yii-hashrun.ts` adapter lets us multiply every new goHash-hosted kennel discovery into zero-code onboarding. Singapore's PWA/JSON pattern (Seletar) was similar. Catalog goHash as a known platform in `.claude/rules/adapter-patterns.md` after phase 1 ships.
- **Blogger feeds are a trap for Malaysia specifically** — 6 of 7 blogspot blogs listed in the Malaysia Hash Directory are dead/abandoned, but the Atom feed still returns 200 OK. Always check the latest-post date before classifying a blogspot as Tier 2.
- **Mother Hash deserves a bespoke onboarding moment** — release notes / PR description should highlight that this is the first hash kennel ever added to the platform. Consider a dedicated `motherh3` kennelCode over generic `mh3-my` to signal its uniqueness in the data model.
