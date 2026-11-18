# Onboarding Handoff — Barbados Bike H3 forward hareline (source-add) — 2026-11-15

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> Issue: **#2795** (`onboarding-candidate`, audit rule `source-coverage-gap`). Put `Closes #2795` in the PR body.
> 1. Branch off a clean `main`: `onboard/bbh3-hareline-20261115`.
> 2. **Source-add only.** The kennel `bbh3` and its Harrier Central source are already in `prisma/seed-data/`
>    (`kennels.ts:7221`, `sources.ts:9618`). Do **not** touch the kennel row or re-create it. Add one new
>    `Source` row (see **Ready-to-paste seed**) and one small bespoke adapter (see **Adapter notes**).
> 3. Register the adapter in `src/adapters/registry.ts` with an `onHost("hashcruise2020.simplesite.com", { path: "/313623591" })`
>    route (never a substring regex). Mirror `src/adapters/html-scraper/warwick-hash.ts` /
>    `tamar-valley-h3.ts` for the shape.
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`: call
>    `adapter.fetch(source, { days: source.scrapeDays })` from a throwaway `npx tsx -e '…'` snippet. Expect
>    14 events, `2026-11-29` → `2027-12-26`, all Sundays. **DO NOT run `npx prisma db seed` here.**
> 5. No historical backfill (the page has none; Harrier Central already holds runs #74–#105).
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit, open the PR (metadata, live-verification output, deep-dive checklist in the body).
> 8. **Post-merge runbook (separate step, after merge):**
>    - `git checkout main && git pull`; `git log -1 -- src/adapters/registry.ts prisma/seed-data/sources.ts` and the
>      new adapter + test files, to confirm squash-merge dropped nothing.
>    - Targeted prod config only, **not** a full seed unless nothing else is pending (`npx prisma db seed` is additive;
>      it inserts the new source).
>    - Trigger a scrape of the new source (`POST /api/cron/scrape/{sourceId}`) and spot-check
>      `https://www.hashtracks.xyz/kennels/barbados-bike-h3`: Upcoming tab should show 14 runs.
>    - Comment the PR link on #2795 (the issue closes via `Closes #2795`).

## Summary
- Type: **source-add** (existing kennel `bbh3`, existing HC source; add a low-trust forward-hareline source)
- Adapter: `HTML_SCRAPER` — **NEW small bespoke adapter** (NOT config-only; `GenericHtmlAdapter` can't do the
  `#N` prefix + yearless `Weekday Month D - Hares` line + Dec→Jan year roll)
- Effort estimate: **new ~100–140 LoC adapter + ~80–120 LoC test**, one `registry.ts` line, one `sources.ts` row
- One-line: HashTracks shows **0 upcoming** runs for the Barbados bike hash; the kennel's own page publishes a
  14-run forward hareline (2026-11-29 → 2027-12-26) and Harrier Central carries none of it.

## 🔴 The issue's run-number mapping is wrong — read before writing the adapter
Issue #2795 says `#106` = Sunday November 29. The raw markup says otherwise. **Each `#N` sits at the START of the
same line as the date it labels**, and the first line has no number:

```html
<p class="textnormal" style="text-align: left; line-height: 1.26;">Sunday November 29 (60th Independence Ride)</p>
<p class="textnormal" style="text-align: left; line-height: 1.26;">#106 Sunday December 20 - Slow Poke</p>
<p class="textnormal" style="text-align: left; line-height: 1.26;">#107 Sunday January 31</p>
…
<p class="textnormal" style="text-align: left; line-height: 1.26;">#118 Sunday December 26 - Slow Poke</p>
```

(The issue was built from `innerText`, where the `#106` token lands visually after the Nov 29 line.) There are
**14 date rows and 13 run numbers**, so one row is unnumbered. The reading that keeps every number on its own line is
"Nov 29 is an unnumbered special; #106 = Dec 20 … #118 = Dec 26 2027." That also matches the 13 monthly runs Dec 2026 →
Dec 2027. The alternative ("Nov 29 is really #106 because #105 ran 2026-10-25 and the cadence is monthly") would put
a number on Dec 26 2027 that the page does not print. **The page is ambiguous, so do not trust either.**

**Decision for this handoff: the adapter must NOT emit `runNumber`.** Leave it `undefined`, let `merge.ts`
synthesize the title, and let Harrier Central supply the real run number when the kennel posts each run (HC is
trust 8 and matches by kennel + date). A wrong `#106` on the Dec 20 card is worse than no number. Record the
ambiguity in a code comment. If John later confirms the numbering, a one-line `runNumber` capture can be added.

## Dedup result
- Kennel in seed: **yes** — `prisma/seed-data/kennels.ts:7221` (`bbh3`, "Barbados Bike H3", region Bridgetown)
- Source in seed: HC row exists (`sources.ts:9618`, `publicKennelId 1651097d-3b01-46af-9008-e641e9d4d4b4`);
  **no** source for `hashcruise2020.simplesite.com` (`grep -rl hashcruise2020 prisma/seed-data` hits only `kennels.ts`
  as the kennel `website`, plus a WS6 migration — no Source row).
- Live dedup: kennel is **live** at `https://www.hashtracks.xyz/kennels/barbados-bike-h3` (page fetched 2026-11-15,
  RSC payload carries runs #74, #75, #76, #77, #81, #100, #105; latest `#105` on `2026-10-25`, `startTime 06:00`).
- Handed-off check: `ls handoffs/*-bbh3*` → only `2026-10-26-bbh3.md` (the original full onboard, HC). This is a
  different deliverable (new forward-hareline source). `gh pr list --state all --search bbh3` → no HTML-source PR.
- Pre-onboarding admin-event check: not applicable (kennel is live and scraped from HC; no admin-seeded rows noted).
- Decision: **source-add**. kennelCode `bbh3` (unchanged; no new code, no alias collisions to check).

## Live source verification ✅ (curl, 2026-11-15)
- Source: `HTML_SCRAPER` — `https://hashcruise2020.simplesite.com/313623591`
  (HTTP/2 200, `content-type: text/html`, `last-modified: Mon, 02 Nov 2026 13:24:22 GMT`, 46,282 bytes, plain `curl`,
  no UA tricks needed; response carries `vary: x-is-ai-bot` — see Implementation gotchas).
- DNS: `dig +noall +comments hashcruise2020.simplesite.com` → `status: NOERROR`.
- Events seen: **14** forward rows, `2026-11-29` → `2027-12-26`. All 14 are Sundays (computed weekday check done).
- Page footer: `Edited: 2026-11-02`.
- **"0 upcoming" claim for the current source, with evidence:** Harrier Central
  `GET https://hashruns.org/api/global-runs?isFuture=1&pageSize=300` → `{"totalMatchingEvents":235,"runs":[…235 rows…]}`
  and the serialized body contains **0** occurrences of `1651097d` and **0** of `BBH3`. HashTracks' kennel page shows
  `#105` (2026-10-25) as the newest event. So the audit's claim holds.
- Source-count parity: the page is the only forward list; 14 rows seen, 14 expected. N/A for platform UI count.
- Sample rows **verbatim** (HTML text of each `<p class="textnormal">`):
  1. `Sunday November 29 (60th Independence Ride)` — no run number, no hare
  2. `#106 Sunday December 20 - Slow Poke`
  3. `#107 Sunday January 31` — no hare
  4. `#108 Sunday February 28 - Hightower`
  5. `#111 Sunday May 30 - Neil &amp; John` (decode entity → `Neil & John`)
  6. `#118 Sunday December 26 - Slow Poke`
  Full list: #109 Mar 28 Gonzalo · #110 Apr 25 Pitbull · #112 Jun 27 · #113 Jul 25 Slow Poke · #114 Aug 29 ·
  #115 Sep 26 · #116 Oct 31 Hightower · #117 Nov 28 Buggy Magoo.
- Heading above the list: `<h3 class="textheading3 …">BBH3 (BASH) 2026 - 2027</h3>`. Dates carry **no year**;
  take the first year from this heading and roll to the next year when the month decreases (Dec → Jan). Do not
  hardcode 2026.
- History depth: **single page, forward only.** No past runs on this page. Past runs already come from HC (#74–#105 in
  prod, back to 2023-09-24). The nav lists other pages ("Planned Cruises 2026-2028", Interhash pre/post-lubes) —
  those are unrelated hash-cruise pages, not BBH3 runs; do not scrape them.
- Coord sanity: N/A (no coordinates, no venue). End times: none. Multi-day: none.
- Notes: SSR static HTML, "one.com / simplesite" site-builder markup. No JS rendering needed; no browserRender.
- **Field-fill assertion table:**

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 1 / 14 | parenthetical only on Nov 29 → `title: "60th Independence Ride"`; else leave `undefined` (merge synthesizes) |
  | `startTime` | 0 / 14 | not on page. Leave `undefined`; ⚠️ confirm whether merge falls back to the kennel schedule time. If not, set source `config.defaultStartTime: "06:00"` (HC shows every run Sun 06:00, one 06:30) |
  | `endTime` | 0 / 14 | not in source |
  | `location` | 0 / 14 | not in source; leave undefined (HC supplies venue once posted) |
  | `locationStreet` / `locationUrl` | 0 / 14 | not in source |
  | `hares` | 10 / 14 | text after ` - ` (Nov 29, Jan 31, Jun 27, Aug 29, Sep 26 have none). Split on ` & ` NOT needed: keep `Neil & John` verbatim |
  | `cost` | 0 / 14 | not in source |
  | `description` | 0 / 14 | page note "Helmets are mandatory. BASH decals." is page-level, not per-run — leave out |
  | `trailLengthText` | 0 / 14 | not in source |
  | `coords` | 0 / 14 | not in source |
  | `runNumber` | 13 / 14 printed, **deliberately not emitted** | see the red box above |

## Kennel metadata (deep-dive complete — source-add, no kennel edits needed)
The kennel seed row already carries the profile (logo, founded 2016, parent `barbados-h3`, FB group, schedule,
description), each cited in its own comments (Half-Mind #765, HC). **No kennel field changes in this PR.**
- Sibling sweep: the same page/site is the BBH3 page only (`/313623591`). The site (`hashcruise2020.simplesite.com`)
  hosts other "Hash Cruises" pages; none is an H3 kennel hareline. No siblings to add.
- Schedule note for context only: Half-Mind #765 says "last Sunday of each month". The 14 rows follow it except
  Dec 20 2026 (the seed row already documents the pre-Christmas exception). The adapter must not enforce it.

## Historical backfill
- Available: **none on this source.** HC already holds #74–#105 (prod). Not worth a script.
- `config.upcomingOnly: true` **required** (the list drops past rows when the owner edits it; without it
  `reconcile.ts` would cancel aged-off rows).

## Ready-to-paste seed
```ts
// kennels.ts — NO CHANGE (bbh3 already seeded).
// aliases.ts — NO CHANGE ("bbh3" already has aliases, aliases.ts:791).

// sources.ts — add next to the existing "Barbados Bike H3 Harrier Central" row (sources.ts:9618).
{
  name: "Barbados Bike H3 Hareline (website)",
  url: "https://hashcruise2020.simplesite.com/313623591",
  type: "HTML_SCRAPER" as const,
  trustLevel: 5,            // below HC (8): HC wins venue/time/run number once a run is posted there
  scrapeFreq: "daily",
  scrapeDays: 400,          // the list reaches 13 months ahead (2027-12-26)
  config: {
    upcomingOnly: true,
    // defaultStartTime: "06:00",   // ONLY if merge does not fall back to the kennel schedule time (see table)
  },
  kennelCodes: ["bbh3"],
}
```

## Adapter notes / new-scraper plan
Create `src/adapters/html-scraper/barbados-bike-hash.ts` (+ `.test.ts`). Model on `warwick-hash.ts` /
`tamar-valley-h3.ts` (single-page static HTML, yearless dates, closest-year logic) and `kaohsiung` for the
**per-row** fail-loud pattern.

Parse plan (illustrative, not authoritative):
1. `safeFetch` (not raw `fetch`) the page; load with cheerio.
2. Read the year anchor from the `<h3>` whose text matches the loose `\b(20\d\d)\b` (first year in `BBH3 (BASH) 2026 - 2027`).
   If no anchor → push an error.
3. Select `p.textnormal`, `.text()`, replace ` `, collapse whitespace, skip empties.
4. For each line, tokenize by whitespace: optional leading `#\d+` token (**read but do not emit**), weekday word
   (must be `Sunday`), month word, day number. Use a **word-token `Map.get()` month lookup**, not a 12-way regex
   alternation (Sonar S5843). Remainder: ` - <hares>` after the first ` - ` ; a `( … )` group becomes `title`.
5. Year roll: start at the anchor year; when this row's month is **less** than the previous row's month, year += 1.
6. **Per-row validate**: build `Date.UTC(y, m-1, d, 12)`, reject if `getUTCDate() !== d` or the computed weekday is not
   Sunday. A mismatch means the owner mistyped or the roll is wrong → `console.warn` + skip that row + push an error
   (fail-loud PER ROW, as in the Kaohsiung SHIPPED notes).
7. **Page-level fail-loud**: if zero rows parse, push an error so reconcile is suppressed (single-page adapter).
8. Emit `{ date: "YYYY-MM-DD", kennelTags: ["bbh3"], hares, title?, startTime: undefined }`. UTC-noon dates only.
9. `options.days`: filter through `buildDateWindow(options?.days ?? 400)` — do not ignore it.
10. Honor `title` rule: only the Nov 29 parenthetical is a real theme. Other rows leave `title` undefined.

Test fixture: use the **verbatim** `<p class="textnormal" …>` lines above inside the real wrapper
(`div.styles_contentContainer__… > p.textnormal`), including the `Neil &amp; John` entity and the `<p><br></p>`
empties at both ends. Add cases: Dec→Jan roll, a mistyped weekday row skipped with an error, empty page error.

**⚠️ Claude Code must verify against current types before writing code:**
- `RawEventData` field names — `kennelTags: string[]` (not `kennelTag`); `hares`, `title`, `startTime`.
- `safeFetch` from `@/adapters/safe-fetch`; helpers from `@/adapters/utils` (`buildDateWindow`, etc.).
- `ScrapeResult.pagination.kennelPagesStopReason` — do **not** set it (no pagination).
- Confirm in `merge.ts` that an event with `runNumber` undefined and `title` undefined synthesizes
  `"Barbados Bike H3 Trail"` cleanly, and what the existing HC rows do (`defaultTitle: "Barbados Bike H3"` in the HC
  config). The two sources must not produce a duplicate canonical for the same date (merge dedups on kennel + date).
- Confirm `friendlyKennelName("Barbados Bike H3", "Barbados Bike H3")` is sane (shortName > 4 chars, so it passes through).

## Deep-dive checklist
- [x] logo / foundedYear / socials / schedule / hashCash / description — already in kennel seed, unchanged
- [x] source live-verified (curl 200, raw markup captured, weekday check on all 14 dates)
- [x] history depth assessed (none on this page; HC holds history)
- [x] coord sanity (none)  [x] end times (none)  [x] kennelCode `bbh3` unchanged  [x] `kennelCodes: ["bbh3"]` set
- [ ] `startTime` fallback — Claude Code must confirm (table above)
- [ ] run-number numbering — **ambiguous in the source**, deliberately not emitted

## Implementation gotchas (for Claude Code — repo knowledge)
- `config.upcomingOnly: true` is required (list is rolling/edited in place).
- **Vary: x-is-ai-bot** — the CDN varies on an AI-bot header. A normal `safeFetch` UA returned the full page here;
  if prod scrapes get a stripped body, the per-page zero-row error will fire (that's the intent) — try a browser-like
  UA before reaching for `browserRender`.
- One page, no pagination: write an explicit `rows.length === 0` error so a markup change surfaces as a failed scrape
  rather than a quiet empty SUCCESS (reconcile would otherwise cancel the 14 future events).
- Sonar: `Number.parseInt(s, 10)`; no negated ternaries; keep regexes simple (tokenize, don't alternate months).
- http→https: the source URL is https, no S5332 hotspot expected.
- Self-checks: no `$$`/doubled currency applies (no cost field).

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
