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
