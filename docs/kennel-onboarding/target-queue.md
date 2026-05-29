# Kennel Onboarding — Target Queue

Ranked backlog for the daily onboarding task. **Rank 1 = onboard next.** The daily run
([`daily-onboarding-prompt.md`](daily-onboarding-prompt.md)) takes the top `queued` row each
morning. When `queued` rows drop to **5 or fewer**, the run refills the list back to ~20.

**Inclusion rule:** every entry must have a **confirmed/identified dynamic data source**
(Google Calendar, iCal, Meetup w/ upcoming events, Harrier Central, Hash Rego, Google Sheets,
or a scrapeable website). No Facebook-only / static-only kennels.

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
2026-05-29 (ONH3 added, 413+). Re-confirm each row at handoff time per the prompt.

## Active queue — all confirmed NOT live (sitemap-verified)

| Rank | Kennel | Full name | Region | Best source type | Source URL / ID | Confidence | Live-dedup (sitemap) | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| — | SACH3 | Sacramento Hash House Harriers | Sacramento, CA | Squarespace events JSON (NEW `SquarespaceEventsAdapter`) | `sach3.beer/events?format=json` (iCal export was gated OFF; sach3.com dead) | Shipped | n/a | **shipped** | **Live in prod (54 events).** PRs #1742 (adapter) + #1745/#1746 (coord-pin fix, pagination, endTime, dropCachedCoords). iCal plan was infeasible → needed ~360-LoC adapter. **Future Squarespace kennels are now config-only.** |
| — | BoiseH3 | Boise Hash House Harriers | Boise, ID | HTML_SCRAPER (static Cheerio, home-page) | `https://www.boiseh3.org/` (Wix; `/events-3` widget is JS-rendered) | Shipped | sitemap-checked absent at handoff | **shipped** | **PR #1750.** New ~200–300 LoC `BoiseH3Adapter`, new Idaho region, self-hosted logo. Wix `richTextElement` traversal + S5852 safe regexes + title-less heading regex now captured in `source-platform-notes.md`. |
| — | ONH3 | Original Nairobi Hash House Harriers | Nairobi, KE | HTML_SCRAPER (WordPress.com REST API) | `public-api.wordpress.com/wp/v2/sites/onh3.wordpress.com/posts` | Shipped | n/a | **shipped** | **🌍 HashTracks' first Africa kennel.** Commits `685f2e0d` (adapter) + `d5a10952` (history split). Future adapter = future-only via WordPress.com REST; past via one-shot `scripts/backfill-onh3-history.ts`; `config.upcomingOnly: true` suppresses stale-event reconciliation. WordPress.com section now lives in `source-platform-notes.md` — next WP.com kennel will be much faster. **Once 3–4 ship, factor a shared `WordPressComAdapter` base class.** |
| — | Bali Hash 2 | Bali Hash House Harriers 2 | Bali, Indonesia | HTML_SCRAPER (Ghost blog, Cheerio) | `https://balihash2.com/` (Ghost 6.5, server-rendered) | High — handed off 2026-05-29; next run #1747 dated 2026-05-30 confirmed live | n/a | **handed-off** | `handoffs/2026-05-29-bali-hash-2.md`. NEW adapter ~250–350 LoC mirroring `hangover.ts` (Ghost) + `ofh3.ts` (single-kennel trail posts). World-famous Bali kennel, run #1747+. **🇮🇩 First Indonesia kennel.** Self-host the Ghost CDN logo. Optional one-shot historical backfill (~1,747 archived runs via `/page/N`). After ship, add a Ghost section to `source-platform-notes.md`. |
| 1 | Paris H3 / SCHHH | Paris + Sans Clue Hash House Harriers | Paris, FR | HTML_SCRAPER (WordPress.com) | `parishash.wordpress.com/category/hash-schedule` (try public-api.wordpress.com REST) | Med — use WP blog, NOT Meetup (0 upcoming); reuse ONH3 patterns | no `paris*`/`sans-clue` slug | queued | Only mainland-EU row that's been #1 for a while. **WordPress.com — apply the ONH3 pattern from `source-platform-notes.md` (title drift, Hash Trash split, upcomingOnly).** |
| 2 | Zürich H3 | Zurich Hash House Harriers | Zurich, CH | MEETUP (site directs to Meetup for locations) | site: `zh3.ch` → meetup slug TBD at build | Med — Thu + 1st Sat / 3rd Sun; confirm Meetup has upcoming at build | no `zurich*`/`zh3` slug (Codex 2026-05-28) | queued | From Codex 2026-05-28 rebalance. `zh3` kennelCode looks clear but confirm vs seed. |
| 3 | Mauritius H3 | Mauritius Hash House Harriers | Mauritius (Indian Ocean) | HTML_SCRAPER | `https://www.mhash.com/category/hash-next-run/` | High — clean future run list through Dec 2026, every 2nd Sunday | no `mauritius*`/`mhash` slug | queued | From Codex 2026-05-28. Mind `mh3` collision (Memphis/Munich/Montreal) → use `mh3-mu` or `mauritiush3`. |
| 4 | Mijas H3 | Mijas Hash House Harriers | Mijas / Costa del Sol, ES | HTML_SCRAPER | `https://www.mijash3.com/hareline` (+ `/run-directions`) | High — weekly Sunday, hareline through Jul 2026 | no `mijas*` slug | queued | From Codex 2026-05-28. Spain coverage. kennelCode `mijash3`. |
| 5 | Winterthur & Schaffhausen H3 | Winterthur & Schaffhausen Hash House Harriers | Switzerland | MEETUP | `meetup.com/winterthur_schaffhausenhhh/` | High — monthly recurring future events (Jun 20 + Jul 18 2026) | no `wsh3`/`winterthur`/`schaffhausen` slug | queued | From Codex 2026-05-28. Second Switzerland kennel. kennelCode `wsh3` (or `wsh3-ch`). |
| 6 | Hamburg H7 | Hamburg H7 | Hamburg, DE | HARRIER_CENTRAL | blog: `hamburghash.blogspot.com` → now on hashruns.org | Med — May 2026 post says next runs on Harrier Central; verify kennel slug on hashruns.org | no `hamburg*`/`h7` slug | queued | From Codex 2026-05-28. **Likely config-only** — `HarrierCentralAdapter` exists. kennelCode `hamburg-h7` (mind `h7` collision check). |
| 7 | VH3 | Vancouver Hash House Harriers | Vancouver, BC | HTML_SCRAPER | `vanhash.com` / `vh3.ca/RecedingHareline.html` | Low-Med — verify which domain is live; may need browserRender | no `vancouver*` slug | queued | Biweekly Sat. |
| 8 | Mexico City H3 | Hash House Harriers Mexico City | Mexico City, MX | MEETUP | `meetup.com/mexico-city-hash-house-harriers` (fallback mchhh.com/schedule) | Med — confirm Meetup has upcoming events | no `mexico*` slug | queued | Run #732+, biweekly Sat. |
| 9 | AnchorageH3 | Anchorage Alaska Hash House Harriers | Anchorage, AK | HTML_SCRAPER (WordPress) | `anchoragealaskah3.com/category/event/` | Med — WP event feed; recency unverified | no `anchorage*`/`alaska*` slug | queued | Biweekly Sat year-round. Self-hosted WordPress (not .com) — check `/wp-json/wp/v2/posts`. |
| 10 | Auckland H3 | Auckland Hash House Harriers | Auckland, NZ | HTML_SCRAPER | `aucklandhashhouseharriers.co.nz` | Low-Med — events exist; structure unverified | only `auckland-hussies` is live | queued | Mind `ah3` collision → `ah3-nz`. |
| 11 | NSWHHH | North Shore Wanderers H3 | Sydney, AU | HTML_SCRAPER | `nswhhh.info` | Low — confirm dynamic run list at build | no `nsw*`/`wanderer*` slug (4 other Sydney kennels live) | queued | Weekly Mon 6:30pm. |
| 12 | Bangkok Monday H3 | Bangkok Monday Hash House Harriers | Bangkok, TH | HTML_SCRAPER | `bangkokmondayhhh.com` | Low — structure unverified | no `bangkok*` slug | queued | Prefer over bangkokhhh.org (PDF-only hareline). |
| 13 | KL Junior H3 | Kuala Lumpur Junior Hash House Harriers | Kuala Lumpur, MY | HTML_SCRAPER (scrapeable runs page) | `https://www.kljhhh.org/runs/` | Med — runs page with future hares confirmed | only `kl-full-moon` is live | queued | Monthly family hash (lower cadence). |

## Leads — verify a live dynamic source before queueing

Grep-confirmed absent from the live sitemap but need one more live check before promotion.

- **B.I.T.CH H3** (Zurich, CH) — Meetup + run-list site; Tuesday hash. *Verify upcoming events live* before queueing.
- **Kampala H3 / KH3** (Uganda) — weekly Monday; active social signals, 2026 7 Hills Run coverage. *Find a clean dynamic source (FB-only is rejected); maybe source-add if a Meetup or HC listing surfaces.*
- **Brasilia H3** (Brazil) — Blogspot + AllEvents sample for Mar 2026 (`brasiliah3.blogspot.com`). *Needs confirmed future event after 2026-05-28 before promotion.*
- **Asunción H3** (Paraguay) — WordPress run history through Apr 18, 2026 (`asuncionh3.wordpress.com/run-history/`). *No confirmed future run after 2026-05-28; re-check next time queue refills.*
- **Santiago H3** (Chile) — strong Meetup group signal but visible events are past (`meetup.com/es-ES/santiago-hash-house-harriers/`). *Verify an upcoming event before queueing.*
- **Guadalajara H3** (MX) — likely Meetup/HTML; source not yet confirmed.
- **El Paso H3** (TX) — likely Meetup; confirm upcoming events.
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
