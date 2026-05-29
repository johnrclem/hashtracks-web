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

- **Ready-to-paste seed blocks** following the real shapes in `prisma/seed-data/` and playbook
  §4/§9: the `Kennel` object (or, for source-add, *which existing kennel*), the `aliases` entry,
  and the `Source` row with `type`, `trustLevel` (GCal/HashRego 8–9, Meetup/Sheets 7–8, iCal 6–7,
  HTML 5–6), `scrapeFreq: "daily"`, adapter `config`, and **`kennelCodes`** (the source-kennel
  guard — list every kennel the source feeds).
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
> 4. `npx prisma db seed`, then **live-verify against the real source URL** per
>    `.claude/rules/live-verification.md` — resolve every item flagged `⚠️ Claude Code must
>    confirm` in **Live source verification** (e.g. confirm the `.ics`/feed returns a valid body;
>    if it doesn't, use the documented fallback). Events non-empty + upcoming, dates UTC-noon,
>    `startTime` "HH:MM", `kennelTag` resolves with no unmatched.
> 5. Optional: the **Historical backfill** one-shot insert, only if marked worth it.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR whose body carries the metadata, live-verification results, and the
>    deep-dive checklist below. Follow `docs/source-onboarding-playbook.md` throughout.
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
```ts
// kennels.ts  (skip if source-add)
{ kennelCode: "...", shortName: "...", fullName: "...", region: "...", country: "...", website: "...", ... }
// aliases.ts
"<code>": ["...", "..."],
// sources.ts
{ name: "...", url: "...", type: "..." as const, trustLevel: N, scrapeFreq: "daily", config: { ... }, kennelCodes: ["..."] }
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

## Implementation gotchas (for Claude Code — repo knowledge, not source knowledge)
Carry these into the build; they've each caused a follow-up fix before:
- **Rejecting upstream coords needs `dropCachedCoords: true`** — setting `latitude: undefined`
  alone does NOT clear a coord already stored by the merge pipeline (a re-scrape keeps the bad pin).
- **On partial pagination failure, set `kennelPageFetchErrors` + `kennelPagesStopReason`** — else
  `scrape.ts` runs stale-event reconciliation against partial data and cancels valid events. A
  non-empty `kennelPagesStopReason` suppresses stale-event reconciliation; only set it on a genuine
  truncation (full page left unfetched / HTTP or fetch error).
- **For historical-archive sources, set `config.upcomingOnly: true`** to restrict reconciliation
  to future dates (ONH3 pattern — prevents false-cancelling the archived backfill once it ages
  off the source's first page).
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
- **Self-host tokenized logos** into `public/kennel-logos/<code>.<ext>` rather than referencing an
  ephemeral CDN URL.

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
