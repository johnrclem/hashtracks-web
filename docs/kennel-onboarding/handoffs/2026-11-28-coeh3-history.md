# Onboarding Handoff — City of Exeter H3 pre-Oct-2020 history backfill (coeh3, Exeter, England) — 2026-11-28

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> Closes #2916. **History-backfill handoff for an already-live kennel** (`coeh3`, source "City of Exeter H3 Blogspot Recaps"). Do not touch the kennel row, aliases or source config. This is a one-shot, frozen-JSON + dumb-loader backfill routed through the merge pipeline. No adapter change.
> 1. Branch off clean `main`: `onboard/coeh3-history-<YYYYMMDD>`.
> 2. Build the frozen dataset `scripts/data/coeh3-history-pre2020.json` with a **throwaway** parser (do not commit the parser), following **Parse plan** below. Target about 380–430 events (see **Counts**).
> 3. Add the dumb loader `scripts/backfill-coeh3-history-pre2020.ts`, copied from `scripts/backfill-coeh3-history.ts` (same `runBackfillScript`, same `sourceName: "City of Exeter H3 Blogspot Recaps"`, `kennelTimezone: "Europe/London"`). Keep the existing 200-run file untouched.
> 4. Run the **Frozen-dataset validation checklist** below. Dry run first (`npx tsx scripts/backfill-coeh3-history-pre2020.ts`), apply only post-merge (`BACKFILL_APPLY=1`).
> 5. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 6. PR body must contain bare `Closes #2916`. **DO NOT run `npx prisma db seed`.**
> 7. Post-merge: verify the two new files landed on `main` (`git log -1 -- <path>`), then run the loader with `BACKFILL_APPLY=1`, then spot-check `https://www.hashtracks.xyz/kennels/coeh3` for the oldest event (2008-08-31) and the 2020-10-04 seam (#984 must not be duplicated).

## Summary
- Type: history backfill (existing live kennel `coeh3`; source row `City of Exeter H3 Blogspot Recaps`, `upcomingOnly: true` already set, so loaded rows are never reconciled away).
- Adapter: none. **Config-only / script-only: ~120–200 LoC loader + throwaway parser + a frozen JSON.** Effort: small, but the date and run-number rules below need care.
- One-line: HashTracks starts at #984 (2020-10-04); the blog holds ~450 distinct dated runs back to 2008-08-31 that carry no run numbers.

## Dedup result
- Kennel in seed: yes (`coeh3`). Source in seed: yes. Already handed off: `2026-11-19-coeh3-calendar.md` (Google Calendar source-add; **different task**, calendar reaches only 2019-09 → today).
- Already delivered backfill? `ls docs/kennel-onboarding/handoffs/*-coeh3-history*.md` → none. `scripts/data/coeh3-history.json` (200 runs, 2020-10-04 → 2026-10-25) is the *post*-cutoff set, and `gh pr list --state all --search "coeh3 backfill"` shows only #2737 (that 200-run set). So this pre-2020 set has not been delivered.
- Decision: history backfill. kennelCode: `coeh3` (no change).

## Live source verification ✅ (curl, 2026-11-28)
- Source: Blogger feed `https://cityofexeterhhh.blogspot.com/feeds/posts/default?alt=json&max-results=150&start-index=N` (domain DNS: `status: NOERROR`). Checked with curl, HTTP 200 JSON.
- **Source-count parity:** the feed reports `openSearch$totalResults = 1089`, but paging 1, 151, … 1051 reaches **987 entries**. Per-year windowed queries (`published-min/max`, 2008…2020) return the same per-year counts (26, 65, 53, 38, 36, 4, 59, 64, 60, 72, 94, 62, 109), so **987 is the real reachable set** (the other ~102 are not served by the public feed, probably drafts or hidden). Parity 987/1089 = 91%, and the gap is not recoverable by pagination.
- Pre-cutoff (published before 2020-10-04): **720 posts**, 2008-08-31 → 2020-09. Posts per publish year: 2008 26, 2009 65, 2010 53, 2011 38, 2012 36, **2013 4**, 2014 59, 2015 64, 2016 60, 2017 72, 2018 94, 2019 62, 2020 87 (pre-cutoff part). **2013 is nearly empty** (4 posts), and 2024 has none.
- Post structure: free-form recap prose (no labelled `Hare:`/`Where:` lines). The structured data is **only the title**. Titles are hand-typed, so shapes drift across years.

### Title shapes (sampled across all years; verbatim)
| Shape | Example (verbatim) | Years | Count (of 466 dated) |
|---|---|---|---|
| A `Date - Venue - Hares` | `31st August - Stowford Cross - Spocky Bitz` · `4th January - Four Firs, Woodbury Common - Tampa` · `1st February 2009 - Core Copse, East Hill Strips - Howling Wilf + Slipshod` | 2008–2012 | 139 |
| B `Venue - Hares - Date` | `Exminster - Stix Family - 4th Jan 2015` · `Haldon Belvedere - Twin Peaks and Blobhoblin - 6th January 2019` · `Obelisk, Mamhead - Hole-in-1- 7th January 2018` | 2015–2020 | 254 |
| C `Venue: Date` (no hares) | `Joney&#39;s Cross: 2nd February ` · `Westcombe, Alphington: 9th February` · `Forest Gate Car Park, Ashclyst Forest: 16th February ` | 2014 | ~18 |
| D one-off prose / date-only | `Sunday 8th February - Exeter Arena - Blobhoblin and TwinPeaks` · `Stoke Woods 17th March 2013` · `Blobington Manor 4th Feb` · `FW: Dawlish Countryside Park, 28 January 2018` | all | ~55 |
| Year-less | 176 of 466 dated titles have **no year** | all | 176 |
| Not a run (254 undated titles) | `Updated City of Exeter H3 hash diary`, `2019 Subs now due`, `HARES REQUIRED`, `Hash Coronacircle #7`, `Spam`, `Photos from the Autumn Gathering 2018`, `FW: 🐈🐩🐾 Devon Lunatics H3 First e-Newsletter 🐾🐩🐈` (70 KB body) | all | filter out |

HTML entities appear in titles (`&#39;`): decode. Distinct-date count after parsing: **450 distinct dates from 466 dated titles (16 same-date duplicates)**; **438 of 450 fall on a Sunday**.

### Parse plan and date rules (each one found in the real data)
1. **Date regex** (loose, keep it S5843-safe): `\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(Mon-name)[a-z]*\.?(?:\s+(\d{4}))?`, matching the leading weekday word if present. Use a month-prefix map (`jan…dec`), not a 12-way alternation inside the regex.
2. **Year inference (176 titles lack a year):** choose the candidate year (`pub-1`, `pub`, `pub+1`) closest to the publish date, and accept only if the event date is within **−14…+60 days of `publishOn`** (blog posts recap after the run; the live adapter's `parseCoeh3Title` is documented as taking the year from the publish date, so reuse its approach, but ⚠️ I did not read its code). 17 titles fall outside that window; handle each as below.
3. **Source year typos (found):** `The Obelisk, Mamhead - No Butts and Mouthful - 3rd July 2017` and `Ellerhayes Bridge - Sorepoint and Paperwork - 10th July 2017` were **published 2016-07-03 / 2016-07-10**. The stated 2017 gives Mondays; 2016-07-03 and 2016-07-10 are Sundays. Rule: if the title's year gives a non-Sunday and `year-1` or `year+1` lands on a Sunday inside the publish window, use that year and log it.
4. **Late posts:** `Stoke Woods 17th March 2013` and `Christmas Fancy Dress Trail and Hash Awards … 23rd Dec 2012` were both published 2013-06-23 (a blog catch-up). Accept the title date, since the title's year is explicit. Other 2011–2012 posts are 2–4 weeks late but unambiguous.
5. **Ambiguous:** `Kenton - Stix and family - 6th August` was published 2018-05-06; 2018-08-06 is a Monday. **Skip** it and any row that fails the Sunday + window test without a clean year fix. Do not guess.
6. **Non-Sunday and special events:** 12 of 450 dates are not Sundays; Boxing Day / Christmas / AGM / Autumn Gathering weekend posts are legitimate. Keep a non-Sunday row only if the title is a recognisable hash (`Boxing Day Hash - Joneys Cross - Tampa`), else skip. Skip every `Autumn Gathering`, `AGM`, `Subs`, photo and notice post, since they are not weekly trails.
7. **Venue / hares split:** shape A: split on ` - `, segment 2 = venue, segment 3 = hares. Shape B: last segment = date, segment 1 = venue, middle = hares. Shape C: venue only, hares absent. Keep hares as published (`Spocky Bitz`, `Sorepoint + Paperwork`, `Blobhoblin and TwinPeaks`); do not normalise nicknames.
8. **Same-date duplicates (16):** e.g. 2019-01-06 has `Haldon Belvedere - Twin Peaks and Blobhoblin` and `More... Haldon Belvedere - Blobhoblin and Twin Peaks` (9.6 KB). Dedupe by (date, venue) and keep the post with the clean title.
9. **Start time:** none in titles; `am/pm` time text appears in only **60 of 720** bodies. Leave `startTime` undefined for every pre-2020 row (do **not** default to the modern `11:00`). The merge pipeline handles missing time.
10. **Run numbers (the key decision):** posts carry no run number, but the blog and the existing dataset give anchors: `400th run` = 2009-05-10 (`10th May - 400th run, The Maer, Exmouth - Spocky Bitz`), `500th run` = 2011-03-20 (`20th March - 500th run - Stoke Woods Upper CP`), `600th Run` = 2013-01-06, `run 949` = 2019-08-25 (`Chudleigh Knighton - Wide Receiver - 25 August 2019`), `Run 957` = 2019-10-20 (`Haldon Chalets - Wide Receiver - 20th October 2019`), `# 973` = 2020-02-09 (`Alphington - Blobby - 9th February 2020`), `#982` = 2020-09-13, `#983` = 2020-09-20, `#984` = 2020-10-04.
    - 949 → 957 is +8 in 8 weeks and 957 → 973 is +16 in 16 weeks, so weekly counting reproduces the anchors **from 2019-08-25 onward**.
    - 500 (2011-03-20) → 600 (2013-01-06) is +100 runs in 93 weeks, and 600 → 949 is +349 in 346 weeks, so the sequence is **not** strictly weekly there.
    - **Rule:** set `runNumber` only on the 6 explicit anchor rows (400, 500, 600, 949, 957, 973) and on rows from 2019-08-25 → 2020-09-13 whose weekly count matches the explicit anchors (#950–#981, expect about 30 rows, flagged `derived`). **Leave every earlier row `runNumber: undefined`.** merge.ts then titles them `City of Exeter H3 Trail` style without a number (confirm the real wording). Never fabricate numbers for 2008–2019-08.

### Counts (to size the PR)
- Pre-cutoff posts: 720 → dated titles 466 → distinct dates 450 → after non-run/AGM/ambiguous filtering and the Sunday + window test expect **about 380–430** loadable runs. **Date range 2008-08-31 → 2020-09-27** (last pre-#984 Sunday; verify the seam against the `2020-10-04 #984` row, and against #982/#983 which the existing dataset may already hold: dedupe by date).
- Per distinct-date year: 2008 18, 2009 51, 2010 45, 2011 24, 2012 21, **2013 2**, 2014 39, 2015 50, 2016 45, 2017 47, 2018 41, 2019 44, 2020 23. Gaps (2013, parts of 2011–2012) are source gaps, not parse failures; say so in the PR.
- ⚠️ I did not query the prod DB for existing `coeh3` events under 2020-10-04. Claude Code must check, since the 2020-09 rows (#982/#983) may already exist from the live adapter's rolling window.

### Coord sanity / end times
- No coordinates, no end times, no cost field in the feed. Not applicable.

### Field-fill assertion table (sampled over the 466 dated titles; "n" = parsed by the plan above)
| Field | n filled / n sampled | Plan if low |
|---|---|---|
| `title` | 0 / 466 | undefined → merge.ts synthesizes `City of Exeter H3 Trail` (add `#N` only for anchor rows) |
| `startTime` | 0 / 466 | undefined (do not default 11:00) |
| `endTime` | 0 / 466 | absent |
| `location` (venue) | 393 / 466 (shapes A+B, measured by 3-segment titles); ~13 more from shape C | from the venue segment; shape D one-offs may need manual cleanup |
| `locationStreet` / `locationUrl` / `coords` | 0 / 466 | not in feed |
| `hares` | 393 / 466 (shapes A+B; not individually validated as hares) | from the hare segment; blank for shape C |
| `cost` | 0 / 466 | absent |
| `description` | 0 | **omit the recap prose** (PII, long). Provide `sourceUrl` per row instead, as the existing dataset does |
| `trailLengthText` | 0 | absent (some recaps say "3.5 mile trail", but it is prose, so skip) |

## Kennel metadata
Not re-researched: the kennel is live and profile fields were handled by the earlier onboarding (#2737). Nothing to add.

## Historical backfill — plan (this is the whole task)
- **Available:** ~380–430 runs, 2008-08-31 → 2020-09, fields: date, venue, hares, `sourceUrl` (the post permalink).
- **Pattern:** frozen curated JSON + dumb loader (the H7/ONH3 pattern). `scripts/data/coeh3-history-pre2020.json` entries shaped like the existing file: `{ date, kennelTags: ["coeh3"], runNumber?, location?, hares?, sourceUrl }`. Use the throwaway parser to produce it, review it by eye, commit only the JSON and the loader.
- **Frozen-dataset validation checklist (run all five before shipping):**
  1. PII scrub: **71 of 720 posts have an `@` or phone-like string in the body**. The dataset omits body text, so confirm no hares/venue field carries an email or number (`grep -E '@|[0-9]{5}'`).
  2. Run-number continuity: only anchors + the 2019-08 → 2020-09 derived block carry numbers; check that block is strictly increasing by 1 per Sunday except where the source skipped a week (flag any gap > 1 week).
  3. Gap sanity: every row's date is within −14…+60 days of its post's `publishOn`, except the two catch-up posts in rule 4. Print the exceptions.
  4. Monotonicity: any run numbers must not decrease with date.
  5. Field bleed: any `hares` or `location` containing `:` or ` - ` probably crossed a segment boundary; inspect each one.
- **Do not widen `scrapeDays` or the source's recurring window** (partial-enumeration source; keep `upcomingOnly: true`).

## Ready-to-paste seed
No seed changes (kennel, aliases and source already exist). Nothing for `kennels.ts` / `aliases.ts` / `sources.ts`.

## Adapter notes
- No adapter change. Reference for the loader: `scripts/backfill-coeh3-history.ts` and `scripts/lib/backfill-runner`.
- Reference for the parser: the live `parseCoeh3Title` in `src/adapters/html-scraper/city-of-exeter-h3.ts` (it already handles numbered titles with publish-date year inference). The pre-2020 parser is a throwaway variant that lacks the run-number group.
- ⚠️ **Claude Code must verify against current types:** `RawEventData` field names (`kennelTags: string[]`, optional `runNumber`/`startTime`), what `runBackfillScript` expects, and the merge pipeline's handling of a missing `runNumber` and `startTime` (fingerprint is `kennelTag + date + runNumber + title`; confirm two same-date events with no run number cannot collide with an existing row).
- Seam risk: confirm what the live adapter and the existing 200-run file hold for 2020-09-13/20/27 (#982, #983, and #984 on 2020-10-04). Dedupe by date, not run number.

## Deep-dive checklist
- [x] source live-verified (curl, JSON feed)  [x] history depth/pagination assessed (987/1089 reachable, windowed check agrees)  [x] coord sanity (none)  [x] end times (none)
- [x] kennel already live, so logo / socials / schedule / hashCash are out of scope  [x] sibling sweep: single-kennel blog, no sibling hashes

## Implementation gotchas
- Blogger's `totalResults` (1089) overstates what the public feed serves (987); do not loop until you reach 1089.
- `&#39;` and `&amp;` appear in titles: `html.unescape` before regexes, and keep nicknames exactly as published after decoding.
- **Sonar:** S3776 ≤ 15 (split the parser into `parseTitle`, `inferYear`, `splitVenueHares`, `classifyPost`), S5852/S5843 (no 12-way month alternation, no stacked `\s*`), `Number.parseInt(s, 10)`, `replaceAll` where no regex is needed.
- Tests: `beforeEach(vi.restoreAllMocks)`; there is no live fetch in the loader, so tests only need the dataset validators.
- Post-merge: the squash merge has dropped follow-up commits before (mijash3). Spot-check both new files landed.
