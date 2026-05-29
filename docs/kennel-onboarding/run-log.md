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
