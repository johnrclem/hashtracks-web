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
  `[/\b(taiwan|taipei|new taipei|formosa|kaohsiung|taichung|tainan)\b|[台臺][灣北中南]|新北|高雄/, "Taiwan"]`.
  The `[台臺]` class unifies the common (台) / formal (臺) Tai- forms in one token. (`inferCountry` lowercases
  input first, but `toLowerCase()` is a no-op on CJK, so the literal Chinese tokens match as written.)
- **⚠️ Single-character alternations trip SonarCloud S6035 — use a character class.** The first cut wrote
  `[台臺](灣|北|中|南)`; S6035 ("Replace this alternation with a character class") flagged the `(灣|北|中|南)`
  group → `[灣北中南]`. Reach for a char class, not `(a|b|c)`, for any all-single-char alternation (same rule
  that prefers `[-:]` over `(?:-|:)`).

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
