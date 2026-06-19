# Onboarding Handoff — Himalayan H3 (Kathmandu, Nepal) — 2026-06-18

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/himalayan-h3-20260618`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the **Nepal COUNTRY +
>    Kathmandu METRO** region records — this is a **new country**, so do all **5 `region.ts` edits**
>    in the checklist under **Adapter notes → Region**.
> 3. Implement the **NEW `HimalayanH3Adapter`** exactly as in **Adapter notes** (small Cheerio table
>    scraper — this is NOT config-only).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` — call
>    `adapter.fetch(source)` via a throwaway `npx tsx -e '…'` snippet. Resolve every `⚠️ Claude Code
>    must confirm` item in **Live source verification**. Validate: events non-empty + at least the two
>    upcoming runs, dates UTC-noon, `startTime` `"15:00"`, `kennelTag` resolves with no unmatched.
>    **DO NOT run `npx prisma db seed` here** — seeding + prod scrape is the post-merge step (8 below).
> 5. **No historical backfill** (none available — see **Historical backfill**). Skip.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive checklist.
>    Follow `docs/source-onboarding-playbook.md` throughout.
> 8. **Post-merge runbook (separate step, after the PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (`git log -1 -- <path>` for the adapter, the seed
>      files, region.ts, the logo). Squash-merge sometimes drops a follow-up commit.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive)
>    - Trigger a scrape from `/admin/sources` to publish events to prod
>    - Spot-check `hashtracks.xyz/kennels/himalayan-h3` for the expected runs + sample dates.
> Everything you need is in the sections that follow.

## Summary
- Type: **full onboard** (kennel + alias + source; new country Nepal)
- Adapter: **HTML_SCRAPER** (**NEW `HimalayanH3Adapter`** — config-only is NOT possible: year-less
  dates + What3Words/Maps-link extraction + table-then-detail-block merge)
- Effort estimate: **new ~150–220 LoC Cheerio adapter + tests** (mirror `bangkok-monday-hash.ts` /
  `kaohsiung-hash.ts`; table parse + single next-run detail-block merge) + **5 `region.ts` edits** (new
  country) + self-hosted logo.
- One-line: **HashTracks' first Nepal kennel** — Kathmandu's "Himalayan Hash House Harriers" (HHHH/H4,
  est. 1979, "Nepal's only hash"), weekly Saturday 15:00, current run #2521, live WordPress
  "Receding Hareline" table.

## Dedup result
- Kennel in seed: **no** (`grep -in "himalaya\|nepal\|kathmandu" prisma/seed-data/*.ts` → none)
- Source in seed: **no**
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP
  (Personal Chrome on MacMini), **446 kennel slugs**, zero hits for `himalaya|kathmandu|nepal|hh3`.
- Decision: **full onboard**
- kennelCode: **`himalayan-h3`** (collision check: `"himalayan-h3"` and `"hh3"` both **clear** in
  `kennels.ts`/`aliases.ts`. Chose the descriptive city/name form over bare `hh3` per the new-country
  convention — manila-h3 / warsaw-h3 / seoul-h3 / asuncion-h3.) **slug = `toSlug("Himalayan H3")` =
  `himalayan-h3`** (ASCII-clean — no `slug:` pin strictly needed; pinned defensively in the seed below).

## Live source verification  ✅ (HTML listing verified from sandbox via web_fetch)
- Source: **HTML_SCRAPER** — `https://himalayanhash.run/` (home page, SSR "Receding Hareline" `<table>`).
  - **DNS check (non-platform domain — MANDATORY):** `dns.google/resolve?name=himalayanhash.run&type=A`
    → **Status 0 (OK)**, A record `191.96.244.235`. Domain exists. ✅
  - `meta-generator: WordPress 6.5.8`; page `modified 2026-06-13T06:14:15+00:00` (fresh).
  - SSR confirmed: the table is present in raw HTML (web_fetch does NOT run JS) → **static Cheerio, no
    browserRender**.
- Events seen: **3 rows** in the Receding Hareline (1 just-past + **2 upcoming**), weekly Saturday.
- **Source-count parity:** N/A — this is a rolling 3-row "receding hareline" (current + next ~2), not a
  paginated feed. Applied the Step 3 *recently-active* evidence rule: the table is fresh (modified
  2026-06-13), the kennel runs weekly, and **2 upcoming runs are present** → live. (Run #2521 on
  13 June 2026 lines up with the ECS-Nepal-documented run #1506 on 15 Sep 2007: 1015 runs over ~18.75
  yr ≈ weekly. Cadence sane.)
- Sample events (**VERBATIM** from the live table — today is 2026-06-18 Thu, so #2521/13 Jun is last
  Saturday = just-past; #2522 & #2523 are upcoming):
  1. **Run 2521** — 13th June — 1500 Hrs — On-In: **Chobhar / Adinath School** — Hares: **Call Boy** —
     What3Words: **shed.code.squirted** (`http://w3w.co/shed.code.squirted`) — + detail block "HASH 2521"
     with a Google Map link `https://maps.app.goo.gl/7RzxmvHsTLVr3jTE8` and turn-by-turn directions prose.
  2. **Run 2522** — 20th June — 1500 Hrs — On-In: **Undecided** — Hares: **Needed** — What3Words:
     **Check.Back.Later** (all placeholders).
  3. **Run 2523** — 27th June — 1500 Hrs — On-In: **Undecided** — Hares: **Needed** — What3Words:
     **Check.Back.Later** (all placeholders).
  - 🔴 **No event "theme" titles and the run id is `Run NNNN` (not `#NNNN`).** Leave `title` undefined →
    `merge.ts` synthesizes `"Himalayan H3 Trail #N"` (`shortName "Himalayan H3"` is >4 chars →
    `friendlyKennelName` short-circuits cleanly; confirm at build with the one-liner in gotchas).
- History depth / pagination: **single rolling table, no pagination.** Probed the WordPress REST API
  (`/wp-json/wp/v2/posts?per_page=100`) → **exactly ONE post total** (`Run 2052`, published 2017-08-17 —
  an old turn-by-turn "run directions" page, category 43). The per-run WP post archive was abandoned
  ~2017. ⚠️ Claude Code may optionally probe the home page's `#hash-archives` anchor (it showed a
  `Loading…` spinner → possibly an AJAX/admin-ajax archive) at build, but **do not block on it** — treat
  as no backfill (below).
- Coord sanity: **no decimal lat/lng anywhere.** Per-run location is **What3Words** text (e.g.
  `shed.code.squirted`) + (for the current run only) a `maps.app.goo.gl` shortlink. No default-pin trap.
  Leave `latitude`/`longitude` undefined → merge geocodes the venue text / falls back to the Kathmandu
  centroid. (Optional: resolve w3w → lat/lng via the What3Words API at build; out of scope, no key.)
- End times: **none** (table has start time only).
- Notes: Avada/Fusion WordPress theme; the table is markdown-ish HTML. **⚠️ Claude Code must capture the
  verbatim `<table>` DOM** via `curl -s https://himalayanhash.run/ | …` and build the test fixture from
  it (web_fetch rendered it as a markdown table; the real DOM is a Fusion `fusion-text` block wrapping a
  `<table>` — confirm cell structure before finalizing selectors).
- **Field-fill assertion table** (from the 3 sampled rows):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 3 | leave undefined → merge synthesizes `"Himalayan H3 Trail #N"` |
  | `runNumber` | 3 / 3 | `Run (\d+)` from col 1 (NOT `extractHashRunNumber` — no `#`) |
  | `startTime` | 3 / 3 | `"15:00"` from `1500 Hrs` (`/(\d{1,2})(\d{2})\s*Hrs/i`) |
  | `endTime` | 0 / 3 | not in source — accept absence |
  | `location` (venue) | 1 / 3 | col 4 "On-In"; `Undecided`/blank → undefined (don't synth) |
  | `locationStreet` | 0 / 3 | not in feed |
  | `locationUrl` (Maps) | 1 / 3 | `maps.app.goo.gl` from the `HASH NNNN` detail block (current run only); else the `w3w.co/<addr>` link |
  | `hares` | 1 / 3 | col 5; `Needed`/`TBA`/blank → **`null`** (placeholder, explicit clear) |
  | `cost` | 0 / 3 | kennel default `hashCash` (per-event override only) |
  | `description` | 1 / 3 | directions prose from the `HASH NNNN` detail block (current run only) |
  | `trailLengthText` | 0 / 3 | not in feed |
  | `coords` (lat/lng) | 0 / 3 | none — leave undefined; merge geocodes venue / Kathmandu centroid |
  | `what3words` | 1 / 3 | col 6; store in `locationUrl` (`w3w.co/<addr>`) or description; `Check.Back.Later`/blank → undefined |

## Kennel metadata (deep-dive complete)
- **fullName:** Himalayan Hash House Harriers — **shortName:** Himalayan H3 — **region:** Kathmandu —
  **country:** Nepal
- **aliases:** `["Himalayan H3", "Himalayan Hash", "Himalayan Hash House Harriers", "Kathmandu Hash", "HHHH Nepal"]`
  - 🔴 **Bare `"HHHH"` OMITTED** — already an alias of `h6` (Hollyweird H6), `aliases.ts:185`. Used qualified `"HHHH Nepal"`.
  - 🔴 **Bare `"H4"` OMITTED** — collides with kennelCode `h4` (Hangover H3) AND aliases on `hockessin`/`h4`/`h4-tx`. kennel-resolution does kennelCode-exact-match first, so a bare `H4` would mis-route to Hangover.
- **website:** `https://himalayanhash.run/` (source: live, DNS-verified)
- **facebook:** `https://www.facebook.com/groups/337430216422725/` ("Himalayan Hash House Harriers" group; source: web search). ⚠️ The kennel-site footer instead links a page `https://www.facebook.com/Shivapuri.Kathmandu/` — list the group as primary; Claude Code may swap if the page is clearly the official one.
- **instagram / twitter / discord:** none found — leave blank.
- **schedule:** **Saturday**, **15:00** (`1500 Hrs`), **Weekly** (source: live table cadence 13/20/27 Jun all Saturdays; ECS Nepal feature "meets every Saturday … in the afternoon … at 3 pm").
  - 🔴 `Kennel.scheduleTime` = **`"3:00 PM"`** (12-hour — every value in `kennels.ts` is 12-hour). The adapter's `RawEventData.startTime` is 24-hour **`"15:00"`**. Different fields, different formats (sh3-kr / Warsaw retro).
  - Single weekly pattern → flat `scheduleDayOfWeek`/`scheduleTime` is sufficient; **no `scheduleRules` needed** (no seasonal split, no multi-cadence). Add the fallback comment per convention.
- **foundedYear:** **1979** (source: ECS Nepal feature "Run Wild, Run Free", Jul 2010, Issue 71 — *"Here in Kathmandu, the club started in 1979."*; corroborated by web search + the kennel's own "1500 Glorious Himalayan Hash House Harrier Hashes" video series, run #1500 ≈ 2007). Medium-high confidence (secondary editorial; kennel site states no year on the home page).
- **hashCash:** **`"NPR 250 (beer drinkers) / NPR 100 (soft drinkers)"`** (source: ECS Nepal 2010 feature — *"beer drinkers paying a fee of Rs 250/- and soft drinkers Rs 100/-"*). ⚠️ 2010 figure — flag as possibly dated; current site doesn't publish a fee.
- **dogFriendly:** **true** (source: ECS Nepal — *"babies, dogs and children come along on the hash runs"*). Medium confidence.
- **walkersWelcome:** **true** (source: ECS Nepal — *"You have the option of running or walking on the Himalayan Hash"*). High confidence.
- **logoUrl:** `http://himalayanhash.run/wp-content/uploads/2017/08/trans_logo1.png` (the `og:image`; a
  **stable** wp-content path, not tokenized). ⚠️ **Self-host** to `public/kennel-logos/himalayan-h3.<ext>`
  per convention (it's `http`-only + a transparent variant). **Confirm the real extension by magic
  bytes** (`\x89PNG` = PNG), do NOT pre-fill `.png`. (Two other variants exist: `trans_logo2.png`,
  `mobile-logo.png` — pick the cleanest.)
- **description:** `"Nepal's original (and, per local press, only) hash — 'a drinking club with a running problem' founded in Kathmandu in 1979. The Himalayan Hash House Harriers (HHHH / H4) run every Saturday afternoon at outlying venues around the Kathmandu Valley, walkers and dogs welcome, with the classic shredded-paper trail and on-in circle."`
- **lat/lng:** Kathmandu centroid **27.7172, 85.324** (kennel-level; per-run venues vary, no per-run coords).

## Historical backfill
- Available: **none** — the WordPress REST API exposes **1 post total** (`Run 2052`, 2017); per-run
  "run directions" posting was abandoned ~2017. No `<table>` archive, no Sheet, no clean machine-readable
  past-run collection. Run #2521 implies ~2500 lifetime runs but the source publishes none of them
  structurally.
- Plan: **none.** (Optional, non-blocking: Claude Code may probe the home page `#hash-archives` AJAX
  section at build — if it returns structured rows with dates, a one-shot `scripts/backfill-himalayan-h3-history.ts`
  could be added; otherwise skip.) Set `config.upcomingOnly: true` regardless (the table is rolling).

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Mirror the manila-h3 inline shape.
{
  kennelCode: "himalayan-h3", shortName: "Himalayan H3", fullName: "Himalayan Hash House Harriers",
  slug: "himalayan-h3",
  region: "Kathmandu", country: "Nepal",
  website: "https://himalayanhash.run/",
  facebookUrl: "https://www.facebook.com/groups/337430216422725/",
  scheduleDayOfWeek: "Saturday",
  // scheduleDayOfWeek/scheduleTime kept as fallback; no scheduleRules needed (single weekly pattern).
  scheduleTime: "3:00 PM",   // 🔴 12-hr here; adapter RawEventData.startTime is 24-hr "15:00".
  scheduleFrequency: "Weekly",
  foundedYear: 1979,
  hashCash: "NPR 250 (beer drinkers) / NPR 100 (soft drinkers)",
  dogFriendly: true,
  walkersWelcome: true,
  logoUrl: "/kennel-logos/himalayan-h3.<ext>",   // self-host; confirm ext by magic bytes
  latitude: 27.7172, longitude: 85.324,
  description:
    "Nepal's original (and, per local press, only) hash — 'a drinking club with a running problem' " +
    "founded in Kathmandu in 1979. The Himalayan Hash House Harriers (HHHH / H4) run every Saturday " +
    "afternoon at outlying venues around the Kathmandu Valley, walkers and dogs welcome.",
},

// aliases.ts — Record<string, string[]>  (keyed by kennelCode, NOT slug). Shape confirmed via head.
"himalayan-h3": ["Himalayan H3", "Himalayan Hash", "Himalayan Hash House Harriers", "Kathmandu Hash", "HHHH Nepal"],
// ❌ bare "HHHH" omitted (→ h6 Hollyweird) · bare "H4" omitted (→ h4 Hangover kennelCode + others)

// sources.ts — Source[] (array of objects). Mirror the Manila H3 Website row.
{
  name: "Himalayan H3 Website",
  url: "https://himalayanhash.run/",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 90,
  config: { upcomingOnly: true },
  kennelCodes: ["himalayan-h3"],
},
```

## Adapter notes / new-scraper plan

**NEW `HimalayanH3Adapter`** (`src/adapters/html-scraper/himalayan-h3.ts`) — static Cheerio. NOT
config-only (year-less dates + w3w/Maps extraction + table⊕detail-block merge; `GenericHtmlAdapter`
can't split a 6-field row + merge a sibling detail block). **Reference adapters:**
`src/adapters/html-scraper/bangkok-monday-hash.ts` (forward table + next-run-block merge + year
inference) and `kaohsiung-hash.ts` (simple forward rollover + per-run fail-loud); `dublin-hash.ts` for
plain table iteration.

**Parsing plan (shape — illustrative, verify field names against current types):**
1. **Fetch** `https://himalayanhash.run/` via `fetchHTMLPage` (static SSR). `cheerio.load(html)`.
2. **Find the Receding Hareline table.** Locate the `<table>` under the "Receding Hareline" heading
   (header cells: `Hash#`, `Date`, `Time`, `On-In`, `Hares`, `What3Words`). Iterate `tr`, skip the
   header row. ⚠️ **Capture the verbatim DOM first** (web_fetch showed a markdown table; build the
   fixture from the real Fusion `<table>` markup).
3. **Per row → 6 cells:**
   - **Run#:** `Run (\d+)` → integer `runNumber` (NOT `extractHashRunNumber` — keys on `#`).
   - **Date:** year-less `13th June` → strip ordinal (`/(\d)(?:st|nd|rd|th)\b/→$1`), parse `D Month`
     via a `Map`-based month lookup (NOT a month-name alternation — S5843), **infer year today-anchored
     with a small forward window**: `year = currentYear; if (candidate > ~60d in the past) year += 1`
     (handles Dec→Jan; the table is current-week-forward so the just-past current run stays this year).
     Only ~3 near-term rows → no Bangkok-style bidirectional rule needed. Store **UTC noon**.
   - **Time:** `1500 Hrs` → `"15:00"` (`/(\d{1,2})(\d{2})\s*Hrs/i`). `startTime`.
   - **On-In (venue):** cell text (`Chobhar / Adinath School`). `Undecided`/empty/`TBA` → `undefined`.
   - **Hares:** cell text (`Call Boy`). `Needed`/`TBA`/empty → **`null`** (explicit clear, NOT
     `undefined` — #2032 tri-state; see gotchas).
   - **What3Words:** cell `<a href>` → `w3w.co/<addr>` (or text). `Check.Back.Later`/empty → undefined.
     Store the `w3w.co/<addr>` URL in `locationUrl` (fallback when no Maps link).
4. **Detail-block merge (current run only).** Below the table, the `HASH NNNN` heading + `Click here for
   GOOGLE MAP` (`maps.app.goo.gl/…`) + directions prose belong to the run whose number matches. Match by
   run number; attach the `maps.app.goo.gl` link as `locationUrl` (preferred over w3w) and the directions
   prose as `description`.
5. **Emit** `RawEventData`: `kennelTags: ["himalayan-h3"]`, `runNumber`, `date` (UTC noon),
   `startTime: "15:00"`, `location`, `hares`, `locationUrl`, `description` (current run only). Leave
   `title` undefined.
6. **`config.upcomingOnly: true`** (rolling table) + **fail-loud `rows.length === 0` guard** (single
   surface, brand-new source baseline 0): if no data rows parse, push an `errors[]` entry so
   `reconcile.ts` is suppressed.
7. **Register** in `src/adapters/registry.ts` `htmlScrapersByUrl` keyed on `himalayanhash.run`.

### Region — Nepal is a NEW COUNTRY → all 5 `region.ts` edits (mirror the Poland/Warsaw precedent)

Poland was added in PR #2234 as a 2-level COUNTRY→METRO country with no `seed.ts stateMetroLinks` — Nepal
mirrors it exactly (palette aside).

1. **`REGION_SEED_DATA`** (after an existing country block):
   ```ts
   // ── Nepal ──
   {
     name: "Nepal", country: "Nepal", level: "COUNTRY",
     timezone: "Asia/Kathmandu", abbrev: "NP",
     colorClasses: "bg-violet-200 text-violet-800", pinColor: "#7c3aed",
     centroidLat: 28.39, centroidLng: 84.12,
     aliases: ["NP", "नेपाल"],
   },
   {
     name: "Kathmandu", country: "Nepal",
     timezone: "Asia/Kathmandu", abbrev: "KTM",
     colorClasses: "bg-violet-100 text-violet-700", pinColor: "#8b5cf6",
     centroidLat: 27.7172, centroidLng: 85.324,
     aliases: ["Kathmandu, Nepal", "Kathmandu Valley"],
   },
   ```
   (🔴 No trailing-zero literals — Sonar S6749 — `85.324` not `85.3240`. ⚠️ Confirm **violet** isn't a
   confusing pin clash with an adjacent mapped region; it's used 3× elsewhere but none adjacent to Nepal.
   Country = `-200`/darker pin, Metro = `-100`/lighter pin, per the ZH3 shade convention.)
2. **`STATE_GROUP_MAP`:** `"Kathmandu": "Nepal",`
3. **`COUNTRY_GROUP_MAP`:** `"Nepal": "Nepal",` (+ the "metro resolves via STATE_GROUP_MAP first" comment, mirroring the Poland/Hungary entries).
4. **`COUNTRY_CODE_TO_NAME`:** `NP: "Nepal",`
5. **`COUNTRY_INFERENCE_RULES`:** `[/\b(nepal|kathmandu|pokhara)\b/, "Nepal"],` — unambiguous tokens only
   (country + the two main Nepali cities; no bare ambiguous token). Without this, `inferCountry()` returns
   `"USA"` for Nepali text (the rule that bit ONH3 in CI).

**⚠️ Claude Code: verify before writing real code.** Any code snippet above is illustrative; the live repo
is authority. Before writing the adapter confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); kennel walker field is
  `walkersWelcome` (NOT `walkerFriendly`). Check `prisma/schema.prisma` for canonical names.
- Imports — `safeFetch`/`fetchHTMLPage` from `@/adapters/...` (NOT raw `fetch`); date/extract helpers
  (`chronoParseDate`, `stripPlaceholder`) from `@/adapters/utils`.
- `title` — leave `undefined`; `merge.ts` synthesizes `"Himalayan H3 Trail #N"`. Verify the synth:
  `npx tsx -e 'import {friendlyKennelName} from "./src/pipeline/merge"; console.log(friendlyKennelName("Himalayan H3","Himalayan Hash House Harriers"));'`
  (shortName is 12 chars → should short-circuit to "Himalayan H3" cleanly).
- `kennelPagesStopReason` — set ONLY on genuine truncation; leave null on a clean parse.

## Deep-dive checklist (nothing deferred)
- [x] logo (stable wp-content URL; flag self-host + magic-byte ext)  [x] foundedYear (1979, ECS Nepal)
- [x] socials (FB group + footer page; no IG/X/Discord)  [x] schedule (Sat 15:00 weekly; no scheduleRules)
- [x] hashCash (NPR 250/100, 2010 — flagged dated)  [x] description  [x] source live-verified (DNS + SSR table)
- [x] history depth/pagination assessed (1 WP post; no backfill)  [x] coord sanity (no decimals; w3w/Maps)
- [x] end times noted (none)  [x] kennelCode collision-checked (`himalayan-h3` clear)  [x] kennelCodes guard set
- [x] sibling sweep: **none** — ECS feature calls HHHH "Nepal's only hash"; no Pokhara/other Nepal kennel surfaced.

## Implementation gotchas (for Claude Code — repo knowledge)
- **Hare placeholders → `null`, NOT `undefined`** (#2032 tri-state). `Needed`/`TBA`/blank in the Hares
  cell must emit `hares: null` (explicit clear) so a source correction overwrites a stale hare.
  `stripPlaceholder` from `utils.ts` returns `undefined` for the universal placeholders — map it
  explicitly (see the Warsaw `cleanHare` shape in `source-platform-notes.md` → Mobirise).
- **`config.upcomingOnly: true` is required** — the home table is a rolling 3-row window; without it
  `reconcile.ts` would false-CANCEL runs as they age off.
- **Single-surface adapter → explicit `rows.length === 0` fail-loud guard** (brand-new source has a 0
  baseline the zero-event health alert can't catch).
- **`title` undefined → merge synthesizes** `"Himalayan H3 Trail #N"`; never let the venue/hare/run-id
  string become the title.
- **Sonar:** month parsing = generic `\b[a-z]{3,9}\b` word-token + exact `Map.get()` lookup (NOT a
  month-name alternation — S5843); `Number.parseInt(s, 10)`; `s.replaceAll(...)`; no `\s*` adjacent to
  `.+`/`.*` (S5852); `\d` not `[0-9]`. `Map.get()` not `Record[var]` (Codacy object-injection).
- **`locationUrl` is for genuine map links** — `maps.app.goo.gl` (preferred) or `w3w.co/<addr>` (a real
  location service) are both fine; do not route arbitrary links there (cf. the New Taipei `fb.me` lesson).
- **Self-host the logo** to `public/kennel-logos/himalayan-h3.<ext>`; confirm ext by magic bytes, not the
  URL suffix or Content-Type.
- **http-only origin** → the kennel `website`/source `url`/adapter default base literals will trip Sonar
  S5332; use `https://` in mocked tests, mark the ~3 real production `http://` literals SAFE via the
  SonarCloud REST API if the origin serves no https (verify `https://himalayanhash.run/` at build — it
  did respond on https in research, so prefer https everywhere and this may be moot).

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
