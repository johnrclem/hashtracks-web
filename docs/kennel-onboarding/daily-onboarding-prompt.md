# Daily Kennel Onboarding — Autonomous Research & Handoff Prompt

> **Purpose:** Each morning, take **one new kennel** from the queue, research it exhaustively,
> verify its data source is live, and produce a **complete, self-contained handoff file** that
> Claude Code can execute in one shot to implement and open the PR.
>
> This run merges the entire [`source-onboarding-playbook.md`](../source-onboarding-playbook.md)
> checklist **and** every completeness field the per-kennel deep dive
> (`src/lib/admin/deep-dive-prompt.ts`) normally catches *after the fact* — logo, founded year,
> socials, hash cash, schedule, description, source accuracy, historical backfill. Get it all on
> day one so the kennel never needs audit rework.

## Why handoff, not direct PR

This task runs in a sandboxed environment that **can read the repo and write files, but cannot
reliably perform git operations** (the repo mount is often parked on a feature branch with
uncommitted work, and `.git/` writes are permission-blocked). So this run does **no git** — it
does the research + verification + drafting, and writes a handoff file. **Claude Code**, running
in a local terminal where git works and where the NAS / live DB are reachable, then implements it
end-to-end through PR creation. The handoff file leads with a `▶ FOR CLAUDE CODE` directive so the
whole file is the brief.

**Do not** attempt `git checkout`/`branch`/`commit`/`push` in this run. **Do** write files
(the handoff, queue updates, run log) — plain file writes work fine.

---

## Golden rules

1. **One kennel per run.** Take the single top target from the queue. Do not batch.
2. **Dynamic data only.** Never hand off a kennel whose only source is a static Facebook page,
   Instagram, or flyer. The queue is pre-filtered — but re-confirm the source is live (Step 3).
   If the top target has no working dynamic source, mark it `blocked` and move to the next.
3. **Verify the source is live before writing the handoff.** Fetch the real source and extract a
   sample of real, upcoming events. A handoff built on an unverified source is worthless.
4. **Front-load the deep dive.** Capture logo, founded year, socials, hash cash, schedule,
   description, historical-backfill availability, end-times, coord sanity, pagination depth
   *now* — they go in the handoff.
5. **The handoff must be complete and self-contained.** Claude Code should implement from it
   without re-researching: exact seed blocks, adapter type + config (or scraper plan), collision
   results, verified sample data, an Effort estimate, and the embedded Claude Code directive
   at the top.

---

## Repo & environment

- **Repo path:** `/Users/johnclem/Developer/hashtracks-web` (bash mount: `/sessions/*/mnt/hashtracks-web`).
  Read freely; **write only** to `docs/kennel-onboarding/` (handoff, queue, run log).
- **Node (for any read-only probes):** `eval "$(fnm env)" && fnm use 20` if needed. You will NOT
  run `prisma db seed` or the full pipeline here — that happens in Claude Code.
- **Queue:** [`target-queue.md`](target-queue.md)
- **Handoffs:** `handoffs/<YYYY-MM-DD>-<kennelCode>.md` (create the dir if missing)
- **Run log:** [`run-log.md`](run-log.md)
- **Key references:** [`docs/source-onboarding-playbook.md`](../source-onboarding-playbook.md),
  [`source-platform-notes.md`](source-platform-notes.md) (platform gotchas — consult AND append to),
  [`prisma/seed-data/{kennels,aliases,sources}.ts`](../../prisma/seed-data),
  [`src/adapters/registry.ts`](../../src/adapters/registry.ts),
  [`src/adapters/types.ts`](../../src/adapters/types.ts),
  [`.claude/rules/adapter-patterns.md`](../../.claude/rules/adapter-patterns.md),
  [`.claude/rules/live-verification.md`](../../.claude/rules/live-verification.md)

---

## Step 1 — Pick today's target

Open `target-queue.md`. Take the **top row whose Status is `queued`** (lowest Rank first). If
none are `queued`, jump to **Step 8's refill logic**, refill, then pick the new #1. Mark the
chosen row `in_progress` with today's date. Record shortName, full name, region, proposed source
type + URL.

## Step 2 — Deduplicate against LIVE production data (NOT the seed files)

> ⚠️ **The seed files are NOT the source of truth for what's live.** Kennels get added directly
> to the production DB via the admin UI / "Suggest a Kennel" (`Kennel.isManualEntry`), so the
> live site has *more* kennels than `prisma/seed-data/` (e.g. ~412+ live vs ~349 seeded). A kennel
> can be fully live — page, logo, source, events — yet absent from `seed-data/`. **Always dedup
> against the live production data first.** This is the #1 cause of wasted onboarding work.

**Tooling reality (important):** the prod DB is **not reachable** from this sandbox (Railway host
isn't in the network allowlist — DNS fails). The kennel directory and region pages are
**client-rendered** — a plain fetch returns only a region's *count* ("SG7 / 7 kennels"), **not**
the kennel names. So the authoritative full list comes from the **sitemap via the Chrome MCP**:

- **PRIMARY — read the live sitemap with the Chrome MCP (authoritative, confirmed working).** The
  server-generated `https://www.hashtracks.xyz/sitemap.xml` lists every non-hidden kennel slug
  (the plain fetch tool returns it as binary, so use Chrome). Steps:
  1. `list_connected_browsers` → `select_browser` (the user runs "Personal Chrome on MacMini").
  2. `tabs_context_mcp { createIfEmpty: true }` → `navigate` to `https://www.hashtracks.xyz/sitemap.xml`.
  3. `javascript_tool` to extract the slug list, e.g.:
     ```js
     [...new Set(Array.from(document.body.innerText.matchAll(/https?:\/\/[^\s<]+/g))
       .map(m=>m[0]).filter(u=>/\/kennels\//.test(u)&&!/\/kennels\/region\//.test(u))
       .map(u=>u.split('/kennels/')[1].replace(/[#?].*$/,'').replace(/\/$/,'')).filter(Boolean))].sort()
     ```
  4. Check the candidate against this list by slug AND by scanning for region/name fragments
     (slugs aren't always the obvious kebab — e.g. Singapore Harriets is `sg-harriets`, Miami
     Valley is `mvh3-day`, HK Monday is `hk-h3`). If present ⇒ **already live**.
- **FALLBACK (only if Chrome isn't connected at run time) — per-slug fetch + empty regions.**
  Fetch `https://www.hashtracks.xyz/kennels/<slug>` for 2–3 slug variants; a page rendering the
  kennel name + "Est." + events ⇒ live. And **prefer candidates whose region shows 0 kennels**
  (`/kennels/region/<region-slug>` count) — there, "not live" is unambiguous. A slug miss only
  rules out that one slug, so without the sitemap you cannot safely treat a saturated-region
  candidate as new — skip it until the sitemap can confirm.

**Secondary check — the seed files** (only to see whether a *source* / adapter config already
exists in code for an already-live kennel):

```bash
grep -in "<shortName>\|<domain/calendar-id/slug>" prisma/seed-data/sources.ts prisma/seed-data/kennels.ts
```

Decision matrix:

| Kennel live on the site? | A dynamic source already feeds it? | Action |
|---|---|---|
| No | — | **Full onboard handoff** (kennel + aliases + source). |
| Yes | Yes (events are flowing from an equivalent source) | **Skip.** Mark row `done (already live)`, pick next `queued`. |
| Yes | No / stale / only a static/Facebook source, and you found a real dynamic one | **Source-add handoff** — don't re-create the kennel; add/repoint the `Source`, link via `kennelCodes`, and enrich any missing kennel fields (logo/foundedYear/socials). Note as "source-add". |

Repeat until you land on a kennel that is genuinely **not live**, or a live kennel that's
genuinely **missing this dynamic source**. Only then proceed.

## Step 3 — Verify the dynamic source is LIVE (mandatory before drafting)

Fetch the source directly and **extract a real sample** of upcoming events. Capture the raw
sample for the handoff. Use the right probe (playbook §1):

- **Google Calendar:** `curl "https://www.googleapis.com/calendar/v3/calendars/{id}/events?key=$GOOGLE_CALENDAR_API_KEY&maxResults=5&timeMin=$(date -u +%Y-%m-%dT%H:%M:%SZ)"`
- **iCal:** `curl -s "<ics url>" | head -120` — find upcoming `VEVENT`/`DTSTART`
- **Meetup:** `curl -s "https://api.meetup.com/{group-urlname}/events"` — must list upcoming events
- **WordPress:** `curl -s "<site>/wp-json/wp/v2/posts?per_page=5"` (or The Events Calendar: `/wp-json/tribe/events/v1/events`)
- **WordPress.com hosted:** `curl -s "https://public-api.wordpress.com/wp/v2/sites/<host>/posts?per_page=5"` — see `source-platform-notes.md` → WordPress.com section
- **Squarespace:** see `source-platform-notes.md` → Squarespace section (config-only via existing `SquarespaceEventsAdapter`)
- **HTML:** `curl -s "<url>" | head -200` — locate the event list / structure
- **Wix / Google Sites / SPA:** these need the NAS `browserRender()` service. See `source-platform-notes.md` → Wix section. If `BROWSER_RENDER_URL`/`BROWSER_RENDER_KEY` aren't available, document clearly and flag for Claude Code rather than guessing.

**Consult [`source-platform-notes.md`](source-platform-notes.md)** for platform-specific checks
(Wix, Squarespace, WordPress.com, etc.) before drafting — and **append to it** if you learn
something new about a platform. It exists because confident-but-wrong source plans (e.g.
"config-only iCal" when the export is tenant-gated off) cause real rework.

**Don't claim a feed works until you've checked the *actual* URL the adapter will use.** Many
platforms gate their clean feed behind a toggle. HEAD-check it:
```bash
curl -sI "<feed-url>" | grep -i content-type   # e.g. expect text/calendar for an .ics feed
```
If the content-type is wrong (e.g. `text/html` from an `?format=ical`), the feed is disabled —
pick the working path (often a JSON/API endpoint) and say so. If you can't fetch it from the
sandbox at all, flag `⚠️ Claude Code must confirm` (see verification reality below) — but if you
*can* HEAD it, do.

**When sampling a JSON/API source, also capture (these are detectable now and bite later if missed):**

- **Pagination / true history depth.** Look for a `pagination`/`nextPage`/`offset`/`_links.next`
  field. Page 1 is usually not the whole history. Report total reachable past events + how to
  paginate — the adapter likely needs pagination (with a max-pages guard) from day 1.
- **Default/garbage coordinates (silent corruption).** If events carry lat/lng, check for a
  **default pin repeated across many events** or duplicate `map*`/`marker*` pairs (e.g.
  Squarespace's Manhattan `40.7207559` default). Report "X of N events have unset/default pins" and
  note the adapter must reject those coords **and** emit `dropCachedCoords: true` (clearing a coord
  doesn't unset an already-stored bad one). This is the kind of thing that ships silently and only
  gets caught when a kennel shows up on the wrong continent on the map.
- **End times / multi-day.** If events carry an end timestamp, note it — same-day → `endTime`,
  different-day → multi-day `endDate`. Don't discard it as "acceptable."

**Verification reality (learned from live runs) — don't get stuck here.** In this sandbox,
`web_fetch` renders **HTML pages fine**, but raw machine-readable bodies (`.ics`, `?format=json`,
REST/API) on domains **outside the allowlist** usually fail (HTTP 403 `blocked-by-allowlist`, or
returned as binary), and the Chrome MCP **auto-denies a brand-new domain** when no user is present
to approve it (Chrome works for already-approved domains like `hashtracks.xyz`). So:

- **Prove events exist from the HTML listing** (almost always fetchable) — that's enough to
  confirm the source is live and to capture the sample.
- When the machine-readable feed itself (the `.ics`/JSON/REST URL the adapter will use) can't be
  fetched here, **record its exact URL and flag it `⚠️ Claude Code must confirm at build`** — do
  **not** block or downgrade the handoff over it. Claude Code live-verifies the feed anyway (the
  adapter rejects a bad body loudly).

**Capture for the handoff:** event count seen, date range, and 3–5 sample events with whatever
fields the source exposes (date, time, title, hares, location, description, run number).

**🔴 Fixtures must come from real `curl` output, not speculation.** When the handoff describes the
source page structure, base it on actual `curl -s <url>` output (or `browserRender` output for
JS-rendered sites). The Mijas H3 handoff described the page as "rendered text, not markup," which
was wrong — a plain fetch returned full SSR'd HTML and the test fixture should have used that
markup verbatim. Speculative DOM descriptions lead to fixture/live mismatches that only surface at
live-verify time.

**🔴 Run-number ≠ archive depth.** When a kennel says "run #1747," that's the CURRENT trail
number, not necessarily how far back the source's archive reaches. **Walk a couple `/page/N` (or
`?offset=…`) URLs and report the actual oldest reachable post** in the handoff. The Bali Hash 2
handoff overstated "~1,747 archived runs" — the Ghost blog only goes back to Sept 2024 (~78 posts);
the rest are *historical*, not *archived on this source*. Use the real depth to decide whether a
one-shot backfill is worth scripting (and whether `upcomingOnly: true` is needed; see below).

**🔴 Sample ≥3 posts across YEARS (not just the latest 3) for multi-year archives.** Format drift
is the rule, not the exception. Real source data routinely mixes: full and abbreviated months
("16 March 2026" vs "16 Mar 2019"), weekday-prefixed dates ("Monday, 20 April 2026"), per-block
field layouts (each `Date:`/`Hare:`/`Venue:` in its own `<p>` or `<h5>`), embedded recap blocks
*inside* run posts, standalone "Hash Trash Run N" recap *posts*, prose-format older entries
vs `<table>`-format newer ones, and outright **source date typos** (a 2020 post may carry a 2019
date label). Report every variant you see in the sample so the adapter is designed for the
distribution, not the latest post. The ONH3 retro lists each of these specifically — start there.

**Past + schedule sources → call the split at research time.** If the source carries both an
archive (past runs) AND an advance schedule, recommend the **past/future split** in the handoff:
- **Past → one-shot backfill** (`scripts/backfill-<code>-history.ts`), run once, never touched again.
- **Future → adapter** with `config.upcomingOnly: true` so `reconcile.ts` doesn't false-cancel
  aged-out archive rows.
- **Report how far ahead the live feed actually reaches** (the ONH3 Google Calendar only covered
  ~4 weeks while the WordPress.com archive went back to 2019). Past-only vs future-only vs both
  matters for the adapter shape — don't conflate them.

**If the source is genuinely dead / has no upcoming events** (HTML listing itself is empty/gone):
mark the target `blocked` with the reason, fall back to the next `queued` target (return to
Step 1). A feed you simply couldn't fetch from the sandbox is **not** "dead" — flag it instead.

## Step 4 — Full metadata harvest (onboarding + deep-dive in one pass)

Gather **all** of the following (cross-reference the kennel's site, the live source, and the two
H3 directories — **HHH Genealogy** `genealogy.gotothehash.net` for aliases/lineage/first-run
date, **Half-Mind.com** for schedule/hash cash/contacts; playbook §3):

Kennel profile (maps to the `Kennel` model): `fullName`, `shortName`, `kennelCode`
(lowercase, URL-safe, **permanent**), `region`, `country`, `aliases`, `website`, `facebookUrl`,
`instagramHandle`, `twitterHandle`, `discordUrl`, `scheduleDayOfWeek`, `scheduleTime`,
`scheduleFrequency`, `foundedYear`, `hashCash`/payment, `dogFriendly`, `walkerFriendly`,
`description` (short "about us"), **`logoUrl`**, and lat/lng if easily found.

- **`hashCash` is the kennel-level *standard* (the typical per-run price; per-event variations live on `Event.cost`):** capture the amount a hasher normally pays at this kennel's runs into `Kennel.hashCash` (free-form, e.g. `"$5"`, `"Free"`, `"CHF 5"`, `"Members Rp.100,000 / Visitors Rp.150,000"`). Preserve the verbatim source nuance (tiers, payment methods) in the value or the `description`. Do NOT try to encode per-event price variations here — those (campouts, anniversary runs, visitor-only specials) belong on the event-level `Event.cost` field, populated by the adapter only when an event differs from this kennel default. The domain term is "hash cash" at both levels; the per-event column is named `cost` for historical reasons.
- **`logoUrl` stability:** prefer a stable URL. If the only logo is a **tokenized/ephemeral CDN
  URL** (e.g. `images.squarespace-cdn.com/.../<hash>/...`, signed S3, Wix `static.wixstatic.com/media/<hash>~mv2.<ext>`),
  flag it `⚠️ self-host` — recommend Claude Code download it into `public/kennel-logos/<code>.<ext>`
  and reference that path instead (these CDN URLs can rotate when the kennel re-uploads).
- **New country → 5-edit `src/lib/region.ts` checklist (NOT just COUNTRY + METRO).** Listing
  only the seed records is the gap that bit ONH3 (Kenya was first Africa, missed
  `COUNTRY_INFERENCE_RULES`, `inferCountry()` returned `"USA"` for Kenyan kennels, caught in CI).
  Bali Hash 2 will hit the same gap if not pre-flagged. Every new country needs **all 5**:
  1. **`REGION_SEED_DATA`** — COUNTRY record (timezone, ISO abbrev, centroid, color classes, pin
     color, aliases) **+** METRO record under it.
  2. **`STATE_GROUP_MAP`** — metro → group (use country name as the group for country→metro
     countries; mirror the New Zealand / Singapore precedent). **Keys are canonical region
     display names, NOT lowercase slugs** — e.g. `"Bali": "Indonesia"` (cf. `"Nairobi": "Kenya"`).
  3. **`COUNTRY_GROUP_MAP`** — wire **both** the country **and** every metro to the country
     name (this is what `groupRegionsByCountry` consumes). Same key convention as item 2 —
     canonical display names, not slugs — e.g. `"Indonesia": "Indonesia"` + `"Bali": "Indonesia"`
     (cf. `"Bangkok": "Thailand"`).
  4. **`COUNTRY_CODE_TO_NAME`** — ISO code → country name (e.g. `"ID": "Indonesia"`).
  5. **`COUNTRY_INFERENCE_RULES`** — regex → country (e.g. `/\bbali\b|\bindonesia\b/i` → "Indonesia").
     **Without this, `inferCountry()` falls through to `"USA"`** for any text mentioning the new
     country. THE one that bit ONH3 in CI; do not omit.
  Also pick a **color palette consistent with the continent** for the COUNTRY + METRO records
  (Africa = amber per Kenya precedent; pick a similarly-distinct Asia palette by scanning
  existing Bangkok/Singapore/Tokyo entries rather than guessing).

  **Region color shade + alias conventions (from ZH3 retro):**
  - **Country = darker shade (`-200`), Metro = lighter shade (`-100`)**, and the two should use
    **different pin colors** (not the same hex). Mirror a sibling COUNTRY+METRO pair (e.g.
    Germany + Berlin) for the exact shade/pin pattern — don't invent.
  - **Region aliases: 1–2 entries**, name + native spelling only (e.g.
    `aliases: ["Zurich", "Zürich, Switzerland"]`). Mirror sibling-metro density. **Do NOT** emit
    near-duplicate `"<Name>, <code>"` forms (e.g. both `"Zurich, CH"` and `"Zürich, CH"`) —
    reviewer-flagged dup on PR #1816.
  - **No trailing-zero numeric literals.** Sonar S6749 rejects `46.80`; emit `46.8`. Same for
    `centroidLng`, `latitude`, `longitude` in any seed block.
- **When you keep flat `scheduleDayOfWeek`/`scheduleTime` alongside `scheduleRules`, add the
  fallback comment.** Convention (lbh3, PR #1684): flat fields are the fallback for clients that
  don't read `scheduleRules`; `scheduleRules` is authoritative. Emit:
  ```ts
  // scheduleDayOfWeek/scheduleTime kept as fallback; scheduleRules is authoritative.
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "16:00",
  scheduleRules: [ ... ],
  ```
- **Schedule with more than one pattern → suggest `scheduleRules`, not just `scheduleDayOfWeek`.**
  If the kennel runs e.g. "weekly Wednesday + occasional Saturday," a single `scheduleDayOfWeek`
  miscategorizes the rest in Travel Mode. Propose an RRULE array, e.g.:
  ```ts
  scheduleRules: [
    { rrule: "FREQ=WEEKLY;BYDAY=WE", startTime: "18:30", label: "Primary" },
    { rrule: "FREQ=MONTHLY;BYDAY=SA", startTime: "12:00", label: "Occasional Saturday" },
  ]
  ```

Deep-dive completeness (resolve now, record in the handoff): which event fields the source
exposes (hares/location/description/start time); **historical events** available (count + which
fields + whether a one-shot DB insert could backfill them without changing the adapter — the
preferred path; per the ONH3 pattern, split future-only into the adapter and past into a
`scripts/backfill-<code>-history.ts` one-shot); aggregator cross-refs (Harrier Central / Hash
Rego / hashruns.org); any secondary source worth adding; avoid stale placeholder titles like
"`<shortName>` Trail".

> 🔴 **Before concluding "no historical backfill available," PROBE for a separate archive
> collection.** Many kennels keep a *distinct* archive section that the upcoming-runs page
> doesn't mention — typically named "Run Reports," "Trail Recap," "Hash Trash," "History,"
> "Archive," or just a blog. The Mijas H3 handoff declared 36 events with "no history" — the
> same site had a `/run-reports` collection with **389 events back to 2005** (a 353-run miss,
> 22×). Checklist:
> - Enumerate every top-nav and footer link on the kennel's site; flag anything that smells
>   archival (`/blog`, `/posts`, `/reports`, `/recap`, `/history`, `/archive`, `/trail-*`).
> - **For Squarespace specifically:** EVERY blog collection is readable at
>   `<collection-url>?format=json-pretty` (paginated via `?offset=…`). Test it — if you get a
>   `items[]` array of posts with `publishOn` epoch-ms + `body` HTML, that's the backfill source.
> - For WordPress / WordPress.com: same `wp-json/wp/v2/posts` and
>   `public-api.wordpress.com/wp/v2/sites/<host>/posts` patterns from the ONH3 onboarding.
> - For Ghost / Blogger / generic blog: walk `/page/N` and report actual oldest reachable post
>   (NOT current run number — see "Run-number ≠ archive depth" in Step 3 above).
>
> Report the actual archive depth (count + date range + per-post field list) in the handoff so
> the implementer can decide if a one-shot backfill is worth scripting. **The cost of finding a
> backfill source after a kennel ships is high** (cleaning up the gap + a separate follow-up PR
> is what happened with Mijas — see retro `handoffs/retros/2026-05-30-mijash3-retro.md`).

## Step 5 — Choose kennelCode + check collisions

```bash
grep -i '"<proposed-code>"' prisma/seed-data/kennels.ts prisma/seed-data/aliases.ts
```

If taken, add a region suffix (`lvh3-nv`, `mh3-tn`, `bh3-bkk`, `ah3-nz`, …). Watch the
collision-prone abbreviations in playbook §2. Resolve before drafting seed data.

## Step 6 — Draft the implementation (seed + adapter plan)

Decide the adapter type, preferring **config-only** sources (no new code): Google Calendar,
Sheets, iCal, Meetup, Hash Rego, Harrier Central, Static Schedule, and the config-driven
`GenericHtmlAdapter`.

**"Config-only" is a claim you must EARN — two conditions, both required:** (a) the specific feed
the config points at is **verified working** (Step 3 HEAD/structure check — not assumed), AND (b)
an adapter for that source type **already exists** in `src/adapters/registry.ts`. If either is
false, this is **not** config-only — give a realistic effort estimate (e.g. "new ~300–500 LoC
shared platform adapter + tests"), not "alternative HTML scrape config." (The SACH3 handoff said
"config-only iCal"; the iCal export was gated off and it actually needed a new ~360-LoC
`SquarespaceEventsAdapter` + tests across 4 PRs. Don't repeat that.) Put your **effort estimate**
in the handoff so Claude Code and John aren't surprised.

Produce:

- **Ready-to-paste seed blocks following the REAL shapes in `prisma/seed-data/` — read the files
  first.** Each file has a distinct shape; do not infer one from another:
  - `kennels.ts` → `Kennel[]` (array of objects, `{ kennelCode, shortName, ... }`)
  - `aliases.ts` → `Record<string, string[]>` (object keyed by slug, value is a string array).
    **NOT** `[{kennelCode, alias}]` — this exact wrong shape was emitted on two consecutive runs
    (ZH3 + Bali, 2026-05-29). `head -3 prisma/seed-data/aliases.ts` before emitting.
  - `sources.ts` → `Source[]` (array of objects)
  Then emit the `Kennel` object (or, for source-add, *which existing kennel*), the `aliases`
  entry in the actual Record shape, and the `Source` row with `type`, `trustLevel` (GCal/HashRego
  8–9, Meetup/Sheets 7–8, iCal 6–7, HTML 5–6), `scrapeFreq: "daily"`, adapter `config`, and
  **`kennelCodes`** (the source-kennel guard — list every kennel the source feeds).
- For a **new HTML scraper** (only if nothing else fits): a parsing plan — target URL, the
  fetch method (`fetchHTMLPage` from `src/adapters/utils.ts` for static HTML; `browserRender`
  from `src/lib/browser-render.ts` for JS-rendered sites — the canonical call in scrapers;
  `fetchWordPressPosts`; `fetchBloggerPosts`), the CSS selectors / fields, date-format notes, a
  captured HTML snippet for the test fixture **that mirrors the real DOM structure** (e.g. Wix
  wraps blocks in `[data-testid="richTextElement"]` — a flat fixture passes tests then fails
  live; see `source-platform-notes.md` → Wix), and the `htmlScrapersByUrl` registry entry to add.
- **Adapter code shown in the handoff is ILLUSTRATIVE — not authoritative.** Show the *shape*
  (control flow, where each field comes from, helper extraction, pagination/coord/end-time
  handling, S5852/S3776 boundaries) and name a **reference adapter** to mirror (e.g.
  "model on `src/adapters/html-scraper/onh3.ts` for WP.com REST; `hangover.ts` for Ghost"). Do
  **NOT** assert field names, function signatures, or import paths in the sketch as if they're
  canonical — the ONH3 sketch invented `kennelTag` (real type is `kennelTags: string[]`),
  invented `walkerFriendly` (not on `Kennel`), used raw `fetch()` (must be `safeFetch`),
  hardcoded a `title` (`merge.ts` synthesizes when undefined), and set
  `kennelPagesStopReason` in a way that would silently disable reconciliation. Include an
  explicit **"⚠️ Claude Code must verify against current types"** stanza listing exactly what
  to check (RawEventData/Kennel field names, `safeFetch` vs `fetch`, `kennelPagesStopReason`
  semantics — set only on genuine truncation, e.g. a full page left unfetched / an HTTP or
  fetch error; a non-empty string suppresses stale-event reconciliation in `scrape.ts`).
- Conventions to honor downstream: dates as **UTC noon**, `startTime` as `"HH:MM"` string,
  `cuid()` IDs, longer kennel-resolver patterns before shorter ones.

## Step 7 — Write the handoff file

Create `docs/kennel-onboarding/handoffs/<YYYY-MM-DD>-<kennelCode>.md` with this structure:

````markdown
# Onboarding Handoff — <shortName> (<region>) — <YYYY-MM-DD>

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/<kennelCode>-<YYYYMMDD>`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source; for a `source-add`, only
>    add/repoint the source and enrich missing kennel fields — don't duplicate the kennel). If the
>    region isn't seeded yet, add it as noted in **Adapter notes**.
> 3. Implement/configure the adapter exactly as in **Adapter notes** (prefer the config-only path).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`
>    — call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'` snippet or a small script
>    under `scripts/`. Resolve every item flagged `⚠️ Claude Code must confirm` in **Live source
>    verification** (e.g. confirm the `.ics`/feed returns a valid body; if it doesn't, use the
>    documented fallback). Validate: events non-empty + upcoming, dates UTC-noon, `startTime`
>    "HH:MM", `kennelTag` resolves with no unmatched. **DO NOT run `npx prisma db seed` here** —
>    seeding + prod scrape is a separate post-merge step (see step 8 below).
> 5. Optional: the **Historical backfill** one-shot insert, only if marked worth it.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR whose body carries the metadata, live-verification results, and the
>    deep-dive checklist below. Follow `docs/source-onboarding-playbook.md` throughout.
> 8. **Post-merge runbook (separate step, run after the PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file actually landed on `main`.** Squash-merge sometimes silently
>      drops a follow-up commit from a multi-commit PR (the mijash3 backfill script was dropped
>      this way — required PR #1837 to recover). Spot-check by name: `git log -1 -- path/to/file`
>      for each file the PR was supposed to add. If anything's missing, open a small recovery PR
>      with the missing files.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive; updates changed `Source.config` and seeds new kennels/aliases/sources)
>    - Trigger a scrape from `/admin/sources` (or the equivalent admin action) to publish events to prod
>    - Spot-check the kennel page on hashtracks.xyz for the expected event count + sample dates
> Everything you need is in the sections that follow.

## Summary
- Type: <full onboard | source-add>
- Adapter: <SOURCE_TYPE> (<config-only — adapter exists & feed verified | NEW adapter needed>)
- Effort estimate: <config-only | new ~N LoC adapter + tests | small JSON/HTML scraper>
- One-line: <what this adds and why it's high value>

## Dedup result
- Kennel in seed: <no | yes @ kennels.ts:LINE>
- Source in seed: <no | yes @ sources.ts:LINE>
- Live sitemap dedup: <confirmed NOT live — read via Chrome MCP, N slugs; no `<fragments>` slug>
- Decision: <full onboard | source-add | skip-reason>
- kennelCode: `<code>` (collision check: <clear | suffixed because …>)

## Live source verification  ✅ / ⚠️ needs Claude Code to confirm
- Source: <TYPE> — <url/id>  (feed HEAD-check: <content-type seen | couldn't fetch — flag>)
- Events seen: <count>, date range <… to …>
- Sample events:
  1. <date> — <title> — hares <…> — <location> — <time>
  2. …
- History depth / pagination: <total reachable past events; how to paginate, or "single page">
- Coord sanity: <coords clean | ⚠️ X of N have default/duplicate pins → adapter must reject + dropCachedCoords:true>
- End times: <none | same-day endTime available | multi-day endDate present>
- Notes: <JS-rendered/browserRender needed? auth? platform quirks? see source-platform-notes.md>

## Kennel metadata (deep-dive complete)
- fullName / shortName / region / country
- aliases: [...]
- website / facebook / instagram / twitter / discord
- schedule: <day>, <time>, <frequency>  (+ scheduleRules: [...] if multi-pattern)
- foundedYear / hashCash / dogFriendly / walkerFriendly
- logoUrl: <stable URL | ⚠️ self-host to public/kennel-logos/<code>.<ext>>
- description: "<short about-us>"
- lat/lng: <if found>

## Historical backfill
- Available: <count or none> — fields: <date/title/hares/location/cost>
- Plan: <one-shot insert script at scripts/backfill-<code>-history.ts | not worth it | none>
  (per the ONH3 pattern: future-only via adapter, past via one-shot; set source `config.upcomingOnly: true`
  if relevant to suppress stale-event reconciliation)

## Ready-to-paste seed

> 🔴 **`aliases.ts` is `Record<string, string[]>`, NOT an object array.** Two consecutive runs
> (ZH3 + Bali Hash 2, 2026-05-29) emitted `[{kennelCode, alias}]` object-array form anyway,
> requiring a manual rewrite each time. **Before emitting the aliases block, `head prisma/seed-data/aliases.ts`
> to confirm the live shape and mirror it exactly.** Reference the retros at
> `docs/kennel-onboarding/handoffs/retros/2026-05-29-{zh3,bali-hash-2}-retro.md`.

```ts
// kennels.ts  (skip if source-add) — Kennel[] (array of objects)
{ kennelCode: "...", shortName: "...", fullName: "...", region: "...", country: "...", website: "...", ... }

// aliases.ts — Record<string, string[]>  (slug → string[]).  Concrete shape (real entries):
//   "bali-hash-2": ["Bali Hash 2", "BH2", "Bali H2", "Bali Hash House Harriers 2"],
//   "zh3":         ["Zurich", "Zürich, Switzerland"],
// ❌ WRONG (do NOT emit): [{kennelCode: "...", alias: "..."}, ...]
// ✅ RIGHT (the file's actual shape — go read it):
"<your-slug>": ["Alias One", "Alias Two", "Native-spelling Alias"],

// sources.ts — Source[] (array of objects). Include scrapeDays!
{ name: "...", url: "...", type: "..." as const, trustLevel: N,
  scrapeFreq: "daily", scrapeDays: 365,   // ← REQUIRED — typical 90 for narrow feeds, 365 for archives
  config: { upcomingOnly: true, ... },    // ← upcomingOnly:true if the feed "ages out"; see gotchas
  kennelCodes: ["..."] }
```

## Adapter notes / new-scraper plan
<config explanation, or full parsing plan + fixture snippet (mirror real DOM) + registry entry>

**⚠️ Claude Code: verify before writing real code.** Any code snippet below is illustrative; the
authority is the live repo. Before writing the adapter, confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); there is no
  `walkerFriendly` field on `Kennel`; check the actual `prisma/schema.prisma` for unexpected
  invented fields.
- Imports — `safeFetch` from `@/adapters/safe-fetch` (NOT raw `fetch`); date/extract helpers from
  `@/adapters/utils`; browser-render via `browserRender` from `@/lib/browser-render`.
- `kennelPagesStopReason` — set ONLY on genuine truncation (a full page left unfetched / HTTP or
  fetch error); a non-empty string suppresses stale-event reconciliation. Don't set it on a clean
  pagination end (e.g. WP.com `page=N+1` returning 400 = expected end, leave it null).
- `title` — leave `undefined` when no clean theme exists; `merge.ts` synthesizes
  `"<KennelName> Trail #N"`. Never let a labeled-field fragment or hare name become the title.
- For `kennelPatterns` (when this is a multi-kennel calendar/source): list the actual sampled
  titles you're matching against AND keep regexes `safe-regex2`-clean — single `\s` (not stacked
  `\s+`), no `(?:…\s+)?` optional groups stacked, no nested quantifiers. S5852 will reject the
  obvious forms.

## Deep-dive checklist (nothing deferred)
- [x] logo (stable? else flag self-host)  [x] foundedYear  [x] socials  [x] schedule (+ scheduleRules if multi-pattern)  [x] hashCash
- [x] description  [x] source live-verified (feed HEAD-checked)  [x] history depth/pagination assessed
- [x] coord sanity checked  [x] end times noted  [x] kennelCode collision-checked  [x] kennelCodes (source guard) set
- [x] **per-run title** extracted when the source carries one (theme/venue/post title) — NOT left on the synthesized `<Kennel> Trail #N` default
- [x] **hares** populated from hareline table columns AND trail-post "Hare(s):" lines
- [x] **sub-letter run numbers** (`1999a`/`1999b`) handled as distinct events (see gotcha below)

## Implementation gotchas (for Claude Code — repo knowledge, not source knowledge)
Carry these into the build; they've each caused a follow-up fix before:
- **Rejecting upstream coords needs `dropCachedCoords: true`** — setting `latitude: undefined`
  alone does NOT clear a coord already stored by the merge pipeline (a re-scrape keeps the bad pin).
- **On partial pagination failure, set `kennelPageFetchErrors` + `kennelPagesStopReason`** — else
  `scrape.ts` runs stale-event reconciliation against partial data and cancels valid events. A
  non-empty `kennelPagesStopReason` suppresses stale-event reconciliation; only set it on a genuine
  truncation (full page left unfetched / HTTP or fetch error).
- **`config.upcomingOnly: true` is required for ANY "ages-out" source** — not just historical
  archives. The rule: if scraping the source twice (a year apart) would NOT return the same old
  events because they age off the source's display window, the source needs `upcomingOnly: true`.
  Without it, `reconcile.ts` false-`CANCEL`s the aged-off events. Applies to:
  - Recent-only feeds (Ghost / Wix "next run" posts that disappear after the event — Bali Hash 2
    missed this and would have started cancelling its own events after ~30 days; ONH3 had it).
  - Schedule-only feeds capped at ±N days (Google Calendar windows, iCal `?past_days=N`).
  - Any source whose display window is shorter than the kennel's actual history.
  Does NOT apply to full archives (the source itself returns the same old events on every
  scrape — most WordPress.com REST, full iCal exports). When in doubt, add it; the cost of a
  false negative (missed cancellation) is lower than a false positive (events disappear from prod).
- **Tests:** `vi.spyOn(globalThis, "fetch")` accumulates `.mock.calls` across `it()` blocks — add
  `beforeEach(vi.restoreAllMocks)` for accurate per-test counts.
- **Sonar S3776 cognitive complexity ≤ 15 — pre-plan helpers, don't inline.** Pagination, guard
  logic, and field extraction blow past 15 fast. The adapter-notes code block in this handoff
  should already show helpers extracted (e.g. `parseDateTimeLine`, `mergeLocation`,
  `walkPagination`, `resolveEndDateOrTime`, `extractVenueCoords`). If they aren't, extract before
  writing the body.
- **Sonar S5852 (catastrophic regex backtracking) — use known-safe patterns.** Avoid `.+$`,
  complex optional groups, and `\s*` before character classes. Safe substitutes:
  - Split combined patterns (e.g. one date+time regex → two simple regexes + combine in code):
    `DATE_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4})/` ; `TIME_RE = /(\d{1,2}:\d{2}) ?(AM|PM)/i`
  - Replace `(.+)$` with `(\S.*)$` (anchor a non-space first char to bound the greedy match):
    `HARES_RE = /^Hares?:\s*(\S.*)$/i`
  - Make optional title groups truly optional: `/^Hash\s*#(\d+)(?:\s*[-–]\s*(.+))?$/i`
- **Sonar S5843 (regex complexity) — don't pile up alternations.** Long alternation patterns
  (12-way month names, every weekday abbreviation, "every possible date separator") trip S5843.
  **Don't enumerate** — match a loose word boundary and let a validator do the lift:
  ```ts
  // ❌ Trips S5843
  const MONTH_RE = /(?:Jan|January|Feb|February|Mar|March|Apr|…)/i;

  // ✅ Match loose, validate with chrono-node
  const DATE_LIKE_RE = /\b\d{1,2}\s+\w+\s+\d{2,4}\b/;
  const parsed = chrono.parseDate(line);   // chrono handles the month-name validation
  ```
- **Code-style nits Sonar/Codacy flag in adapter PRs:**
  - `Number.parseInt(s, 10)` (NOT bare `parseInt(s, 10)`).
  - `s.replaceAll("a", "b")` (NOT `s.replace(/a/g, "b")` when no regex is needed).
  - `RegExp.exec()` for capture-heavy use; `String.match` is fine for simple boolean checks.
  - **No negated ternaries.** `a ? b : c` (NOT `!a ? c : b`) — Sonar S3358.
- **Self-host tokenized logos** into `public/kennel-logos/<code>.<ext>` rather than referencing an
  ephemeral CDN URL.
- **Don't ship a kennel stuck on the synthesized `<Kennel> Trail #N` title.** If the source carries
  a per-run descriptor — a trail-post theme, a hareline `Venue` column, or a structured post title
  (Ghost: `… - #N - <location> - D-MMM-YY`) — extract it into `title`. Fall back to the synthesized
  default only when the source row genuinely has none. The audit flags this as `stale-default-title`
  (Bali #1838, ONH3 #1862). Same rule for `hares`: hareline tables put it in a dedicated column and
  trail posts in a leading `Hare(s):` line — promote both to `RawEventData.hares` (#1863).
- **Sub-letter run numbers (`1999a` / `1999b`) must produce DISTINCT events.** Some kennels append
  `a`/`b` when two trails share a base run number on different dates (Mijas #1848). Keep the base
  integer in `runNumber` and emit the suffix as `eventLabel` — do NOT silently drop it. Dropping it
  leaves both rows at `(sourceUrl, runNumber)`, and the merge same-sourceUrl date-correction
  (`merge.ts`) then "moves" one onto the other's date, deleting a real event. The date-correction
  probe co-matches on `eventLabel`, so an emitted label keeps the pair separate.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is
the brief — no separate prompt needed._
````

Putting the directive at the **top** means the file works whether it's pasted into Claude Code or
piped in whole by an automated runner.

## Step 8 — Update the queue + run log; refill if low

1. In `target-queue.md`, set the target's Status to `handed-off` (or `blocked` with reason / 
   `done (already live)`), add the handoff file path + today's date.
2. Append an entry to `run-log.md`: date, kennel, source type, outcome (handoff path / blocked),
   events verified (count + range), historical backfill count, follow-ups.
3. **Refill check:** count rows still `queued`. **If 5 or fewer remain, research and add new
   targets to ~20**, ranked by (a) hashing popularity/activity and (b) reliability of a
   *confirmed* dynamic source. **Dedup every candidate against LIVE production data** (the
   sitemap / kennel directory / region pages / per-slug page check from Step 2 — NOT just the
   seed files, which are incomplete). A kennel already live (even if absent from `seed-data/`)
   must not be queued as new; a live kennel lacking a dynamic source is a valid "source-add"
   target. Use web search + H3 directories (harriercentral.com / hashruns.org,
   hashrego.com, half-mind.com, genealogy.gotothehash.net); for Meetup, confirm upcoming events.
   **Prefer candidates whose region shows 0 live kennels** (dedup is unambiguous there); for a
   candidate in an already-populated region, only queue it after a positive slug check or a
   sitemap read proves it's not already live. Append rows with full columns + honest confidence.

## Step 9 — Report

Return a one-line summary: kennel, source type, adapter (config-only or new), handoff file path,
events verified, and the backlog count remaining.

---

## Failure / edge handling

- **Target already seeded (kennel + source)** → mark `done (already live)`, pick next.
- **Existing kennel, missing source** → that's a valid source-add handoff, not a skip.
- **Source dead / no upcoming events** → mark `blocked` with reason, pick next.
- **Source is JS-rendered and browserRender isn't available in this shell** → still write the
  handoff with everything you could gather, clearly flagging that Claude Code must pull/verify
  the live sample. Mark the queue row `handed-off (needs live-verify)`.
- Never attempt git operations in this run. Never write outside `docs/kennel-onboarding/`.
- Never invent a logo/source URL — mark "none found / follow up" instead.
