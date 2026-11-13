# Onboarding Handoff — IndyScent H3 history backfill (Indianapolis, IN) — 2026-11-13

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full backfill now, autonomously:
> 1. Branch off a clean `main`: `onboard/indyh3-history-20261113`.
> 2. **No seed changes.** `indyh3` and `thicch3` are live, and the "IndyScent H3 Upcumming Hashes"
>    source already feeds both (`prisma/seed-data/sources.ts`, `upcomingOnly: true`). Do NOT touch
>    the kennel rows, aliases or source config.
> 3. Build the **frozen dataset** described in **Historical backfill** below with a throwaway
>    extraction script (do not commit the parser). Commit only
>    `scripts/data/indyh3-history.json` + the dumb loader `scripts/backfill-indyh3-history.ts`
>    (mirror `scripts/backfill-aberdeen-h3-history.ts`, `runBackfillScript`, bound to
>    `sourceName: "IndyScent H3 Upcumming Hashes"`, `kennelTimezone: "America/Indiana/Indianapolis"`).
> 4. Run the frozen-dataset validation checklist (PII, monotonicity, weekday/date agreement).
>    Dry-run the loader against prod read-only (`npx tsx scripts/backfill-indyh3-history.ts`)
>    and paste the per-kennel tally + "would create / would match" counts into the PR body.
> 5. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 6. Commit and open a PR. Body must include **`Closes #1353`** and the dry-run tally.
> 7. **Post-merge runbook:** `git checkout main && git pull`; `git log -1 -- scripts/data/indyh3-history.json scripts/backfill-indyh3-history.ts`
>    (both must have landed); then `BACKFILL_APPLY=1 npx tsx scripts/backfill-indyh3-history.ts`.
>    Spot-check `https://www.hashtracks.xyz/kennels/indyscent-h3` (Past tab shows 2016–2022 runs
>    and #1115/#1116/#1118/#1123/#1130) and `/kennels/thicc-h3` (#1117 on 2026-03-19).
>    No `prisma db seed` is needed (no seed change).

## Summary
- Type: **history backfill** for a live kennel pair (onboarding-candidate **#1353**).
- Adapter: none changed. One-shot frozen JSON + loader through the merge pipeline.
- Effort estimate: small. ~37 rows of JSON + a ~30-line loader, plus a throwaway extractor.
- One-line: loads the 6 recent IndyScent/THICC runs the live list page aged out before HashTracks
  saw them (#1115–#1118, #1123, #1130) and 26 dated, numbered runs from the 2016–2022 "Hash Trash"
  blog posts. The kennel's Past tab currently starts in April 2026.

## Dedup result
- Kennel in seed: yes. `indyh3` (`prisma/seed-data/kennels.ts`, "IndyScent H3", foundedYear 1999)
  and `thicch3` ("THICC H3"), both region "Indianapolis, IN".
- Source in seed: yes. "IndyScent H3 Upcumming Hashes", `https://indyhhh.com/upcumming-hashes/`,
  HTML_SCRAPER, `upcomingOnly: true`, `kennelPatterns: [["THICC","thicch3"]]`,
  `kennelCodes: ["indyh3","thicch3"]`.
- Already delivered? No. No `handoffs/*-indyh3-history*.md`, no `scripts/data/*indy*`,
  `gh pr list --state all --search "indyh3 backfill"` finds only #2275 (detail-page
  *enrichment* of live events, not a past-run backfill). The only indy script is
  `scripts/backfill-indyh3-detail-1354.ts` (enrichment of existing canonicals, #1354).
- Decision: history-backfill handoff per Step 1 (history gap on a live kennel).
- **What prod already has** (read from the public kennel pages' RSC payload on 2026-11-13,
  `curl https://www.hashtracks.xyz/kennels/indyscent-h3` and `/kennels/thicc-h3`, grepping
  `runNumber`; no DB access in this task, so ⚠️ **Claude Code must confirm with a prod query**):
  - `indyh3`: 1119, 1120, 1121, 1124, 1126, 1127, 1128, 1129, 1131, 1132, 1133, 1134, 1136, 1137,
    1139, 1140, 1142, 1143, 1144, 1145, 1146, 1147, 1149, 1150, 1151
  - `thicch3`: 1122, 1125, 1135, 1138, 1141, 1148
  - Earliest date in either payload: 2026-04-10. No pre-2026 events seen.
  - The payload also shows a 2026-07-09 date with no matching archive run; leave it alone and
    just note it in the PR if the prod query shows what it is.

## Live source verification ✅
All fetches made 2026-11-13 with the adapter's Chrome `User-Agent` + `Accept: text/html`
(without that header the site answers HTTP 406, as the 2026-06-29 comment on #1353 found).

### Surface A — `ht_hash_event` custom post type (2026 runs)
- Listing: `https://indyhhh.com/hashes/`, `/hashes/page/2/` … `/page/4/` → 200; `/page/5/` → 404.
- Complete list: `https://indyhhh.com/wp-sitemap-posts-ht_hash_event-1.xml` → 200, **37 URLs**,
  identical to the 37 unique detail links found walking pages 1–4 (`diff` empty).
- The CPT is **not** exposed in WP REST (`/wp-json/wp/v2/types` lists only core types).
- Range: `Hash #1115` (Sat 2026-02-28) → `Hash #1151` (Fri 2027-01-01).
- Detail page shape (real markup, `hash-1117-thicc-moon`):
  ```html
  <h1 class="post-title entry-title">Hash #1117: THICC Moon</h1>
  ... <span class="published">March 16, 2026</span>
  <div class="ht-event-details" ...><div ...><strong>📅 Date:</strong> Thursday, March 19, 2026</div>
  <div ...><strong>⏰ Time:</strong> 7:00 PM</div>
  <div ...><strong>🐇 Hares:</strong> NEEEEERRRRRD! / Sheiße Superveiße</div>
  <div style="margin-top: 20px;"><strong>Start Location:</strong> ... (Leaflet map div, no text)
  <a href="https://www.google.com/maps/dir/?api=1&destination=39.9122586,-86.2624383" ...>🗺️ Get Directions</a>
  <a href="data:text/calendar;...DTSTART%3A20260319T230000Z%0D%0ADTEND%3A20260320T020000Z..." ...>📅 Add to Calendar</a>
  ```
  followed by free-form description `<div>`/`<p>` blocks (the existing `parseIndyDetail`
  already folds these into `description`).
- 🔴 **Use the run number in the `<h1>` title, never the slug.** Slugs are copy-pasted and lag:
  `hash-1117-tia-bday-trail` is **#1118**, `hash-1132-nash-hash-copy` is **#1133**,
  `hash-1133-nash-hash-copy` is #1134, `hash-1134-thicc-moon` is #1135, `hash-1135-saturday-hash`
  is #1136, `hash-1139-campout-copy` is #1137, `hash-1140-thicc-moon-copy` is #1138,
  `hash-1141-indyscents-27th-analversary` is #1139. (The #1353 triage comment's "#1117 ×2" was
  read from the slugs; the second one is really #1118.)

**The six rows prod is missing** (verbatim from the detail pages):

| Run | Date (page) | Time | Kennel | Title after `Hash #N: ` | Hares (verbatim) | Coords (Maps `destination=`) | Slug |
|---|---|---|---|---|---|---|---|
| 1115 | Saturday, February 28, 2026 | 3:00 PM | indyh3 | Bar Bridge Bar Trail | 13” Cocktower/ Pink Clam Pussy, ClamBake | 39.8731403,-86.1426869 | hash-1115-bar-bridge-bar-trail |
| 1116 | Friday, March 13, 2026 | 7:00 PM | indyh3 | Pi Day Parade | Fifty Shades of Green, Civil Whorf | 39.8324495,-86.1648220 | hash-1116-pi-day-parade |
| 1117 | Thursday, March 19, 2026 | 7:00 PM | **thicch3** | THICC Moon | NEEEEERRRRRD! / Sheiße Superveiße | 39.9122586,-86.2624383 | hash-1117-thicc-moon |
| 1118 | Saturday, March 28, 2026 | 3:00 PM | indyh3 | TIA Birthday Trail | Takes It All, Snatchsquatch | 39.7580465,-86.1396693 | hash-1117-tia-bday-trail |
| 1123 | Saturday, May 2, 2026 | 3:00 PM | indyh3 | Squat Post-Mini Hash | Will Squat for Beer | 39.7904672,-86.1821511 | hash-1123-squats-post-mini-hash |
| 1130 | Thursday, July 2, 2026 | 4:00 PM | indyh3 | NashHash26 USA Nash Hash – Naughty in Nature 2026 – Thursday Lingerie/Nekkid Trail | Psychedelic Cumfountain, Tri-harder, Zucch Chute Riot | 39.4091912,-83.9894485 | hash-1130-nash-hash |

- Times agree with the embedded ICS `DTSTART` (e.g. #1117 `20260319T230000Z` = 19:00 EDT;
  #1115 `20260228T200000Z` = 15:00 EST). Use the `⏰ Time:` text, not the UTC stamp.
- Descriptions: #1115, #1116, #1123 have an empty body. #1117, #1118, #1130 have prose
  (e.g. #1117 "Neeeeerrrrrd will hare. You should show up! Start is just west of Trader’s Mill
  Grill & Bar. True trail will be <3.5 miles…"). Run the existing `parseIndyDetail` on each page
  for `description` + trail length so the rows match what the live adapter produces.
- Kennel routing: apply the source's own pattern (`/THICC/` in the title → `thicch3`, else
  `indyh3`). Only #1117 routes to THICC. Note #1128 "Indyscent New Moon Trail – Juan Solomon
  Park" has a `thicc-moon` slug but prod has it under `indyh3`, which matches the title rule;
  don't route by slug.
- Coord sanity: 31 of 37 pages carry a Maps `destination=` pair (the 6 newest, #1146–#1151,
  have none yet). The only repeated pair is 39.4091912,-83.9894485 ×5 = the NashHash26
  campground (Camp Graham, Clarksville, OH; #1130–#1134), which is real, not a default pin.
  All others are distinct and inside the Indianapolis area.
- End times: the ICS stub always has `DTEND = DTSTART + 3h`, a template default. Ignore it.
- Same-day double-header: #1131 (Fri 2026-07-03 15:00) and #1132 (Fri 2026-07-03 21:00) share a
  date. Both are already in prod, so the backfill does not touch them; nothing to do.

### Surface B — WordPress posts, "Hash Trash" recaps (2016–2022)
- `https://indyhhh.com/wp-json/wp/v2/posts?per_page=100` → 200 JSON, `X-WP-Total: 36`.
  36 posts total; **27 have a run number in the title**, the other 9 are notices (awards,
  rego, mismanagement, hapi coats). Oldest post 2016-03-01, newest 2026-08-14.
- Bodies are free-form prose recaps listing attendees by hash name (some "Just <first name>"
  entries). Only 1 of 27 has a labelled `Hares:` line (#857). So these rows are **title-only**:
  date, run number, theme title. Sampled bodies from 2016, 2018, 2020 and 2022 to confirm.
- The 26 usable runs (excluding #1138, already in prod), verbatim titles:

| Post date | WP id | Title (verbatim) |
|---|---|---|
| 2016-03-01 | 300 | #683 Cosby Sweater Hash Trash…Saturday, February 27, 2016 |
| 2016-03-03 | 302 | #684…Where the Fuck Are the Bloomingfools? Hash Trash…Wednesday, March 2, 2016 |
| 2016-03-13 | 308 | # 685…Fight Club Hash…Friday, March 11, 2016 |
| 2016-03-29 | 319 | #686…Jesus Can’t Go Hashing Hash…Saturday, March 26, 2016 |
| 2016-04-09 | 324 | #687 Toxic Love Canal (Part II) – Wednesday, April 6, 2016 |
| 2016-05-01 | 352 | #688…Tax Day Hash Trash…Friday, April 15, 2016 |
| 2016-05-05 | 375 | #692…May the 4th Be IN You Hash Trash…Wednesday, May 4, 2016 |
| 2016-05-19 | 397 | #693…Friday the 13th Hash Trash…Friday, May 13, 2016 |
| 2016-06-03 | 408 | #694…2016 HAH Hash Trash…Saturday, May 28, 2016 |
| 2016-06-03 | 406 | #695…Naughty School Girl Hash (Part 2) Hash Trash…Wednesday, June 1, 2016 |
| 2016-06-14 | 413 | # 696…Chiropractic Nightmare Hash Trash…Friday, June 10, 2016 |
| 2016-07-05 | 423 | #698…Freedom Hash…Sunday, July 3, 2016 |
| 2016-07-20 | 446 | #699…Ten Years Past Their Prime Hash Trash…Friday, July 15, 2016 |
| 2017-05-18 | 626 | #740…Not In My Hair Pickup Hash…Wednesday, May 17, 2017 |
| 2018-08-13 | 873 | #797…Wendy Gets Dirty (30) Hash…Friday, August 10, 2018 |
| 2018-09-07 | 886 | #798…IndyScent’s 19th Analversary…Saturday, August 25, 2018 |
| 2018-09-09 | 889 | #799…To Hash Where We Dare Not Go…Wednesday, September 5, 2018 |
| 2018-09-19 | 891 | #800-802…Banned Camp – Back to School…The weekend of Sept 14-16, 2018 |
| 2018-10-07 | 906 | #803…Naughty Piana Chiropractic Hash…Saturday, Sept 29, 2018 |
| 2018-10-08 | 908 | #804…Teenage Mutant Ninja Hashers: Secret of the Booze…Wednesday, Oct 3, 2018 |
| 2018-11-01 | 912 | #806…Tosserween II…Saturday, October 27, 2018 |
| 2020-01-03 | 1250 | #855…Hangover Hash…Wednesday, January 1st, 2020 |
| 2020-01-20 | 1258 | #857…Viking Hash…Saturday January 19, 2020 |
| 2022-01-02 | 1423 | #937… The We’re Hungover For Betty Hash… Saturday, January 1st, 2022 |
| 2022-05-05 | 1454 | #952… May the Fourth Be With You Hash: Episode IV – A Nude Hope… Wednesday, May 4, 2022 |
| 2022-09-08 | 1504 | #965… Indyscent Analversary Hash Trash Saturday… August 20, 2022 |

- Title format drift to handle (all seen above): `#N…` vs `#N ` vs `# N…` (space after `#`);
  `…` as U+2026 or HTML `&#8230;`; `–` dash separator (#687); ordinal days (`1st`); abbreviated
  months (`Sept`, `Oct`); no comma after the weekday (#857); weekday after the theme (#965,
  "Hash Trash Saturday… August 20, 2022"); a run **range** `#800-802` over a weekend.
- Weekday check (computed): 25 of 26 dates agree with their weekday. **#857 says "Saturday
  January 19, 2020", but 2020-01-19 was a Sunday** (Sat = 01-18). The post was published
  2020-01-20 and the body doesn't settle it. Recommendation: keep the explicit date
  2020-01-19 (dates are more often right than weekdays in this archive) and note it in the PR.
- `#800-802` Banned Camp, 14–16 Sep 2018 (Shakamak State Park, Jasonville, IN per the body):
  emit three rows (#800 2018-09-14, #801 2018-09-15, #802 2018-09-16), same title, or a
  multi-day series via `seriesId` if the merge pipeline's series path is simpler. Implementer's
  call; don't invent per-day themes.
- Start times: the titles carry none. Leave `startTime` undefined (do not infer from the
  weekday; the 2016 schedule differs from today's).
- No location text is reliably labelled; leave `location` undefined. Do not put the recap
  prose in `description` (attendee lists only, some with first names).

### Field-fill table
Surface A = the 6 missing rows; Surface B = the 26 blog runs.

| Field | A | B | Plan |
|---|---|---|---|
| `title` | 6/6 | 26/26 | text after `Hash #N: ` (A) / theme between run # and weekday-date, minus a trailing "Hash Trash" (B) |
| `runNumber` | 6/6 | 26/26 | from the `<h1>` / post title, never the slug |
| `startTime` | 6/6 | 0/26 | `⏰ Time:` → 24-h `HH:MM` via `parseIndyTime` / undefined |
| `endTime` | 0/6 | 0/26 | ICS DTEND is a +3h template; omit |
| `location` | 0/6 | 0/26 | "Start Location:" has only a map; undefined |
| `locationStreet` | 0/6 | 0/26 | not in source |
| `locationUrl` | 6/6 | 0/26 | the `google.com/maps/dir/?api=1&destination=…` href |
| `hares` | 6/6 | 1/26 | `🐇 Hares:` verbatim (A); B undefined (only #857 has a line) |
| `cost` | 0/6 | 0/26 | not in source |
| `description` | 3/6 | 0/26 | `parseIndyDetail(html).description` (A); none for B |
| `trailLengthText` | 1/6 | 0/26 | `parseIndyDetail` already extracts (#1117 "<3.5 miles" — check it parses or stays undefined) |
| coords | 6/6 | 0/26 | lat/lng from `destination=` (A) |

## Kennel metadata
Unchanged; both kennels are live. Corroboration only, no edits proposed:
- foundedYear 1999 (seed) is consistent with the site's own milestone posts: "#798…IndyScent’s
  19th Analversary…August 25, 2018" (wp id 886) and "Hash #1139: IndyScent’s 27th Analversary
  FLOAT TRIP!" on 2026-08-15 (`/hashes/hash-1141-indyscents-27th-analversary/`).
- THICC H3's seed says "3rd Tuesday 7 PM", but its 2026 runs fell on Thu 03-19, Fri 04-17,
  Sun 05-17, Fri 07-17, Wed 08-12, Fri 09-11, Wed 12-09 — a moon-phase cadence, not a fixed
  weekday. Out of scope here; worth a separate schedule-fix issue (see run log).

## Historical backfill
- Available: **32 rows** = 6 (Surface A) + 26 (Surface B; 28 if #800-802 becomes 3 rows).
  Range 2016-02-27 → 2026-07-02. Not reachable by any other source: the live adapter reads only
  the Upcumming Hashes page (future runs) and `upcomingOnly: true` is already set.
- Gaps are in the source itself: #689–691, #697, #700–739, #741–796, #805, #807–854, #856,
  #858–936, #938–951, #953–964, #966–1114 were never posted. Do not try to fill them.
- Plan: frozen `scripts/data/indyh3-history.json` (RawEventData[], `kennelTags` per row, UTC-noon
  handled by the runner) + `scripts/backfill-indyh3-history.ts` via `runBackfillScript`, bound to
  "IndyScent H3 Upcumming Hashes" (the source that is linked to both `indyh3` and `thicch3`, so
  the source-kennel guard passes). Set `sourceUrl` per row to the detail page / post link.
- Validation before shipping:
  1. PII: no emails or phone numbers in any field (grep `@` and `\d{3}[-. ]\d{3}[-. ]\d{4}`).
     Hares are hash names as displayed; keep them verbatim, don't add the recap attendee lists.
  2. Monotonicity: run numbers increase with date across both surfaces (683 … 965 … 1115 … 1130).
  3. Weekday/date agreement: only #857 disagrees (documented above).
  4. Dedup: the loader must not create rows for runs already in prod (#1119+ except 1123/1130).
     The dry run's "would match" count should be 0 for this dataset; any match means a row
     collides and must be inspected, not double-inserted.

## Deep-dive checklist
- [x] source live-verified (both surfaces fetched 2026-11-13)  [x] history depth assessed (sitemap
  = 37 CPT URLs; REST `X-WP-Total: 36` posts)  [x] coord sanity (only legitimate repeat)
  [x] end times (template default, ignored)  [x] kennel routing rule checked  [x] PII rule stated
- Kennel profile fields: n/a (live kennels, no change).

## Implementation gotchas
- Backfills must route through `runBackfillScript` → merge, not raw inserts.
- Slug run numbers lag the title (see list above). Title wins.
- Don't let the THICC slug route #1128; route by title only, matching the live adapter.
- Without `Accept: text/html` and the Chrome UA, indyhhh.com returns 406.
- `parseIndyDate` expects `"Month D, YYYY"` and won't handle ordinals (`January 1st, 2020`) or
  `Sept`. Normalize in the throwaway extractor before calling it; don't change the adapter.
- `friendlyKennelName` doesn't matter: every row carries a title.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). Closes #1353._
