# Kennel Onboarding — Target Queue

Ranked backlog for the daily onboarding task. **Rank 1 = onboard next.** The daily run
([`daily-onboarding-prompt.md`](daily-onboarding-prompt.md)) takes the top `queued` row each
morning. When `queued` rows drop to **5 or fewer**, the run refills the list back to ~20.

**Inclusion rule:** every entry must have a **confirmed/identified dynamic data source**
(Google Calendar, iCal, Meetup, Harrier Central, Hash Rego, Google Sheets, or a scrapeable website)
that is **live and recently active** — upcoming events OR a regular cadence whose latest run is
within ~2× its interval (the *recently-active* rule; 0 upcoming alone is fine). No Facebook-only /
static-only kennels.

**Dedup rule (see prompt Step 2) — against the LIVE sitemap, read via the Chrome MCP.** The seed
files are incomplete (live site has 410+ kennel slugs in the sitemap vs ~349 in seed; kennels are
added straight to prod via the admin UI), the prod DB isn't reachable from the run's sandbox, and
the kennel directory is client-rendered. The authoritative oracle is `hashtracks.xyz/sitemap.xml`
read through the Chrome MCP. **Slugs aren't always the obvious kebab** — scan for fragments
(Singapore Harriets = `sg-harriets`, Miami Valley = `mvh3-day`, HK Monday = `hk-h3`, Brussels
Manneke Piss = `bmph3`).

**Status values:** `queued` · `in_progress` · `handed-off` · `blocked` · `done (already live)` · `source-add` · `verify-live-first` · `shipped`

> Cooperative: John can reorder, add, or strike rows anytime. The daily run respects the current
> top `queued` row.

**Last sitemap audits via Chrome MCP:** 2026-05-27 (411 slugs) → 2026-05-28 (412 slugs) →
2026-05-29 (ONH3 added, 413+) → 2026-05-29 (414 slugs; ZH3 dedup — 0 Swiss kennels confirmed) →
2026-05-30 (415 slugs; Mijas H3 dedup — 0 Spain kennels confirmed) →
2026-06-02 (421 slugs; Paris H3/Sans Clue dedup — 0 France kennels confirmed) →
2026-06-03 (423 slugs; WSH3 recovery — `wsh3-ch` absent/404 in prod though seeded in code; Vancouver/Mexico City/Anchorage all confirmed absent) →
2026-06-03 (424 slugs; Mexico City H3 dedup — 0 `mexico*`/`cdmx*`/`mch3` slugs confirmed, now shipped).
Re-confirm each row at handoff time per the prompt.

## Active queue — all confirmed NOT live (sitemap-verified)

| Rank | Kennel | Full name | Region | Best source type | Source URL / ID | Confidence | Live-dedup (sitemap) | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| — | SACH3 | Sacramento Hash House Harriers | Sacramento, CA | Squarespace events JSON (NEW `SquarespaceEventsAdapter`) | `sach3.beer/events?format=json` (iCal export was gated OFF; sach3.com dead) | Shipped | n/a | **shipped** | **Live in prod (54 events).** PRs #1742 (adapter) + #1745/#1746 (coord-pin fix, pagination, endTime, dropCachedCoords). iCal plan was infeasible → needed ~360-LoC adapter. **Future Squarespace kennels are now config-only.** |
| — | BoiseH3 | Boise Hash House Harriers | Boise, ID | HTML_SCRAPER (static Cheerio, home-page) | `https://www.boiseh3.org/` (Wix; `/events-3` widget is JS-rendered) | Shipped | sitemap-checked absent at handoff | **shipped** | **PR #1750.** New ~200–300 LoC `BoiseH3Adapter`, new Idaho region, self-hosted logo. Wix `richTextElement` traversal + S5852 safe regexes + title-less heading regex now captured in `source-platform-notes.md`. |
| — | ONH3 | Original Nairobi Hash House Harriers | Nairobi, KE | HTML_SCRAPER (WordPress.com REST API) | `public-api.wordpress.com/wp/v2/sites/onh3.wordpress.com/posts` | Shipped | n/a | **shipped** | **🌍 HashTracks' first Africa kennel.** Commits `685f2e0d` (adapter) + `d5a10952` (history split). Future adapter = future-only via WordPress.com REST; past via one-shot `scripts/backfill-onh3-history.ts`; `config.upcomingOnly: true` suppresses stale-event reconciliation. WordPress.com section now lives in `source-platform-notes.md` — next WP.com kennel will be much faster. **Once 3–4 ship, factor a shared `WordPressComAdapter` base class.** |
| — | Bali Hash 2 | Bali Hash House Harriers 2 | Bali, Indonesia | HTML_SCRAPER (Ghost blog, Cheerio) | `https://balihash2.com/` (Ghost 6.5, server-rendered) | High — handed off 2026-05-29; next run #1747 dated 2026-05-30 confirmed live | n/a | **handed-off** | `handoffs/2026-05-29-bali-hash-2.md`. NEW adapter ~250–350 LoC mirroring `hangover.ts` (Ghost) + `ofh3.ts` (single-kennel trail posts). World-famous Bali kennel, run #1747+. **🇮🇩 First Indonesia kennel.** Self-host the Ghost CDN logo. Optional one-shot historical backfill (~1,747 archived runs via `/page/N`). After ship, add a Ghost section to `source-platform-notes.md`. |
| — | Paris H3 / SCHHH | Paris + Sans Clue Hash House Harriers | Paris, FR | MEETUP (config-only, multi-kennel) | `meetup.com/parish3-schhh` (group `parish3-schhh`) | Shipped | no `paris*`/`sans-clue`/`france` slug (sitemap 421, 2026-06-02) | **shipped** | **[PR #1920](https://github.com/johnrclem/hashtracks-web/pull/1920) — merged; live at /kennels/paris-h3 (Sat) + /kennels/sans-clue-h3 (Sun). 18 prod events (8 Paris + 10 Sans Clue), 0 unmatched/blocked/errors; 21 "Thursday Night Drinking Club" socials dropped pre-RawEvent, 0 leakage.** Handoff `handoffs/2026-06-02-paris-h3.md` · retro `handoffs/retros/2026-06-02-paris-h3-retro.md`. **🇫🇷 First France kennel(s).** Prior 0-upcoming "block" was a **false negative** (events-list SSR shell shows 0 — Meetup hydration artifact; `__NEXT_DATA__` Apollo state carried all events — platform note now corrected). Two kennels off one Meetup via `kennelPatterns`; socials dropped via `silentlySkipPatterns`. Config-only MEETUP + France COUNTRY/Paris METRO region (5 `region.ts` edits). Sans Clue `foundedYear` left null (medium-confidence → comment). Logos self-hosted (shared Meetup JPEG). |
| 2 | Zürich H3 | Zurich Hash House Harriers | Zürich, CH | MEETUP (config-only) | `meetup.com/the-zurich-hash-house-harriers` (slug confirmed; site `zh3.ch` directs here) | High — handed off 2026-05-29; upcoming run **#1731 Sat 2026-06-06** verified live | no `zurich*`/`zh3`/Swiss slug (sitemap 414, 2026-05-29) | **handed-off** | `handoffs/2026-05-29-zh3.md`. **🇨🇭 First Switzerland kennel.** Config-only MEETUP (`extractRunNumber: true`), founded 1990, CHF 5, Thu 7PM + 1st Sat + 3rd Sun (`scheduleRules`). Add Switzerland+Zürich regions. ⚠️ group is "Request to join" — Claude Code confirms public events scrape at build (fallback: `zh3.ch` WP `?cat=12`). |
| 3 | Mauritius H3 | Mauritius Hash House Harriers | Mauritius (Indian Ocean) | HTML_SCRAPER | `https://www.mhash.com/category/hash-next-run/` | High — clean future run list through Dec 2026, every 2nd Sunday | no `mauritius*`/`mhash` slug | **blocked: stale** | 🔁 **Re-checked 2026-06-03 → STILL STALE, re-blocked.** No change since 2026-05-30: homepage latest "Next Run" still = **Hash Run 955 dated 19 Apr 26** (46 days / ~3.3× the biweekly interval past, today 2026-06-03); latest "Hash Trash 954" published **10/04/2026**; `/category/hash-next-run/` archive still renders **"Nothing Found"**; no #956/#957. Per Step 3 "genuinely stale → skip." Kennel still active socially (biweekly, FB group `1944322859018859`). Re-check on next refill. Mind `mh3` collision → `mh3-mu`/`mauritiush3`. |
| 4 | Mijas H3 | Mijas Hash House Harriers | Mijas / Costa del Sol, ES | HTML_SCRAPER | `https://www.mijash3.com/hareline` (+ `/run-directions`) | High — handed off 2026-05-30; full hareline through Aug 2026 verified live (run #2020 Sun 31 May → #2034) | no `mijas*`/Spain slug (sitemap 415, 2026-05-30) | **handed-off** | `handoffs/2026-05-30-mijash3.md`. **🇪🇸 First Spain kennel.** Est. 1989 "Burro Hash", weekly Sunday. NEW ~150–220 LoC Cheerio scraper (Squarespace *content-page* hareline — NOT the Events-JSON path, so not config-only). Add Spain + Costa del Sol regions (all-5 `region.ts` edits). Self-host tokenized Squarespace logo. hashCash not published (follow up). |
| — | Winterthur & Schaffhausen H3 | Winterthur & Schaffhausen Hash House Harriers | Winterthur, CH | MEETUP (config-only) | `meetup.com/winterthur_schaffhausenhhh/` (group live, 12 upcoming 2026-06-20→2027-05-15) | High — re-verified live 2026-06-03 (Apollo `apolloEventCount:12`) | **`wsh3-ch` seeded in code (PR #1870) but 404 in prod** (sitemap 423 slugs, 2026-06-03) | **handed-off (recovery)** | `handoffs/2026-06-03-wsh3-ch.md`. **🔧 POST-MERGE RECOVERY, not a new build.** Full impl merged in PR #1870 (kennel kennels.ts:1212 + source sources.ts:3713 + aliases:360 + Winterthur region/inference rule region.ts:1818/3195/3447 — all intact). But `/kennels/wsh3-ch` is **404 in prod** — never seeded/scraped (post-merge step missed or undone by a DB refresh). Claude Code: verify seed integrity → `npx prisma db seed` → scrape the Meetup source → confirm page goes live. Meetup re-verified 2026-06-03: 12 upcoming, verbatim titles "WSH3 Summer Solstice Trail"/"WSH3 tbd" (no run #s), 3rd-Sat monthly @14:00. |
| — | Hamburg H7 | Hamburg H7 | Hamburg, DE | HARRIER_CENTRAL + Blogspot backfill | hashruns.org; `hamburghash.blogspot.com` | Shipped | no `hamburg*`/`h7` slug | **shipped** | **PRs #1886 + #1895 (merged). Live — 111 events** (101 historical #594–#700 from the Blogspot archive, 10 upcoming #707–#716 via Harrier Central). `walkersWelcome` badge live; Hamburg METRO region added. Config-only HC + one-shot Blogspot backfill. |
| — | Asunción H3 | Asunción Hash House Harriers | Asunción, Paraguay | HTML_SCRAPER (NEW `AsuncionH3Adapter`, WordPress.com REST — mirrors ONH3) | `public-api.wordpress.com/wp/v2/sites/asuncionh3.wordpress.com/posts` | Shipped | no `asuncion*`/Paraguay slug (sitemap 423, 2026-06-03) | **shipped** | **[PR #1944](https://github.com/johnrclem/hashtracks-web/pull/1944) (onboard) + [#1946](https://github.com/johnrclem/hashtracks-web/pull/1946) (slug pin) — merged. Live at https://www.hashtracks.xyz/kennels/asuncion-h3 — 120 prod events (2021-12-05 → 2026-05-30), all with coords.** 🇵🇾 **First Paraguay / first South America kennel.** Handoff `handoffs/2026-06-03-asu-h3.md` · retro `handoffs/retros/2026-06-03-asu-h3-retro.md`. Future-only adapter + frozen 120-run backfill (`scripts/data/asu-h3-history.json` + dumb loader). Paraguay COUNTRY+Asunción METRO added (purple). Key learnings: in-body date format drifts hard (ordinal/`of`/Spanish-month/`Arpil` typo — EN+ES month map); embed-coord `!2d`=lng/`!3d`=lat extracted in-adapter; `aliases.ts` keyed by kennelCode not slug; accented shortName mangles `toSlug` → pin the slug; page-1 400 ≠ clean end. |
| 7 | VH3 | Vancouver Hash House Harriers | Vancouver, BC | HTML_SCRAPER | `vanhash.com` / `vh3.ca/RecedingHareline.html` | Low-Med — verify which domain is live; may need browserRender | no `vancouver*` slug | queued | Biweekly Sat. |
| — | Mexico City H3 | Hash House Harriers Mexico City | Mexico City, MX | MEETUP (config-only) | `meetup.com/mexico-city-hash-house-harriers` | Shipped | no `mexico*`/`cdmx*`/`mch3` slug (sitemap 424, 2026-06-03) | **shipped** | **[PR #1953](https://github.com/johnrclem/hashtracks-web/pull/1953) (merged). Live at https://www.hashtracks.xyz/kennels/mexico-city-h3 — 10 prod events #746–#756.** 🇲🇽 **First Mexico kennel.** Config-only MEETUP + Mexico COUNTRY/Mexico City METRO region (5-edit, fuchsia, **`New Mexico`→USA inference guard**) + self-hosted logo + frozen 10-run backfill (`scripts/data/mch3-history.json` + dumb loader). Recently-active 0-upcoming onboard (last run #756 2026-05-23). Retro `handoffs/retros/2026-06-03-mch3-retro.md`. 🔴 **MEETUP sets `title`** (merge keeps it, no `Trail #N` synthesis) → backfill freezes the **real cleaned Meetup titles**; founded **1983** (NOT the 2022 Meetup-group date). |
| 9 | AnchorageH3 | Anchorage Alaska Hash House Harriers | Anchorage, AK | HTML_SCRAPER (WordPress) | `anchoragealaskah3.com/category/event/` | Med — WP event feed; recency unverified | no `anchorage*`/`alaska*` slug | queued | Biweekly Sat year-round. Self-hosted WordPress (not .com) — check `/wp-json/wp/v2/posts`. |
| — | Brasília H3 | Brasilia Hash House Harriers | Brasília, Brazil | HTML_SCRAPER (NEW `BrasiliaH3Adapter`, Blogger API v3 — empty-title body parse) | `brasiliah3.blogspot.com` (`fetchBloggerPosts`) | Shipped | no `brasilia*`/`brazil`/`bsb` slug (sitemap 424, 2026-06-04) | **shipped** | **[PR #1969](https://github.com/johnrclem/hashtracks-web/pull/1969) (merged). Live at https://www.hashtracks.xyz/kennels/brasilia-h3 — 175 prod events** (174 backfilled #154 2019-04-21 → #338 2026-05-10 + upcoming **N+340 Sun 7 Jun 2026**). 🇧🇷 **First Brazil kennel.** Est. 1989. Handoff `handoffs/2026-06-04-brasilia-h3.md` · retro `handoffs/retros/2026-06-04-brasilia-h3-retro.md`. Empty-title Blogspot → body parse; future-only adapter + `config.upcomingOnly` + frozen 174-run backfill. Brazil COUNTRY + Brasília METRO added (emerald). kennelCode `brasilia-h3` (`bh3` taken). Key learnings: **year-less date → infer CLOSEST-to-publish** (not naive +1; recap posts publish after the run); venue label has inline `Start:` AND `📍 Start`-heading-then-next-line forms; Blogger **public feed caps ~150 → use the keyed API**; faithful source errors (dup `N+252`) stored, not renumbered. |
| — | Auckland H3 | Auckland Hash House Harriers | Auckland, NZ | HTML_SCRAPER (NEW `AucklandHashAdapter`, Rocketspark) | `aucklandhashhouseharriers.co.nz` | Shipped | only `auckland-hussies` is live | **shipped** | **PR #1896 (merged). Live — 7 events** (weekly Mon, 1 Jun → 13 Jul 2026). 🇳🇿 NZ's oldest hash (est. 1970). kennelCode `ah3-nz`. Rocketspark Draft.js TAB-delimited run list (platform note added). |
| — | NSWHHH | North Shore Wanderers H3 | Sydney, AU | GOOGLE_SHEETS (forward, config-only) + NEW `NSWHHHAdapter` HTML_SCRAPER (Google Sites home page, venue/coords) | `docs.google.com/.../export?format=csv&gid=0` + `nswhhh.info/home` | Shipped | no `nsw*`/`wanderer*` slug (4 other Sydney kennels live) | **shipped** | **PR #1917 (merged). Live — 187 prod events** (#904 Sep 2022 → #1092 Dec 2026). First **dual-source** onboard: the sheet supplies the forward season, the website enriches the current run's venue + coords (website trust 8 > sheet 7 so the merge doesn't drop its coords — Codex catch). 159-run backfill from the sheet's *second tab* (`gid=360703890`). Made `GoogleSheetsConfig.columns.location` optional. Self-hosted logo (browser-grabbed — `sitesv` token 403s server-side). Google Sites section added to `source-platform-notes.md`. |
| 12 | Bangkok Monday H3 | Bangkok Monday Hash House Harriers | Bangkok, TH | HTML_SCRAPER | `bangkokmondayhhh.com` | Low — structure unverified | no `bangkok*` slug | queued | Prefer over bangkokhhh.org (PDF-only hareline). |
| 13 | KL Junior H3 | Kuala Lumpur Junior Hash House Harriers | Kuala Lumpur, MY | HTML_SCRAPER (scrapeable runs page) | `https://www.kljhhh.org/runs/` | Med — runs page with future hares confirmed | only `kl-full-moon` is live | queued | Monthly family hash (lower cadence). |

## Leads — verify a live dynamic source before queueing

Grep-confirmed absent from the live sitemap but need one more live check before promotion. **Promotion
bar = a live dynamic source with recent-cadence activity — NOT necessarily an upcoming run.** Apply
the *recently-active* rule (daily-prompt Step 3): a regular-cadence kennel whose latest run is within
~2× its interval qualifies even at 0 upcoming (onboard with a recent-history backfill).

All candidates below confirmed **absent from the live sitemap** (Chrome MCP, 423 slugs, 2026-06-03) unless noted.

- **Santiago H3** (Chile) — Meetup `meetup.com/santiago-hash-house-harriers` exists but **0 upcoming** (Apollo `apolloEventCount:0`, checked 2026-06-03); also a Blogspot `santiagohashhouseharriers.blogspot.com`. *Check the Blogspot / Meetup-past cadence; promote with a backfill if recent + consistent.*
- **Tulsa H3** (OK) — Meetup `meetup.com/tulsa-hash-house-harriers` exists but **0 upcoming** (checked 2026-06-03). *Check past cadence; promote if within ~2× interval.*
- **Buenos Aires H3** (Argentina) — Blogspot `buenosaireshashhouseharriers.blogspot.com` (from Brasília H3 blogroll). *Check Blogger feed recency.*
- **Lima H3** (Peru) — Blogspot `limahashash.blogspot.com`. *Check Blogger feed recency.*
- **B.I.T.CH H3** (Zürich, CH) — Meetup + run-list site; Tuesday hash. *Verify recent runs (upcoming OR last run within ~2× weekly interval).*
- **Kampala H3 / KH3** (Uganda) — weekly Monday; active social signals. *Find a clean dynamic source (FB-only rejected); source-add if a Meetup/HC listing surfaces.*
- **Guadalajara H3** (MX) — likely Meetup/HTML; source not yet confirmed.
- **OKC H3** (OK) — likely Meetup; confirm a live source.
- **Madrid H3 / Lisbon H3 / Vienna H3 / Prague H3 / Budapest H3** (Europe) — large well-known city hashes, all sitemap-absent; *identify + verify a live dynamic source (Meetup or website) before queueing.*
- **Bogotá H3 / Montevideo H3 / Panama H3** (LatAm) — sitemap-absent; Blogspot/FB signals from regional blogrolls; *confirm a clean dynamic source.*
- **Cape Town H3 / Jo'burg H3** (South Africa) — sitemap-absent; *identify a live source (Africa expansion after ONH3/Nairobi).*

## Removed — already live (authoritative sitemap check)

Confirmed present in `hashtracks.xyz/sitemap.xml` — do **not** onboard:

- **Las Vegas H3** (`las-vegas-h3`) — kennel + lvh3.org Events Calendar source both live. Handoff `2026-05-27-lvhhh.md` was **voided**.
- **Wanchai H3** (`wanchai-h3`), **Sydney Larrikins** (`sydney-larrikins`).
- **Dayton/Cincinnati cluster** — `dayton-h4`, `mvh3-day` (Miami Valley), `swot` (SW Ohio Trash), `queen-city-h4` all live. The daytonhhh.org iCal hub is already covered.
- **HHHS / Father Hash** (`hhhs`), **Singapore Harriets** (`sg-harriets`).
- **HK H3 Monday** (`hk-h3`), **Wellington Capital H3** (`capital-h3`).
- **El Paso H3** (`el-paso-h3`) + **BJH3 El Paso** (`bjh3`) — both live (sitemap 2026-06-03). Removed from leads.
- **Brussels Manneke Piss H3** (`bmph3`) — flagged tempting because of Friendica/iCal but already live per Codex 2026-05-28 sitemap check.

## Parking lot / rejected (no usable dynamic source)

- **RenoH3** — HashRego renders "No Public Events"; renoh3.com timed out; blog stale (2009).
- **LDSH3 (Salt Lake City)** — HashRego empty; site static; Meetup slug unverified.
- **Dubai Desert H3** — calendar shows "No event found"; details only via WhatsApp/email.
- **Bangkok H3 (bangkokhhh.org)** — hareline is a PDF only (Bangkok Monday kept instead).
- **Christchurch H3** — events page lists only special weekends, not the weekly calendar.
- **Spokane** — no clear kennel site or active Meetup surfaced.
- **Barcelona H3** — Meetup page exists but only two 2024 past events visible; fails the dynamic-source rule (Codex 2026-05-28).
- **Brazil Nuts São Paulo H3** — Google Site says activity moved to Facebook; Facebook-only unless a better source turns up (Codex 2026-05-28).
- **Note on HashRego** — many kennels' HashRego pages render "No Public Events"; don't rely on it without confirming events are posted.
