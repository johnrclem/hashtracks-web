# Onboarding Handoff — Cambridge H3 (source-add: /calendar + /runlist archive) — 2026-11-21

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> Closes #2861. Source-add for an already-live kennel (`cambridge-h3`, adapter `CambridgeHashAdapter`
> in `src/adapters/html-scraper/cambridge-hash.ts`). Do not duplicate the kennel.
> 1. Branch off clean `main`: `onboard/cambridge-h3-calendar-<YYYYMMDD>`.
> 2. Extend the adapter (or add a sibling `calendar` pass) per **Adapter notes**.
> 3. Live-verify with `adapter.fetch(source, { days: source.scrapeDays })` (no DB write), per `.claude/rules/live-verification.md`.
> 4. Optional history backfill from `/runlist` (see **Historical backfill**), routed through the merge pipeline.
> 5. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 6. PR body must contain bare `Closes #2861`. Do NOT run `prisma db seed` in the build step.

## Summary
- Type: source-add (existing kennel `cambridge-h3`, existing source "Cambridge H3 Website" `https://www.ch3.co.uk/`)
- Adapter: HTML_SCRAPER via `browserRender` — existing adapter extended (small: ~40–70 LoC + tests)
- One-line: the homepage `.RunList` misses non-trail events listed on `/calendar` (Girton College Dinner Dance, Fri 11 Dec 2026); `/runlist` also holds a full run archive (2006→present).

## Dedup result
- Kennel in seed: yes (`cambridge-h3`; source at `prisma/seed-data/sources.ts` ~line 9968, `config: { upcomingOnly: true }`, `kennelCodes: ["cambridge-h3"]`)
- Registry: `onHost("ch3.co.uk", { subdomains: "www" })` → `CambridgeHashAdapter` (`src/adapters/registry.ts:247`)
- Decision: source-add / adapter extension. No new kennel fields researched (already live).

## Live source verification ✅ (browser render, 2026-11-21)
- `curl https://www.ch3.co.uk/calendar` → HTTP 200 but only a 3.8 KB Blazor shell (no data). Needs `browserRender`; rendered after ~5 s.
- **`/calendar` rendered text (verbatim):** `Calendar / Future events. / Date  Venue  Event / Fri, 11 Dec 2026  Girton College - Dinner Dance  Run 2500`
- DOM: `<table class="my-table cse-table w-100 min-width-992"><thead><tr><th>Date</th><th>Venue</th><th>Event</th></tr></thead><tbody><tr><td>Fri, 11 Dec 2026</td><td>Girton College - Dinner Dance</td><td>Run 2500</td></tr></tbody></table>` (inside `<main>`; Blazor comment nodes `<!--!-->` between cells; no time, no hares, no coords, no links).
- Events seen: 1 (2026-12-11). Only future events are listed (`<h3>Future events.</h3>`).
- ⚠️ The Event column says "Run 2500", which collides with the real trail #2500 (Hoops, Sun 2026-11-22, on the homepage `.RunList`). Treat as a **kennel social**, NOT run 2500: do not emit `runNumber`, give it a title like `Girton College - Dinner Dance`, and ensure it cannot merge into the 2026-11-22 trail (different date, so fingerprint differs as long as runNumber is omitted).
- No start time on the page → leave `startTime` undefined (do not default to the 11:00 trail time).
- `/past` → HTTP 404 (the seed comment "done runs move to /past/" is stale; archive is `/runlist`).
- Pagination/history: see below. Coord sanity: n/a (no coords). End times: none.

### Field-fill table (n=1 calendar row)
| Field | n/N | Plan |
|---|---|---|
| title | 1/1 | `<td>` 2 (venue column text is the event name) |
| startTime | 0/1 | leave undefined |
| location | 0/1 | do NOT put "Girton College - Dinner Dance" in location blindly; title only (could add "Girton College" as location if you split on " - " — optional, flag) |
| hares/cost/description/coords | 0/1 | not in page |

## Historical backfill (bonus — verified exists)
- `https://www.ch3.co.uk/runlist` (browser-render, ~5 s): "A list of our runs from Sep 2006 to the present". Grouped by season blocks ("Runs 2494-2545 / Years 2026/2027", …, "Runs 1458-1508 / Years 2006/2007"). ~1,326 `<tr>` rows (includes month/header rows), so on the order of ~1,000 runs, run numbers ~1458 → 2504+. Only the newest block was expanded in the initial render; **older season blocks are collapsed — the implementer must expand/click them (or find the data endpoint) to read rows.** Not verified beyond the first block.
- Columns: `Date | Run | Relive | Venue | Hare`. Verbatim sample rows (newest block, year from season header + month header):
  - `20th  2504  (blank)  TBD , Anywhere, CB1 2JW  Wrong Way`
  - `22nd  2500  (blank)  Hoops , Barton, CB23 7BD  Jetstream and Unmentionable`
  - `11th  2494  (blank)  Maids Head , Wicken, CB7 5XR  Dainty Blobs, Crack of Doom and Swampy`
  - Placeholder venue `TBD , Anywhere, CB1 2JW` (already handled by the adapter's `PLACEHOLDER_POSTCODE`).
- Whether HashTracks already holds older Cambridge runs: **not checked** (no prod DB access in this task). Implementer should compare run numbers vs prod before backfilling.
- Plan: frozen `scripts/data/cambridge-h3-history.json` + dumb loader `scripts/backfill-cambridge-h3-history.ts` routed through the merge pipeline (throwaway parser, don't commit it); PII scrub (phone numbers/emails), run-number monotonicity + gap checks per the frozen-dataset checklist. Sample ≥3 seasons across years for format drift before trusting the parser (this was only sampled for the newest season).
- Also: `/Hashtory`, `/statisticlist` and `/harecountlist` exist in the nav (unprobed).

## Adapter notes
- Mirror the existing pattern in `cambridge-hash.ts`: `browserRender` of the page, wait for a selector (e.g. `main table.cse-table tbody tr`), parse with cheerio. Calendar rows: date text `Fri, 11 Dec 2026` (use `chronoParseDate` from `src/adapters/utils`; weekday-prefixed full date).
- Extend `fetch()` to also render `https://www.ch3.co.uk/calendar` and append its events; a calendar failure should push to `errors` but NOT drop homepage events; empty calendar table is a valid state (no events) — do not fail.
- Keep `config.upcomingOnly: true` (both pages show future/rolling items only).
- Dedup between pages: if a calendar row's date equals a homepage run date, prefer the homepage run (has run number/venue/hares).
- `kennelTags: ["cambridge-h3"]`. Leave `title` as the row text; omit `runNumber`.
- ⚠️ Claude Code must verify against current types: `RawEventData` field names (`kennelTags: string[]`), `safeFetch`/`browserRender` imports, `buildDateWindow`, and whether a calendar-only event with no `startTime` is acceptable to merge.
- Sonar: keep helpers small (S3776 ≤ 15), no stacked `\s*` regexes.
- Alternative (issue's second suggestion): one-off admin event — rejected, the page will list future socials again.

## Deep-dive checklist
Kennel profile fields not re-researched (kennel already live; source-add). Sibling sweep: site is single-kennel (Cambridge H3); `UKH3 Events` link is external.

## Implementation gotchas
- Blazor server app: first paint is empty; wait for the table selector or `browserRender` returns an empty shell (adapter should fail loud on a rendered page with no table AND no "Future events." heading).
- Tests: `beforeEach(vi.restoreAllMocks)`; fixture should mirror the real DOM above including `<!--!-->` comment nodes.
