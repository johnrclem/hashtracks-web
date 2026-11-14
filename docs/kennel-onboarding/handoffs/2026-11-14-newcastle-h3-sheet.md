# Onboarding Handoff — Newcastle H3 hareline Sheet (source-add + archive backfill) — 2026-11-14

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> Closes #2591 (`onboarding-candidate`). Put `Closes #2591` in the PR body.
> 1. Branch off a clean `main`: `onboard/newcastle-h3-sheet-20261114`.
> 2. **Source-add only. Do NOT re-create the kennel.** Add the **Source row** below to
>    `prisma/seed-data/sources.ts`, next to the existing "Newcastle H3 Harrier Central" row (~line 8366).
>    No new kennel, alias or region. No adapter code (config-only; the live probe below passed).
> 3. Build the **archive backfill**: a frozen `scripts/data/newcastle-h3-sheet-history.json` plus a dumb
>    loader `scripts/backfill-newcastle-h3-sheet-history.ts`, **routed through the merge pipeline**
>    and bound to the NEW sheet source (not the HC source). Mirror `scripts/backfill-newcastle-h3-history.ts`
>    and the Zagreb H4 / IndyScent loaders. Don't commit the throwaway parser.
> 4. Live-verify `GoogleSheetsAdapter.fetch(source, { days: source.scrapeDays })` (no DB write) per
>    `.claude/rules/live-verification.md`. Already done at research time (see below); re-confirm.
>    **DO NOT run `npx prisma db seed` in the PR.**
> 5. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 6. PR body: metadata, verification, field-fill table. Follow `docs/source-onboarding-playbook.md`.
> 7. **Post-merge:** verify every file landed on `main` (`git log -1 -- <path>`); targeted prod config
>    push (not a full seed: `feedback_post_merge_config_to_prod_targeted`); run the backfill dry-run then
>    live; trigger one scrape; spot-check `hashtracks.xyz/kennels/newcastle-h3`.
>    Comment the PR link on #2591 and close it.

## Summary
- Type: **source-add** (existing kennel `newcastle-h3`) + historical archive backfill.
- Adapter: `GOOGLE_SHEETS`, **config-only** (adapter exists; `dayFirst` shipped in #2778; the exact config below was run live).
- Effort estimate: config-only source row + ~120-line frozen-dataset loader + one-off JSON curation (~670 rows).
- One-line: the kennel's own public hareline sheet adds real run numbers, venue, street + postcode, hares and notes for the live 2026 season, and a ten-year archive (2014–2025) HashTracks has never loaded. HC (`getEvents` via hashruns.org) only supplies placeholder-ish rows from 2024-09.

## Dedup result
- Kennel in seed: **yes** @ `prisma/seed-data/kennels.ts:1359` (`newcastle-h3`, shortName "Newcastle H3", est. 1994, hashCash £2.50, logo `/kennel-logos/newcastle-h3.png`).
- Source in seed: HC row `sources.ts:8366` ("Newcastle H3 Harrier Central", `upcomingOnly: true`). **No sheet source.** `grep -in "1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4" prisma/seed-data/sources.ts` → no hit.
- Live sitemap dedup: `curl https://www.hashtracks.xyz/sitemap.xml` → `/kennels/newcastle-h3` is live (166 events in the page's RSC payload, 2024-09-01 → 2027-04-28, last `lastEventDate` 2027-04-28). `nh3-gb` is not a live slug.
- Prior handoffs / PRs: no `*newcastle-h3*` handoff (`2026-08-21-newch3.md` is N.E.W. Cotswold, a different kennel). PR #2734 (HC global-runs fallback) and `scripts/backfill-newcastle-h3-history.ts` (107 rows, 2024-09-01 → 2026-07-01) are the only earlier Newcastle work. Open `onboarding-handoff` PRs: none.
- Decision: **source-add + backfill**. kennelCode `newcastle-h3` (no collision work; kennel exists).

## Live source verification  ✅
- Source: `GOOGLE_SHEETS` — spreadsheet `1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4`. The kennel site `nhhh.co.uk` → "The Hareline" → `hareline.nhhh.co.uk`, which answers `HTTP/2 302` with `location: https://docs.google.com/spreadsheets/d/1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4/edit#gid=1330518329` (curl, 2026-11-14). Public view; CSV export HTTP 200.
- **Adapter run (read-only, no DB):** `GoogleSheetsAdapter().fetch(source, { days: 365 })` with the config below (tabs 2026 + 2027, throwaway `GOOGLE_CALENDAR_API_KEY` value because `tabs` mode uses the keyless gviz URL) returned **122 events, 0 errors**, 2026-01-04 → 2027-11-10. The 2026 tab alone is 66 rows (#1926–#1991, 2026-01-04 → 2026-12-30).
- Tabs (14, from the sheet's own `sheet-menu` JSON): `The Hareline - 2027` (gid 1140163987), `The Hareline - 2026` (1264089184), `The Hareline - 2025` (946946259), ` The Hareline - 2024` (1916943852, **leading space in the name**), `The Hareline - 2023` (1164554213), `2022-Archive` (346169899), `2020 Archive` (631035557), `2021 Archive` (1330518329), `2019-Archive` (577407685), `2018-Archive` (992245080), `2017-Archive` (2051624385), `2016-Archive` (1830011969), `2015 - Archive` (1984186292), `2014 Archive` (1250905851).
- **Why `tabs` (explicit names), not auto-discovery:** auto-discovery keeps only year-PREFIXED tab names; these start with "The Hareline" / are mixed. gviz CSV (`/gviz/tq?tqx=out:csv&sheet=<name>`) also collapses the blank rows above the header, so **`skipRows` stays 0** (the export-CSV route has three blank rows first; the gviz one does not). Verbatim gviz first rows:
  ```
  "The 2026 Hareline ","Day","Date","Date","Venue","Location","Postcode","Hare(s)","Any Other Information","Beer Stop",...
  "1926","Sunday","04/01/2026","05/01/2026","The Cartologist (formerly Garden House)","Framwellgate Peth, Durham","DH1 4NQ","Wild Rover","Very good lunch allegedly plus cask ale !",""
  ```
  The second `Date` column (index 3) is a stale template value (one day off on the 2026 tab; on the 2027 tab it still holds 2026 dates). **Do not map it.**
- **Source-count parity:** the UI shows no event counter; the sheet is the source. 2026 tab 66 rows → 66 parsed run-numbered rows. Parity 100% for 2026. HC prod holds 166 Newcastle events for 2024-09 → 2027-04, so overlap by date is large and the fingerprint (kennel + date) should merge; enrichment details in "Merge behaviour".
- Sample events (VERBATIM from the 2026 tab CSV; run numbers are real, titles are absent):
  1. 2026-01-04 — #1926 — hare `Wild Rover` — `The Cartologist (formerly Garden House)`, `Framwellgate Peth, Durham`, `DH1 4NQ` — note `Very good lunch allegedly plus cask ale !` — Sunday
  2. 2026-01-07 — #1927 — `Octopushy, Just Ana & SSTB` — `The Library`, `17 South Parade, Whitley Bay`, `NE26 2RE` — `OP birthday`
  3. 2026-01-28 — #1930 — `Counterfit` — `Newcastle Cricket Club (Burns Supper)`, `Osbourne Ave, Jesmond`, `NE2 1JS`
  4. 2026-11-18 — #1983 — `InnContinence & H3O` — `The Coachmans` (prod today shows the same run as "Hash 1983" with hares "H3O, Inncontinence", location "Coachman, Burnthouse Lane, Newcastle" — same run number, so the sheet and HC agree)
  5. 2026-12-05 — #1986 — `Regresa (long r*n); InnConts (short r*n); C'fit walk` — `Wooler Hostel`; 2026-12-06 — #1987 — `#Sab & Misled`. **Prod currently carries both dates as HC placeholders: title "Newcastle H3 Trail", null run number, null hares, null location.** The sheet fills them.
- Cadence: Wednesday 19:00 weekly plus **a first-Sunday-of-the-month run** (2026 Sundays: 01-04, 02-01, 03-01, 04-12 [Easter replacement, note says so], 05-03, 06-07, 07-05, 08-02, 09-06, 10-04, 11-01, 12-06). The kennel seed carries only the Wednesday rule — see follow-ups.
- History depth / pagination: single request per tab, no pagination. Archive: 11 tabs, 2014 → 2025, **~669 numbered rows** (see Historical backfill).
- Coord sanity: no coordinates in the sheet (the `Map` links are free text in `Notes`; the adapter builds `locationUrl` as a Google Maps search from venue + street). N/A.
- End times: none in the source.
- Notes: **No start-time column.** Use `startTimeRules`: Wed → 19:00 (kennel seed `scheduleTime "7:00 PM"`; HC prod rows are also 19:00), Sun → 11:30 (archive notes say it outright: `Sunday hash 11:30am start`, `Sunday Hash 11:30am start.`; 2026 Sunday rows have no explicit time → treat as inferred, see "Claude Code must confirm").
- **Field-fill assertion table** (adapter run above, 122 rows = 2026 + 2027 tabs; the 2027 tab is mostly an unfilled template, so these ratios understate the 2026 tab):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 122 | No title column. Leave undefined; `merge.ts` keeps the HC title ("Hash 1983") where one exists and otherwise synthesizes "Newcastle H3 Trail #N". Do **not** set `runHareTitle`/`defaultTitle` (would fight HC titles). |
  | `startTime` | 122 / 122 | From `startTimeRules` (Wed 19:00, Sun 11:30). Inferred, not sourced. |
  | `endTime` | 0 / 122 | Not in feed. |
  | `location` (venue) | 63 / 122 | `Venue` col 4. 2027 rows mostly blank. |
  | `locationStreet` | 66 / 122 | `Location` col 5 (street/area). |
  | `locationUrl` | 63 / 122 | Adapter-built Maps search from venue + street. |
  | `hares` | 70 / 122 | `Hare(s)` col 7, free text (e.g. `Omm/Pimp`, `BM, Floppy, GH, Misled, 5K, BNM, Mindphuk`). |
  | `cost` | 0 / 122 | Not in feed (kennel default £2.50). |
  | `description` | 46 / 122 | `Any Other Information` col 8 (themes, birthday runs, "NUFC Home Game 7.30.Substitute Beer Truck"). |
  | `trailLengthText` | 0 / 122 | Not in feed. |
  | `coords` | 0 / 122 | Not in feed. |
  | `postcode` | n/a | Present in col 6 but `RawEventData` has no postcode field; the adapter ignores it. Optional: map `address` to col 5 only (as run). |

## Merge behaviour to expect (read before enabling)
- Sheet trust **7** < HC **8**, so on overlapping dates HC wins conflicts and the sheet **fills NULLs field-by-field** (`reference_merge_fieldfill_trust_gated`). HC rows already have run numbers for most dates, so the visible gains are: venue/street/hares/description on the **HC placeholder rows** (e.g. 2026-12-05/06), real run numbers where HC has `null`, and Notes text.
- A HC title like "Hash 1983" stays. That's fine.
- `upcomingOnly: true` keeps `reconcile.ts` from cancelling anything: the sheet has no rows older than the 2026 tab, and HC is the cancellation authority.
- `kennelCodes: ["newcastle-h3"]` satisfies the source-kennel guard. **Single-kennel sheet** (no `Group` column; all rows are Newcastle). Siblings: none in this sheet.

## Kennel metadata (deep-dive complete — nothing to change)
- Existing seed row already carries: fullName "Newcastle Hash House Harriers", website `https://www.nhhh.co.uk`, Facebook `https://www.facebook.com/NewcastleH3`, foundedYear 1994 (`nhhh.co.uk`: "every week since 1994"), hashCash £2.50, logo `/kennel-logos/newcastle-h3.png`, lat/lng. Not re-verified by this run; out of scope for a source-add.
- **Aliases:** none to add.
- **Schedule gap (follow-up, not part of this PR):** seed has `scheduleDayOfWeek: "Wednesday"` only. The sheet shows a first-Sunday-of-the-month 11:30 run. Suggested `scheduleRules` (UNVERIFIED beyond the 2026 Sunday list above — confirm against 2025 tab Sundays before adding): `{ rrule: "FREQ=WEEKLY;BYDAY=WE", startTime: "19:00", label: "Weekly" }`, `{ rrule: "FREQ=MONTHLY;BYDAY=1SU", startTime: "11:30", label: "First Sunday" }`.

## Historical backfill  (worth it: yes)
- Available: **~669 numbered rows** across 11 archive/season tabs, 2014-01 → 2025-12. Fields: run number, date, day, hare(s) (1–2 columns in 2015–2020 tabs), venue, address, postcode, notes. No times.
- Plan: frozen `scripts/data/newcastle-h3-sheet-history.json` + dumb loader; binds to the new sheet source; **routed through the merge pipeline** (`reference_backfill_must_route_through_merge_pipeline`); strict date partition: loader `< <first date of the 2026 tab>` (2026-01-04), adapter handles 2026+. Overlap with the existing HC backfill (2024-09 → 2026-07) is expected and wanted: sheet rows add run numbers/venues/notes onto the same fingerprints. Dry-run first.
- **Per-tab layout (needed for the throwaway extraction; columns 0-indexed on the raw export CSV — header row position differs, find it by `Run No.`/`Run Number`):**

  | Tab (gid) | Year | Date format | Columns |
  |---|---|---|---|
  | 2014 Archive (1250905851) | 2014 *(year is not in any cell; inferred — see below)* | `1st January` / `5th January` (day + month name, no year, no weekday col) | run0, date1, hare2, venue3, address4, postcode5 |
  | 2015 - Archive (1984186292) | 2015 | `12/27/15` **M/D/YY** | run0, date1, day2, hare3, venue4, address5, postcode6, notes7 |
  | 2016–2020 Archive (1830011969, 2051624385, 992245080, 577407685, 631035557) | 2016–2020 | **M/D/YY** (`12/21/16`, `01/04/17`, `03/03/18`, `01/02/19`, `01/05/20`) | run0, date1, day2, hare1=3, hare2=4, venue5, address6, postcode7, notes8 |
  | 2021 Archive (1330518329) | 2021 | **D/M/YYYY** (`23/6/2021`) | run0, day1, date2, venue3, address4, postcode5, hare6, notes7 (header on row 4) |
  | 2022-Archive (346169899) | 2022 | D/M/YYYY (`5/1/2022`) | same as 2021 |
  | The Hareline - 2023 (1164554213), 2024 (1916943852) | 2023, 2024 | D/M/YYYY | run0, day1, date2, venue3, *(blank col 4)*, address5, postcode6, hare7, notes8, beerstop9 |
  | The Hareline - 2025 (946946259) | 2025 | D/M/YYYY | run0, day1, date2, venue3, address4, postcode5, hare6, notes7, beerstop8 |

  The US-style M/D/YY archive tabs are why a single `dayFirst` config can't read the archive: **the live adapter source must never be pointed at those tabs.** Fixed by the frozen-dataset route.
- **2014 year inference (evidence):** the date cells carry no year. Run #1183 is "1st January", #1184 "5th January" (a Sunday-hash date). Every dated row (65 of 70) lands on a Wednesday or Sunday in 2014, the kennel's two run days, and 1 Jan 2014 is a Wednesday. Run numbers continue to #1252 (31st Dec) and then jump to #1318 (27 Dec 2015) — ~65 runs of 2015 (#1253–#1317) **do not exist in the sheet** (the 2015 tab has only #1318, #1319). That gap is unrecoverable from this source; say so in the PR.
- Source cleanup list (found by cross-checking each row's own `Day` cell against its parsed date; **fix in the frozen JSON, don't guess silently**):
  - `#1328` in the 2016 tab: `02/17/15` says Wednesday → Tuesday in 2015; `2016-02-17` is a Wednesday → year typo, use **2016-02-17**.
  - `#1640` in the 2021 tab: `20/10/2023` says Wednesday, 2023-10-20 is a Friday; 2021-10-20 is a Wednesday and #1639/#1641 sit in Oct 2021 → **2021-10-20**.
  - `#1628` in the 2021 tab: `11/32023` (unparseable). Neighbours: #1627 = 4/8/2021, #1629 = 18/8/2021, so **2021-08-11** (a Wednesday). Confirm Day cell.
  - `#1443` `10/17/17` says Wednesday (is Tuesday) → likely 2017-10-18. `#1469` `03/03/18` says Sunday (is Saturday) → 2018-03-04. `#1474` `04/03/18` says Wednesday (is Tuesday) → 2018-04-04. `#1590` `12/06/19` says Saturday (is Friday) → 2019-12-07. `#1714` `9/12/2022` says Saturday (is Friday) and `#1715` `10/12/2022` says Sunday (is Saturday) → 2022-12-10 / 2022-12-11. These are single-day slips; **apply the fix only when the rest of the sequence confirms it** (the continuity check below).
  - `#1779` / `#1780` (2023, 23–26 Nov weekend): the Day cell reads `Saturday - PCDP` / `Sunday - PCDP`; the date is right, the cell is just annotated. Keep as is.
  - 2014: `#1200` (date cell reads `Sunday`) and `#1251` (reads `Saturday`) have **no date** → drop and list in the PR. `#1225`/`#1226` (22–23 Aug, Fri/Sat) and `#1246` (6 Dec, Sat) are weekend events, not typos.
  - 2020 tab ends `#1609 03/18/20 Cancelled — "NO official hashes planned for the forseeable future."` Drop it (a cancelled row, not a run). Run numbers #1610–#1618 are absent: the COVID pause; the next row is #1619 (23/6/2021). Not a gap to fill.
- **Frozen-dataset validation checklist (run before shipping):** 1. PII scrub — `Notes` carry a few URLs (`thekingsarms-ne.co.uk`, goo.gl maps) but I saw no emails or phones; grep for `@` and digit runs of 10+ anyway. 2. Run-number sequence continuity — consecutive numbered runs are 3–4 days apart on a Wed+Sun cadence; flag `(gap-days/step) < 2` or `> 14`. 3. Gap sanity — date year must equal the tab's year (this caught #1328 and #1640). 4. Monotonicity — run numbers must not decrease; 5 non-monotone dates in my check were the typos above. 5. Field bleed — hare cells with `:` or `Map` are suspect (2023/2024 notes columns contain `Map`, `Map New Micro Pub …` text — keep in `description`, not `hares`).
- Hare column handling for 2015–2020: join `hare1` + `hare2` as `"A, B"`, sorted deterministically (nondeterministic order re-fingerprints).
- **Existing-data note:** the earlier HC history JSON (`scripts/data/newcastle-h3-history.json`, 107 rows 2024-09-01 → 2026-07-01) has one row with `runNumber: 1` (the 2024-09-01 row, title "Hash 1835"). The sheet's 2024 tab has 2024-09-01 as the real run. After the sheet backfill, check that row's run number and correct it if the merge didn't (the lower-trust sheet can only fill NULLs, so a wrong non-null `1` will survive — fix with a one-line guarded update or the backfill's explicit-null path).

## Ready-to-paste seed

```ts
// sources.ts — add next to the "Newcastle H3 Harrier Central" row (~line 8366). Source[] element.
{
  name: "Newcastle H3 Hareline Sheet",
  url: "https://docs.google.com/spreadsheets/d/1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4/edit", // hareline.nhhh.co.uk redirects here
  type: "GOOGLE_SHEETS" as const,
  trustLevel: 7, // below HC (8): the sheet enriches NULLs, HC keeps winning conflicts
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    sheetId: "1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4",
    // Tab names are not year-prefixed, so auto-discovery would find none → explicit names (gviz by name).
    // Add "The Hareline - 2027" when the kennel populates it (see Claude Code must confirm #3).
    tabs: ["The Hareline - 2026"],
    // gviz CSV drops the blank rows above the header → skipRows 0. Col 3 is a stale second "Date": unmapped.
    columns: { runNumber: 0, date: 2, location: 4, address: 5, hares: 7, description: 8 },
    dayFirst: true, // "04/01/2026" = 4 Jan (#2778)
    requireRunNumber: true,
    kennelTagRules: { default: "newcastle-h3" },
    // No time column. Weekly Wednesday evening; first-Sunday 11:30 (archive notes: "Sunday hash 11:30am start").
    startTimeRules: { byDayOfWeek: { Wed: "19:00", Sun: "11:30" }, default: "19:00" },
    upcomingOnly: true, // year tab; HC stays the cancellation authority
  },
  kennelCodes: ["newcastle-h3"],
},
```

Verified shape for the other seed files: **no `kennels.ts` or `aliases.ts` edit.**

## Adapter notes
**Config-only. Live-verified** with the config above (2026 + 2027 tabs → 122 events, 0 errors; sample rows printed identically to the CSV). Reference: Zagreb H4 (`sources.ts` ~9780) for `dayFirst` + `requireRunNumber`.

**⚠️ Claude Code: verify before writing real code.**
- Re-run the probe with `{ days: source.scrapeDays }` explicitly (the Sheets adapter defaults to 90 otherwise, `live-verification.md`).
- `GOOGLE_CALENDAR_API_KEY` must be present in the shell for `tabs` mode (the adapter's key gate runs before the gviz fetch even though gviz needs no key).
- Backfill loader: confirm the current merge-pipeline entry point and the `RawEventData` field names (`kennelTags: string[]`, `locationStreet`, `description`) in `src/adapters/types.ts`; `hares` sorted before join; emit explicit `null` rather than `undefined` for fields the sheet blanks only if the existing backfill precedent does.
- `startTime` for backfilled rows: do **not** invent. Sheet has no time. Either leave undefined (so HC's stored time survives) or apply the same Wed 19:00 / Sun 11:30 inference *only* where the row's own notes support Sun 11:30. Prefer undefined for pre-2024 rows.

**⚠️ Claude Code must confirm:**
1. **Sunday start time 11:30** for the 2026 first-Sunday runs. Archive notes (2018–2020) state it; no 2026 note does. HC rows for Sundays carry their own times: compare one before trusting the inferred value. If HC's Sunday time differs, change `startTimeRules`.
2. The 2027-tab behaviour: see #3.
3. **2027 tab left out of `tabs` on purpose.** It's a pre-filled template: 64 rows #1992–#2055 with the right weekday dates but mostly empty venue/hares (and a stale second `Date` column), so enabling it now would emit ~60 blank-numbered rows whose run numbers are guesses (the kennel can skip a week). HC already carries placeholders for 2027 (to 2027-04-28). Add `"The Hareline - 2027"` to `tabs` around mid-December once real venues appear (the config edit is one string; no code). If you'd rather add it now, the live probe above shows it works.
4. Whether `upcomingOnly` plus a non-HC source is enough to stop `reconcile.ts` from cancelling HC-only dates (e.g. 2026-09-25, 2026-12-04 exist on prod and not in the sheet). It should: reconcile only considers rows from the scraped source.

## Deep-dive checklist
- [x] logo / foundedYear / socials / hashCash — already in seed (not re-verified, source-add)  [x] schedule — Sunday rule gap flagged
- [x] source live-verified (adapter run, 122 events)  [x] history depth assessed (11 tabs, ~669 rows, 2014–2025)
- [x] coord sanity (none in source)  [x] end times (none)  [x] kennelCodes set  [x] no kennel/alias collisions (nothing new)

## Implementation gotchas
- gviz vs export CSV differ in blank-row handling: the live adapter uses gviz (`skipRows` 0); if you test with the export URL you'll need `skipRows: 3` and column 3 shifted — don't mix them.
- Tab name ` The Hareline - 2024` has a **leading space**; only matters for the archive extraction.
- Sonar S3776/S5852: the loader's date parsers (`M/D/YY`, `D/M/YYYY`, `1st January`) should be separate helpers using string splits, not one regex.
- Post-merge: targeted config to prod (`feedback_post_merge_config_to_prod_targeted`); watch for the concurrent-seed revert trap (`feedback_concurrent_seed_reverts_source_config`).
