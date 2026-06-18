# Source Platform Notes

Lessons learned from specific platforms encountered during kennel onboarding.
Add a new section when you discover non-obvious behavior on a platform.

---

## Wix Events widget (learned from BoiseH3, 2026-05-28)

- **Detection:** `<meta name="generator" content="Wix.com Website Builder">` in page head; `static.wixstatic.com` CDN assets.
- **Feed reality:** Wix sites often render the **current** event inline as static HTML on the home page (server-rendered), while the dedicated `/events` or `/events-3` calendar page uses a JS-rendered Wix Events widget. If only the current or next event is needed, a static home-page Cheerio parse is more reliable than browser-render.
- **Home-page parse:** Look for `<h1|h2|h3>Hash #NNN</h1>` or equivalent heading, then traverse `.nextAll()` until the next heading or a sentinel phrase (`We need Hares!`). **Climb to the `[data-testid="richTextElement"]` container first** — Wix wraps each content block in such a div, so the heading and following paragraphs are siblings at the container level, not siblings of the `<h1>` itself. Content-keyed traversal is required — Wix rotates opaque CSS class names.
- **Events widget:** Use `browserRender(url, { waitFor: "body", timezoneId: "America/Boise" })` and look for `[data-hook*="event"]` or `[class*="eventList"]` containers. For BoiseH3, the `/events-3` page loads only CSS bundles (978 KB) with no SSR'd event data — the widget content is fully JS-rendered and the home-page parse remains the canonical path.
- **iCal:** Wix exposes per-event `?format=ical` links via the public widget but NOT a collection-level iCal feed by default — do not use as the primary source URL.
- **Coord trap:** If Wix Events exposes `lat`/`lng` per event, verify they differ across events. Repeated identical coordinates indicate a tenant-default venue pin (same trap as Squarespace) — reject and emit `dropCachedCoords: true`.
- **Logos:** `static.wixstatic.com/media/<hash>~mv2.<ext>` URLs are tokenized and rotate when the kennel re-uploads assets. Always self-host into `public/kennel-logos/<code>.<ext>` and reference that path.
- **Effort:** Small new static scraper (~130–180 LoC + tests) if only the home-page block is needed; larger (~400+ LoC, mirror `northboro-hash.ts`) if the events-page widget must be parsed via browser-render.

#### Kaohsiung H3 addenda (verified via real web_fetch, 2026-06-14) — multi-page SSR Wix, schedule-as-image, cross-page run-# drift

`kaohsiunghash.com` (Kaohsiung H3 / 高雄捷兔, est. 1973) is a richer Wix variant than Boise — **multiple content pages are fully SSR'd**, not just one home-page block. Confirmed by fetching the real pages:
- **The home page AND `/run-information` are both fully SSR'd** and each carry the next ~2–3 numbered runs. Home page = clean backbone (`<h2>` `#NNNN - <Month Day> - <Title>` linked headings); `/run-information` = the same runs as `<h2>` `#NNNN <Month Day> <Title>` headings followed by free-form prose (time, "Meet at …", `maps.app.goo.gl` link, cost) and a `<h4>Your Hares:</h4>` block whose **hare names sit in the following `<h1>`**. Parse `/run-information` for richness; cross-check the home page for an extra near-term run.
- **🔴 The full season schedule is published only as an IMAGE** (`KHHH V2(2).png` on `/run-schedule`) — NOT scrapeable text. So there's no deep forward list and **no machine-readable archive at all** (the `/events` page is a special-events content page, not a calendar; no `?format=json`). A high run number (#2732) ⇒ deep history, but the source exposes none → **no backfill, `upcomingOnly: true`, fail-loud zero guard.**
- **🔴 Cross-page run-number drift** — the home page and `/run-information` can disagree on the same run's number (Kaohsiung: home `#2733` vs run-info `#2734` for the same July 11 run). When merging the two surfaces, **match by date, not run number**, and prefer the detail page's number.
- **No Wix Events widget in use** — so the "events-page is JS-rendered" caveat doesn't bite here; everything needed is SSR'd. Static Cheerio only.
- **Year-less `Month Day` dates** with only ~2–3 forward runs (all future) → a simple Dec→Jan forward rollover suffices (no Taipei-style run-number anchoring — that's only for a deep year-less history page).
- **Coords:** venues are `maps.app.goo.gl` shortlinks (no coords). 🔴 A site may also expose a decimal Maps coord that is a **sponsor/bar pin, NOT a run start** (Kaohsiung's `22.62,120.29` = "Uncle Bob's") — don't harvest it for events. lat/lng undefined → merge geocodes the venue text / metro centroid.
- **Logo + collision notes:** Wix `static.wixstatic.com/media/<hash>~mv2.png` → self-host + magic-byte the ext. The kennel's own shortcode can collide globally (KHHH=Kampong H3, KH3=Kowloon H3) → use a city-based kennelCode (`kaohsiung-h3`) and omit the bare shortcodes.

**Implementation update (SHIPPED [PR #2196](https://github.com/johnrclem/hashtracks-web/pull/2196), 2026-06-14)** — three reusable adapter learnings for *any* multi-run SSR page (the research addenda above all held):
- **🔴 Fail-loud must be PER-RUN, not just per-page.** A single `events.length === 0` (or windowed-empty) guard misses **partial** drift: with two runs on the page and one heading's date no longer parsing, the scrape returns one event with `errors: []`, so `scrape.ts` runs stale reconciliation and (because `upcomingOnly` only shields *past* events) `reconcile.ts` false-CANCELs the drifted run's sole-source canonical **while the page still lists it**. Fix: every numbered (`#NNNN`) block that fails to fully parse pushes a `ParseError` into `errors[]` **and** `errorDetails.parse` — so partial markup drift suppresses reconcile even when other runs parse cleanly. (Codex adversarial-review catch; generalizes the Vindobona/Taipei single-page zero-guard to per-block granularity. → memory.)
- **🔴 Month parsing: generic word-token + exact `Map.get()`, NOT a month-name alternation.** A full-name+abbreviation regex alternation (`/(january|…|dec)/i`, ~23 arms) trips Sonar **S5843** (complexity >20); an abbreviation+`[a-z]*` form re-introduces an S5852 shape AND mis-matches "Maybe"→"May". The clean form that satisfies every reviewer from the first write: scan candidate words with `/\b[a-z]{3,9}\b/gi` (trivial complexity) and validate each by **exact lookup in a `Map` keyed by both full names and abbreviations** (`MONTH_INDEX.get(word.toLowerCase())`) — no alternation, no prefix slice, no "Maybe" false positive, and a `Map` (not a `Record[var]`) dodges Codacy's object-injection rule. Two-pass month-then-day (don't combine into one date+time regex).
- **Parse the richest single surface, skip redundant ones.** Kaohsiung's home page carried the *same* two runs as `/run-information` and only introduced the cross-page run-# drift — parsing `/run-information` alone removed the discrepancy with zero loss. Only merge a second surface when it demonstrably adds runs the first lacks (match by date, prefer the detail page's number).
- **Bare run-type titles → leave `title` undefined.** "Saturday Night Run" / "Sunday Family Run" are not themes; leave `title` undefined so `merge.ts` synthesizes "Kaohsiung H3 Trail #N" (verified end-to-end: #2732 → "Kaohsiung H3 Trail #2732"). Keep only descriptive themes ("7-eleven Joint Night Run").

#### 🔴 Home-page SSR is per-tenant — do NOT assume it (Taiwan Wix siblings, 2026-06-16)

The "Wix SSRs the current event on the home page" behavior above is **tenant-dependent — confirm it per site, never assume it.** Three Taiwan Wix kennels, three different outcomes:
- **Kaohsiung H3** (`kaohsiunghash.com`, already live) — home page AND `/run-information` **fully SSR the upcoming runs** as text headings (`#2732 - June 27 - Saturday Night Run`) + rich per-run detail (hares, cost, Maps `maps.app.goo.gl` pin, time, prose). A plain `web_fetch`/Cheerio parse works; no browserRender. Its `/run-schedule` page is a **PNG image** (the full year) — useless for scraping; the home + `/run-information` surfaces are the real source. Note: home heading run# can disagree with `/run-information` (Kaohsiung's `#2733 Jul 11` home vs `#2734 Jul 11` run-info) — a source inconsistency, not a parse bug.
- **Taoyuan Metro H3** (`tymh3.com`) — home AND `/upcoming-run` SSR carry **NO run data** (only nav, logo, tagline, email, FB link); the run list is a fully JS-rendered Wix Events widget → **needs browserRender**.
- **Taichung H3** (`taichunghash.com`) — returns an **empty body** to a plain fetch (JS-rendered/anti-bot) → needs browserRender.

So for any new Wix kennel: `web_fetch` the home page first; if the runs appear as SSR text → small static Cheerio scraper (Kaohsiung/Boise pattern). If empty/nav-only → browserRender (northboro pattern), and from the research sandbox you likely **cannot verify the sample** (no browserRender; Chrome MCP auto-denies the brand-new domain with no user present) → write a `handed-off (needs live-verify)` handoff or leave it `verify-live-first` and flag for Claude Code.

---

## WordPress.com hosted blogs (learned from ONH3, 2026-05-29)

Many international kennels (especially African / Asian / Latin American) run on `*.wordpress.com` rather than self-hosted WordPress. These blogs **always** expose the WordPress.com public REST API — no auth, no rate-limit headaches in practice:

```
https://public-api.wordpress.com/wp/v2/sites/<host>/posts?per_page=100&page=N&_fields=id,date,link,title,content,categories
```

`SWH3Adapter` and `ONH3Adapter` both use it. Pattern:

- **`posts[].title.rendered`** — HTML-encoded title. Parse run number + theme here. Title formats drift across years ("Run 1326", "Monday 30 Mar 2026 | Run 1326", "ONH3 1023 Orange Run") — extract the run number leniently and **leave `title` undefined when no clean theme exists** so `merge.ts` synthesizes the canonical title (never let a labeled-field fragment or hare name become the title).
- **`posts[].content.rendered`** — full post HTML. Flatten with `stripHtmlTags(html, "\n")` (newline separator) so each labeled field stays on its own line; then a multi-pass tokenizer can bound a field value at the next label **or** the next newline. This matters because ONH3 puts each field (`Date:`, `Hare(s):`, `Venue:`) in its own block element and appends an unlabeled write-up — a trailing field like `Venue:` would otherwise swallow the whole recap.
- **Embedded recaps:** trail posts often bundle a "Hash Trash" recap of the **previous** run in the same post. Split the body on `/Hash\s+Trash/i` and parse only `[0]`, or you'll harvest the wrong run's date. Standalone "Hash Trash Run NNN" recap posts (and socials) should be skipped by title.
- **Dates:** labeled `Date:` values vary — full month ("30 March 2026"), abbreviated ("16 Mar 2019"), and weekday-prefixed ("Monday, 20 April 2026"). Slice the `Date:` value, then *search* (don't anchor) a simple `D Month YYYY` regex; resolve the month by 3-letter prefix. Hareline-table dates are `DD/MM/YYYY` (UK/Kenyan order — **not** US M/D/Y).
- **`posts[].date`** — ISO 8601 publish date; a usable fallback when a post omits a per-run `Date:` line.
- **`posts[].categories`** — numeric IDs; not reliable for run/recap classification on ONH3 (recaps appear under both "Hash Trash" and "Uncategorized"). Prefer title patterns.
- **Annual "Hareline YYYY" master posts** — one post containing a `<table>` of every run for the year (Run nr | Day | Date | Hare | Venue | Location). These arrive through the same posts list — route by title (`/^\s*hareline\s+\d{4}/i`) to a `cheerio` table parser; the merge pipeline dedupes table rows against per-post announcements by kennel + date. **Split past vs future:** the recurring adapter emits only **future** table rows (`date >= today`) — the live advance schedule that the kennel's Google Calendar doesn't reach (GCal ran ~4 weeks ahead at most). The **past** rows (the archive) are mapped once into a one-shot backfill script (`scripts/backfill-onh3-history.ts`) rather than re-parsed every scrape — per `feedback_historical_backfill`. To stop reconciliation false-cancelling that archive once it ages off the blog's first page, set `config.upcomingOnly: true` on the source (restricts `reconcile.ts` to future dates). **Caveat:** only newer years use `<table>` — older "Hareline" posts may be a prose list (hand-map those into the backfill).
- **Pagination:** `page=N+1` returns HTTP **400** (not 404) past the last page — treat 400 as a clean end. Only set a non-null `kennelPagesStopReason` on genuine truncation (a full page left unfetched / an HTTP or fetch error); a non-empty string suppresses stale-event reconciliation in `scrape.ts`.

**Detection:** WordPress.com hosting shows a `gravatar.com/blavatar/…` favicon and `meta-generator: WordPress.com` in the page `<head>`.

**Effort:** ~200–280 LoC per kennel (each kennel's title + body format is bespoke; the WP REST plumbing is trivial). Once 3–4 ship, factor a shared `WordPressComAdapter` base class taking a `parseTitle`/`parseBody` config.

#### Asunción H3 addenda (verified via real REST fetch, 2026-06-03) — clean variant + two new gotchas

ASU H3 (`asuncionh3.wordpress.com`) is the *cleanest* WP.com case so far — **all** posts are `Run #N` (titles `"Run #120"`, `categories:[1]`), no Hareline-table posts, no embedded "Hash Trash" recaps (post-run photos sit under an "Impressions" Jetpack tiled gallery, not a labeled run block). Two non-obvious things confirmed by inspecting the real `content.rendered`:

- **🔴 Bilingual two-column body.** Each run renders EN (left column) then ES (right column), so EVERY labeled field appears twice: `Hare(s):`/`Liebre(s):`, `Start:`/`Inicio:`, `Cost:`/`Coste:`, `Bag drop:`/`Entrega de bolsas:`, `Food & circle:`/`Comida & Circle:`. After `stripHtmlTags(html,"\n")` flatten, take the **first** (English) occurrence of each label. The date line is the same: `Saturday, 30 May 2026` then `Sábado, 30 de mayo 2026` — parse the first.
- **🔴 Date is fragmented across `<strong>` tags in raw HTML** (`<strong>Saturday, 30 </strong><strong>May 2</strong><strong>026</strong>`). Parse the date ONLY after flattening — a regex on raw HTML sees `30 ` and `May 2` as separate tokens. (General WP.com lesson, acute here.)
- **🔴 Start coords come from a Google Maps EMBED iframe, NOT a place/share link.** `src=".../maps/embed?pb=…!2d<lng>!3d<lat>…"` — order is **`!2d`=longitude, `!3d`=latitude**, and there is **no `!4d`**. `src/lib/geo.ts extractCoordsFromMapsUrl` Pattern 1a requires `!3d…!4d…` and Pattern 1b requires `@lat,lng` → **neither matches an embed URL**, so it returns `null` and the pin is dropped silently. Extract in-adapter: `m = src.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/); {lat:+m[2], lng:+m[1]}`. (The `Food & circle:` link is a `maps.app.goo.gl` shortlink for the circle venue, not the start — don't use it for coords.)
- **Publish date ≠ run date for historical runs** — ASU batch-posted backfilled runs (e.g. #84–#86 all on 2024-11-18, #58–#62 all on 2024-01-08), so the post `date` is unreliable for those; always parse the in-body `Saturday, D Month YYYY`.
- **🔴 The in-body date format drifts HARD across the archive — "parse the first D Month YYYY" is not enough.** Confirmed at implementation time (all 120 posts): only ~10 use the clean `30 May 2026` form. The rest mix **ordinal + "of"** (`5th of December 2021`, `28th of May 2022`), **plain** (`17 January 2026`), **English weekday + Spanish month** (`14 marzo 2026` — they typed the Spanish month in the English column), the **full Spanish `de` form** (`Sábado, 30 de mayo 2026`), and a **recurring source typo `Arpil`** (runs #34, #35). Robust recipe: (1) normalize first — strip ordinal suffixes (`/(\d)(?:st|nd|rd|th)\b/→$1`) and the connectors `of`/`de` (`/(\d)\s+of\s+/`, `/(\d)\s+de\s+/` — keep them as **separate literal replaces**, not `(?:of|de)`, or Sonar S5852 flags the `\s+`-around-alternation shape); (2) then a single loose `\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,12})\s+(\d{4})\b`; (3) resolve the month against a **combined English+Spanish map** (enero…diciembre, mayo, marzo, …) **plus** known typos (`arpil:4`). Validate via `Date.UTC` round-trip; store UTC noon.
- **`categories:[1]` ("Runs") IS reliable here** (unlike ONH3) — usable as a defense-in-depth guard alongside the title regex: `RUN_TITLE_RE.test(title) && (post.categories?.includes(1) ?? true)` (falls open if a post omits categories).
- **Char classes under the `/i` flag must not include both `A-Z` and `a-z`** — `[A-Za-z …]/i` trips Sonar S5869 (duplicate class, since `/i` already folds case). Use `[A-Z …]`. (Bit the per-line label regexes here.)
- **Pagination:** 120 posts → `per_page=100` page1=100, page2=20, **page3 → HTTP 400 (clean end)** — same as ONH3. **But a 400 on PAGE 1 is NOT a clean end** — it means the site/API is gone; flag it as truncation (`kennelPagesStopReason`) so reconcile can't read the empty scrape as authoritative and cancel upcoming events. (CodeRabbit/adversarial-review catch — the healthy "0 upcoming" path still returns posts on page 1, leaving the flag null.)
- **`safeFetch`'s direct-fetch path has no default timeout** (only the residential-proxy branch does). Pass `signal: AbortSignal.timeout(30_000)` so a hung WP.com connection can't block the scrape indefinitely (matches `chicago-shared`/`phoenixhhh`).
- **Site/logo metadata** lives at `public-api.wordpress.com/rest/v1.1/sites/<host>` (`name`, `description`, `logo.url`, `icon`) — handy when the site's About page is on a brand-new domain Chrome won't auto-approve. ASU's `logo.url` is a stable non-tokenized `wp-content/uploads/.../wp-banner-1-1280x426-1.png` (a 3.9 MB PNG — self-hosted to `public/kennel-logos/asu-h3.png`).

---

## Meetup — verifying upcoming events from the sandbox (learned from Paris/SCHHH + ZH3, 2026-05-29; corrected 2026-06-02 after Paris shipped)

`MeetupAdapter` is config-only (`groupUrlname` + `kennelTag`, optional `kennelPatterns`/`extractRunNumber`), but **verifying that a Meetup group actually has upcoming events is the trap** — the dynamic-source rule lives or dies here. Two lessons:

- **The group *events-list* page (`/<urlname>/events/`) is JS-rendered. Its bare SSR shell always shows `Events 0 … Upcoming` from a plain fetch — that "0" is a hydration artifact, NOT a real zero.** Do not conclude "no upcoming events" from the list count — read the page's `__NEXT_DATA__` Apollo state (Chrome JS-render), which carries the real `Event` collection. **🔧 2026-06-02 correction:** Paris/SCHHH was marked `blocked` on 2026-05-29 as a *real* 0-upcoming — that was a **false negative**. Its shell showed "Events 0" while the Apollo state held **30 live group events** the whole time; onboarded via [PR #1920](https://github.com/johnrclem/hashtracks-web/pull/1920) (18 prod events across two kennels). The shell counter is never authoritative; only the Apollo `Event` collection is.
- **Individual event *detail* pages (`/<urlname>/events/<id>/`) ARE fully server-rendered** — title, `Sat, Jun 6 · 2:00 PM to 5:00 PM CEST`, venue + maps link, hares, cost, run number all in the HTML. **To verify upcoming events, web-search the group name for an indexed future event page and fetch that**, rather than trusting the list. A live, future-dated detail page = source confirmed. This also yields a real sample event for the handoff.
- **"Request to join" (semi-private) groups still expose public event detail pages** (ZH3 is request-to-join yet its #1731 page is public + indexed). But flag for Claude Code to confirm the adapter's events-page/Apollo extraction returns events for such groups — a private group *could* gate the list even while detail pages are public.
- **Telling a dead kennel from a between-postings gap — the Apollo `Event` collection is the ONLY reliable signal.** A genuinely dormant group shows an *empty Apollo collection* AND a stale site with its most-recent event in the past. **Do not infer "dead" from the shell "0" + a stale site alone** — that exact combination produced the **false block on Paris** (its blog `parishash.wordpress.com` had been stale since 2024 *and* the group was very active). Read the Apollo state first; if it's genuinely empty and the signals point dormant, mark `blocked` (revisit). When Apollo carries a future event, it's live.
- **The kennel's own site often *is* just a Meetup funnel** — `zh3.ch` / `parishash` both say "go to Meetup for the location." In that case Meetup is the right primary source even though a WordPress/blog URL also exists; the blog carries announcements, not per-run location/date.

#### 🔴 `MeetupAdapter` SETS `title` — the generic "leave title undefined" rule does NOT apply to MEETUP (learned from Mexico City H3, 2026-06-03)

The general handoff guidance is *"leave `title` undefined; `merge.ts` synthesizes `<KennelName> Trail #N`."* **That is wrong for MEETUP.** `MeetupAdapter.buildRawEventFromApollo` sets `title: cleanMeetupTitle(ev.title)` — the cleaned Meetup event name — for **every** Meetup source, and `merge.ts` (the `sanitizeTitle` branch) **keeps an adapter-provided title**, only synthesizing `Trail #N` when title is *absent*. There is **no `MeetupConfig` knob to suppress it**. So live-scraped Meetup events display the real Meetup names (e.g. `"HASH #756- SPRING HASH !"`, `"Run #749 – Octuber 25th"` [source typo], `"Hash House Harriers Mexico City - Run #748"`).

- **Don't tell a MEETUP onboard to leave title undefined** — the adapter will set it regardless; the synthesized-`Trail #N` path is unreachable for MEETUP.
- **MEETUP backfills MUST freeze the real cleaned Meetup titles.** If a one-shot backfill leaves `title` undefined (synthesizing `Trail #N`) while the live adapter sets the Meetup name, the kennel ends up with **mixed titles** (synthesized past runs vs Meetup-named live runs) **and title churn** on the in-window overlap the adapter re-scrapes (within `scrapeDays`). Capture the real titles from a live `adapter.fetch(source, {days})` against the **`?type=past`** page (the adapter fetches the past page too) and paste them verbatim into `scripts/data/<code>-history.json`. This still avoids the real anti-pattern (a bare theme as the title) because these are full event names. (Mexico City H3, [PR #1953](https://github.com/johnrclem/hashtracks-web/pull/1953); agent memory `reference_meetup_adapter_sets_title`.)

#### Meetup `foundedDate` ≠ kennel founding; gather-time ≠ event start (Mexico City H3, 2026-06-03)

- **Never use the Meetup group `foundedDate` for `foundedYear`** — it's the *group-creation* date (Mexico City H3's group = 2022-09-08, kennel founded **1983**; run #756 long predates the group). Use a primary/editorial source for the kennel founding.
- **Seed the operational event start time, not an editorial "gather at ~X."** When a press/editorial blurb's gather time disagrees with the consistent Meetup event start (MND said "2 p.m." but every event started 13:30), seed the Meetup start (`scheduleTime: "1:30 PM"`). When stated cadence ("every other Saturday") disagrees with observed cadence (~monthly), keep the stated `scheduleFrequency` and record the observed reality in `scheduleNotes`.

---

## Squarespace — content-page harelines ≠ Events collections (learned from Mijas H3, 2026-05-30)

There are **two distinct Squarespace patterns**, and they need different adapters:

- **Events collection** (SACH3, 2026-05-27): a Squarespace *Events* page backed by an events
  collection. Fetch `?format=json` for structured event JSON → handled by the shared
  `SquarespaceEventsAdapter`. **This is the config-only path.** (Watch the tenant-default
  Manhattan-coord trap + pagination + endDate/endTime — see the SACH3 entry / run-log.)
- **Content-page hareline** (Mijas H3): a *regular content page* (`/hareline`) where the committee
  hand-maintains the season's runs as a delimited text list under month `<h2>` headings, e.g.
  `2020 - 31 May 2026 - Shaggy & AguaSex - AGM Run`. There is **no events collection** behind it,
  so `?format=json` returns page content blocks (not events) and `SquarespaceEventsAdapter` does
  **not** apply. This needs a **small bespoke Cheerio scraper** with a line tokenizer
  (`split(/\s+-\s+/)` → runNum / `DD Month YYYY` date / hares / theme). `GenericHtmlAdapter` can't
  do it (it maps one CSS selector → one field; it can't split a single text line into 4 fields).

Detection / gotchas for the content-page variant:
- **Server-rendered** — a plain fetch returns the full list as text, so Cheerio works; no
  browser-render needed. (Squarespace SSRs page content.)
- **DOM order is NOT chronological** — Mijas' live page renders the **August** block *before* the
  **May** block. Parse each line's own full date; never trust the `<h2>` month heading for the year
  or assume source order is sorted.
- **List wrapper:** items live in a Squarespace `.sqs-html-content` / `.sqs-block-content` block as
  `<ul><li>` or `<p>` lines — content-keyed traversal; capture the real DOM for the test fixture.
- **No per-event coords or times** in a hareline list (a separate "Next Run Details" page may carry
  the single next run's pin/time) → no coord-corruption trap, but `startTime`/`location` come out
  undefined. Set `config.upcomingOnly: true` (a rolling hareline prunes old months → protects
  reconcile).
- **Logo** is the usual tokenized `images.squarespace-cdn.com/.../<hash>/logo.<ext>` → self-host.
- **Sub-letter run numbers** (`1999a`/`1999b`): when two trails share a base run number on different
  dates (a Memorial Run squeezed in, an away-weekend split), keep the base integer in `runNumber`
  and emit the suffix as **`eventLabel`** (`"a"`/`"b"`). Dropping the suffix collapses both rows to
  `(sourceUrl, runNumber)`; since a content-page hareline emits a single fixed page `sourceUrl`, the
  merge same-sourceUrl date-correction then "moves" one onto the other's date and deletes a real
  event (Mijas #1848). The date-correction probe co-matches on `eventLabel`, so the label keeps them
  distinct. `parseRunLabel` in `mijas-hash.ts` is the reference.

#### 🔴 Third pattern — separate "Run Reports" / archive collection (learned from Mijas H3, 2026-05-30)

In addition to (1) the Events collection (SACH3 path) and (2) the content-page hareline (Mijas
upcoming-runs path), a Squarespace kennel often has a **third surface**: a separate **blog/journal
collection** with one post per past run. **This is the historical-backfill source — but you only
find it by probing for it explicitly.** The Mijas H3 handoff missed it and declared "no history
available"; the same site had `/run-reports` with **389 events back to 2005** (a 353-run miss).

- **EVERY Squarespace blog collection is JSON at `<path>?format=json-pretty`** (paginated via
  `?offset=…`). The response is `{ items: [{ id, recordType, title, publishOn (epoch-ms), body
  (HTML), urlId, … }], pagination: { nextPage: true | absent, nextPageOffset } }`.
- **Pagination end is signaled by OMITTING `nextPage`** (not `nextPage: false`). Fail-loud: if
  you stop early because `nextPageOffset` is undefined but the last page was full, that's a
  truncation — log it and surface as a stop reason; don't quietly tail-prune.
- **Discovery routine:** walk top-nav + footer links; for any that smells archival (Run Reports,
  Trail Recap, Hash Trash, Journal, Blog), curl `<url>?format=json-pretty` and inspect:
  ```bash
  curl -s "https://<site>/<collection>?format=json-pretty" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("items:",len(d.get("items",[])),"oldest:",min((i.get("publishOn",0) for i in d.get("items",[])), default=0),"next:",d.get("pagination",{}).get("nextPage"))'
  ```
- **Run number lives in the title or body** (e.g. `"Run #849 …"` or `"#849 – …"`); extract via
  `extractHashRunNumber` from `src/adapters/utils.ts` rather than a bespoke regex.
- **Backfill, not adapter.** Drive this from a one-shot `scripts/backfill-<code>-history.ts` per
  the ONH3 pattern. The recurring adapter scrapes the future-facing surface (hareline or events
  collection) and emits future-only with `config.upcomingOnly: true`.
- **`location` is tri-state in backfill.** `cleanLocationName()` returns `null` for "TBD" / unknown;
  preserve that null (don't coerce to empty string), so the merge pipeline can display "venue TBD"
  properly.

---

## Ghost blog — the run descriptor lives in the post TITLE (learned from Bali Hash 2, 2026-05-30)

Ghost-hosted kennels (balihash2.com) publish one post per run with a **structured title**:
`Bali Hash 2 Next Run Map - #NNNN - <location> - D-MMM-YY`. The home page lists ~12–22 recent
posts as `article.gh-card` / `a.gh-card-link`; the detail page (`section.gh-content`) adds GPS,
hares, and a per-tier fee table.

- **Parse the title for the `title` field**, not just the run number. The middle `<location>`
  segment is the source's own per-run descriptor — slice off the `…#NNNN - ` prefix and the trailing
  ` - D-MMM-YY` date (index slicing + a date regex, no `.*?`/`\s*` shapes → Sonar S5852-safe).
  Leaving it on the synthesized `<Kennel> Trail #N` default is the `stale-default-title` finding
  (Bali #1838). `parseBaliTitle` in `bali-hash-2.ts` is the reference.
- **The home page is recent-only** → set `config.upcomingOnly: true` and drive deep history from a
  one-shot `scripts/backfill-<code>-history.ts` that walks `/page/N/` reusing the adapter's own
  `parseListingCards`/`buildEvent` (no parser fork — the title fix lands in the backfill for free).
- **Corrected reposts** get a `…-2` slug published later (higher on the reverse-chron listing);
  dedupe by run number keeping the first DOM occurrence so the correction wins.
- **`hashCash`** is a per-tier fee table in every post body, not a single value — capture verbatim
  (`Members Rp.X / Non-drinkers Rp.Y / Visitors Rp.Z / Kids <15 Rp.W`).

## Google Sites + embedded Google Sheet (learned from NSWHHH, 2026-06-02)

New Google Sites (`*.info`, `sites.google.com`) kennels often pair a **server-rendered home page**
(current run, rich) with an **embedded Google Sheet** (forward hareline + history). NSWHHH shipped
both as two sources.

- **The home page is fully SSR'd** — a plain `fetchHTMLPage`/`curl` returns the run details
  (`Run #:`, `Date:`, `Hare:`, `Circle up:`, `On Inn:`, `Directions:`). **No `browserRender` needed.**
- **Content blocks have rotating, opaque class names** (deeply nested divs). Key the parser on
  **visible text**, not selectors: linearize via the shared `stripHtmlTags(html, "\n")` (same helper
  DCFMH3 uses), split into lines, find the `Run #` line, walk to a stop sentinel (`Recent Runs/Walks`),
  and classify each line by its label prefix. Labels render with the colon immediately after the
  word (`Date:`, not `Date :`) — so label regexes need no `\s*` (which also keeps them S5852-clean).
  `nswhhh.ts` is the reference.
- **Coordinates** come from the embedded Maps `<iframe>` `src`, which carries both `q=<lat>,<lng>`
  (the marker) and `ll=<lat>,<lng>` (the viewport center) — **prefer `q=`** (`extractCoordsFromMapsUrl`
  already orders `q` before `ll`). The `Directions:` link is a `maps.app.goo.gl` shortlink (no coords).
- **🔴 Tokenized `sitesv` logos 403 server-side.** The `og:image` is
  `lh3.googleusercontent.com/sitesv/AA…=w16383` — a **session/referer-bound** token that returns
  HTTP 403 to `curl`/`safeFetch` and **rotates per page load**. It loads fine in an authenticated
  browser, so **grab it via Chrome MCP** (navigate to `/home`, read the rendered logo `<img>` /
  `og:image`, fetch it in-page, download) and self-host to `public/kennel-logos/<code>.<ext>` (confirm
  the extension via magic bytes). Extends the self-host-logo convention to a browser-only fetch.

### The embedded Google Sheet (GOOGLE_SHEETS source)

- **🔴 Enumerate ALL tabs/gids before declaring "no history."** The link/embed `gid` is usually just
  the **forward** hareline; a sibling tab often holds a clean **archive**. NSWHHH's embed was `gid=0`
  (28 forward runs); `gid=360703890` held 160 archived runs back to 2022. List tabs via
  `…/htmlview` (`grep -oE 'gid=[0-9]+'`) and confirm columns via `…/gviz/tq?tqx=out:json&gid=N`.
  (Generalizes the Mijas "probe other collections" lesson from Squarespace to Sheet tabs.)
- **🔴 Use `config.csvUrl`, NOT `config.gid`, for anonymous public sheets.** `GoogleSheetsAdapter`
  checks `GOOGLE_CALENDAR_API_KEY` **before** the `gid` branch (`adapter.ts` ~L726), so a `gid`-mode
  source errors without the key even though gid-mode never calls the Sheets API. Seed the full
  `…/export?format=csv&gid=N` URL as `config.csvUrl` (keep `sheetId` for `validateSourceConfig`) —
  it routes through `fetchDirectCsv`, which skips the key gate. HEAD-check the export is
  `content-type: text/csv` (not a login-redirect HTML page) at research time.
- **`columns.location` is optional** — a `date | run # | hare` forward sheet with no venue column is
  valid; omit it and let a sibling source supply the venue.
- **"No Run" / holiday rows** carry a real date but an empty run # and a "No Run …" note in the hare
  column — drop them with a `silentlySkipPatterns` entry matching `\bno\s+run\b` on the `hares` field
  so they don't ingest as phantom runs.
- **Backfill the archive tab** with a one-shot `scripts/backfill-<code>-history.ts` (require a numeric
  run #, `date < today`), bound to the live source row. The forward source stays `upcomingOnly`.

### Dual-source trust ordering follows COORD OWNERSHIP (not "primary vs enrichment")

When a location-less primary (the sheet) is paired with a coord-bearing secondary (the website), the
**coord-bearing source must be ≥ the other's trust.** The merge pipeline's lower-trust enrichment
path (`merge.ts` ~L1668) backfills `locationName` but **NOT** `locationAddress`/`latitude`/`longitude`,
so a *lower*-trust coord source has its map pin silently dropped whenever the higher-trust source's
raw merges first (order is nondeterministic across two daily scrapes). NSWHHH: website → trust **8**,
sheet → **7**. Pre-state trust by which source owns the coordinates, and add a merge-level regression
test (sheet-first → website-second → assert coords land). (A follow-up to make the enrichment path
backfill coords symmetrically is tracked separately.)

### Single current-run home page (no embedded sheet) — learned from Manila H3, 2026-06-08

Some Google Sites kennels render **only the current "next run"** as one label block, with no embedded
sheet and no reachable archive (Manila H3: `ano (what) / kailan (when) / sino (who) / saan (where) /
mapa:`). Treat these like Boise/NSWHHH's website surface:

- **`config.upcomingOnly: true`** (the run ages off weekly) **+ a mandatory fail-loud guard**: if the
  label block doesn't parse, push an `errors[]` entry so reconcile is suppressed — don't let the scrape
  "succeed" with `events: []` (the zero-event health alert can't catch that on a brand-new source whose
  baseline is already 0). No historical backfill.
- 🔴 **Match labels on a whitespace-collapsed copy of the line, then read the value after the closing
  `)` — NOT a label-prefix regex.** Google Sites splits words across inline `<span>`s; `stripHtmlTags`
  re-joins them without separators *usually*, but a stray space inside a label (`si no (who)`,
  `saan (whe re)`) makes a `/sino\s*\(who\)/` regex silently miss and **drop the hare/venue every
  scrape** while the date/run still parse (the fail-loud guard, which checks the date, won't catch it).
  Robust shape: `compact(line) = line.replace(/\s+/g,"").toLowerCase()`, detect via
  `compact(line).includes("sino(who)")`, extract via `line.slice(line.indexOf(")")+1)`. Add a
  regression test feeding the spaced-label variant.
- **Encoded fields parse deterministically, not via chrono.** Manila's run number is roman+decimal
  (`mmdccxxviii = 2728` → take the decimal after `=`) and its date is an encoded token
  (`sikoklokmon08jun26` → `\d{1,2}[a-z]{3}\d{2}` core → UTC noon). Resolve month via a 3-letter map,
  keep regexes simple (S5852/S5843).
- **`title` undefined → merge synthesizes `"<Friendly> Trail #N"`.** Confirm `friendlyKennelName`
  short-circuits on a >4-char shortName before relying on it.
- 🟡 **Codacy runs `eslint-plugin-security` (local `npm run lint` doesn't).** `Record[var]` /
  `arr[i]` / `str[i]` lookups are flagged `detect-object-injection` ("Object Injection Sink") — use
  **`Map.get()` and `for…of`** in new adapter code instead (also fixes `noUncheckedIndexedAccess`).
  The unavoidable `detect-non-literal-html-method` hits (`stripHtmlTags(html)`, passing `html` to the
  parser) are the documented-accepted class — left unsuppressed per `.codacy.yml`. If Codacy freezes on
  stale line numbers (0s run), verify clean + document; don't churn (it's non-blocking — `main`
  unprotected).

### `sitesv` logo — a `Referer` header often fetches it server-side (refines the NSWHHH note)

The NSWHHH note said `lh3.googleusercontent.com/sitesv/…` logos 403 server-side → browser-grab. For
Manila, **`curl -e https://sites.google.com/ <ogimage>` returned HTTP 200** (real PNG, magic-byte
confirmed) — a `Referer` header was enough. The token still rotates per load, so a browser grab remains
the fallback, but try a Referer'd `curl` first.

## Blogger / Blogspot — staleness check from the sandbox (learned 2026-06-03, LatAm leads)

The Blogger JSON feed `https://<blog>.blogspot.com/feeds/posts/default?alt=json&max-results=N` **is fetchable from the research sandbox via `web_fetch`** (returns `application/json`, not stripped) — a reliable, fast recency probe for Blogspot-hosted kennels.

- **🔴 The feed-level `updated` timestamp is NOT the latest post date.** Buenos Aires H3's feed showed `updated: 2025-02-12` but its newest *entry* was **Hash #739, March 2020** (the blog's metadata churns; the posts stopped). **Always read `entry[0].published`**, not `feed.updated`, to judge staleness. Santiago H3 feed `updated:2026-05-06` but newest entry was 2015.
- `openSearch$totalResults` gives the archive depth (BA: 265 posts; Santiago: 121) — useful for sizing a historical backfill IF a live source ever surfaces. Many LatAm Blogspots are dead-since-COVID archives whose live activity (if any) moved to Meetup/FB — verify the *current* source separately before queueing.
- **🔴 The public `/feeds/` endpoint CAPS at ~150 entries** even with `max-results=500` — it's a depth *probe*, not a full extractor. Brasília's public feed returned 150 of 186 posts (losing the oldest ~3 years / back to #154). For the actual backfill, use the **keyed Blogger API** (`fetchBloggerPosts(url, 200)`, Blogger API v3, `GOOGLE_CALENDAR_API_KEY`), which returns the complete archive.

#### Brasília H3 addenda (verified via real feed + adapter run, 2026-06-04) — EMPTY-TITLE body parsing

`brasiliah3.blogspot.com` (first Brazil kennel) is the **empty-title** Blogspot variant — UNLIKE
Brass Monkey (titles carry `Brass Monkey #NNN`), **every post's `title.$t` is `""`**. All run data
lives in the **post body**. Confirmed structure, stable April 2019 → June 2026:

- **🔴 Detect run posts by a BODY match, not the title.** After `stripHtmlTags(content, "\n")`,
  anchor on the **first** `Hash N+\d+` occurrence. Posts without it (Stammtisch socials, away-hash
  weekends, "About" pages) are non-runs → skip. Because titles are empty you cannot classify by title
  at all; pair the body detector with a `events.length === 0 && posts.length > 0` **fail-loud guard**
  (a brand-new source has no fill-rate baseline, so a body-format drift won't otherwise alert).
- **Body order:** heading `Hash N+NNN "<Theme> Hash"` → date line `Weekday, Dth of Month` → jokey
  prose. **Anchor date + venue extraction to `body.slice(firstRunMatchIndex)`** — a previous-run photo
  gallery is sometimes prepended (post edited after the run), so a first-match-over-the-whole-body
  search can grab the wrong date/venue.
- **🔴 Run number is `N+NNN`** — the `N+` is the kennel's post-reboot numbering. Store the bare
  integer after `N+` as `runNumber` (e.g. `340`); don't pack `"N+"` into the numeric field. Leave
  `title` undefined → merge synthesizes `"<Kennel> Trail #340"`. (`extractHashRunNumber` does NOT fit
  — it keys on `#`, not `N+`; use a local `/Hash\s+N\+(\d+)/i`.)
- **🔴 Date line has NO YEAR** (`Sunday, 7th of June`). Parse the in-body `Dth of Month` for day+month
  (month via a `MONTHS` 3-letter-prefix lookup), then **infer the year as the candidate ∈
  {publishYear−1, publishYear, publishYear+1} CLOSEST to `post.published`** — validating each candidate
  first so an impossible date (31 Feb, non-leap 29 Feb) can't mask a valid sibling year.
  ⚠️ **Do NOT use the naive "publishYear, +1 if the date is >7d before publish" rule** — it's wrong:
  many posts are **recaps published days-to-weeks AFTER the run** (the prepended-gallery case), so the
  run date is often *before* publish, and the naive +1 rolls those a full year forward (Brasília
  dry-run: 5 mis-dated). Closest-to-publish handles Dec→Jan rollover AND recaps in one rule. Sample
  dates from across the whole archive (oldest/middle/recent), not just the latest, before finalizing.
- **Venue label has TWO forms** — both should be parsed, each anchored to the **whole line** so prose
  that merely begins with "start …" can't false-match: (1) inline `Start: <venue>` /
  `Start Location: <venue>` / `📍 Start: <venue>`; (2) a `📍 Start` (or `Start`) **heading on its own
  line with the venue on the NEXT line** (recent posts, e.g. N+335 → `SQS 406, Bloco K`). Colon-only
  matching silently drops ~40% of the venues that exist.
- **No per-event coords or times** — `Start` is free-text venue only (no lat/lng, no map iframe). No
  default-pin trap; `latitude`/`longitude` stay undefined and the merge geocodes the venue text (or
  the region centroid for vague "Parking lot at …" strings). `startTime` undefined (not published).
- **A multi-year archive carries source-author errors** — extract them **faithfully**. Brasília reused
  `Hash N+252` for two different runs and copy-pasted a prior post's date line into six others (→ six
  same-date collisions). The merge pipeline collapses same-`(kennel, date)` RawEvents into one
  canonical Event; **never renumber or "correct" to satisfy a linter/bot** (a review bot flagged the
  dup N+252 and proposed renumbering to 253 — declined with live-blog evidence; it agreed).
- **No shared config-only Blogger adapter exists** — each Blogspot kennel is a bespoke ~180–240 LoC
  adapter (`brass-monkey.ts` title-parse, `ofh3.ts`/`brasilia-h3.ts` body-parse). Register by URL
  pattern in `htmlScrapersByUrl`. `fetchBloggerPosts(url, maxResults)` is the shared plumbing that
  bypasses cloud-IP 403s.

---

## Gamma sites (gamma.app) — server-rendered card pages (learned from Victoria H3, 2026-06-04)

Some kennels (Victoria H3 / `vh3.ca`) publish on **Gamma** (`gamma.app`), a slide/site builder. A
published Gamma site is reachable on a custom domain (`vh3.ca`) and on `*.sites.gamma.app`
(`www.vh3.ca` CNAMEs to `sites.gamma.app`).

- **Detection:** footer link "Made with gamma.app"; `meta-og:image` / `meta-twitter:image` on
  `assets.api.gamma.app`; all in-page images on `cdn.gamma.app/...` and `imgproxy.gamma.app/...`;
  `meta-robots: noindex, nofollow`.
- **Fully server-rendered.** A plain `web_fetch` / `fetchHTMLPage` returns the COMPLETE content
  (every event, all text) — **no `browserRender` needed.** Use static Cheerio.
- **🔴 Whole-document `.text()` / `stripHtmlTags()` STACK-OVERFLOWS.** Gamma nests each block in a
  deep tree of divs; calling `$.text()` on the root (or `stripHtmlTags(html)`) blows the domutils
  `textContent` recursion stack on a real page (vh3.ca is ~833 KB). `cheerio.load(html)` is fine —
  the overflow is only in whole-tree text extraction. **Select the leaf text-block wrappers and read
  each one's (shallow) `.text()` instead:**
  `'[data-node-view-content-inner="paragraph"],[...="heading"],[...="title"]'`. Each paragraph
  subtree is shallow, so per-node `.text()` is safe and yields clean lines in document order with
  entities decoded. (Confirmed Victoria H3 / PR #1992 — the first thing to get right on any Gamma site.)
- **Layout = "cards."** The page is a stack of Gamma cards anchored as `#card-<id>`. The content
  Victoria H3 exposed has the kennel data **twice**: (a) rich per-event **cards** near the top
  (image + bold heading `VH3 #929 The Double Sixth Festival` + `Where:`/`Hare:`/`Cost:`/`On-afters:`
  lines, near-term events only), and (b) plain per-kennel **schedule lists** at the bottom
  (`VH3 #918: Saturday, January 17, 2:30 pm.` … one line per run, the full season). **Parse the
  bottom lists as the backbone** (complete + clean), enrich the nearest runs from the top cards,
  match by (kennelTag, runNumber).
- **Multi-kennel pages are common** — one Gamma site can host several sibling kennels (Victoria H3 +
  Dark Side of the Moon H3 + Victoria K9 H3). Route by the run-line title prefix (`^VH3 #`,
  `Dark Side of the Moon Run #`, `^Victoria K9 H3 #`); seed one HTML source with all `kennelCodes`.
  **Emit a per-kennel fail-loud zero guard** (one error per expected tag, not just a total-zero
  check) so a partial parse — one kennel's prefix breaks while the others parse — can't let
  `reconcile` false-cancel the dropped kennel's future runs.
- **🟡 Schedule-vs-card discriminator: key on a WEEKDAY prefix, NOT a month-name substring.** A
  schedule-list line carries its date inline and its remainder after the run number starts with a
  weekday (`VH3 #918: Saturday, …`); a card heading's remainder is a theme or empty. Discriminate on
  `/^:?\s*(?:mon|tue|wed|thu|fri|sat|sun)/i` against the remainder — a month-name check would
  misclassify a theme like **"May Day Madness"** (contains "May") as a schedule row. (Codex catch on
  PR #1992.)
- **A "Hash Write-ups" prose section** gives completed runs a real theme/title (`Hash#918 The Annual
  New Year's Day Polar Bear Swim (Jan 1st)`). Parse it into a runNumber→theme map and use it as the
  title for past runs that have no card.
- **Rolling current-season page** — only the current year's runs are listed (no deep archive). Set
  `config.upcomingOnly: true` so reconcile doesn't cancel completed runs when the page rolls to the
  next year. Completed runs of the current season ingest on the first scrape (they're still listed).
- **Dates often omit the year** (`Saturday, June 6, 2:30 pm`); some include it; a January run can be
  next-year (`Friday January 1 (2027)`). Use `chronoParseDate` + a reference date + Dec→Jan rollover.
- **Venues are `maps.app.goo.gl` shortlinks → no extractable coords.** Store as `locationUrl`; leave
  lat/lng undefined (centroid fallback). No coord-corruption trap.
- **Logos are tokenized `cdn.gamma.app/...` URLs → self-host** to `public/kennel-logos/<code>.<ext>`;
  confirm the extension by **magic bytes, NOT Content-Type** — the VH3 logo is served `Content-Type:
  image/png` but is actually **WebP** (`RIFF…WEBP`), so it saved as `vh3.webp`. The Gamma CDN
  mislabels; trust the bytes.
- **✅ CONFIRMED DOM (Victoria H3, PR #1992).** Every visible text block is its own node-view wrapper
  `<div data-node-view-content-inner="paragraph|heading|title">…</div>`; one logical line = one
  wrapper. Venue links are `<a href="https://maps.app.goo.gl/…"><span>Venue text</span></a>` — the
  `.text()` of a paragraph loses the href, so build a venue-text→URL map separately via
  `$('a[href*="maps.app.goo.gl"]')`. Reference adapter: `src/adapters/html-scraper/victoria-h3.ts`
  (`linearize` = select the node-view leaves; two-pass parse = schedule backbone + card enrichment;
  `parseVictoriaH3Page` exported for unit tests with a fixture built from this real markup).

## Bespoke static club sites — forward hareline + per-year archive index (learned from Bangkok Monday H3, 2026-06-05)

Old-school hash club sites (Bangkok Monday H3 / `bangkokmondayhhh.com`, est. 1982 — hand-maintained
HTML, GIF banners, `index.php`) often follow a stable two-surface shape that's worth onboarding even
though there's no SaaS platform behind it:

- **Two pages, one table shape.** A **forward hareline** page (`FutureHares.html`) lists far-out runs
  (mostly `TBA` venues), and the **homepage** repeats a near-term `Run | Date | Hare | Location` table
  (the next ~8 runs, WITH venues) plus a **`#nextrun` block** that carries the single Google Maps pin +
  confirmed start time. **Fetch both, merge by run number** (dedupe; prefer the row that has a
  location), then attach the one next-run pin to its matching run. Plain `fetchHTMLPage` (static
  Cheerio) — no browserRender. Iterate `$("table tr")` and let the row parser reject non-data rows
  (header `<strong>`, decorative GIF rows, nav rows) by requiring a numeric first cell **and**
  `cells.length >= 4` — that filters the nav-table rows whose first cell is e.g. `"2024 Archives"`
  (note: `parseInt("2024 Archives")` = `2024`, so the cell-count guard, not the parseInt, is what
  saves you).
- **🔴 Year-less `DD MMM` dates need a BIDIRECTIONAL rollover, not just Dec→Jan.** These pages print
  `8 Jun` / `2 Nov` with no year. The forward case is obvious (a Jan row on a mid-year page → next
  year). The case the handoff missed (caught in review by Gemini + claude-review): the homepage's
  near-term table also retains the **1–2 just-completed runs**, so scraped in early January it still
  shows a **Nov/Dec run** — inferring the reference year would push it a year into the future. Rule
  that handles both, anchored on the actual scrape date:
  - candidate more than **~60 days in the past** → `refYear + 1` (margin keeps just-completed runs in
    the current year),
  - candidate more than **~8 months in the future** → `refYear − 1` (a stale prior-year run still on
    the homepage; safe because a weekly club never schedules >8 months out, and the live forward
    hareline only reaches ~6 months).

  Gemini's first suggestion (a 300-day forward bound) is **too loose** — a November run scraped in
  January is ~291 days out and slips through; 240 days catches it. Test both directions.
- **Event markers leak into cells.** An AGM/special tag appears in the date cell (`2 Nov AGM`) and the
  archive's hare cell (`AGM Codpiece`). Strip a standalone `\bAGM\b` token before parsing the date and
  before storing the hare. `TBA` hare/location → `undefined` (never store the literal). Run-number
  gaps (e.g. #2238/#2239 unassigned) are legitimate — emit the rows present, don't synthesize.
- **Deep, clean per-year archive → frozen-dataset backfill.** `ArchiveIndex.html` links one page per
  year (`History/Index20NN.html`, 2002→present) with the **same table shape** — here ~1,185 runs back
  to #981 (2002). Reuse the adapter's exported row parser in a **throwaway** extractor (year comes from
  the page filename, not inference), freeze the result to `scripts/data/<code>-history.json`, and ship
  a dumb loader delegating to `runBackfillScript` (H7/Brasília/Asunción pattern). Set
  `config.upcomingOnly: true` so reconcile doesn't false-cancel the archive once runs age off the
  forward pages. The one PII pass to run on the curated JSON: drop write-up/FB permalinks and flag
  `@`/long-digit strings (Bangkok's lone `@` hit was a venue name — `Fongfab Laundry@Vistagarden`, not
  contact info — so keep it; just confirm).
- **Reference adapter:** `src/adapters/html-scraper/bangkok-monday-hash.ts` (`parseHarelineRow` takes a
  `resolveDate` callback so the live adapter passes forward-inference and the backfill passes
  page-year; `inferYear` is the bidirectional rule; `parseNextRunBlock` extracts the single pin via
  `extractCoordsFromMapsUrl`). Backfill loader `scripts/backfill-bmh3-bkk-history.ts` + frozen
  `scripts/data/bmh3-bkk-history.json`.

#### Vindobona H3 addenda (verified via real web_fetch, 2026-06-05) — apex-not-www + ISO dates + N/E GPS

`viennahash.org` (Vindobona HHH, Vienna — est. 1982, hand-maintained since the 90s) is another bespoke
static club site but with three differences from Bangkok Monday, all confirmed by fetching the real pages:

- **🔴 The `www.` host returns an EMPTY body; the bare apex returns full SSR'd HTML.** `https://www.viennahash.org/`
  and `…/schedule.html` returned **nothing** to the sandbox fetcher, while `https://viennahash.org/schedule.html`
  (and every other page) returned complete content. Seed and fetch the **apex** URL. (Chrome MCP also
  auto-denied the brand-new domain with no user present — the apex web_fetch is what unblocked it.)
- **🔴 Dates are already ISO `YYYY-MM-DD` — NO year inference needed** (unlike Bangkok's `DD MMM`). The
  receding hareline `plans/futureruns.html` is a flat pipe/newline-delimited list:
  `2026-06-08 | Hash #2363 | Miss Piss | <notes>`. Parse the ISO date straight to UTC noon.
- **Dual-surface, merge by run number:** `plans/futureruns.html` = the forward backbone (run#, hares,
  notes — far-future runs have **unfinalized numbers** like `Hash #23??` / `FMH #30?`: store `runNumber`
  only for a clean `#\d+`, else undefined). `schedule.html` = the single **next run** with full detail
  (time `18:30`, venue, on-after, and a **`GPS coordinates: N<lat>, E<lng>`** line — N/E-prefixed decimals,
  NOT a Maps URL → parse `/N(\d+\.\d+),\s*E(\d+\.\d+)/` locally; `extractCoordsFromMapsUrl` won't match it).
- **Multi-kennel by line prefix:** `Hash #` → the main kennel, `FMH #` → the Full Moon sibling. One HTML
  source, all `kennelCodes`. FMH numbering on the source is unreliable (a `#30?` contradicts the dead
  blog's `#241` from 2020) — never "correct" it.
- **No clean historical archive:** the site's stats pages are per-hasher cumulative tables, `locations.html`
  is per-year Google My-Maps links, `history.html` is milestone prose, and the Blogspot recap blog
  (`whatcanisayaboutthiselixir.blogspot.com`) is **dead since 2020** (#2085, free-form prose, run# only in
  category tags). For sites like this, the live forward hareline is the whole deliverable — no backfill.

## Harrier Central — config-only onboard + placeholder-venue geocode sentinels (learned from Lisbon H3, 2026-06-07)

The `HARRIER_CENTRAL` adapter already exists (`src/adapters/harrier-central/adapter.ts`, registered in
`registry.ts`); onboarding an HC kennel is **config-only** — no new adapter code. Mirror the nearest
existing HC source (Hamburg H7 `sources.ts`): `publicKennelId` GUID filter (more stable than
`kennelUniqueShortName` or `cityNames`), `defaultKennelTag`, `defaultTitle` + `staleTitleAliases` for
the kennel's placeholder-title rows, `trustLevel:8`, `scrapeFreq:"daily"`, `scrapeDays:365`, single
`kennelCodes`. **`upcomingOnly` is OMITTED on every HC source** — HC `getEvents` returns future-only and
the established HC kennels survive reconciliation without it; do not add it.

- **`getEvents` is future-only — no backfill from HC.** The API exposes only upcoming events (earliest is
  ~6 days out). A high run number (LH3's #1016) implies a deep history, but HC won't serve it — check for
  a separate archive (Blogspot/WordPress/Sheet); if none, there is no backfill (LH3 had none).
- **Sandbox can't resolve the Azure host.** `harriercentralpublicapi.azurewebsites.net` is allowlist-blocked
  from the research sandbox (`EAI_AGAIN`); the daily run captures the verbatim event sample via a **browser
  page-context fetch** (Chrome MCP) and flags "Claude Code: reconfirm `adapter.fetch(source)` from local
  env" — where the host is reachable. Routine.
- **🔴 Placeholder venues: dropping the default pin is a TWO-part change.** Kennels that announce venues
  day-of pre-create slots with placeholder location strings ("TBD", "No location provided", "ANNOUNCED
  LATER via Hares") and HC pairs them all with ONE region-default pin (LH3: all 27 events at
  `38.7227,-9.1449`). Two independent code paths read those fields:
  - **Coords** — `hcGeocodeFailed(place, resolvable)` gates whether the API lat/lng are dropped (+
    `dropCachedCoords:true` so the merge re-geocodes). It originally only fired when `place === resolvable`
    (catches `"TBD"=="TBD"` but NOT empty-place + `"No location provided"`).
  - **Location text** — `composeHcLocation` builds `event.location` *independently* (never calls
    `hcGeocodeFailed`); its `stripTba` drops only "TBA", not "TBD"/"No location provided"/etc.

  So "extend the sentinels to drop coords" **alone is a half-fix** — coords get dropped but the placeholder
  string still lands in `event.location` and the merge stores + geocodes it as meaningless text (the merge's
  `sanitizeLocation` only filters generic TBA/TBD). The complete fix is a shared `GEOCODE_FAIL_SENTINELS`
  set (normalized, exact-match, **Set lookup not regex** → Sonar-clean) driving BOTH paths: `hcGeocodeFailed`
  (drop coords) AND `composeHcLocation` via `stripPlaceholderLocation` (drop the text → row renders
  unlocated, map falls back to the region centroid). Result for LH3: 26/27 unlocated, 0 fake pins.
- **Seed the sentinel set with the whole family**, not one kennel's literal:
  `tbd`/`tbc`/`to be determined`/`to be confirmed`/`to be announced`/`no location provided`/`announced
  later via hares` (UK/Ireland HC kennels use "TBC" heavily). It's a shared adapter concern and the
  config-free path for the next HC kennel.
- **Suppression is EXACT-MATCH** — a coarse-but-real location ("Portugal", a bare city name) must survive
  (a country name geocodes to a country centroid; better than nothing). Don't broaden to substring/prefix.

#### Taiwan H3 addenda (verified via browser page-context fetch, 2026-06-10)

- **HC kennels often name events `<ShortName> <N>` (a real name), so `staleTitleAliases` never fires.**
  Taiwan H3's `eventName` is `"TwH³ 2664"` (or `"TwH³ 2662 - <theme>"`) — NOT the `"Placeholder event for X"`
  string Lisbon/Porto use. `applyTitleFallback` passes a non-placeholder name through verbatim, so the kennel
  page shows the kennel's own `<ShortName> <N>` titles. Still seed `defaultTitle` + a `staleTitleAliases`
  placeholder defensively (cheap insurance for empty-name rows), but don't expect it to fire — the kennel's
  event names are the titles. (This is faithful, not a bug.)
- **🔴 kennelCode-collision (not just alias-collision) → suffix the kennelCode AND drop the bare alias.**
  A new HC kennel's `kennelUniqueShortName` can collide with an existing kennel's **kennelCode** (Taiwan's
  "TwH3" → `twh3` is already **Tidewater H3**). Because kennel resolution does kennelCode-exact-match BEFORE
  alias-match, a bare `TwH3` alias on the new kennel would silently route to Tidewater. Use a region-suffixed
  kennelCode (`twh3-tw`) and **omit the bare shortcode from aliases** (publish `TwH3-TW` instead). Stronger
  than the Lisbon bare-`LH3` rule — there the collision was only an alias; here it's a live kennelCode.
- **Coord default-pin sentinel `"no location provided"` already in `GEOCODE_FAIL_SENTINELS`** handles
  Taiwan H3's `#2663`/`#2664` (Taipei region-default pin dropped + re-geocoded); `#2662` with a real venue
  keeps its real coords. No new config — the Lisbon-era sentinel set covers it.
- **CJK is fine in seeds.** Taiwan's aliases/fullName carry `台灣健龍捷兔`/`台灣`/`台北` — valid UTF-8 TS
  string literals (Japan/HK already do this).
- **🔴 `COUNTRY_INFERENCE_RULES` for a CJK-locale country needs a CJK branch — NOT optional (build, CodeRabbit).**
  The English `eventCityAndCountry` ("Taipei, Taiwan") matches the ASCII-`\b` rule, but a Chinese-only
  location field (`新北市, 台灣`, which TwH3's #2662 actually carries) is invisible to `\b` and defaulted to
  **"USA"**. `\b` is ASCII-only, so it never anchors against CJK. Append a CJK alternation to the same rule:
  `[/\b(taiwan|taipei|new taipei|formosa|kaohsiung|taichung|tainan|taoyuan)\b|[台臺][灣北中南]|新北|高雄|桃園/, "Taiwan"]`.
  The `[台臺]` class unifies the common (台) / formal (臺) Tai- forms in one token. (`inferCountry` lowercases
  input first, but `toLowerCase()` is a no-op on CJK, so the literal Chinese tokens match as written.)
  Cover all six **special municipalities** (Taipei/New Taipei/Taoyuan/Taichung/Tainan/Kaohsiung) up front —
  each hosts or may host a kennel (Taoyuan = TyMH3); a municipality-only field would otherwise default to "USA". (Gemini, PR #2113.)
- **⚠️ Single-character alternations trip SonarCloud S6035 — use a character class.** The first cut wrote
  `[台臺](灣|北|中|南)`; S6035 ("Replace this alternation with a character class") flagged the `(灣|北|中|南)`
  group → `[灣北中南]`. Reach for a char class, not `(a|b|c)`, for any all-single-char alternation (same rule
  that prefers `[-:]` over `(?:-|:)`).

### 🔑 `hashruns.org/api/global-runs` — the public web enumeration of ALL Harrier Central kennels (learned 2026-06-18)

The cleanest way to discover HC kennels (better than the Azure `getEvents` token sweep below):
`harriercentral.com` has **no public web directory** — its kennel/run DB is app-only (`/index.php/kennels/`
renders empty). But **`hashruns.org` is the public web front-end for the same Harrier Central data**
("Powered by Harrier Central" footer), a Next.js app with a clean read-only JSON endpoint:

```
https://hashruns.org/api/global-runs?isFuture={0|1}&minEventDate=YYYY-MM-DD&maxEventDate=YYYY-MM-DD
```

Each record carries **`PublicKennelId` (GUID)**, `KennelSlug`, `KennelShortName`, `KennelName`,
`KennelContinent`, `KennelIANATimezone`, plus per-event number/name/datetime/hares/location/lat-lng/
fees/tags. The `PublicKennelId` is exactly the `publicKennelId` our HARRIER_CENTRAL adapter config keys
off — so this endpoint hands you ready-to-paste config-only source rows.

- **Enumeration recipe:** pull `isFuture=1` plus a trailing 12-month `isFuture=0` window, collect distinct
  `(PublicKennelId, KennelName, KennelSlug, KennelIANATimezone, continent/city)`, then dedup against the
  hashtracks sitemap. A 2026-06-18 pull = ~2,924 events → **128 distinct kennels active in the past year**,
  overwhelmingly in already-covered regions (US/UK/DE/PT/FR/BE/NL/NO/TW/JP/SG/TH/CN/BR/Barbados/Hawaii).
- **It only surfaces kennels that have POSTED runs** (past or future) — which is exactly the filter we want
  (a source needs dated runs to be useful). A kennel that exists in the app but never posted won't appear.
- **0-upcoming is normal** (HC `getEvents` is future-only). A kennel with recent past runs but 0 upcoming on
  HC is still a valid recently-active config-only onboard; BUT if the same kennel posts FUTURE runs on its own
  website (e.g. Dubai's Desert/Creek do), prefer the website as the live source and treat HC as optional
  secondary.
- **Timezone data quirk:** some records carry a wrong `KennelIANATimezone` (Bandung HHH 2 = `Asia/Bangkok`
  for a city that's `Asia/Jakarta`) — set the METRO timezone from the real city, not the HC field.
- **Reachable from the research sandbox?** `hashruns.org` is a normal HTTPS site — try `web_fetch` on the
  `/api/global-runs` URL first; if it's allowlist-blocked, run it from the Claude-in-Chrome extension
  (page-context `fetch`). Either way it beats replicating the Azure `generateAccessToken` token below.
- 🔑 **`global-runs` ALSO returns PAST events** (`isFuture=0` with a date window) with full
  number/name/hares/location/lat-lng/fees — so it's a **one-shot historical-backfill source for any HC
  kennel**, not just a discovery tool (the Azure `getEvents` adapter path is future-only). 2026-06-18 pulls:
  Bandung 56 runs, Moonshine Dubai 17, Barbados 130 — each enough for a frozen `scripts/data/<code>-history.json`
  backfill. Window caps: `isFuture=1` ~200 rows; each `isFuture=0` request ~2 MB → page it in ≤6-month windows
  and dedup by `PublicEventId`. **Source-data quirks survive into the feed** — extract faithfully, don't
  "fix": e.g. Bandung reuses run# 2292 and skips 2273/2289, and its `Hares` field sometimes carries the
  *location* (data-entry bleed) → treat HC `Hares` as unreliable per-kennel; verify before trusting.

## Supabase / PostgREST JSON backend behind a React SPA (learned from Riyadh H3, 2026-06-18)

Some modern hash sites are a **client-rendered React/Vite SPA whose run data comes from a Supabase
(PostgREST) REST API** — the cleanest possible source (true JSON, full history in one query), but the page
HTML is empty so you MUST use the API, not a scrape. Riyadh H3 (`riyadhhash.com`) is the reference.

- **Detection:** `index.html` is a near-empty `<div id="root">` + `/assets/index-*.js` (Vite), no
  `__NEXT_DATA__`; the Network tab shows XHR to `https://<projectref>.supabase.co/rest/v1/<table>?select=...`
  with `apikey:` + `Authorization: Bearer <jwt>` headers.
- **The `anon` key is publishable, not a secret.** The JWT in the JS bundle has `"role":"anon"` — Supabase's
  public client key (RLS-gated), the same class as a `NEXT_PUBLIC_*` Maps key. Safe to read/use for ingest.
  ⚠️ Re-extract it at build (decode the JWT from the current `/assets/index-*.js`); it can rotate.
- **Query shape (PostgREST):** `?select=*&order=date.desc` for the list; filter soft-deletes with
  `&deleted_at=is.null`; date-range with `&date=gte.YYYY-MM-DD&date=lte.YYYY-MM-DD`. **One query = full
  history + future** (Riyadh: 58 rows back to 2025-01-03), so the adapter is future-window-filtered and the
  backfill is the same table with `date < today`.
- **Adapter:** a lightweight JSON client (NOT Cheerio/browserRender). Map columns straight: `run_number`,
  `title`, `date` (→ UTC noon), `location`, `gathering_time`/`circle_time` (→ `startTime "HH:MM"`),
  `difficulty` (→ Shiggy?), `registration_status`. No coord-default trap (Riyadh carries text locations only).
- **Effort:** small (~120–180 LoC) — closer to the Meetup/HC config-shaped adapters than a scraper, but it
  needs a new adapter since the endpoint/columns are bespoke. Store the project ref + table in source config.

### HC `getEvents` is a live-kennel FINDER — city-name sweep (learned from Shanghai H3, 2026-06-11)

When the queue runs dry, turn the existing HARRIER_CENTRAL adapter into a discovery tool. Replicate the
`generateAccessToken("getEvents")` token (`src/adapters/harrier-central/token.ts`) in a browser
page-context `fetch` (the Azure host is allowlist-blocked from the research sandbox, reachable locally)
and POST `{publicHasherId, accessToken, queryType:"getEvents", cityNames:"<City>"}` to the PortalApi. It
returns `[[events]]` with `publicKennelId`, `kennelName`, `kennelUniqueShortName`, city, dates, coords,
and logo — i.e. a **ready-to-paste config-only source for any HC kennel in an uncovered city**. Sweeping
~120 uncovered cities surfaced Shanghai H3 (`63e3cccd-…`). Notes: the unfiltered call errors ("No query
constraints") — you must pass `cityNames` (or a kennel/GUID filter); most HC kennels are in
already-covered cities, so a sweep yields a handful of hits, not dozens (the 2026-06-10 sweep was already
"HC exhausted" for then-uncovered cities — re-run only after new cities enter the backlog).

#### Shanghai H3 addenda (config-only HC, first mainland-China kennel, 2026-06-11)

- **`stripTba` strips only `"TBA"`, NOT `"TBC"` — and the placeholder filters are FIELD-SCOPED.** Three
  different filters clean three different fields: `stripTba` (`/^tba$/i`) runs on hares *and* location but
  only catches bare "TBA"; the `GEOCODE_FAIL_SENTINELS` set (`tbc`/`tbd`/`to be confirmed`/…) is applied
  **only to location** (`stripPlaceholderLocation`/`hcGeocodeFailed`), never to hares. So an HC event with
  `hares:"TBC"` reaches the adapter output **verbatim**. It still surfaces clean because the **merge
  pipeline's** own hare sanitization drops the "TBC" placeholder (canonical `hares: null`, no hare line on
  the card). Lesson for handoff field-fill tables: name the *filter and the field*, not just "it gets
  nulled" — and for HC placeholder hares, expect the **merge** to clean them, so don't propose an
  adapter change.
- **Coarse city location (`"SHANGHAI"`) → coords dropped + re-geocoded, same as Lisbon/Porto.**
  `placeName === resolvable === "SHANGHAI"` → `hcGeocodeFailed` fires → `dropCachedCoords:true` → merge
  re-geocodes the city text (+ country bias) to the metro centroid. Third HC kennel where the Lisbon
  coord work made the pin automatic with no adapter change. Don't pre-empt it with a `dropCachedCoords`
  config — it's already the default behavior.
- **First-in-metro alias: avoid the bare city/metro name.** The handoff seeded a bare `"上海"` alias;
  every future Shanghai sibling (DOGS H3, POSH, Full Moon, Taiping) would equally match it → mis-route in
  the resolver. Use the **kennel-specific** local-language name instead — `"上海捷兔"` (Shanghai Hash; 捷兔 =
  the standard Chinese for "hash", as in Taiwan's `台灣健龍捷兔`), mirroring Tokyo's `東京ハッシュ`. Keep the
  bare city token in `COUNTRY_INFERENCE_RULES` (city→country is correct there), NOT as an alias. Same
  discipline as the bare-`SHH3`/`TwH3`/`LH3` omissions, extended to CJK city names.
- **`COUNTRY_INFERENCE_RULES`: use bare CJK tokens (match the adjacent rule's convention).** A review nit
  proposed wrapping `上海|中国` in `(?:^|\W)…(?:\W|$)`; declined — the neighboring Taiwan rule uses bare CJK
  alternatives (`[台臺][灣北中南]|新北|高雄|桃園`), `\b`/`\W` are ASCII-only and don't bound CJK, and a
  substring match on `上海`/`中国` is exactly what country inference wants. Place the China rule AFTER the
  Hong Kong/Taiwan rules so those tokens resolve to their own regions first.

## STATIC_SCHEDULE — seasonal (summer/winter) kennels need `scheduleRules`, not just flat fields (learned from Budapest H3, 2026-06-10)

A "Facebook-funnel" kennel (per-run details members-only, but a published fixed weekly cadence) is a
valid **config-only STATIC_SCHEDULE** onboard — two rows with disjoint `BYMONTH` for the summer/winter
split (mirror NOSE Hash: summer Apr–Oct, winter Nov–Mar). That part is well-trodden. **The trap is the
kennel-record schedule fields.**

- If the kennel seed carries only the flat `scheduleDayOfWeek/scheduleTime/scheduleFrequency` fields,
  `scripts/backfill-schedule-rules.ts` (run by `prisma db seed`) **Pass 2** parses them into a bare
  `FREQ=WEEKLY;BYDAY=<day>` rule. Its "already covered by Pass 1" check is **exact-string**, so it never
  matches the BYMONTH-bearing rules Pass 1 emits from the STATIC_SCHEDULE sources → Pass 2 emits a
  **stale all-year rule at the SUMMER time** that mis-projects the summer time in winter (Codex P2 on
  Budapest, [PR #2096](https://github.com/johnrclem/hashtracks-web/pull/2096)).
- **Fix:** declare seasonal `scheduleRules` on the kennel seed (mirror **LBH3**, itself shaped by Codex on
  PR #1684) — one entry per season with `label` / `validFrom` / `validUntil` ("MM-DD") / `startTime`.
  Declaring `scheduleRules` **structurally opts the kennel out of Pass 2**, and Pass 3 absorbs the
  overlapping Pass 1 rows. Keep the flat fields as legacy fallback.
- **Same-day-different-time seasons gotcha:** when both seasons run the *same weekday* (Budapest = Sunday,
  11:30 summer / 10:30 winter) the `scheduleRules` rrules must **retain `BYMONTH`**
  (`FREQ=WEEKLY;BYDAY=SU;BYMONTH=4,5,…` vs `…BYMONTH=11,12,1,2,3`). Two identical rrules would collide on
  the `(kennelId, rrule, source)` upsert key; and matching the source rrules *exactly* is what lets Pass 3
  absorb Pass 1. LBH3 dodges this only because its seasons are *different days* (TH vs SU). Verify both
  rrules `parseRRule`-parse and `normalizeRRule` is identity. Prod should show **exactly N seasonal rules,
  no stale all-year rule** (`SELECT rrule, startTime, label FROM "ScheduleRule" WHERE "kennelId"=… AND
  "isActive"`).
- **This is latent in every existing flat-fields-only seasonal STATIC_SCHEDULE kennel** (NOSE / Tidewater /
  Rumson). For a NEW seasonal kennel, the handoff should specify `scheduleRules` up front.

## Recovering a logo (and content) when the canonical site is NXDOMAIN at build (learned from Budapest H3, 2026-06-10)

A domain the daily research run verified live can be **NXDOMAIN by build time** — Budapest's
`budapesthashhouseharriers.org` lapsed in the <24h research→build gap (confirmed across Google DNS,
Cloudflare DNS, and the fetch infra — apex + www, A + NS, `.org` SOA in authority = a real registration
lapse, not a sandbox quirk). When the origin is unreachable but the kennel is real:

- **Always DNS-resolve the handoff's named website/source at build time** before trusting it as live (a
  new variant of the WSH3 "verify the source actually exists" rule — here the source went dead *after*
  research).
- **Recover the logo from the Wayback Machine** instead of shipping without one:
  1. List real captures: `curl "http://web.archive.org/cdx/search/cdx?url=<domain>*&output=text&filter=statuscode:200"`
     and grep for `logo`/`cropped`/`wp-content/uploads` (WordPress sites expose `cropped-logo.png`).
  2. Pull the **raw archived bytes** via the identity modifier (no Wayback toolbar/rewrite):
     `https://web.archive.org/web/<timestamp>id_/<original-asset-url>`.
  3. **Magic-byte verify** (`file` / first bytes) — never trust the URL suffix or Content-Type.
- **Confirm flagged metadata from the search-index snapshot** when the live page is gone (Budapest's
  `foundedYear: 1982` and the schedule were confirmed verbatim from the cached home-page text in search
  results).
- **Keep the canonical URL as `website`** if the lapse looks recoverable (live <24h prior, fully in
  search index + Wayback) and document it as a re-check item — the kennel page still surfaces the live
  `facebookUrl`. A review bot will flag the broken link; declining with this rationale is legitimate
  (CodeRabbit accepted it on Budapest as an intentional reversible exception).

---

## UTF-8 SSR PHP run tables + run-number-anchored year inference (learned from Taipei H3, 2026-06-12, SHIPPED)

**Taipei H3 / 台北捷兔** (`taipeihash.com.tw/run_site.php`, [PR #2170](https://github.com/johnrclem/hashtracks-web/pull/2170)) — Taiwan's oldest hash. A fully **server-rendered, UTF-8** PHP run table (contrast the Big5 `.htm` cousins below — this one has no charset trap). Static Cheerio, no browserRender. The reusable win here is the **year-inference algorithm**, which applies to *any* year-less-date hareline that exposes deep history on one page.

**Confirmed (real `run_site.php` DOM, captured at build via `curl`):**
- **Three `<table class="events-table">` blocks on one page:** 本週活動 (this week, 1 row) → 未來預告 (future, ~3) → 歷史足跡 (history, ~23). Total ~27 runs, ~6-month rolling window.
- **Parse `<table>` rows ONLY.** The page also re-renders every run as a `<div class="mobile-event-card">` for mobile — a *different* DOM shape, so iterating `table.events-table tbody tr` naturally skips the duplicates. (This resolves the "UNVERIFIED — do mobile card duplicates exist?" caveat in the Big5 note below: **yes they exist**, but only as `div`s, not `<td>` rows.) Keep a dedupe-by-run-number `Map` as belt-and-suspenders.
- **5-col rows:** `跑次 (Run No.) | 日期 (Date, MM/DD) | 兔子 (Hare) | 地點 (Run Site) | 記號起點 (Marks/Start)`. Run# sits in a `<strong>` with the `NEW`/`預告` badge in a **sibling `<span>`**; the date `MM/DD` sits in a `<strong>` with any event tag (`生日`/`特跑`/`家庭特跑`/`A.I.R.`/`全島特跑`) in a **sibling `<span>`** — read the `<strong>`, ignore the badge span (and `DATE_RE = /(\d{1,2})\/(\d{1,2})/` ignores a trailing tag anyway).
- **🔴 Year-less `MM/DD` + deep history → run-number-anchored year inference, NOT a today-anchored rollover.** Because 歷史足跡 deliberately shows ~23 PAST runs, a naive "candidate >60d in the past → +1 year" rule pushes the Jan/Feb rows a full year into the *future*. Instead: pick the **anchor** = the row whose today-nearest date is closest to today (= the current run, for a strictly-weekly kennel); for every other row compute `expectedMs = anchorMs + (runNumber − anchorRun) × 7d`; resolve its year to the candidate `y ∈ {expectedY−1, expectedY, expectedY+1}` whose `MM/DD` lands closest to `expectedMs`, validating each with a `Date.UTC` round-trip (so an impossible date can't mask a valid sibling year). Exact for any weekly kennel; handles Dec→Jan cleanly. Reference impl: `src/adapters/html-scraper/taipei-hash.ts` (`resolveDate`/`pickAnchor`/`buildEvents`).
- **PII phone in a dedicated `<span class="phone">`** → `$cell.clone().find(".phone").remove()` is precise and beats a regex (keep a bounded `/0\d[\d\s-]{6,15}/g` only as a markup-drift fallback).
- **Bilingual ZH/EN cells:** location is `中文<br>English` (`<br>`→space → `"猴硐 Houtong"`); hare is `[Chinese name]<br>[English hash name]` (`"李志勇 R.P.M"`). Keep both.
- **Maps links are `maps.app.goo.gl` shortlinks** (no extractable coords) → store verbatim as `locationUrl` (after validating `https:` + a host allowlist — Codacy flags variable-URL fetches), leave lat/lng undefined → merge geocodes the bilingual place text with Taiwan/Taipei bias. No default-pin trap.
- **`title` left undefined** → `merge.ts` synthesizes `"Taipei H3 Trail #N"` (`shortName` >4 chars short-circuits `friendlyKennelName` cleanly).
- **`config.upcomingOnly: true`** (rolling window → history ages off; protects it from `reconcile` false-cancel). Single data surface → add a **fail-loud `events.length === 0` guard** (a brand-new source has a 0 baseline the zero-event health alert misses).
- **No machine-readable deeper archive** — the page's own 歷史足跡 ships ~23 past runs on the first scrape; older history is Google-Drive PDF weekly reports → no backfill script.

---

## Legacy Big5 Taiwanese run-site pages (`.htm`) — New Taipei H3 (SHIPPED 2026-06-13)

HashTracks' **first Big5-encoded source**, shipped onboarding **New Taipei H3 / 新北捷兔**
(`newtaipeihash.com`, [PR #2186](https://github.com/johnrclem/hashtracks-web/pull/2186)). Several older
Taiwanese kennels run hand-maintained static `.htm` sites with one **`run_site_<YYYY>.htm` page per
year** plus a `run_site_all_list.htm` index that links every year and encodes the founding year (New
Taipei's index labels years `2013(1st) … 2026(14th)`, so the "(1st)" page = founding year). Reference
adapter + tests: `src/adapters/html-scraper/new-taipei-hash.ts`.

**Confirmed (real Big5 DOM captured at build via `curl -s <url> | iconv -f BIG5 -t UTF-8`):**
- **Charset is Big5, no declaration** — no `<meta charset>` and no charset in the HTTP `Content-Type`. A
  UTF-8 string fetch (`fetchHTMLPage` / `response.text()`) mojibakes every Chinese cell. **Fetch raw
  bytes (`safeFetch(...).arrayBuffer()` → `Uint8Array`) and decode with `new TextDecoder("big5")` before
  `cheerio.load`** — native in Node, **no `iconv-lite` dependency**. Force `big5` (don't sniff a meta tag
  — there isn't one). Unit-test a known string round-trips (`新北捷兔` = Big5 `b773a55fb1b6a8df`). The
  byte-fetch + size-cap scaffold mirrors `auckland-hussies.ts` (which sniffs windows-1252).
- **A `Mozilla`-prefixed `User-Agent` is mandatory** — the Apache origin returns **HTTP 500** to a bare
  `curl/*` UA but 200 to any `Mozilla/...` UA (incl. `"Mozilla/5.0 (compatible; HashTracks-Scraper)"`).
- **Whole-year hareline on one SSR page** (no pagination / browserRender). Single `<table>`; section
  bands are 1-cell `<tr>`s, data rows are 5-cell. Bands: 本週活動 (this week) → 重要活動預告 (highlighted
  specials — **duplicates** of weekly rows, dedupe by run number, last-wins keeps the richer weekly row)
  → 每週活動預告 (the weekly list, descending run#) with interleaved **season-marker rows** (開始夏令/冬令時間…)
  and a mid-year 以上/以下 divider. **Mobile "card" duplicates do NOT exist on this page** (the Taipei H3
  sibling has them as `<div>`s, not `<td>` rows); a dedupe-by-run-number `Map` is belt-and-suspenders.
- **5-column data rows:** `跑次 (Run No.) | 日期 (MM/DD) | 兔子 (Hare) | 地點 (Run Site) | 記號起點&詳細資訊`.
- **Year is in the URL filename** (`run_site_2026.htm`) → trivial date resolution (no run-number anchoring,
  unlike the Taipei H3 `run_site.php` cousin). **But the source URL embeds the year** — the adapter must
  build `run_site_${currentYear}.htm` from `new Date()` or it silently scrapes a stale page after Dec 31.
- **Word "Save as HTML" quirks:** `<style><!--td {...}--></style>` leaks *inside* table cells (cheerio
  `.text()` includes it) → strip `style, script` per cell. Multi-value specials stack siblings
  (`<p>647</p><p>648</p>`, `<p>08/23</p><p>08/24</p>`); `.text()` mashes them → insert a space at block
  boundaries (`p, div, li`) and take the **first** run#/date (a 2-day overseas special is one event).
- **`startTime` is NOT per-row** — the page header is authoritative (summer 15:00 / winter 14:30); the
  in-table season-marker rows even had a typo (both said 14:30). Month-based season (Apr–Sep / Oct–Mar)
  matched the real marker boundaries (winter from run #706=10/04, summer from #680=04/05) exactly — use
  it, and mirror it in the kennel's `scheduleRules` (disjoint BYMONTH, like `shh3-cn`).
- **PII phones in the Hare cell** (`0920-946-035`, landline `(02)2883-2383`) — strip with narrow bounded
  regexes. Keep the hare-separator split as a bare `[&＆、]` char class (no surrounding `\s*` — that trips
  Sonar S5852; `normalizeHaresField` trims the comma-split parts anyway).
- **Cancellations have no run number** — COVID rows use run cell `"X"` + venue `"…三級疫情取消"` / `"大雨取消"`;
  treat any non-numeric run cell as a non-run and **skip it silently** (only a *numbered* run with an
  unparseable date is a genuine anomaly worth an `errors[]` entry).
- **Multi-day specials** appear as a `MM/DD~DD` range (e.g. archive #46 `11/15~17`) — take the first day.
- **No coords** — venues are Chinese place names; the detail cell carries a per-run Facebook event link
  (`fb.me/e/…` newer, `facebook.com/events/<id>` older) and occasional `goo.gl/maps/…`. **Route FB links
  to `externalLinks` (labelled EventLinks), NOT `locationUrl`** — `locationUrl` → canonical
  `Event.locationAddress` drives the static-map click-through, so an `fb.me` there points the "map" at
  Facebook; reserve `locationUrl` for genuine maps links. Leave lat/lng undefined → merge geocodes the
  decoded place text. No default-pin trap.
- **Deep clean archive → frozen backfill.** 13 yearly pages (`run_site_2013…2025.htm`) share the
  structure → one-shot `scripts/backfill-nth3-tw-history.ts` + frozen `scripts/data/nth3-tw-history.json`
  (663 runs, #1 2013-01-06 → #666 2025-12-27; PII scrubbed, COVID cancellations excluded, the 2-day
  Chiang Mai special folded to one run). `config.upcomingOnly: true` keeps `reconcile.ts` from cancelling
  the aged-off history.
- **http-only** → 7 Sonar S5332 hotspots on the `http://` literals (kennel website, source URL, adapter
  default base, test fixtures); mark SAFE (the origin serves no https).

**UNVERIFIED — confirm at implementation time:** the exact `<table>`/`<tr>`/`<td>` nesting and whether
mobile "card" duplicates exist (the structure above is from a UTF-8-mangled fetch; the Chinese columns
and precise DOM must be re-captured with `curl -s <url> | iconv -f BIG5 -t UTF-8` and the test fixture
built from that verbatim markup). The queued **Kaohsiung** (Wix) and **Taoyuan** (Wix) siblings are a
DIFFERENT platform (Wix, not legacy `.htm`) — don't assume this Big5 recipe applies to them.

## Mobirise static sites — SSR home page, "next run" block + "Upcoming runs" list (learned from Warsaw H3, 2026-06-17, SHIPPED [PR #2234])

[Mobirise](https://mobirise.com) is a drag-and-drop **static HTML** site builder (output is plain SSR
HTML — no JS-rendered run data, no CMS/API). Warsaw H3 (`warsawh3.com`, first Poland kennel) is the
reference. Confirmed via `web_fetch` (the research sandbox could NOT `curl` the domain — allowlist-blocked,
exit 56 — so the raw wrapper markup must be re-captured at build; the *content* below is verified):

- **Detection:** `<meta name="generator" content="Mobirise vN.N.N, mobirise.com">` in the page head;
  assets under `/assets/images/` with Mobirise's `…-WIDTHxHEIGHT.<ext>` resized-variant suffix; a
  `mobiri.se/<id>` "Made with Mobirise" footer badge.
- **Fully server-rendered → plain Cheerio, no browserRender.** The home page (`index.html`) carries the
  run data as static text.
- **Two shapes on ONE page, merge by run number:** (a) a **"next run" detail block** under a heading like
  *"WH3 meets every second Saturday. The next run is:"* → `WH3 Run #NNNN`, a `D Month YYYY, 14h00` line,
  a `Where?` label then the venue line, a `Who?` label then the hare line; and (b) an **"Upcoming runs"
  list** where each run is two lines: `#NNNN Month D, YYYY` then `Hare: <name>`. The list rows carry only
  date + hare (no venue/time). Parse both, merge by run#, prefer the detail block's venue/time.
- **🟢 Dates CARRY THE YEAR** (`Sat 20 June 2026`, `July 4, 2026`) → **no year inference** (unlike Bangkok
  Monday / Taipei). Parse straight to UTC noon. Note the **`14h00` time format** (`h` separator, not `:`)
  → normalize to `"14:00"`.
- **Rotating opaque inner classes** (Mobirise wraps each block in `<section class="mbr-section …">` with
  churning utility classes) → **key the parser on visible text**, not selectors. `stripHtmlTags(html,"\n")`
  → split into lines → find the `Run #` line → walk to the "Upcoming runs"/end sentinel (same approach as
  the Manila/NSWHHH Google-Sites parsers).
- **🔴 Hare placeholders → `null` (explicit clear), NOT `undefined`.** Common jokes — `???`, `It Could Be
  You!`, `TBA`, `Hare needed`. The merge pipeline treats `hares: undefined` as *preserve-existing* and
  `null` as *explicit clear* (#2032); emitting `undefined` for a placeholder lets a stale hare survive a
  source correction (Codex caught this on Warsaw). ⚠️ `stripPlaceholder` (from `adapters/utils.ts`) only
  **detects** the universal placeholders (`???`/`TBA`/`Hare needed`) — it **returns `undefined`** (it can't
  distinguish "present placeholder" from "absent"), so converting it straight (`const h =
  stripPlaceholder(x)`) would wrongly *preserve* a stale hare. Map it explicitly — the shipped Warsaw shape:
  ```ts
  function cleanHare(value: string | undefined): string | null | undefined {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;                              // field absent → no signal (preserve)
    const hare = stripPlaceholder(trimmed);
    if (!hare || KENNEL_PLACEHOLDER_RE.test(hare)) return null;  // present placeholder → explicit clear
    return hare;
  }
  ```
  Keep only a kennel-specific in-joke (e.g. `It Could Be You!`) in the local `KENNEL_PLACEHOLDER_RE`; the
  universal ones live in `stripPlaceholder`.
- **No per-run coords / no archive.** Venue is free text only (no lat/lng, no Maps link) → leave coords
  undefined, merge geocodes the venue or falls back to the region centroid. The other nav pages
  (`Events.html` = special events, `news.html` = prose, `picsdocs.html` = photos) carry **no run history**
  → no backfill source even for a 1600+-run kennel. Set `config.upcomingOnly: true` (the home block rolls
  forward) + a **fail-loud `rows.length === 0` guard** (single-page source, brand-new baseline).
- **Logos are Mobirise-resized variants** (`/assets/images/<name>.jpg-96x96.jpg`) — small + path-tokenized
  → self-host to `public/kennel-logos/<code>.<ext>`; try the **un-suffixed original** (`<name>.jpg`) for a
  larger asset, confirm extension by magic bytes.
- **Effort:** small new ~120–180 LoC Cheerio adapter + tests. Model on `manila-h3.ts` (single SSR block +
  guard) and `bangkok-monday-hash.ts` (next-run-block ⊕ list merge — but simpler: one page, no inference).

**✅ CONFIRMED AT BUILD (Warsaw H3):** the entire forward feed is **one** `<p class="mbr-text mbr-fonts-style
display-7">` with `<br>` separators (next-run block + "Upcoming runs" list all inside it). There's a *second*
`display-7` paragraph above it (a generic welcome blurb) → **anchor the parser on the `WH3 Run #` marker, not
"first display-7 paragraph".** `stripHtmlTags(html, "\n")` linearizes the `<br>`s to lines cleanly. The
sandbox `curl` block (exit 56) was **sandbox-local** — `curl`/`fetchHTMLPage` worked immediately from the
Claude Code build env (HTTP 200, 10.6 KB); always capture the verbatim DOM at build (it confirmed the research
guess here).

**Cross-cutting build learnings (Warsaw H3 — apply to any new small-adapter onboard, not just Mobirise):**
- **Same-run merge = tri-state field-merge, never `??`.** When merging the next-run block ⊕ a list row for the
  same run number, do `{ ...existing, ...Object.fromEntries(Object.entries(event).filter(([,v]) => v !==
  undefined)) }` — a defined value wins (incl. an explicit `null`), `undefined` preserves. Winner-take-all
  drops the richer row's fields; `event.x ?? existing.x` reverts a `null` clear back to stale data.
- **New-country `inferCountry` rule = unambiguous tokens only.** Omit a bare city token that's also a common
  US/other place name (e.g. `warsaw` → Warsaw, IN; `inferCountry` defaults to USA on the free-form research
  path). Keep the country name + native spellings (`warszawa`/`polska`); "City, Country" input still matches
  via the country token. Add a disambiguation test (mirror the Victoria-BC/Australia one).
- **Biweekly / `INTERVAL` > 1 `scheduleRules` need an `anchorDate`** (a known real run date) — `INTERVAL=2` is
  phase-ambiguous without one.
- **New regexes — backtracking-safe (S5852):** bound a leading `+`/`*` on an *unanchored* pattern
  (`[A-Za-z]{3,9}` for month names), and never put `\s*`/`\s+` adjacent to `.+`/`.*` (drop it, trim in code).
  Rewrite clean rather than marking the hotspot SAFE when the rewrite is cheap.

## Plain-PHP SSR single-current-run, semantically-classed labeled blocks + PII-in-hares (learned from Seoul H3, 2026-06-16, SHIPPED)

`seoulhash.com` (Seoul H3, "Korea's Mother Hash", est. 1972) is a hand-rolled PHP site that server-renders
**one** current run on `index.php` plus a deep `archive.php`. Three reusable learnings:

- **🟢 `web_fetch` flattens labels — the real DOM is often cleanly classed; capture it before choosing a
  parser.** The handoff's `web_fetch` sample showed the labels as a run-together blob
  (`Title:`/`Meeting Time:`/`Location:`/… on one line) and proposed a flattened-text scanner. The real
  `index.php` is semantically classed:
  ```html
  <div class="event">
    <div class="number">2897</div><div class="title">Anti-Celibacy Day</div>
    <div class="section">
      <div class="label_value"><div class="label">Meeting Time:</div><div class="value">2026/06/13 16:00</div></div>
      …Location / Geo Coordinates / Hares / Apres Trail / Hash Cash…
    </div>
  </div>
  ```
  The flattening was a **render artifact, not the DOM.** `curl` the page, build a `.label`/`.value`
  **`Map` keyed on visible label text** (`Map.get`, not `obj[key]` — Codacy object-injection), read
  run#/title from `.number`/`.title`. `Meeting Time` carries a full `YYYY/MM/DD HH:MM` → date to UTC noon +
  `startTime "HH:MM"`, **no year inference.** Same single-block `upcomingOnly` + fail-loud guard as Manila.
  The `Geo Coordinates` value is a bare `…/maps/place/` stub (no coords) → leave lat/lng undefined, never
  fabricate. `archive.php` = the same `.event` block × ~380 → frozen `scripts/data/<code>-history.json` +
  `runBackfillScript` loader (drop `description` from historical rows — bulky prose + where emails hide).

- **🔴 `sanitizeHares` does NOT strip mid-string phone numbers — scrub PII yourself, in BOTH the live
  adapter AND the backfill.** The merge pipeline's `sanitizeHares` only truncates **trailing**
  logistics/boilerplate; a phone embedded *inside* a hare line (`"EM Blank Space +82 10-7152-6362, EM Seoul
  Ultraman"`, `"ASBO 010-2354-1741"`) survives into public canonical events. Korean mobiles appear in **both**
  the domestic `010-XXXX-XXXX` and the international `+82 10-XXXX-XXXX` form (the leading 0 drops), with
  **inconsistent spacing** (`+82  10-…` double space). Match both (anchor on `01x`/`+82` so `1995-1996` and
  "Line 1 (10-15 min walk)" survive; tolerate multi-space separators), plus emails. Put the scrubber in
  `src/` so the **live adapter and the freeze share it**, and guard the committed dataset with a regression
  test using the same patterns. The Codex adversarial review caught the `+82` form a domestic-only first pass
  missed — **a forward-config/backfill fix is not enough; the live daily scrape must scrub too.**

- **🔴 `Kennel.scheduleTime` is 12-hour `"4:00 PM"`, NOT 24-hour.** Every `scheduleTime` in `kennels.ts` is
  12-hour `"H:MM AM/PM"`; a `"16:00"` (which the handoff shipped, by analogy with the adapter's `startTime`)
  would be the sole 24-hour value and break the display formatter. The adapter's per-event
  `RawEventData.startTime` IS 24-hour `"HH:MM"` — **two different fields, two different formats.**

- **New regex-heavy modules (PII scrubbers etc.):** author them Sonar/Codacy-clean from the first write —
  regex **literals** (not `new RegExp(str)` → Codacy non-literal flag), **one regex per type** (a combined
  alternation trips S5843 complexity > 20), `\d` not `[0-9]` (S6353), `RegExp.exec()` not `String.match()`
  (S6594), a backtracking-safe email `[\w.+-]+@[\w-]+(?:\.[\w-]+)+`, and **string ops over `\s*`-heavy
  cleanup regexes**; a genuinely-linear pattern S5852 still flags → mark the hotspot SAFE via the API.
  (Full detail: `handoffs/retros/2026-06-16-sh3-kr-retro.md`.)

- **Collision check = EVERY bare initialism** in the proposed alias list, not just the kennelCode-shaped one:
  Seoul correctly omitted bare `SH3` (Summit/Salem/Seattle) but `SHHH` *also* collided (Secession/Singapore
  Harriets) and had to be dropped too.

## WordPress (Avada/Fusion) + TablePress "Receding Hareline" SSR table + What3Words / Fusion-map coords (Himalayan H3, 2026-06-18 — SHIPPED, [PR #2255](https://github.com/johnrclem/hashtracks-web/pull/2255))

`himalayanhash.run` (Himalayan H3, Kathmandu — Nepal's first kennel, est. 1979, run #2521) is a
**WordPress 6.5.8 / Avada (Fusion-builder)** single-page site whose **home page SSRs a "Receding
Hareline" table** (the rolling forward schedule: current run + next ~2). Confirmed via `curl` (no JS) —
static Cheerio, no browserRender. The shipped adapter (`himalayan-h3.ts`) models
`kaohsiung-hash.ts` / `bangkok-monday-hash.ts` (table ⊕ detail-block merge by run number).

- **🟢 It's a clean TablePress table, NOT raw Fusion markup** (the research note feared a bespoke
  `fusion-text` block — the build `curl` resolved it *simpler*): `<table id="tablepress-5"
  class="tablepress tablepress-id-5">` with a real `<thead>`/`<tbody class="row-hover">` and semantic
  `td.column-1`…`column-6` cells. Read cells by **position** (`$row.find("td").eq(n)`), robust to class
  drift. Columns: `Hash# | Date | Time | On-In | Hares | What3Words`. The On-In cell is
  `<strong>Area</strong><br/><em>Venue</em>` → render `<br>` as `" / "` → `"Chobhar / Adinath School"`.
- **🔴 "No decimal coords" was the research note's biggest miss — the source HAS real venue coordinates.**
  The featured run's detail block (a `HASH NNNN` heading below the table) carries a Fusion Google-Map
  shortcode whose inline `<script>` embeds **`addresses:[{"latitude":"27.666559","longitude":" 85.293534"}]`**
  (note the leading space inside the longitude quotes; the value appears twice — take the first). Capture
  these for the matching run → a precise pin, far better than geocoding the venue text or the Kathmandu
  centroid. **Lesson: when a page shows only a w3w/Maps *link*, still grep the detail-block / map-embed
  inline scripts** — Avada/Fusion (and Leaflet / WP Google-Maps plugins generally) stash decimal lat/lng
  in the shortcode JSON even when the visible UI hides it. Regex `/"latitude":"(-?\d+\.\d+)","longitude":"\s*(-?\d+\.\d+)"/`,
  validate the bounds, attach by run number.
- **🟡 Location fallback is What3Words.** The On-In cell links a `w3w.co/<addr>` (`shed.code.squirted`) —
  a 3-word geocode. Prefer the detail-block `maps.app.goo.gl` link, else the `w3w.co/<addr>`, in
  `locationUrl` (`extractW3wUrl` validates the host; pass a **base URL** to `new URL(href, origin)` so
  protocol-relative/relative hrefs parse instead of throwing, and return the normalized `parsed.href`).
- **🔴 The WP REST archive is a red herring.** `/wp-json/wp/v2/posts?per_page=100` returned **exactly
  1 post** (an old 2017 "run directions" page) — per-run posting was abandoned ~2017. A high run number
  (#2521) does NOT mean a structured archive exists. **Probe the REST API before assuming a backfill** —
  here there's none. Set `config.upcomingOnly: true` (rolling table) + a fail-loud `events.length === 0`
  guard (single surface, brand-new baseline 0).
- **🔴 Year-less dates on a rolling table need three guards, not a naive forward roll** (the research
  note's *"only ~3 near-term rows, so no bidirectional rule needed"* was wrong — the year boundary and
  source abandonment both bite). For `13th June`: strip the ordinal, look up the month via a **`Map`**
  (`new Map(Object.entries(MONTHS_ZERO))` — `.get()`, not `Record[var]`), build a UTC-noon date, then:
  1. **Bidirectional year roll** (mirror bangkok `inferYear`): `>60d` past → next year; `>8mo` future →
     prior year. The backward roll is what keeps a just-past `27 Dec` run scraped on `2 Jan` (Gemini catch).
  2. **Impossible-date rejection** (Codex catch): `Date.UTC(y,5,31)` silently rolls `31 June` → `1 Jul`;
     round-trip the constructed date against the requested month/day and return `null` on mismatch
     (leap-aware — `29 Feb` kept only in a leap year). A `day <= 31` guard is not enough.
  3. **Tight near-term horizon** (Codex adversarial catch — the *fail-open* fix): a receding hareline only
     ever shows current + the next few weekly runs, but an **abandoned/frozen table republishes last
     year's rows as phantom FUTURE events** once "now" wraps back within `filterEventsByWindow`'s ±90d of
     their month — and `upcomingOnly` reconcile (future-only) + the zero-event health alert are both blind
     to it (valid date, present every scrape). Gate accepted rows to `now-14d .. now+42d`; stale rows drop
     → 0 events → the existing fail-loud fires. (Shared exposure across every year-less `upcomingOnly`
     adapter — see the `reference_yearless_rolling_table_phantom_future` memory.)
- **🟡 Placeholder hygiene:** `Needed` (hares) → `null` (explicit clear, #2032 tri-state — the Warsaw fix);
  `Check.Back.Later` (w3w) → undefined. **⚠️ `Undecided` (venue) is NOT in the shared `stripPlaceholder`
  list** (which covers TBD/TBA/TBC/Needed/N-A/… but not "Undecided") → add an explicit per-source guard
  or it leaks as a venue.
- **`title` undefined → merge synthesizes "Himalayan H3 Trail #N"** (`friendlyKennelName` short-circuits on
  the 12-char shortName). Never set `title` to the hare/venue/run-id string.
- **Logo:** `wp-content/uploads/2017/08/trans_logo1.png` — a **stable** (non-tokenized) wp-content path,
  `http`-only → self-host (`trans_logo1` is the 117×120 RGBA `og:image`, the cleanest of three variants) +
  magic-byte the extension (`\x89PNG`) per convention.
