# Onboarding Handoff — Vindobona H3 (Vienna, Austria) — 2026-06-05

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/vindobona-h3-20260605`.
> 2. Apply the **Ready-to-paste seed** below (kennels + aliases + ONE source feeding BOTH
>    `vindobona-h3` and `vienna-fmh3`). Add the **Austria COUNTRY + Vienna METRO** regions per
>    the 5-edit `region.ts` checklist in **Adapter notes** (this is HashTracks' first Austria kennel).
> 3. Implement the **NEW `VindobonaH3Adapter`** exactly as in **Adapter notes** (static Cheerio,
>    dual-surface forward-hareline + next-run-detail — NOT config-only).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`
>    — call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'` snippet. Resolve every item
>    flagged `⚠️ Claude Code must confirm`. Validate: events non-empty + upcoming, dates UTC-noon,
>    `startTime` "HH:MM" where present, `kennelTags` resolve with no unmatched, `FMH #` lines route
>    to `vienna-fmh3` and `Hash #` lines to `vindobona-h3`. **DO NOT run `npx prisma db seed` here.**
> 5. Historical backfill: **none in this PR** (see **Historical backfill** — no clean structured
>    archive exists; the blog is dead-since-2020 prose).
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive
>    checklist below. Follow `docs/source-onboarding-playbook.md` throughout.
> 8. **Post-merge runbook (separate step, after the PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (squash-merge can silently drop a follow-up
>      commit): `git log -1 -- src/adapters/html-scraper/vindobona-h3.ts`,
>      `git log -1 -- public/kennel-logos/vindobona-h3.*`. Recover any missing file in a small PR.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive; seeds new kennels/aliases/source + Austria/Vienna regions)
>    - Trigger a scrape from `/admin/sources` to publish events to prod
>    - Spot-check `hashtracks.xyz/kennels/vindobona-h3` (and `/vienna-fmh3`) for the expected
>      upcoming runs (#2363 on 2026-06-08, etc.)
> Everything you need is in the sections that follow.

## Summary
- Type: **full onboard** (new kennel + new sibling kennel + new source + first Austria region)
- Adapter: **HTML_SCRAPER — NEW `VindobonaH3Adapter` (~200–300 LoC, static Cheerio, dual-surface)**. NOT config-only.
- Effort estimate: new ~200–300 LoC adapter + tests; **+ 5-edit `region.ts`** (first Austria) + 2 kennel seeds + self-hosted logo.
- One-line: Adds **Vindobona H3** — Vienna's original hash (est. 25 Apr 1982, "the drinking club with a running problem", Run #2363+), **HashTracks' first 🇦🇹 Austria kennel** — plus its Full Moon sibling, from a live, weekly, 11-runs-ahead hareline.

## Dedup result
- Kennel in seed: **no** (`vindobona-h3` absent from `kennels.ts`; `vienna-fmh3` absent)
- Source in seed: **no** (`viennahash.org` absent from `sources.ts`)
- Live sitemap dedup: **confirmed NOT live** — read via Chrome MCP 2026-06-05, **430 slugs**; no `vienna*`/`wien*`/`vindobona*`/Austria slug. (The `*vh3*` matches in the sitemap are `cvh3, hvh3-ny, lvh3, lvh3-cin, mvh3-day, svh3, vh3` — `vh3` = **Victoria H3, BC**, NOT Vienna.)
- Pre-onboarding admin-event check: kennel not live → no admin-seeded `Event` rows to dedup/purge.
- Decision: **full onboard** (primary `vindobona-h3` + sibling `vienna-fmh3`)
- kennelCode: `vindobona-h3` (collision check: **clear**; bare `vh3`/`VH3` is **taken by Victoria H3** — see Step 5 below; `vienna-fmh3` clear)

## Live source verification  ✅ (HTML listings fetched & parsed from the sandbox)
- Source: **HTML_SCRAPER** — primary `https://viennahash.org/plans/futureruns.html` (receding hareline) + enrichment `https://viennahash.org/schedule.html` (next-run detail). **DNS check: `viennahash.org` Status 0 → 185.51.8.84 (real domain).**
  - 🔴 **Use the bare apex `viennahash.org`, NOT `www.viennahash.org`** — the `www.` host returns an **empty body** to the fetcher; the apex returns full SSR'd HTML. (Confirmed: `www.` → empty; apex → complete content.)
  - feed HEAD-check: both pages return `Content-Type: text/html`, fully server-rendered (static Cheerio works; **no browserRender needed**).
- Events seen: **11 upcoming** on `futureruns.html`, date range **2026-06-08 → 2026-12-13**. The kennel is very active (stats page "as of 2026-05-11"; next run in 3 days).
- **Source-count parity:** `futureruns.html` is the authoritative forward list (11 rows); `schedule.html` shows the single next run (#2363). No platform "total events" counter to compare — parity N/A; the recently/continuously-active evidence is the 11-deep forward hareline + weekly cadence.
- Sample events (**VERBATIM** from `futureruns.html`; #1 enriched from `schedule.html`):
  1. **2026-06-08** — Hash **#2363** — hares **Miss Piss** — **Kaiserzeit Würstelstand, Augartenbrücke, 1020 Wien** — **18:30** — GPS **N48.21903, E16.37094** (lat 48.21903, lng 16.37094) — on-after Karavan Restaurant — *(full detail from schedule.html)*
  2. **2026-06-15** — Hash **#2364** — hares **Storming Norman & Rowed Runner** — (no location/time on futureruns)
  3. **2026-06-22** — Hash **#2365** — hares **Marie Tamponette & S. Energy** — notes **Wiener Neudorf**
  4. **2026-06-28** — Hash **#2366** — hares **Just in Beaver** — notes **"Sunday run, 10th Beaver creek Run"**
  5. **2026-07-12** — Hash **#2368** — hares **No Mercy Mistress** — notes **"Swimming pool run, Sunday run"**
  - *(sibling)* **2026-08-01** — **FMH #30?** — hares **Casting Couch** — notes **"Summer afternoon Full Moon run, Gruess di a Gott Wirt"** → routes to `vienna-fmh3`
  - *(far-future, run # not finalized)* **2026-09-27** — **Hash #23??** — Marie Tamponette & S. Energy — **Eisenstadt**; **2026-12-13** — **Hash #23??** — Oh Fardolena & Whoppa — "Finlandia run"
- History depth / pagination: **single page each** (no pagination). `futureruns.html` = the forward window only (~6 months ahead). No deep archive on a parseable page — see **Historical backfill**.
- Coord sanity: **clean** — only `schedule.html`'s next run carries one real GPS pin (`N48.21903, E16.37094`); `futureruns.html` rows have **no coords** → fall back to the Vienna centroid. **No default/duplicate-pin trap** (single real coord). No `dropCachedCoords` needed.
- End times: **none** published (no end timestamps).
- Notes: Old-school hand-maintained static club site (est. 1982, `meta-author: Lord Glo-Balls`, hit counter, framesets-era markup but the two target pages are flat HTML). **Schedule is multi-pattern**: per `schedule.html` verbatim — *"The Hash normally runs at 18:30 on Monday in the Summer and 14:30 on Sunday in the Winter. The Full Moon Hash runs at 19:00 (usually on the Friday evening closest to the actual Full Moon)."* The futureruns rows already carry explicit ISO dates, so the adapter trusts the dates, not the schedule prose.

- **Field-fill assertion table** (from the sample rows above — `futureruns.html` backbone + `schedule.html` enrichment of the next run):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` (theme) | ~2 / 11 | Mostly leave **undefined** → `merge.ts` synthesizes `"<Kennel> Trail #N"`. Only the notes column occasionally holds a real theme ("Finlandia run", "10th Beaver creek Run"); do NOT promote hares or a run-type note ("Sunday run") to title. |
  | `startTime` | 1 / 11 | Only `schedule.html` next run (`18:30`) is explicit. Others: **leave undefined** (don't fabricate — summer Mon 18:30 vs winter Sun 14:30 vs FMH 19:00 varies). Enrich the matched next run from `schedule.html`. |
  | `endTime` | 0 / 11 | accept absence |
  | `location` (venue) | 3 / 11 | `schedule.html` next run full venue; `futureruns` notes sometimes a town (Wiener Neudorf, Eisenstadt). Else **undefined** — don't synth. |
  | `locationStreet` | 1 / 11 | `schedule.html` next run only ("Augartenbrücke, 1020 Wien"). Not on futureruns. |
  | `locationUrl` (Maps) | 1 / 11 | `schedule.html` next run has a custom Google My-Maps link. Not on futureruns. |
  | `hares` | 8 / 11 | free text from `futureruns` col 3 (e.g. "Storming Norman & Rowed Runner"); some rows blank → undefined. |
  | `cost` | kennel default | €5 adult default (kennel-level `hashCash`); no per-event override seen. |
  | `description` | ~5 / 11 | the notes column (run type / theme) when present. |
  | `trailLengthText` | 0 / 11 | not in feed |
  | `coords` (lat/lng) | 1 / 11 | `schedule.html` next run GPS (`N…, E…`); else fallback to Vienna centroid. |

## Kennel metadata (deep-dive complete)
**PRIMARY — Vindobona H3:**
- fullName: **Vindobona Hash House Harriers** / shortName: **Vindobona H3** / region: **Vienna** / country: **Austria**
  - 🔴 shortName is **"Vindobona H3"** (slug → `vindobona-h3`), **NOT "VH3"**: `toSlug("VH3")` = `vh3` which **collides with Victoria H3's slug** (already live in prod). The kennel brands itself "VH3"; we disambiguate to `Vindobona H3` and capture "VH3 (Vienna)" forms in aliases (omitting the bare `VH3` alias — Victoria owns it).
- aliases: see seed block (omit bare `VH3`).
- website: **https://viennahash.org** (source: live fetch)
- facebook: **https://www.facebook.com/viennahash/** (source: WebSearch indexed result) · blog (DEAD since 2020): http://whatcanisayaboutthiselixir.blogspot.com/ · mailing list: Groups.io (ViennaHash) · photos: https://mypintofview.smugmug.com · instagram/twitter/discord: **none found**
- contactEmail: **webmaster@viennahash.at** (source: page meta on schedule.html/masthead.html)
- schedule: **Monday 18:30** primary (summer); **Sunday 14:30** in winter; **Full Moon Fri 19:00** — roughly **Weekly**. (source: schedule.html verbatim)
- foundedYear: **1982** — *Run #1 on **25 April 1982** at Grüß-di-a-Gottwirt, set by Hans Saxinger (Australian Embassy) & Lan Yarbrough (US Embassy)* (source: https://viennahash.org/history/history.html). ⚠️ The homepage banner says **"43 Years"** (would imply 1983) — that banner is **stale** (2026−1982 = 44); the History page's explicit "25th April 1982" first-run record is canonical.
- hashCash: **"€5"** — adults 18+; €2 youths 12–17; under-12, dogs & sticks free (source: schedule.html verbatim). Self-validated: single "€5", no doubled symbol.
- dogFriendly: **true** (dogs explicitly free per schedule.html) / walkersWelcome: **true** ("runners- and walkerstrails on offer" — blog/schedule)
- logoUrl: **⚠️ self-host** → `public/kennel-logos/vindobona-h3.<ext>` from `https://viennahash.org/images/191228_VH3_logo_Full.png` (apex path; confirm extension via magic bytes — see gotchas; URL says `.png` but verify).
- description: "Founded 25 April 1982, Vindobona H3 is Vienna's original hash — 'the drinking club with a running problem' and self-styled 'World's Wurst Hash.' On Run #2363+ in 2026. Runs roughly weekly: Monday evenings (18:30) in summer, Sunday afternoons (14:30) in winter, plus a Full Moon Hash. Run fee €5; dogs and walkers welcome."
- lat/lng: **48.21, 16.37** (Vienna; matches the next-run GPS)

**SIBLING — Vienna Full Moon HHH** (the source carries it — do not drop it):
- fullName: **Vienna Full Moon Hash House Harriers** / shortName: **Vienna FMH3** (slug → `vienna-fmh3`) / region: **Vienna** / country: **Austria**
- foundedYear: **2000** — *sub-chapter of VH3 set up at the AGM on 5 November 2000; original GM Mr. Bob Davolino, RA No Mercy Master* (source: https://viennahash.org/masthead.html)
- schedule: **Full Moon — Friday ~19:00** (the Friday evening closest to the actual full moon) (source: schedule.html)
- hashCash: **"€5"** (shares VH3's facilities/cash) · website https://viennahash.org · dogFriendly true / walkersWelcome true
- logoUrl: **⚠️ self-host** → `public/kennel-logos/vienna-fmh3.<ext>` from `https://viennahash.org/images/Full_moon_T-shirt_front_Small.jpg` (or reuse the VH3 logo if the FM image is low-res — Claude Code's call; confirm extension via magic bytes).
- description: "The Full Moon sub-chapter of Vindobona H3 (Vienna), founded 5 November 2000. Runs on the Friday evening closest to each full moon at 19:00, sharing all facilities with VH3."
- 🔴 **FMH run-number caveat:** the source's Full Moon numbering is **inconsistent** — `futureruns.html` shows `FMH #30?` (with a `?`) for 2026-08-01, while the (dead) blog tagged "Full Moon Hash # 241" back in **2020**. Treat FMH run numbers as **unreliable**: only store `runNumber` when the token is a clean `#\d+` with no trailing `?`; otherwise leave `runNumber` undefined and let merge synthesize the title. (See gotchas.)

### Sibling-kennel sweep (per Step 4)
- **Vienna Full Moon HHH** → **included** as `vienna-fmh3`, routed from the same source by the `FMH #` line prefix (vs `Hash #` → `vindobona-h3`). Documented above with founding + schedule.
- **Blue Moon / New Moon Hash** → **excluded**: per the masthead it's *"just a useful name for any Hash organized outside the regular schedule"* (ad-hoc, no fixed cadence, no regular numbering). Not a standing kennel — do not seed.
- No other sibling on the source.

## Historical backfill
- Available: **none worth a one-shot in this PR.** Probed all candidate archives (evidence captured):
  - **Blog `whatcanisayaboutthiselixir.blogspot.com`** — **DEAD since Sep 2020** (latest entry **Run #2085, 2020-09-20**; 394 total posts back to ~2009). Sampled 12 posts: free-form **prose travel-writing recaps**; run number lives only in a **category tag** ("Run # 2085", "Full Moon Hash # 241"), run **date ≈ publish date** (recaps posted days after), hares/location buried in prose, and ~30% of posts are non-runs (Christmas parties, "Football Songs"). A backfill would yield ~360 shallow `run# + approximate-date` rows with a **2020→2026 gap** and no clean hares/location. **Low value → deferred** (not dismissed — sampled per the no-dismiss-without-a-sample rule).
  - **`stats/stats.html` + per-year `stats20NN.html`** — **per-hasher cumulative attendance** tables (Hash Name | End 2025 | In 2026 | Total), **not** per-run date/hare/location. Confirms the kennel is alive (current as of 2026-05-11) but is not a run log.
  - **`locations.html`** — per-year **Google My-Maps links** (2008→2025), not a parseable run list.
  - **`history/history.html`** — milestone **prose** (50th, 100th … 1700th runs), not a per-run table.
- Plan: **no backfill script.** The live adapter brings the forward hareline (11 runs) + the current run immediately. Flag the blog as a possible *future* low-priority shallow backfill only.

## Ready-to-paste seed

> `aliases.ts` is `Record<string, string[]>` keyed by **kennelCode** (confirmed: `head prisma/seed-data/aliases.ts` → `export const KENNEL_ALIASES: Record<string, string[]> = { "nych3": [...] }`). Emit `"<kennelCode>": [ ... ]`.

```ts
// kennels.ts — append to the Kennel[] array (near the Malaysia/Europe blocks).
// region: "Vienna" (bare metro name — mirrors the Swiss zh3 precedent region: "Zürich").
{
  kennelCode: "vindobona-h3", shortName: "Vindobona H3", fullName: "Vindobona Hash House Harriers",
  region: "Vienna", country: "Austria",
  website: "https://viennahash.org",
  logoUrl: "/kennel-logos/vindobona-h3.png", // ⚠️ self-host; confirm extension via magic bytes
  contactEmail: "webmaster@viennahash.at",
  facebookUrl: "https://www.facebook.com/viennahash/",
  // scheduleDayOfWeek/scheduleTime kept as fallback; scheduleRules is authoritative.
  scheduleDayOfWeek: "Monday", scheduleTime: "6:30 PM", scheduleFrequency: "Weekly",
  scheduleRules: [
    { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "18:30", label: "Summer (Monday evening)" },
    { rrule: "FREQ=WEEKLY;BYDAY=SU", startTime: "14:30", label: "Winter (Sunday afternoon)" },
  ],
  scheduleNotes: "Roughly weekly. Monday 18:30 in summer, Sunday 14:30 in winter; dates shift, so trust the published hareline. The Full Moon Hash (sibling Vienna FMH3) runs Friday ~19:00 nearest the full moon.",
  foundedYear: 1982,
  dogFriendly: true, walkersWelcome: true,
  description: "Founded 25 April 1982, Vindobona H3 is Vienna's original hash — 'the drinking club with a running problem' and self-styled 'World's Wurst Hash.' On Run #2363+ in 2026. Runs roughly weekly: Monday evenings (18:30) in summer, Sunday afternoons (14:30) in winter, plus a Full Moon Hash. Run fee €5; dogs and walkers welcome.",
  latitude: 48.21, longitude: 16.37,
},
{
  kennelCode: "vienna-fmh3", shortName: "Vienna FMH3", fullName: "Vienna Full Moon Hash House Harriers",
  region: "Vienna", country: "Austria",
  website: "https://viennahash.org",
  logoUrl: "/kennel-logos/vienna-fmh3.png", // ⚠️ self-host; confirm extension via magic bytes
  contactEmail: "webmaster@viennahash.at",
  scheduleDayOfWeek: "Friday", scheduleTime: "7:00 PM", scheduleFrequency: "Monthly",
  scheduleNotes: "Full Moon Hash — Friday evening closest to each full moon, 19:00. Sub-chapter of Vindobona H3, sharing facilities.",
  foundedYear: 2000,
  dogFriendly: true, walkersWelcome: true,
  description: "The Full Moon sub-chapter of Vindobona H3 (Vienna), founded 5 November 2000. Runs on the Friday evening closest to each full moon at 19:00, sharing all facilities with VH3.",
  latitude: 48.21, longitude: 16.37,
},

// aliases.ts — Record<string, string[]> keyed by kennelCode.
// ❌ Do NOT add bare "VH3" (owned by Victoria H3) or bare "FMH" (too generic).
"vindobona-h3": ["Vindobona", "Vindobona Hash", "Vindobona HHH", "Vienna Hash", "Vienna H3", "VH3 Vienna", "World's Wurst Hash"],
"vienna-fmh3": ["Vienna Full Moon", "Vienna Full Moon Hash", "Vindobona Full Moon", "Vienna FMH3", "VFMH3"],

// sources.ts — append to the Source[] array. ONE source feeds BOTH kennels.
{
  name: "Vindobona H3 Hareline",
  url: "https://viennahash.org/plans/futureruns.html",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    upcomingOnly: true, // rolling forward hareline prunes past runs → suppress reconcile false-cancels
    scheduleUrl: "https://viennahash.org/schedule.html", // next-run enrichment (GPS, time, venue)
  },
  kennelCodes: ["vindobona-h3", "vienna-fmh3"],
},
```

## Adapter notes / new-scraper plan

**NEW `VindobonaH3Adapter`** — static Cheerio, dual-surface. **Reference adapters: mirror
`src/adapters/html-scraper/bangkok-monday-hash.ts`** (forward hareline + next-run-block with the single
GPS pin, merged by run number) **and `src/adapters/html-scraper/dublin-hash.ts`** (simple row parse).
Register in `src/adapters/registry.ts` named-scraper list:
```ts
{ pattern: /viennahash\.org/i, name: "VindobonaH3Adapter", factory: () => new VindobonaH3Adapter() },
```
(add the `import { VindobonaH3Adapter } from "./html-scraper/vindobona-h3";` near the other html-scraper imports.)

**Parsing plan**
1. **Fetch `futureruns.html`** (the source `url`) with `fetchHTMLPage` (static — no browserRender). It is a flat list where each run is rendered as **pipe/newline-delimited cells**: `Date | Hash #N | Hares | Notes`. Real captured rows (verbatim):
   ```
   2026-06-08 | Hash #2363 | Miss Piss |
   2026-06-22 | Hash #2365 | Marie Tamponette & S. Energy | Wiener Neudorf
   2026-06-28 | Hash #2366 | Just in Beaver | Sunday run, 10th Beaver creek Run
   2026-08-01 | FMH #30?   | Casting Couch | Summer afternoon Full Moon run, Gruess di a Gott Wirt
   2026-12-13 | Hash #23?? | Oh Fardolena & Whoppa | Finlandia run
   ```
   - **Date** is **ISO `YYYY-MM-DD`** → **no year inference needed**. Parse directly to **UTC noon** (`Date.UTC(y, m-1, d, 12)`).
   - **Run label**: `Hash #NNNN` → `vindobona-h3`; `FMH #NN` → `vienna-fmh3`. Extract the integer **only when it's a clean `#\d+$`** — reject `#30?` / `#23??` (trailing `?`) → `runNumber` undefined, still emit the dated event.
   - **Hares**: col 3 free text; blank → undefined. **Notes**: col 4 → `description` (and a town like "Wiener Neudorf"/"Eisenstadt" may be the only `location` hint).
2. **Fetch the enrichment page** `config.scheduleUrl` (`schedule.html`) — the single **next run** with full
   detail. Extract: run number (`#2363`), `startTime` (`18:30` from the `**2026-06-08** 18:30 #2363 …` line),
   `location` (`Kaiserzeit Würstelstand, Augartenbrücke, 1020 Wien`), **GPS** (`GPS coordinates: N48.21903, E16.37094`),
   on-after, and the Google Maps link. **Merge into the matching `futureruns` run by run number.**
   - 🔴 **GPS format is `N<lat>, E<lng>`** (N/E-prefixed decimal degrees) → `lat = 48.21903, lng = 16.37094`.
     `extractCoordsFromMapsUrl` will NOT parse this; do it locally: `m = txt.match(/N(\d+\.\d+),\s*E(\d+\.\d+)/); {lat:+m[1], lng:+m[2]}`.
3. **Times**: set `startTime` from `schedule.html` for the enriched next run; **leave undefined** for the
   others (the day/time genuinely varies summer Mon 18:30 / winter Sun 14:30 / FMH Fri 19:00 — don't fabricate).
4. **Emit** UTC-noon dates, `kennelTags: ["vindobona-h3"]` or `["vienna-fmh3"]`, `runNumber` (clean only),
   `hares`, `location`/`coords`/`startTime` where available, `description` from notes.

**⚠️ Claude Code: verify before writing real code.** Any snippet here is illustrative; the live repo is authoritative. Confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); `walkersWelcome` (NOT `walkerFriendly`) on `Kennel`. Check `prisma/schema.prisma`.
- Imports — `fetchHTMLPage` from `@/adapters/utils`, `safeFetch` from `@/adapters/safe-fetch` (NOT raw `fetch`), `extractCoordsFromMapsUrl` from `@/lib/geo` (for the Maps link, not the N/E coords).
- `kennelPagesStopReason` — leave null on a clean parse; set ONLY on genuine truncation (a page that failed to fetch). A non-empty string suppresses stale-event reconciliation.
- `title` — leave `undefined` unless the notes column holds a real theme; `merge.ts` synthesizes `"<Kennel> Trail #N"`. Never promote hares or a run-type note ("Sunday run") to the title.
- Dates are UTC noon; `startTime` is a `"HH:MM"` string; `cuid()` IDs.

### First Austria — `src/lib/region.ts` 5-edit checklist (mirror the Switzerland block at L1793)
Pick a **teal** palette (distinct from neighbors: Germany yellow, France blue, Switzerland red, Belgium amber, Netherlands orange, Denmark rose).
1. **`REGION_SEED_DATA`** — add Austria COUNTRY + Vienna METRO:
   ```ts
   // ── Austria ──
   { name: "Austria", country: "Austria", level: "COUNTRY", timezone: "Europe/Vienna",
     abbrev: "AT", colorClasses: "bg-teal-200 text-teal-800", pinColor: "#0d9488",
     centroidLat: 47.6, centroidLng: 14.55, aliases: ["AT", "Österreich"] },
   { name: "Vienna", country: "Austria", timezone: "Europe/Vienna",
     abbrev: "VIE", colorClasses: "bg-teal-100 text-teal-700", pinColor: "#14b8a6",
     centroidLat: 48.21, centroidLng: 16.37, aliases: ["Wien", "Vienna, Austria"] },
   ```
   (Metro record omits `level` → defaults to METRO, per the Zürich precedent. No trailing-zero literals — `47.6` not `47.60`.)
2. **`STATE_GROUP_MAP`** — `"Vienna": "Austria",`
3. **`COUNTRY_GROUP_MAP`** — `"Austria": "Austria",` **and** `"Vienna": "Austria",`
4. **`COUNTRY_CODE_TO_NAME`** — `AT: "Austria",`
5. **`COUNTRY_INFERENCE_RULES`** — `[/\b(austria|österreich|osterreich|vienna|wien|vindobona)\b/, "Austria"],`
   (Without this, `inferCountry()` falls through to "USA" for any Vienna/Vindobona text — the ONH3/WSH3 trap.)

## Deep-dive checklist (nothing deferred)
- [x] logo (⚠️ self-host both) [x] foundedYear (1982 from History page; banner "43 Years" flagged stale) [x] socials (FB + blog + mailing list; no IG/X/Discord) [x] schedule (+ scheduleRules, multi-pattern) [x] hashCash (€5)
- [x] description [x] source live-verified (both pages fetched & parsed; apex-not-www trap recorded) [x] history depth/pagination assessed (single page; no clean archive — blog dead 2020)
- [x] coord sanity checked (1 real pin, no default trap) [x] end times noted (none) [x] kennelCode collision-checked (`vindobona-h3`/`vienna-fmh3` clear; bare `VH3` = Victoria, omitted) [x] kennelCodes (source guard) set [x] sibling sweep (FMH3 included, Blue Moon excluded) [x] first-Austria region 5-edit listed

## Implementation gotchas (for Claude Code — repo knowledge)
- 🔴 **Apex-not-www:** fetch `viennahash.org`, never `www.viennahash.org` (www → empty body). Seed the apex URLs.
- 🔴 **GPS is `N<lat>, E<lng>`** (not a Maps URL) → parse locally `N(\d+\.\d+),\s*E(\d+\.\d+)`. Single pin, no `dropCachedCoords` needed.
- 🔴 **Run-number hygiene:** store `runNumber` only for a clean `#\d+` (no trailing `?`). `FMH #30?` and `Hash #23??` → emit the dated event with `runNumber` undefined (merge synthesizes the title). Don't fabricate a number.
- 🔴 **FMH numbering is unreliable** on the source (#30? vs blog's #241 in 2020) — never "correct" it; just store the clean integer when present.
- 🔴 **`config.upcomingOnly: true` is required** — `futureruns.html` is a rolling forward window (past runs drop off), so without it `reconcile.ts` would false-`CANCEL` aged-off runs.
- 🔴 **Multi-kennel fail-loud zero guard:** emit a per-kennel zero check (one error if `vindobona-h3` rows are empty AND one if the parse total is 0) so a markup drift that breaks one prefix can't let `reconcile` false-cancel that kennel's future runs while the other parses.
- **`friendlyKennelName` check:** both shortNames are >4 chars ("Vindobona H3", "Vienna FMH3") → `friendlyKennelName` short-circuits to the shortName (no garble). Quick confirm: `npx tsx -e 'import {friendlyKennelName} from "./src/pipeline/merge"; console.log(friendlyKennelName("Vindobona H3","Vindobona Hash House Harriers"), "|", friendlyKennelName("Vienna FMH3","Vienna Full Moon Hash House Harriers"));'`
- **Self-host logos** into `public/kennel-logos/vindobona-h3.<ext>` + `vienna-fmh3.<ext>`. **NEVER pre-fill the extension** — confirm via `curl -sI` Content-Type AND magic bytes (`RIFF`=WebP, `\x89PNG`=PNG, `\xff\xd8`=JPEG). The VH3 logo URL says `.png`; verify (the Vienna FM image is a `.jpg`).
- **Sonar S5852/S5843:** date is plain ISO (`/\b(\d{4})-(\d{2})-(\d{2})\b/`), run label `/#(\d+)\b/` — keep regexes simple; no stacked `\s*`/alternations.
- **Code-style nits:** `Number.parseInt(s, 10)`, `s.replaceAll(...)`, no negated ternaries.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._

### Sources (research provenance)
- Live source pages (fetched 2026-06-05): `viennahash.org/schedule.html`, `viennahash.org/plans/futureruns.html`, `viennahash.org/index.html`, `viennahash.org/history/history.html`, `viennahash.org/masthead.html`, `viennahash.org/stats/stats.html`, `viennahash.org/locations.html`
- Blog (dead since 2020): `whatcanisayaboutthiselixir.blogspot.com/feeds/posts/summary?alt=json`
- Facebook: `https://www.facebook.com/viennahash/`
- Live dedup: `hashtracks.xyz/sitemap.xml` via Chrome MCP (430 slugs, 2026-06-05)
