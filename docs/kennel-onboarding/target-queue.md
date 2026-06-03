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
2026-06-02 (421 slugs; Paris H3/Sans Clue dedup — 0 France kennels confirmed).
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
| 3 | Mauritius H3 | Mauritius Hash House Harriers | Mauritius (Indian Ocean) | HTML_SCRAPER | `https://www.mhash.com/category/hash-next-run/` | High — clean future run list through Dec 2026, every 2nd Sunday | no `mauritius*`/`mhash` slug | **queued (re-eval)** | ⟳ **Re-queued under the *recently-active* rule (Step 3):** was ~3× interval stale on 2026-05-30 (biweekly, last run 19 Apr) — **recheck whether the next-run CPT has updated since**; onboard with a recent-history backfill if the latest run is now within ~2× interval, else re-block `stale`. _Prior block evidence:_ **Source currently stale — no upcoming events.** Live homepage shows the latest "Next Run" = #955 dated **19 Apr 26** (6 weeks past, today 2026-05-30); `/category/hash-next-run/` archive renders "Nothing Found"; runs #956/#957 + trash #956 don't exist (latest trash = #954, 10 Apr 26). Site is server-rendered WP but its "Next Run" CPT hasn't been updated since mid-April; `/wp-json/wp/v2/posts` returns empty (REST disabled). Kennel **is** active (biweekly, FB group `1944322859018859`) — revisit when the next-run updates. Mind `mh3` collision → `mh3-mu`/`mauritiush3`. |
| 4 | Mijas H3 | Mijas Hash House Harriers | Mijas / Costa del Sol, ES | HTML_SCRAPER | `https://www.mijash3.com/hareline` (+ `/run-directions`) | High — handed off 2026-05-30; full hareline through Aug 2026 verified live (run #2020 Sun 31 May → #2034) | no `mijas*`/Spain slug (sitemap 415, 2026-05-30) | **handed-off** | `handoffs/2026-05-30-mijash3.md`. **🇪🇸 First Spain kennel.** Est. 1989 "Burro Hash", weekly Sunday. NEW ~150–220 LoC Cheerio scraper (Squarespace *content-page* hareline — NOT the Events-JSON path, so not config-only). Add Spain + Costa del Sol regions (all-5 `region.ts` edits). Self-host tokenized Squarespace logo. hashCash not published (follow up). |
| 5 | Winterthur & Schaffhausen H3 | Winterthur & Schaffhausen Hash House Harriers | Switzerland | MEETUP | `meetup.com/winterthur_schaffhausenhhh/` | High — monthly recurring future events (Jun 20 + Jul 18 2026) | no `wsh3`/`winterthur`/`schaffhausen` slug | queued | From Codex 2026-05-28. Second Switzerland kennel. kennelCode `wsh3` (or `wsh3-ch`). |
| — | Hamburg H7 | Hamburg H7 | Hamburg, DE | HARRIER_CENTRAL + Blogspot backfill | hashruns.org; `hamburghash.blogspot.com` | Shipped | no `hamburg*`/`h7` slug | **shipped** | **PRs #1886 + #1895 (merged). Live — 111 events** (101 historical #594–#700 from the Blogspot archive, 10 upcoming #707–#716 via Harrier Central). `walkersWelcome` badge live; Hamburg METRO region added. Config-only HC + one-shot Blogspot backfill. |
| 7 | VH3 | Vancouver Hash House Harriers | Vancouver, BC | HTML_SCRAPER | `vanhash.com` / `vh3.ca/RecedingHareline.html` | Low-Med — verify which domain is live; may need browserRender | no `vancouver*` slug | queued | Biweekly Sat. |
| 8 | Mexico City H3 | Hash House Harriers Mexico City | Mexico City, MX | MEETUP | `meetup.com/mexico-city-hash-house-harriers` (fallback mchhh.com/schedule) | Med — biweekly; confirm recent cadence (upcoming OR last run within ~2× interval — *recently-active* rule, the motivating case) | no `mexico*` slug | queued | Run #732+, biweekly Sat. **If 0 upcoming but recently active, onboard with a recent-history backfill.** |
| 9 | AnchorageH3 | Anchorage Alaska Hash House Harriers | Anchorage, AK | HTML_SCRAPER (WordPress) | `anchoragealaskah3.com/category/event/` | Med — WP event feed; recency unverified | no `anchorage*`/`alaska*` slug | queued | Biweekly Sat year-round. Self-hosted WordPress (not .com) — check `/wp-json/wp/v2/posts`. |
| — | Auckland H3 | Auckland Hash House Harriers | Auckland, NZ | HTML_SCRAPER (NEW `AucklandHashAdapter`, Rocketspark) | `aucklandhashhouseharriers.co.nz` | Shipped | only `auckland-hussies` is live | **shipped** | **PR #1896 (merged). Live — 7 events** (weekly Mon, 1 Jun → 13 Jul 2026). 🇳🇿 NZ's oldest hash (est. 1970). kennelCode `ah3-nz`. Rocketspark Draft.js TAB-delimited run list (platform note added). |
| — | NSWHHH | North Shore Wanderers H3 | Sydney, AU | GOOGLE_SHEETS (forward, config-only) + NEW `NSWHHHAdapter` HTML_SCRAPER (Google Sites home page, venue/coords) | `docs.google.com/.../export?format=csv&gid=0` + `nswhhh.info/home` | Shipped | no `nsw*`/`wanderer*` slug (4 other Sydney kennels live) | **shipped** | **PR #1917 (merged). Live — 187 prod events** (#904 Sep 2022 → #1092 Dec 2026). First **dual-source** onboard: the sheet supplies the forward season, the website enriches the current run's venue + coords (website trust 8 > sheet 7 so the merge doesn't drop its coords — Codex catch). 159-run backfill from the sheet's *second tab* (`gid=360703890`). Made `GoogleSheetsConfig.columns.location` optional. Self-hosted logo (browser-grabbed — `sitesv` token 403s server-side). Google Sites section added to `source-platform-notes.md`. |
| 12 | Bangkok Monday H3 | Bangkok Monday Hash House Harriers | Bangkok, TH | HTML_SCRAPER | `bangkokmondayhhh.com` | Low — structure unverified | no `bangkok*` slug | queued | Prefer over bangkokhhh.org (PDF-only hareline). |
| 13 | KL Junior H3 | Kuala Lumpur Junior Hash House Harriers | Kuala Lumpur, MY | HTML_SCRAPER (scrapeable runs page) | `https://www.kljhhh.org/runs/` | Med — runs page with future hares confirmed | only `kl-full-moon` is live | queued | Monthly family hash (lower cadence). |

## Leads — verify a live dynamic source before queueing

Grep-confirmed absent from the live sitemap but need one more live check before promotion. **Promotion
bar = a live dynamic source with recent-cadence activity — NOT necessarily an upcoming run.** Apply
the *recently-active* rule (daily-prompt Step 3): a regular-cadence kennel whose latest run is within
~2× its interval qualifies even at 0 upcoming (onboard with a recent-history backfill).

- **B.I.T.CH H3** (Zürich, CH) — Meetup + run-list site; Tuesday hash. *Verify the source is live with recent runs (upcoming OR a last run within ~2× the weekly interval).*
- **Kampala H3 / KH3** (Uganda) — weekly Monday; active social signals, 2026 7 Hills Run coverage. *Find a clean dynamic source (FB-only is rejected); maybe source-add if a Meetup or HC listing surfaces.*
- **Brasilia H3** (Brazil) — Blogspot + AllEvents sample for Mar 2026 (`brasiliah3.blogspot.com`). *Promote if the Blogspot shows a consistent recent cadence (latest post within ~2× interval) — a future-dated event is not required.*
- **Asunción H3** (Paraguay) — WordPress run history through Apr 18, 2026 (`asuncionh3.wordpress.com/run-history/`). *Re-check the run-history cadence: if recent + consistent (within ~2× interval), promote and onboard with a backfill even at 0 upcoming.*
- **Santiago H3** (Chile) — strong Meetup group signal but visible events are past (`meetup.com/es-ES/santiago-hash-house-harriers/`). *Promote if the past runs show a recent, consistent cadence (within ~2× interval); onboard with a backfill if 0 upcoming.*
- **Guadalajara H3** (MX) — likely Meetup/HTML; source not yet confirmed.
- **El Paso H3** (TX) — likely Meetup; confirm a live source with recent runs (upcoming OR within ~2× interval).
- **Tulsa / OKC H3** (OK) — likely Meetup; confirm a live source.

## Removed — already live (authoritative sitemap check)

Confirmed present in `hashtracks.xyz/sitemap.xml` — do **not** onboard:

- **Las Vegas H3** (`las-vegas-h3`) — kennel + lvh3.org Events Calendar source both live. Handoff `2026-05-27-lvhhh.md` was **voided**.
- **Wanchai H3** (`wanchai-h3`), **Sydney Larrikins** (`sydney-larrikins`).
- **Dayton/Cincinnati cluster** — `dayton-h4`, `mvh3-day` (Miami Valley), `swot` (SW Ohio Trash), `queen-city-h4` all live. The daytonhhh.org iCal hub is already covered.
- **HHHS / Father Hash** (`hhhs`), **Singapore Harriets** (`sg-harriets`).
- **HK H3 Monday** (`hk-h3`), **Wellington Capital H3** (`capital-h3`).
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
