# Onboarding Handoff — Basel-Stadt H3 hareline + 1996–2025 history (source-add) — 2026-11-18

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> Issue: **#2798** (`onboarding-candidate`, audit rule `source-coverage-gap`). Put `Closes #2798` in the PR body.
> 1. Branch off a clean `main`: `onboard/bsh3-ch-hareline-20261118`.
> 2. **Source-add only.** Kennel `bsh3-ch` is already seeded and live (`kennels.ts:1638`, aliases `aliases.ts:456`,
>    Meetup source `sources.ts:5090`). Do **not** touch the kennel row's identity. Add one new `Source` row
>    (see **Ready-to-paste seed**) and one small bespoke adapter (see **Adapter notes**). Optional kennel-field tweak: none required.
> 3. Register the adapter in `src/adapters/registry.ts` with `onHost("basel.harrier.eu.org")` (never a substring regex).
>    Mirror `src/adapters/html-scraper/warwick-hash.ts` / `tamar-valley-h3.ts` for shape.
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`:
>    `adapter.fetch(source, { days: source.scrapeDays })` from a throwaway `npx tsx -e '…'`. Expect the recent+future window
>    only (see Adapter notes) and run numbers #386–#396 at minimum, `startTime: "14:00"` for #396.
>    **DO NOT run `npx prisma db seed` here.**
> 5. **History backfill (worth doing, 376 runs):** freeze a curated `scripts/data/bsh3-ch-history.json` + dumb loader
>    `scripts/backfill-bsh3-ch-history.ts`, routed through the merge pipeline and bound to the NEW hareline source
>    (see **Historical backfill**). Do not commit the extractor.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit, open the PR (metadata, live-verification output, deep-dive checklist in the body).
> 8. **Post-merge runbook (separate step, after merge):**
>    - `git checkout main && git pull`; `git log -1 -- src/adapters/registry.ts prisma/seed-data/sources.ts scripts/data/bsh3-ch-history.json scripts/backfill-bsh3-ch-history.ts`
>      to confirm squash-merge dropped nothing.
>    - Targeted prod config only (the new source row), **not** a full seed unless nothing else is pending.
>    - Trigger a scrape of the new source, then run the backfill loader, then spot-check
>      `https://www.hashtracks.xyz/kennels/basel-stadt-h3`: runs #386–#397 numbered, history back to Jan 1996 (Run #1, 1996-01-13).
>    - Comment the PR link on #2798 (closes via `Closes #2798`).

## Summary
- Type: **source-add** (existing kennel `bsh3-ch`, existing Meetup source; add the kennel's own hareline site as a numbered-run source)
- Adapter: `HTML_SCRAPER` — **NEW small bespoke adapter, ~90–130 LoC + tests** (NOT config-only: rows are `<li><a>` lines
  `Run #N: DD/MM/YYYY venue (hares)`, and time/coords/description live on a per-run detail page). Plus a ~60 LoC dumb backfill loader.
- Effort estimate: small scraper + frozen-dataset backfill (~376 rows). No `region.ts` change.
- One-line: the kennel's own site is the canonical, numbered, 30-year archive. The Meetup source has no run numbers on socials and starts at #377 (Apr 2025).

## Dedup result
- Kennel in seed: **yes** @ `kennels.ts:1638` (`bsh3-ch`, shortName "Basel-Stadt H3", logo/foundedYear/hashCash/scheduleRules already present)
- Source in seed: Meetup only @ `sources.ts:5090`; **no source for `basel.harrier.eu.org`** (`grep -rn 'basel.harrier'` hits only the kennel `website` and a profile migration)
- Live site: prod `https://www.hashtracks.xyz/kennels/basel-stadt-h3` renders (fetched 2026-11-18); its past list is Meetup-sourced, newest `BSH3 #396 Hash in Münchenstein`, oldest in the listing ≈ #377 "Basel Hash #377 - Bad Säckingen Station". No `bsh3`-tagged admin-seeded rows seen.
- Already handed off? `handoffs/2026-09-07-bsh3-ch.md` is the original kennel+Meetup onboard (shipped as PR #2729). No hareline/history handoff, no `scripts/*bsh3*`, no open PR. This is the first one.
- Decision: **source-add + history backfill**
- kennelCode: `bsh3-ch` (existing; no new code or aliases)

## Live source verification  ✅
- Source: `HTML_SCRAPER` — `https://basel.harrier.eu.org/hareline.php`. DNS `status: NOERROR`; `curl -A 'Mozilla/5.0'` → HTTP 200, `text/html; charset=UTF-8`, 43,598 bytes, static server-rendered PHP (no JS needed). A browser-style User-Agent was sent on every request; whether it is required was not tested.
- Events seen: **396 list rows, contiguous Run #1 → #396**, dates **1996-01-13 → 2026-11-15** (verbatim, parsed with the regex in Adapter notes). Per-year counts 10–16 (monthly cadence).
- Detail pages: fetched **all 396** `runs.php?run=N` (2 transient failures, #229 and #324: HTTP/2 framing error / connection reset, both fine on retry with `--http1.1` → the adapter and loader need a retry). **Detail date == list date for 396/396.**
- **Source-count parity:** the page IS the full list; list rows M = 396 = runs 1…396, ratio 100%. N/A to platform UI.
- Sample events (verbatim from the page, not constructed):
  1. #396 — 15/11/2026 — "Münchenstein Train Station" — hares "Chunder Woman/Against Nature" — detail: Sunday, November 15th 2026, **14:00**, "Meeting Point: Münchenstein Train Station at 2pm / A to A run / Bag car will be provided / OnIn at a restaurant near by"
  2. #395 — 11/10/2026 — "Olten SBB" — "LOskar/QuickMount" — 14:00 — detail has "Meeting Point: SBB Olten Sector C (opposite side of Migrolino, next to the fontain)"
  3. #394 — 13/09/2026 — "Rodersdorf Tram. Dammstrasse · Rodersdorf" — "Just Walk Away/Chunder Woman"
  4. #354 — 09/07/2023 — "Aesch" — "LOskar" — 15:00 — **has coordinates** `var lat = 47.467710; var lng = 7.602961;`
  5. #1 — 13/01/1996 — "Chrischona" — "Mad Max/Mealticket" — 14:00 — "No run details available."
- **⚠️ Next-run placeholder (important):** the list's newest row is #396 (**3 days past as of 2026-11-18**). The next run **#397 exists only on its detail page and RSS**, not in `hareline.php`:
  - RSS `https://basel.harrier.eu.org/rss.php` (HTTP 200, `lastBuildDate` 2026-11-18): `<title>Run #397: December 13th 2026</title>`, `<link>http://basel.harrier.eu.org/?src=rss&amp;run=397</link>`, one `<item>` only.
  - `runs.php?run=397`: Date "Sunday, December 13th 2026", Time "15:00", Place **"TBD"**, Hare **"Who knows... maybe you?"**, Details "No run details available." (page shows `[Add]` / `[Add next run]` controls, i.e. an auto-created placeholder).
  - So the audit issue's premise ("upcoming #396 missing") is stale: #396 has now run; the live "upcoming" is the #397 placeholder. Hareline rows appear only once a venue/hare is posted. Recommended: parse the hareline for #≤396 AND probe the RSS item for any run number > max list row; emit it with `location` and `hares` **undefined** (placeholder strings `TBD` and `Who knows... maybe you?` must be dropped, not leaked). 2nd-Sunday Dec 13 matches the kennel's `scheduleRules`.
- History depth / pagination: **single page, no pagination**; all 396 runs in one `<ul>` (nested under two section headings `<li><b>12th Swiss Nash Hash</b>` and `<li><b>Basel-Stadt H3 Virgin Lay</b>`: skip `<li>` with `<b>` and no `<a>`). Source archive reaches **Run #1, 1996-01-13**, the kennel's founding run.
- Coord sanity: `var lat/var lng` present on **227 of 396** detail pages (runs #51 → #390; sparse recently: only #354, #364, #365, #371, #390 in 2023–2026). All 227 within ~1.2° of Basel; no duplicate default pin (most repeated pair appears 9×, a real recurring venue). "Coordinates: Unknown" on the rest. Adapter should only set lat/lng when `var lat/lng` exist and `Unknown` is absent; no `dropCachedCoords` needed.
- End times: none in source (single `Time:` field).
- Notes: PHP site, `Set-Cookie: PHPSESSID` (ignorable), HTTP/2 occasionally resets (retry with `--http1.1` or `safeFetch` retry). Detail pages obfuscate hare emails as `write_mail("madmax", "", "Mad Max")` JS; the visible hare name follows, so parse the text after the script call. See `source-platform-notes.md` → "harrier.eu.org / PHP hash-kennel sites" (added today).
- **Field-fill assertion table** (list = `hareline.php` row; detail = `runs.php?run=N`; n = 396 unless noted; counts from the 396 fetched pages):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 396 | No themed title in the list. Leave `undefined`; merge synthesizes "Basel-Stadt H3 Trail #N" (shortName > 4 chars, `friendlyKennelName` short-circuits). Do NOT use hares as title |
  | `runNumber` | 396 / 396 | list `Run #N` (also `title="Run #N"` attr and `href` `?run=N`) |
  | `startTime` | 396 / 396 (detail) | `Time: HH:MM` on the detail page: 264 × 14:00, 60 × 15:00, 16 × 14:30 + others (some 19:00, 11:00). Not on the list, so detail fetch needed |
  | `endTime` | 0 / 396 | not in source |
  | `location` (venue) | 384 / 396 list (12 are `TBD`) | list text between date and the trailing `(hares)`; drop literal `TBD` |
  | `locationStreet` | partial | some places are addresses (e.g. "2 Rue Annexe Tannwald, 68220 Leymen, France"); keep verbatim in `location`, don't split |
  | `locationUrl` | 0 / 396 | none |
  | `hares` | ~384 / 396 | list parenthetical (`A/B`, `TBD` = none); detail `Hare(s):` gives `A and B`. Prefer detail where fetched. Drop `TBD` and `Who knows... maybe you?` |
  | `cost` | 0 / 396 | none on page. Kennel default CHF 5 already seeded |
  | `description` | 343 / 396 detail (53 say "No run details available.") | detail `Details:` block, collapse whitespace, **scrub phone numbers/emails** |
  | `trailLengthText` | 0 / 396 | not in source |
  | `coords` | 227 / 396 detail | `var lat/var lng`; see Coord sanity |

## Kennel metadata (deep-dive complete — all already seeded; nothing to add)
- fullName "Basel-Stadt Hash House Harriers" / shortName "Basel-Stadt H3" / Basel, Switzerland (`kennels.ts:1638`)
- aliases already in `aliases.ts:456`; website `https://basel.harrier.eu.org/` (source: page above, HTTP 200)
- foundedYear 1996 — corroborated today: Run #1 is dated **13/01/1996 at Chrischona** (source: `runs.php?run=1`, "Saturday, January 13th 1996", hares Mad Max and Mealticket), matching seed.
- schedule: seed says 2nd Sunday, 14:00 (`scheduleRules`). Source cadence 2026: Jan 11 Sun, Feb 14 **Sat**, Mar 15 Sun (3rd), Apr 12 Sun, May 10 Sun, Jun 13 **Sat**, Jul 12 Sun, Aug 8 **Sat**, Sep 13 Sun, Oct 11 Sun, Nov 15 Sun (3rd), #397 Dec 13 Sun. Mostly the 2nd weekend; no change proposed, flagged so a rule-drift report isn't a surprise.
- logo already self-hosted `/kennel-logos/bsh3-ch.gif`; hashCash CHF 5; contact/mailing list already set.
- Sibling sweep: the site (`harrier.eu.org`) is a hosting family (`www.harrier.eu.org/style/bsh3.css`). Basel has no other kennel on this domain in the data seen. (c) Queue as future lead: other `*.harrier.eu.org` kennel sites (unverified; not probed).

## Historical backfill
- Available: **376 runs (#1–#376, 1996-01-13 → 2025-03-08)** are NOT on HashTracks (prod's Meetup rows start ≈ #377). Fields per run from the detail pages: date, time (396/396), place (list/detail), hares, description text (343 pages), coords (227 pages).
- Plan: **one-shot frozen dataset + dumb loader**, bound to the new hareline source (the scraped source for these rows). Past → backfill, future → adapter `upcomingOnly: true`.
  - Extract once with a throwaway script (not committed): list page + 396 detail GETs, ≥300 ms apart, retry on HTTP/2 framing errors or resets (#229 and #324 needed it).
  - Commit only `scripts/data/bsh3-ch-history.json` + `scripts/backfill-bsh3-ch-history.ts`; route through the merge pipeline (don't write `Event` rows directly).
  - Include rows #1–#376 only. #377+ are Meetup-covered (the merge fills null runNumber etc.; the adapter's recent window picks those up going forward).
  - **Frozen-dataset validation checklist:**
    1. PII: **32 detail pages mention a phone number/WhatsApp and 30 contain `@`**: scrub emails/phones from `description` (grep `@` and digit-group patterns); the `write_mail(...)` hare obfuscation must not leak into `hares`.
    2. Run-number continuity: list is contiguous 1–396 (verified). Date gaps: only #250→#251 (2015-02-22 → 2015-05-10, 77 d) and #313→#314 (2020-03-07 → 2020-06-14, COVID); nothing > 75 d otherwise, nothing out of order.
    3. Gap sanity: detail date == list date for all 396, so no misparse. Weekday mix Sat 206 / Sun 161 / Fri 10 / Thu 6 / Wed 5 / Tue 4 / Mon 4 (the weekday ones are special events, e.g. Boxing Day, Swiss Nash Hash weekend rows #279–#281 on 15–17 Sep 2017).
    4. Monotonic: yes.
    5. Field bleed: `hares` contain `/` inside one name (`Out of Africa / Mausi`) on the list: **do not blindly split on `/`**. Use the detail `Hare(s):` text (`A and B`) where possible; in the list the separator between hares is `/` and a single hare can itself contain ` / ` with spaces. Split on a `/` with no surrounding spaces, or just prefer detail text.
    6. Multi-day: #279–#281 (15–17/09/2017, three consecutive days, the 12th Swiss Nash Hash) are separate numbered rows; keep as three events. No series parent needed.
    7. 12 placeholder rows with `TBD` venue or hare (e.g. #340, #338, #299, #289, #281, #280, #279, #276, #264, #262, #248, #215): emit with that field undefined.

## Ready-to-paste seed

```ts
// kennels.ts — NO CHANGE (existing bsh3-ch row stays as is)
// aliases.ts — NO CHANGE (existing "bsh3-ch" key, aliases.ts:456)

// sources.ts — Source[]  (add next to the existing "Basel-Stadt H3 Meetup" row, ~line 5104)
{
  name: "Basel-Stadt H3 Hareline",
  url: "https://basel.harrier.eu.org/hareline.php",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,           // kennel's own canonical site; Meetup (7) keeps title/venue precedence, this fills run numbers/times
  scrapeFreq: "daily",
  scrapeDays: 365,         // forward + recent window only; history is the one-shot backfill
  config: {
    // Past rows age out of the adapter's window; reconcile must not cancel them or the backfilled history.
    upcomingOnly: true,
    kennelTag: "bsh3-ch",
  },
  kennelCodes: ["bsh3-ch"],
},
```

## Adapter notes / new-scraper plan
- File: `src/adapters/html-scraper/basel-hash.ts` (+ `.test.ts`); registry entry `onHost("basel.harrier.eu.org")` → `BaselHashAdapter`. Mirror `warwick-hash.ts` / `tamar-valley-h3.ts` (small single-kennel list-page scrapers); use `fetchHTMLPage` / `safeFetch` (never raw `fetch`).
- Fetch `hareline.php`; Cheerio over `ul li a[title^="Run #"]`; skip `li` that hold only `<b>` section headings.
- Row regex, split into two simple ones (Sonar S5852/S5843): `^Run #(\d+): (\d{2})/(\d{2})/(\d{4})\s*(.*)$` on the anchor text, then pull the trailing `(...)` hares group procedurally (last `(` … `)`; venues can contain parentheses, e.g. "Restaurant Alte Post (Basel) (LOskar)" and "Fribourg (CH) (TBD)", so take the **last** paren group). Date is **DD/MM/YYYY**, store UTC noon.
- Window: honor `options.days` through `buildDateWindow(options?.days ?? 365)`. Emit rows inside the window (≈ last 90 days + all future) and fetch `runs.php?run=N` only for those (≤ ~15 GETs/scrape): `startTime` from `Time:`, coords from `var lat/var lng` (when `Unknown` absent), description from the `Details:` block (scrub phone/email; drop "No run details available."), hares from `Hare(s):` (strip the `write_mail("x","","Name")` call, keep the plain name).
- **Next-run probe:** also read `rss.php` (`<title>Run #N: <Month> <D>th <YYYY></title>`); if `N` > max list row and the date is in the future, fetch `runs.php?run=N` and emit it. Drop `Place: TBD` and the hare placeholder `Who knows... maybe you?` (leave `location`/`hares` undefined). If the RSS fetch fails, add nothing and do **not** push an error that suppresses reconcile of list events (the RSS item is a bonus, not required).
- Retry detail/list fetches once on HTTP/2 framing/reset errors (observed on #229 and #324).
- Fail-loud guard: `if (rows.length === 0) errors.push("…")` — single-page adapter, so a markup drift would otherwise "succeed" with zero events and never alert. Also error if the list returns HTTP 200 but fewer than, say, 300 rows (the whole 396-row archive is always present, so a collapse is a drift).
- Set `kennelTags: ["bsh3-ch"]`, leave `title` undefined (merge synthesizes "Basel-Stadt H3 Trail #N"), no `cost`, no `endTime`.
- Fixtures: capture real markup verbatim from `curl -s https://basel.harrier.eu.org/hareline.php` (e.g. the #396, #395, #385 "Restaurant Alte Post (Basel) (LOskar)", #340 "TBD (TBD)", #3 and the nested `<b>Basel-Stadt H3 Virgin Lay</b>` rows) and one detail page with `var lat/var lng` (#354) and one without (#396).
- Merge note: Meetup (trust 7) rows already exist for #386–#396 with titles like "BSH3 #396 Hash in Münchenstein"; same kennel+date should dedupe. This source fills null `runNumber` on the two unnumbered Meetup events the audit named (**#388 = 15/03/2026**, **#395 = 11/10/2026**). Verify at build that the merge actually enriches (lower-trust field fill) rather than creating a twin.

**⚠️ Claude Code: verify before writing real code.** Any snippet/regex here is illustrative; the authority is the repo. Confirm against current types:
- `RawEventData` — `kennelTags: string[]` (not `kennelTag`), `startTime` "HH:MM", lat/lng field names, `dropCachedCoords`.
- `safeFetch` from `@/adapters/safe-fetch`, helpers in `@/adapters/utils` (`fetchHTMLPage`, `buildDateWindow`), `ScrapeResult.pagination.kennelPagesStopReason` only on genuine truncation.
- Whether `buildDateWindow` handles a window starting in the past AND future for `upcomingOnly` sources the way `warwick-hash.ts` does.

## Deep-dive checklist (nothing deferred)
- [x] logo (already self-hosted)  [x] foundedYear (Run #1 = 1996-01-13)  [x] socials n/a (none on site)  [x] schedule (no change)  [x] hashCash (seed CHF 5)
- [x] description (seeded)  [x] source live-verified (HTTP 200, 396 rows, 396 detail pages)  [x] history depth assessed (#1–#376 backfill)
- [x] coord sanity checked  [x] end times none  [x] kennelCode collision n/a (existing)  [x] kennelCodes (source guard) set

## Implementation gotchas (repo knowledge)
- `config.upcomingOnly: true` is required: the adapter only returns a recent window, so without it `reconcile.ts` would cancel aged-out rows and the backfilled history.
- Single-page adapter needs the `rows.length === 0` fail-loud guard (above).
- Sonar S3776 ≤ 15: extract `parseRow`, `parseDetail`, `parseRssNextRun`, `splitHares`. S5852: two simple regexes, procedural last-paren extraction.
- `Number.parseInt(s, 10)`, `replaceAll`, no negated ternaries.
- Backfill must route through the merge pipeline bound to the NEW hareline source (the source the rows came from), not an ad-hoc source.
- http/https: site and links are https; RSS `<link>` values are `http://` (don't copy them as `locationUrl`/`sourceUrl`).

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief — no separate prompt needed._
