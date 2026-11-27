# Onboarding Handoff — City of Exeter H3 Hash Diary calendar (Exeter, England) — 2026-11-19

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/coeh3-calendar-20261119`.
> 2. Apply the **Ready-to-paste seed** below. This is a **source-add**: the kennel `coeh3` is already
>    seeded and live, so add only the new `Source` row (no kennel or alias edits).
> 3. Configure the adapter exactly as in **Adapter notes** (config-only `GOOGLE_CALENDAR`; no new code).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`:
>    call `new GoogleCalendarAdapter().fetch(source, { days: 3000 })` and, separately,
>    `{ days: 365 }` (pass `days` explicitly — see the rule). Confirm the numbers in **Live source
>    verification**. **DO NOT run `npx prisma db seed` here.**
> 5. **Historical backfill:** add `scripts/backfill-coeh3-calendar-history.ts` wrapping
>    `backfillGCalSource({ sourceName: "City of Exeter H3 Hash Diary Calendar", days: 3000, timezone: "Europe/London" })`
>    (mirror `scripts/backfill-capital-h3-history.ts`). One-shot, run after the source row exists in prod.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR. Put a bare `Closes #2911` in the PR body (and `Refs #2916` — the pre-2020 blog
>    history gap is a separate, parser-heavy task and is NOT done here).
> 8. **Post-merge runbook:** `git checkout main && git pull`; verify the new files landed
>    (`git log -1 -- scripts/backfill-coeh3-calendar-history.ts`); `npx prisma db seed` (additive; adds the
>    Source row); trigger a scrape from `/admin/sources`; then run the one-shot backfill
>    (dry run first, then `BACKFILL_APPLY=1`); spot-check `https://www.hashtracks.xyz/kennels/city-of-exeter-h3`.

## Summary
- Type: **source-add** (existing kennel `coeh3`; issue **#2911**, `source-coverage-gap`)
- Adapter: `GOOGLE_CALENDAR` — **config-only** (adapter exists in `registry.ts`; feed verified live below)
- Effort estimate: **config-only + a ~25-line one-shot backfill wrapper** (no new adapter code, no region edits)
- One-line: the kennel's public "Hash Diary" Google Calendar carries the *advance* schedule (6 upcoming runs
  Nov 22 → Dec 27 2026) that the recap-only blog source cannot, and fills the three Sundays the blog has not
  posted yet (Nov 1 / 8 / 15), plus 102 post-Oct-2020 and 21 earlier calendar dates with no HashTracks event.

## Dedup result
- Kennel in seed: **yes** @ `prisma/seed-data/kennels.ts:7348` (`coeh3`, slug `city-of-exeter-h3`)
- Source in seed: **blog only** — "City of Exeter H3 Blogspot Recaps" @ `sources.ts:~9758` (HTML_SCRAPER, trust 6, `upcomingOnly`). No calendar source (`grep -in "hash-diary\|cityofexeterh3@" prisma/seed-data/sources.ts` → none).
- Live sitemap dedup: `curl` of `https://www.hashtracks.xyz/sitemap.xml` returned **562** kennel slugs (≥ 400); `city-of-exeter-h3` is present, so the kennel is live and this is a source-add. Sibling slugs seen: `isca-h3`, `devon-lunatics-h3`.
- Handed-off check: `handoffs/2026-10-12-coeh3.md` is the earlier **blog-recap** onboarding (never mentions the calendar). No open PR for `coeh3`; no calendar handoff. This is a distinct source.
- Decision: **source-add**. Kennel code stays `coeh3` (immutable, no collision question).
- Admin-event pre-check: the kennel is fully live; its existing events come from the blog adapter + `scripts/data/coeh3-history.json` (200 runs). Overlap with the calendar is analysed below; no purge is needed.

## Live source verification  ✅
- Source: `GOOGLE_CALENDAR` — calendar id `cityofexeterh3@gmail.com` (decoded from the base64 `src=` param of the
  Google Calendar iframe embedded on `https://cityofexeterhhh.blogspot.com/p/hash-diary.html`, titled "City of Exeter H3 Hash Diary").
  - iCal HEAD: `https://calendar.google.com/calendar/ical/cityofexeterh3%40gmail.com/public/basic.ics` → HTTP 200, `content-type: text/calendar; charset=utf-8`; 336 `VEVENT`, **0 `RRULE`** (every run is its own event, so no recurrence phantoms).
  - Calendar API v3 (what the adapter uses): HTTP 200, `timeZone: Europe/London`, public (no auth beyond the project key).
- **Real adapter run** (throwaway `tsx` probe of `GoogleCalendarAdapter.fetch` with the config below, `days: 3000`, no DB): `errors: []`, **329 events**, `2019-09-08 → 2026-12-27`. With `days: 365` the same adapter returns the recent window only.
- Events seen: 6 upcoming + 323 past. Cadence is every Sunday (332 of 336 raw rows are Sundays; 3 Saturdays, 1 Friday).
- **Upcoming (verbatim API summaries):**
  1. 2026-11-22 11:00 — `City of Exeter H3 - the Strand car park Starcross - Zoot and Hotlips` — LOCATION `Starcross`
  2. 2026-11-29 11:00 — `City of Exeter H3 - Double Locks Exeter - Stix` — LOCATION `Double Locks`
  3. 2026-12-06 11:00 — `City Of Exeter Hash Warren Car Park Spocky` — no LOCATION
  4. 2026-12-13 11:00 — `City of Exeter Hash Blindwell Farmhouse TQ12 3AX Wide` — no LOCATION (description: "Tight's 50th … party food")
  5. 2026-12-20 11:00 — `City of Exeter Hash The Boathouse Dawlish Warren Stix` — no LOCATION
  6. 2026-12-27 11:00 — `City of Exeter Hash Model Airfield Car Park Tampa` — no LOCATION
- **Recent past, calendar vs blog** (blog newest post is #1281, 2026-10-25, so nothing for Nov 1 / 8 / 15 yet):
  `2026-11-01 Swan Inn Bampton - Boots` · `2026-11-08 Core Copse East Hill Strips - Howlin' Wilf` · `2026-11-15 Joneys Cross - Wobblybitz and Oddbitz`.
- **Source-count parity:** the calendar has no UI total. The adapter yields 329 of 336 raw rows (the 7 difference are exact same-day duplicates
  merged by the adapter's `dedupGCalEvents`, plus the 1 `No City of Exeter Hash…` row dropped by `skipPatterns`). Parity ≈ 98%, no pagination needed.
- **History depth / pagination:** one query returns the whole archive; the earliest event is **2019-09-08**. Per year (raw rows): 2019 = 8, 2020 = 25, 2021 = 44, 2022 = 52, 2023 = 52, 2024 = 49, 2025 = 51, 2026 = 55.
- **Overlap with what HashTracks already has** (computed from `scripts/data/coeh3-history.json`, 200 blog runs, vs the 325 distinct calendar dates):
  196 dates are in both; **129 calendar-only** (123 past + 6 upcoming); 4 blog-only. Of the 123 calendar-only past dates, 21 are before 2020-10-04 (the blog backfill's floor)
  and 102 are after it (runs the blog never posted a recap for, e.g. every Sunday 2025-07-20 → 2025-09-07, and 2026-11-01/08/15). This matches the audit's "125 missing".
- Coord sanity: only **29 of 329** events carry coordinates (from `LOCATION` strings like `50.597649, -3.442937`), 0 default-pin clusters. Nothing to reject.
- End times: `DTEND` on 328 of 329. The adapter maps same-day ends to `endTime`. Start time is `11:00` on 320 of 329 (a few 11:30 / 10:30 / 11:15 social events and 4 afternoon ones).
- Notes: timestamps are UTC (`...T11:00:00Z` in winter, `T10:00:00Z` in summer = 11:00 BST), so **`timezone: "Europe/London"` is mandatory** (without it every summer run reads as 10:00).
- **Field-fill assertion table** (329 adapter events, config below, `days: 3000`):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 329 / 329 | venue (+hares on shape A) after prefix strip; `defaultTitle` when empty |
  | `startTime` | 329 / 329 | from the timed `dateTime` via `timezone` |
  | `endTime` | 328 / 329 | from `DTEND` |
  | `location` (venue name) | 252 / 329 | `LOCATION` field, else `titleLocationPattern` fill (shapes A/C) |
  | `locationStreet` | not measured | not a separate field in this feed |
  | `locationUrl` (Maps) | 254 / 329 | `LOCATION`/description maps links (`maps.app.goo.gl`, `goo.gl/maps`) |
  | `hares` | 117 / 329 | shape A title pattern + description labels; shapes C/D left blank on purpose |
  | `cost` | 0 / 329 | not in feed; kennel has no published fee |
  | `description` | 304 / 329 | calendar `DESCRIPTION` |
  | `trailLengthText` | 0 / 329 | not in feed |
  | `coords` (lat/lng) | 29 / 329 | only when `LOCATION` is a coordinate pair |
  | `runNumber` | 0 / 329 | **the calendar carries no run numbers**; the blog source supplies them |

## Summary-shape distribution (why the config is conservative)
The `SUMMARY` field is hand-typed and has drifted. Classified over all 336 raw rows:
- **A** `City of Exeter H3 - <venue> - <hares>`: 31 rows (2020, 2023, 2025, 2026 and the Nov 22 / Nov 29 upcoming runs). Cleanly splittable.
- **B** `City of Exeter H3 - <venue>`: 115 rows (2023 → 2026), no hares.
- **C** `City of Exeter Hash, <venue>, <HARES>` (and a few `City of Exeter, <venue>, …`): older rows. Venue itself contains commas (`"Blackborough Woods (Broad Road, near Forest Glade holiday park)"`), so a "last comma token is the hare" rule mis-parses. **Tested: it produced `hares: "near Forest Glade holiday park)"` for 2022-01-23. Do not add a hare pattern for shape C.**
- **D** `City Of Exeter Hash <venue> <hares>` with **no delimiter at all**: 167 rows incl. 4 of the 6 upcoming runs (`Warren Car Park Spocky`, `Blindwell Farmhouse TQ12 3AX Wide`). The hare name is glued onto the venue; it cannot be split without a name list. **Left as the title remainder, hares blank. Do not guess.**
- **E** other / socials: 23 rows (`AGM @ 11.30am`, `Autumn Gathering`, Christmas hashes, `joint with Isca Roman Away Day`, `Joint hash with Isca H3`, `joint with AH3 - Sidmouth Scout Hut`). Real events; keep.
- Placeholders: `City of Exeter H3 - TBC`, `… - VENUE TBC (No Butt)` (2026-06-07, 2026-03-29). Not a cancelled-run marker. ⚠️ Not verified what the adapter emits for these two rows (I did not inspect them in the probe output); check they land on `defaultTitle` and not the literal `TBC`. `No City of Exeter Hash, instead Rambo’s Celebration of Life` (2022-10-09) is a **non-run** → `skipPatterns`.
- 10 dates carry two calendar rows (e.g. 2019-12-07 ×3, 2021-11-28, 2026-03-01, 2026-09-06). The adapter's `dedupGCalEvents` collapses most; the merge pipeline dedups the rest on `kennel + date`.

## Kennel metadata (already complete — source-add)
- fullName / shortName / region / country: `City of Exeter Hash House Harriers` / `City of Exeter H3` / Exeter / UK (unchanged, `kennels.ts:7348`).
- Nothing to enrich from this source. The calendar title (`City of Exeter H3 Hash Diary`) and the blog both confirm the kennel's website `https://cityofexeterhhh.blogspot.com/` and Sunday 11:00 schedule already in the seed.
- Not re-verified this run: logo (`/kennel-logos/coeh3.gif`, self-hosted already), foundedYear 2001, socials, hash cash (none published). Out of scope for a source-add.

## Historical backfill
- Available: **123 calendar-only past dates** (21 pre-2020-10-04, 102 after) on top of the 196 dates the blog data already covers. Fields: date, startTime, endTime, venue (title/LOCATION), hares (shape A only), description.
- Plan: **one-shot wide-window pass via the existing GCal helper** (`scripts/lib/gcal-backfill.ts`), not a permanently wide `scrapeDays`.
  - Recurring `scrapeDays` stays **365**. A permanent huge value makes reconcile look up to ~27 years ahead while the adapter only fetches 365 days forward (the PR #2028 lesson).
  - Run `backfillGCalSource({ sourceName, days: 3000, timezone: "Europe/London" })`: dry run first, assert **0 cancelled** (the helper does), then `BACKFILL_APPLY=1`. Do not pass `force`.
  - Note: this repo's older precedents (Devon Lunatics, Isca H3) used a permanent wide `scrapeDays`; the later guidance supersedes that. Do not copy it.
- Do the 123 rows duplicate existing HashTracks events? They should not: the 196 shared dates already exist from the blog and will merge on `kennel + date`. Confirm in the dry run that the *new* count is close to 123 and the merge reports the other ~196 as matched/updated, not inserted.
- **Not covered here:** the 720 pre-2020-10-04 Blogger posts in #2916 (2008–2020, no run numbers). That needs a different parser and stays a separate task. Only the 21 calendar dates before 2020-10-04 come in with this PR.

## Ready-to-paste seed

```ts
// sources.ts — Source[] (insert directly after "City of Exeter H3 Blogspot Recaps", ~L9769)
{
  name: "City of Exeter H3 Hash Diary Calendar",
  // Public calendar id (base64 `src=` of the iframe on /p/hash-diary.html), same convention as Isca H3.
  url: "cityofexeterh3@gmail.com",
  type: "GOOGLE_CALENDAR" as const,
  // 7: above the recap blog (6) so the advance schedule wins on upcoming rows, below GCal-primary
  // kennels (8). Confirm in the dry run that this does not overwrite blog hares/titles with null.
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 365, // recurring window; deep history comes from the one-shot backfill (see above)
  config: {
    defaultKennelTag: "coeh3",
    timezone: "Europe/London", // feed is UTC (Z); summer runs are 10:00Z = 11:00 BST
    defaultTitle: "City of Exeter H3 Trail",
    // Shape A only: "City of Exeter H3 - <venue> - <hares>". C/D deliberately NOT parsed for hares.
    titleHarePattern: [String.raw`^City of Exeter H3\s-\s[^-]+?\s-\s(\S[^-]*)$`],
    // Venue fill for shapes A and C when LOCATION is empty or a bare maps link.
    titleLocationPattern: [
      String.raw`^City of Exeter H3\s-\s([^-]+?)(?:\s-\s|$)`,
      String.raw`^City of Exeter Hash,\s([^,]+?)(?:,|$)`,
    ],
    titleLocationFillOnly: true,
    // Remove the repeated kennel prefix ("City of Exeter H3 - ", "City Of Exeter Hash, ", "City of Exeter Hash ").
    titleStripPatterns: [String.raw`^City of Exeter(?:\s+H3|\s+Hash)?\s*[-,]?\s*`],
    skipPatterns: [String.raw`^No City of Exeter`], // 2022-10-09 non-run
  },
  kennelCodes: ["coeh3"],
},
```

No `kennels.ts` / `aliases.ts` / `region.ts` edits (kennel and region already exist).

## Adapter notes
- **Config-only.** `GoogleCalendarAdapter` options used: `defaultKennelTag`, `timezone`, `defaultTitle`, `titleHarePattern`, `titleLocationPattern`, `titleLocationFillOnly`, `titleStripPatterns`, `skipPatterns`. All exist on `GCalSourceConfig` (`src/adapters/google-calendar/adapter.ts` ~L1087–1215). Reference config: "Isca H3 Google Calendar" (`sources.ts:9713`), the nearest sibling (same city, same hand-typed-summary problem).
- **Why not `upcomingOnly`:** a Google Calendar keeps every event, so a repeat scrape returns the same old rows. Reconcile is safe at `scrapeDays: 365`.
- **No `includeAllDayEvents`:** the feed is timed (`dateTime` with `Z`); verified 329/329 events got a `startTime`, so nothing is dropped as all-day.
- **Title behaviour you will see (verified):** upcoming rows come out as `title: "the Strand car park Starcross", hares: "Zoot and Hotlips"` (A), `"Double Locks Exeter" / "Stix"` (A), and for shape D `"Warren Car Park Spocky"`, `"The Boathouse Dawlish Warren Stix"` with no hares. The D rows still read badly because the hare is glued to the venue. Accepted for now: precision over recall. If John wants D cleaned up, the only reliable route is a per-source known-hare list; not proposed here.
- **Cross-source duplicates (verify at build):** blog rows carry `runNumber`; calendar rows carry none, and both are keyed `kennel + date`. Expect the merge to join them (196 shared dates). After the first scrape, check a few overlapping dates (e.g. 2026-10-18, 2026-10-25) on the hareline for **one card per date** with the blog's run number intact. If two cards appear, that is the merge MATCH/TITLE issue recorded in the cross-source-duplicate-cards memory, not a config problem.
- **Joint trails:** rows such as `joint with Isca Roman Away Day` (2022-07-31) and `Joint hash with Isca H3` (2024-07-28) appear on this calendar only. Isca H3 has its own calendar (`isca-h3`). No `kennelPatterns` or multi-kennel `kennelTags` are proposed: the calendar is single-kennel and the cross-attribution is not machine-readable. **Sibling sweep:** the only siblings in the area (Isca H3, Devon Lunatics H3, Teign Valley H3, Devonport = Tasmania, unrelated) are already onboarded as separate sources.

**⚠️ Claude Code: verify before committing.** Confirm against the current repo, not this file:
- `GCalSourceConfig` field names above (especially `titleLocationFillOnly` and `skipPatterns`) and that `timezone` is read from `source.config`.
- The regexes are `safe-regex2`-clean (`config-validation.ts` runs ReDoS checks on admin-entered config, and Sonar S5852 is strict): no stacked `\s+`, no nested quantifiers. The ones above use a single `\s` and negated classes; re-run the validator.
- `backfillGCalSource` signature in `scripts/lib/gcal-backfill.ts` and that `sourceName` is unique in the DB.
- `friendlyKennelName("City of Exeter H3", "City of Exeter Hash House Harriers")` is not needed: `defaultTitle` is set explicitly.

## Deep-dive checklist (source-add scope)
- [x] source live-verified (iCal HEAD `text/calendar`; Calendar API v3 HTTP 200; real adapter run, 329 events)
- [x] history depth assessed (single query, 2019-09-08 →; overlap with frozen blog JSON computed)
- [x] coord sanity checked (29/329, no default pins)  [x] end times noted (328/329)
- [x] kennelCodes (source guard) set: `["coeh3"]`
- [ ] logo / foundedYear / socials / hashCash: unchanged; not re-verified (kennel already live)

## Implementation gotchas (for Claude Code)
- **Do not raise the recurring `scrapeDays` above 365** (reconcile gap, see Historical backfill).
- **Seed follow-through:** after merge, `Source.config` only reaches prod via the post-merge `npx prisma db seed`; run it before the backfill so the wrapper can find the source by name. Do not run a full seed from a worktree that imports `prisma/seed.ts`.
- **The scrape adds only NEW future/recent rows.** Nothing already in prod is changed by a re-scrape; rows for dates the blog already created are enriched by merge only if the calendar row is the higher-trust source. Check the dry run.
- **Tests:** add a small fixture test only if you add code. This is config-only, so a source-config validation/registry test (if one enumerates seeded GCal sources) is the likely one to touch.
- **Sonar S3776 / S5852:** keep the regexes as written; do not "simplify" into alternations.
- Close the loop on the issue: the implementing PR carries `Closes #2911`. `#2916` stays open (pre-2020 blog archive).
