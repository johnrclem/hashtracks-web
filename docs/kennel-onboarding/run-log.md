# Kennel Onboarding — Run Log

Append one entry per daily run (newest at top). Keep it terse.

Format:
```
## YYYY-MM-DD — <shortName> (<region>)
- Source: <TYPE> — <url/id>
- Outcome: <PR #123 | branch onboard/... ready to push | blocked: reason>
- Events verified: <count>, date range <…>
- Historical backfill: <count or none>
- Follow-ups: <anything deferred>
```

---

## 2026-05-30 — Mijas H3 (Costa del Sol, Spain) 🇪🇸 first Spain kennel
- Source: HTML_SCRAPER — `https://www.mijash3.com/hareline` (Squarespace *content-page* hareline, server-rendered; NEW ~150–220 LoC `MijasH3Adapter` — NOT the Events-JSON config-only path).
- Outcome: **SHIPPED** → PR #1832 (onboarding: adapter + Spain/Costa del Sol regions + seed) + PR #1837 (historical backfill tooling). Live at https://www.hashtracks.xyz/kennels/mijash3 — **389 prod events**.
- Dedup: full onboard — 0 Spain/Mijas slugs in live sitemap (415, Chrome MCP 2026-05-30). kennelCode `mijash3` clear.
- Events verified: 37 hareline rows Jan–Aug 2026; upcoming **#2020 "AGM Run" Sun 31 May 2026 (Shaggy & AguaSex, Fuengirola, ~15:00)** through #2034 (30 Aug). Run#, date (`DD Month YYYY`), hares, theme per line. ⚠️ live DOM order is NOT chronological (Aug block before May) — parse per-line date.
- Historical backfill: **~353 runs (#849 9 Jan 2005 → #1998 28 Dec 2025)** — handoff said "none" but the Squarespace "Run Reports & Gallery" collections (`/runreports-2019`…`/run-reports-gallery-2025`, via `?format=json-pretty`) hold one post per run. One-shot `scripts/backfill-mijash3-history.ts`, bound to the `upcomingOnly` source so history is reconcile-safe. **(Biggest research-prompt gap — see retro Gap A.)**
- Follow-ups: hashCash not published (revisit). Retro at `handoffs/retros/2026-05-30-mijash3-retro.md`: probe blog/archive collections + `?format=json-pretty` before declaring "no history"; plain fetch returns SSR markup (don't speculate DOM); add Sonar S5843 to pre-empt notes; include `scrapeDays` in source seed. New-country 5-edit checklist (from ONH3 retro) **worked** — no `inferCountry` bug.

## 2026-05-30 — Mauritius H3 (Mauritius) — **BLOCKED (target #3)**
- Source attempted: HTML_SCRAPER — `mhash.com/category/hash-next-run/`.
- Outcome: **blocked — source currently stale, no upcoming events.** Live homepage's "Next Run" = #955 dated **19 Apr 26** (6 weeks past); `/category/hash-next-run/` renders "Nothing Found"; runs #956/#957 + trash #956 don't exist (latest trash #954, 10 Apr 26); `/wp-json` posts empty (REST disabled). Kennel is active (biweekly, FB group `1944322859018859`) but the website's next-run hasn't refreshed since mid-April. Fell through to target #4 (Mijas H3). Revisit Mauritius when the next-run updates.

## 2026-05-29 — Zürich H3 (Zürich, Switzerland) 🇨🇭 first Switzerland kennel
- Source: MEETUP (config-only) — `meetup.com/the-zurich-hash-house-harriers` (kennelTag `zh3`, `extractRunNumber: true`). Kennel site `zh3.ch` (WP 6.9.4) directs all signups to Meetup.
- Outcome: **handed-off** → `docs/kennel-onboarding/handoffs/2026-05-29-zh3.md`. Config-only — no new adapter. Branch suggestion: `onboard/zh3-20260529`.
- Dedup: full onboard — 0 Swiss slugs in live sitemap (414, Chrome MCP 2026-05-29). kennelCode `zh3` clear.
- Events verified: upcoming run **#1731 "Spitroast hash", Sat 2026-06-06 2–5 PM CEST, Pfadiheim Holzwiese Zürich**, hares "Premature Cocksucker", CHF 5 (SSR'd Meetup detail page). Regular cadence Thu 7PM + 1st Sat 2PM + 3rd Sun. Founded 1990.
- Historical backfill: none worth scripting (Meetup keeps only recent events).
- Follow-ups: ⚠️ Claude Code confirms the "Request to join" group exposes events to the public scrape path (fallback: `zh3.ch` WP `?cat=12`). Add Switzerland+Zürich regions (umlaut in `name`, ASCII alias). Self-host the WP logo. FB/IG not found.

## 2026-05-29 — Paris H3 / SCHHH (Paris, FR) — **BLOCKED**
- Attempted Rank 1. Source plan (WordPress.com `parishash.wordpress.com`) is **stale** — last post 2024-07-30; no 2025/2026 content.
- Meetup `parish3-schhh` shows **0 upcoming** today (last event 2026-05-24, now past); new `sanscluehash.fr` is a client-rendered SPA with no sitemap/`wp-json`/identifiable feed reachable from the sandbox.
- Outcome: **blocked** — no verifiable upcoming-events source today. Kennel is active (2,113-member Meetup), so not dead; revisit when Meetup repopulates or the `sanscluehash.fr` backend API is identified via Chrome (attended). Fell back to Rank 2 (Zürich H3).
- Lesson: a queued "use the WP blog" plan can rot — the Paris blog went silent mid-2024 when the kennel migrated to Meetup + a custom SPA. Always re-verify recency at handoff time, not just that the URL resolves.

## 2026-05-29 — Bali Hash 2 (Bali, Indonesia) 🇮🇩 first Indonesia kennel
- Source: HTML_SCRAPER (Ghost 6.5 blog, Cheerio) — `https://balihash2.com/`
- Outcome: **handed-off** → `docs/kennel-onboarding/handoffs/2026-05-29-bali-hash-2.md`. NEW adapter ~250–350 LoC mirroring `hangover.ts` (Ghost) + `ofh3.ts`. Branch suggestion: `onboard/bali-hash-2-20260529`.
- Dedup: full onboard — kennel absent (no `bali*`/`bh2` in seed). kennelCode `bali-hash-2` (clear). World-famous kennel, run #1747+ as of May 2026.
- Events verified: next run #1747 dated 2026-05-30 (tomorrow) live; home-page lists ~12-22 recent posts.
- Historical backfill: optional one-shot script paginating `/page/N` (~1,747 archived runs).
- Follow-ups: self-host Ghost CDN logo; verify foundedYear (1977 vs 1980 conflict — Codex says don't guess); after ship, add a Ghost section to `source-platform-notes.md`.

## 2026-05-29 — ONH3 (Nairobi, KE) 🌍 first Africa kennel
- Source: HTML_SCRAPER (WordPress.com REST API) — `public-api.wordpress.com/wp/v2/sites/onh3.wordpress.com/posts`
- Outcome: **SHIPPED** → commits `685f2e0d` (`feat(onh3): onboard Original Nairobi H3 — HashTracks' first Africa kennel`) + `d5a10952` (`refactor(onh3): split history into one-shot backfill; adapter table = future-only`).
- Adapter strategy: WordPress.com REST → future-only via adapter, past via one-shot `scripts/backfill-onh3-history.ts`. Source config `upcomingOnly: true` to suppress stale-event reconciliation on the aged archive.
- WordPress.com platform notes appended to `source-platform-notes.md` (multi-year title format drift, Hash Trash recap split, hareline-table parser, pagination 400-as-end, `kennelPagesStopReason` semantics, etc.).
- Follow-ups: 3-4 more WordPress.com kennels and the pattern can be factored into a shared `WordPressComAdapter` base class.

## 2026-05-28 — BoiseH3 (Boise, ID)
- Source: HTML_SCRAPER (static Cheerio, home-page parse) — `https://www.boiseh3.org/`
- Outcome: **SHIPPED** → PR #1750 + #27793f98 (SonarCloud fix). New ~200-300 LoC `BoiseH3Adapter`. New Idaho region. Self-hosted logo.
- Dedup: full onboard — kennel absent from seed AND from live sitemap (412 slugs read via Chrome MCP). kennelCode `boiseh3` (clear).
- Events verified: **1 upcoming** from home-page static HTML — Run #1993 "Memorial Day Hash!" Mon 2026-05-25 6:40 PM. Home page is updated weekly; daily scrape captures every trail (fingerprint dedup handles repeats). `/events-3` Wix Events widget is JS-only and not used.
- Historical backfill: **none** — site doesn't expose an archive.
- Retro lessons folded into the system: Wix `richTextElement` traversal pattern, title-less heading regex, Sonar S5852 safe regexes, S3776 pre-planned helpers, `browserRender` (not `fetchBrowserRenderedPage`) as canonical call. Wix section appended to `source-platform-notes.md`.

## 2026-05-27 — SACH3 (Sacramento, CA)
- Source: Squarespace events JSON (NEW `SquarespaceEventsAdapter`, ~360 LoC) — `sach3.beer/events?format=json`
- Outcome: **SHIPPED** → PRs #1742 (adapter) + #1745 (Manhattan-coord-pin rejection + `dropCachedCoords`) + #1746 (pagination, endTime, dropCachedCoords, reconciliation suppression, per-event try/catch, maxPages guard).
- Final prod state: 54 events (handoff promised 38), 0 Manhattan coords, 51 with end-time ranges, 2 multi-day events, history back to 2025-09-03.
- iCal plan was infeasible (Squarespace collection-level iCal export tenant-gated off) → built shared platform adapter. **Future Squarespace kennels are now config-only.**
- Retro lessons folded into the system: Squarespace section in `source-platform-notes.md` (HEAD-check `?format=ical`, tenant-default coord trap, pagination, endDate/endTime). Daily prompt now requires JSON sampling to capture pagination + coord sanity + end times.

## 2026-05-27 — LVHHH (Las Vegas, NV) — **VOIDED**
- Source: ICAL_FEED (The Events Calendar) — `lvh3.org/events/category/trails/lvhhh/?ical=1`
- Outcome: **VOID — Las Vegas H3 was already live in prod** (`las-vegas-h3`, code `LVUSA0`, est. 1990, sourced from lvh3.org via The Events Calendar REST API). Discovered after the handoff was generated. Handoff file marked VOID.
- Lesson: dedup against `prisma/seed-data/` files is insufficient — must check the **live sitemap** because kennels can be added directly via the admin UI without seed entries. System now uses Chrome MCP sitemap as the primary dedup oracle.

## 2026-05-27 — (no onboard) — ENVIRONMENT BLOCKED at Step 0
- Target attempted: Rank 1 LVHHH (now known to be already-live).
- Outcome: **blocked — could not start.** Repo on `admin-ui-redesign` with 123 uncommitted changes, `main` occupied by another worktree, `.git/` writes broken from the sandbox (stale locks owned by another uid).
- Lesson: this triggered the redesign to a write-only handoff workflow (no git from sandbox). Subsequent runs from this date onward never attempt git.

_(latest successful onboarding: ONH3 2026-05-29. Daily cadence is working.)_
