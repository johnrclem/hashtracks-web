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
- **Taoyuan Metro H3** (`tymh3.com`) — home AND `/upcoming-run` SSR carry **NO run data** (only nav, logo, tagline, email, FB link); the run list is a fully JS-rendered Wix Events widget → **needs browserRender**. *(Re-confirmed 2026-06-23 via real `web_fetch`; handed off `handoffs/2026-06-23-tymh3-tw.md`. 🔴 Refinement: the **content/info pages ARE fully SSR'd** — `/about-tymh3` gave founded date "27 Dec 2019", the full schedule prose [1st & 3rd + occasional 5th Friday, 7:30 PM; holiday Fridays → afternoon], run-type descriptions, email, FB — it's specifically the **Wix Events run widget** that's JS-only. Lesson: on a Wix-Events kennel, harvest metadata from the SSR About/info pages even when the run feed needs browserRender. DNS: apex `185.230.63.x` (Wix), `www`→`wixdns.net`. Tell Claude Code to first inspect the Wix Events viewer JSON XHR before falling back to browserRender, and set `timezoneId:"Asia/Taipei"`.)*
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

#### Hanoi H3 addenda (researched 2026-06-21) — WordPress.com **single-current-run PAGE** variant (NOT the REST-blog pattern)

Not every WP.com kennel is a REST-blog (ONH3/ASU). `hanoih3.com` (Traditional Hanoi H3) is WP.com-hosted
(DNS → `192.0.78.24/25` Automattic block; `meta-generator: WordPress.com`) but the **runs are NOT posts** —
the committee hand-maintains a single **"## Upcoming runs"** section on the **home page** carrying the
**current run only** as a `#### No.NNNN on <date> (<run-type>)` heading + emoji-labeled detail lines
(`📌 Location:`, `📍 First pick up: … maps.app.goo.gl/…`, `🐇 Hares: …`). This is the
**single-current-run SSR page** pattern (same shape as Manila/Warsaw), NOT a REST feed:

- **Adapter target = the home-page block, parsed with static Cheerio** — content-keyed traversal (heading
  text + labels), since WP.com **rotates the wrapper class names** (same caveat as the REST-blog detection,
  but here you're parsing rendered HTML, not JSON). `config.upcomingOnly: true` + a fail-loud zero-row guard
  (the page advances week-over-week, overwriting the prior run → reconcile would false-cancel without it).
- **Date string is IRREGULAR but year-bearing** (`"saturday, June,20th,2026"` — lowercase weekday, stray
  commas, ordinal). Normalize (strip ordinal, commas→spaces, collapse) → `chronoParseDate` → **no year
  inference** (year is present). No month-name alternation needed → no S5843/S5852 date risk.
- **The WP.com REST archive (`/wp/v2/sites/<host>/posts`) may still exist for backfill** — but on a
  single-current-run-PAGE site the run-report posts are often **sporadic free-form recaps**, not the clean
  per-run blocks the REST-blog kennels have. **Pull a sample (`?per_page=20`) before deciding** — don't
  assume the ONH3-grade structured archive. (From the research sandbox the REST JSON returned **empty to
  `web_fetch`** — non-allowlisted machine body; verify at build.)
- **Watch for a published "Run Stats" Google Sheet** in the nav — it's usually a **per-hasher attendance
  matrix**, not a per-run event log (low backfill value; the cells are JS-loaded so `web_fetch` on the
  `pubhtml` shows only the title).

**Build confirmations (shipped 2026-06-21, [PR #2272](https://github.com/johnrclem/hashtracks-web/pull/2272)):**

- **🔴 Scope to the run block's own `wp-block-column`, NOT a whole-page text scan.** The home page's second
  column is a Jetpack **slideshow** whose `figcaption` reads `No. 1763 Cold bia hoi run` (a *past* run's
  photo). A naive `lines.find(/^No\.?\s*\d+/)` matches whichever `No.NNNN` is first in document order — it
  works today only because the text column precedes the slideshow. Find the `<h2>` containing "Upcoming runs"
  → `.closest(".wp-block-column")` → `stripHtmlTags` *that* column; the gallery caption drops out. (Any
  single-current-run page with a photo gallery has this trap — past-run captions reuse the `No.NNNN` shape.)
- **🔴 The bare first-pickup maps shortlink can have the next run's `No.` template glued onto it**
  (`https://maps.app.goo.gl/FTavtwpc4hAoQTik7No.` — no `<a href>`, no separator). A greedy
  `…/[A-Za-z0-9]+` capture swallows the `No`. goo.gl shortcodes never contain a period, so the clean
  discriminator is: a captured shortcode ending in `No` that's **immediately followed by `.` in the source**
  is the artifact → strip the trailing `No`. (The second-pickup link, followed by `<`, is clean.)
- **🔴 SonarCloud's regex rules are NOT covered by local `lint`/`tsc`/CI-`test`.** A "strip leading
  `on`/weekday before chrono" regex (nested optional `\s*` next to an alternation) tripped **S5852 (ReDoS)**;
  `[A-Za-z0-9]` under `/i` tripped **S5869**. Fix: delete the prefix-strip entirely (`chronoParseDate` already
  ignores `on`/weekday and locks onto the explicit `Month D YYYY`, even when the source weekday disagrees),
  and drop the `/i` flag. Expect a post-push SonarCloud pass on any new adapter regex.
- **🟢 Same-weekday seasonal `scheduleRules`** (Sat 14:00 summer / 13:30 winter) shipped as two HIGH
  `SEED_DATA` rules with **disjoint `BYMONTH`** (`4..10` vs `11,12,1,2,3`) + `validFrom`/`validUntil` +
  `displayOrder`, mirroring `kennels.ts:5305`. `parseRRule` accepts `BYMONTH`; the disjointness is what keeps
  the two same-`BYDAY` rules distinct on the `(kennelId, rrule, source)` upsert key.

---

## Self-hosted WordPress — "This Week's Meet Point" flexslider + paged `/?cat=N` archive (learned from Creek H3, 2026-06-29, SHIPPED)

A common self-hosted-WordPress club shape (distinct from the WordPress.com REST blogs above): one home
**current-run block** + a deep **paged category archive** of past runs. `creekhash.org` (WP + WooCommerce):

- **WP REST disabled** (`/wp-json/wp/v2/posts` → **HTTP 404**) → static Cheerio, no API path. (Confirm at
  build with a single `curl`; the handoff's sandbox got an empty body, but 404 was the build-time truth.)
- **Home current run** = a `ml-slider`/flexslider: `.flexslider li.slide` → `<a href="?p=NNNNN">` (the
  detail page) + `.flex-caption h3` title `<ordinal> Month YYYY – Run <N> – <venue>` (spaced en-dash `–`).
  Split on the **spaced dash only** (never a bare hyphen — preserves "Al-Quoz" venue names), trim segments.
- **Detail page** = `.entry-content` `<p><strong>Label:</strong> value</p>` rows (Time/Location/Hares + a
  "Google Maps Link" `<a href>`). Read by an **allowlist of labels** so a "Contact if lost: <name> – <phone>"
  PII row is structurally never parsed.
- 🔴 **Date from the post TITLE, not the body `Date:` line** — the body weekday/day-number can be a source
  typo; the title's `<ordinal> Month YYYY` is year-bearing and cadence-consistent. And **validate it**:
  round-trip (y,m,d) through `Date.UTC` and return `null` on overflow, or merge's `parseUtcNoonDate` rolls
  an impossible "31st June" onto Jul 1 (Codex P2).
- **Deep archive** = `/?cat=N&paged=1..M` (clean WP `paged` pagination); listing titles alone give
  date+run#+venue (year-bearing → NO inference). Walk all pages once → freeze to `scripts/data/<code>-history.json`.
- 🔑 **A `Run <N>` archive can hide a restart-numbered sub-series.** Creek's `/?cat=4` carried a COVID-era
  **"Virtual Creek" (VCH3)** series renumbered **1–20** (2020) while the main series paused #1997→#1998 —
  also titled `Run N`, so a naïve filter ingests them as bogus low-numbered trails. Sort the frozen set by
  date, spot the restart, and filter by the **documented run-number floor** (here `< 1000`), NOT venue text
  (one real main-series run was also held virtually). See `reference_runn_archive_hidden_restart_subseries`.
- **`BACKFILL_ALLOW_SELF_SIGNED_CERT` is a no-op** (appears only in script doc comments, never read by code);
  the real Railway-TLS lever is `db.ts`'s `NODE_ENV` check + `DATABASE_URL` being present. An inline
  `npx tsx -e` DB probe needs `set -a && source .env && set +a` first (committed backfill scripts self-load via
  `import "dotenv/config"`).

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

#### North Hants H4 addenda (researched 2026-08-25) — CUSTOM-DOMAIN Google Sites + reduced-cadence single-run + unresolvable "atari" archive gadget

`nh4.org` (North Hants H4, Aldershot, England, founded 1981) is the **Manila single-current-run pattern
on a Google Sites CUSTOM DOMAIN** (`.org`, not `sites.google.com/...`). Confirmations:
- **A custom domain does NOT break the SSR-parse path.** `web_fetch`/`fetchHTMLPage` returns the home
  page's run block as plain text — labels `Run No:` / `Date:` / `Time:` / `Hare(s):` / `Location:` /
  `RV:` / `Postcode:` / `On Inn:` / `Notes:`, colon-adjacent, one per line after linearization. Detect
  the site as Google Sites via the `lh3.googleusercontent.com/sitesv/…=w16383` og:image + "Google Sites
  / Report abuse" footer. Register the adapter by the custom-domain URL pattern (`/nh4\.org/i`), not a
  `sites.google.com` pattern. Content-keyed parse (rotating classes) as always.
- 🟡 **Reduced-cadence single-run is still a valid onboard, not a 0-upcoming block.** NH4 posts exactly
  one "Next Run" and, as of 2026, runs "one run a month + pop-ups" (down from weekly). One genuine
  FUTURE run was posted (Sun 6 Sept 2026) → recently-active. `config.upcomingOnly:true` + fail-loud zero
  guard; no run numbers (`Run No: N/A` → runNumber undefined, title synth).
- 🔴 **The Google Sites "atari" embed gadget is NOT resolvable from the research sandbox.** NH4's
  `/run-list-old` page embeds `www.gstatic.com/atari/embeds/<hash>/intermediate-frame-minified.html`; the
  nested frame exposes only `jsh`/`r` params (the real embedded URL — possibly a Sheet/Calendar of past
  runs — is JS-loaded and not in the SSR). Treat such a gadget as an **unverified potential backfill
  source** and flag Claude Code to inspect the rendered nested iframe at build (browserRender / Chrome),
  rather than dismissing "no history" or guessing the target. (Generalizes the NSWHHH "enumerate embedded
  sheets" rule to the opaque atari-embed case.)

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

#### Teign Valley H3 addenda (researched 2026-07-25) — CUSTOM-DOMAIN Blogger + interleaved announcement/recap posts

`teignvalleyh3.com` (Teign Valley H3, South Devon, weekly Monday) is a **custom domain fronting
Blogger** — NOT a `*.blogspot.com` URL, so it's easy to mistake for a self-hosted site. Detection:
`meta-generator: blogger` + `meta-google-adsense-platform-domain: blogspot.com` in the page `<head>`;
the feed self-link exposes `www.blogger.com/feeds/<numericBlogId>/posts/default`. The public JSON feed
`https://<domain>/feeds/posts/default?alt=json` **IS fetchable from the research sandbox** via
`web_fetch` (`application/json`), same as a bare Blogspot — so a custom domain doesn't break the
recency/structure probe. `openSearch$totalResults` gives archive depth (TVH3: **922 posts**).

- **🔴 Two interleaved post types; detect the run by BODY, not title.** Unlike Brass Monkey (title
  carries `#NNN`) or empty-title Brasília, TVH3 mixes: (1) **run-ANNOUNCEMENT** posts whose title
  VARIES ("MONDAY'S DETAILS", or the venue "THE DRUM at Cockington", "THE STAR AT LIVERTON") and whose
  body opens `Run #NNNN Monday DDth Month … Circle up 7:15 pm from <venue+postcode> … with hare
  <name>.`; and (2) **"The Words" RECAP** posts (title "TVH3 The Words for …"/"the words …", body
  opens `HARE:` / "Who wuz there:" + trail narrative) that reference the SAME run number but are about
  a past run. **Detect announcements by the body pattern** (`Run #NNNN <Weekday> <Dth> <Month>` +
  "Circle up"); skip recaps. Only announcements become events; recaps would mis-parse a date. Pair
  with an `events.length === 0 && posts.length > 0` fail-loud guard (single-source, 0 baseline).
- **🔴 Year-less date `Monday 20th July`** (weekday + ordinal + month, NO year). Announcement is
  posted the **day before** the Monday run, so `post.published` is a tight anchor → infer year as the
  candidate ∈ {publishYear−1, publishYear, publishYear+1} **closest to `published`** (Brasília rule;
  handles Dec→Jan). Strip the ordinal, month via a `Map` 3-letter lookup (no month-name alternation →
  S5843/S5852-safe), validate via `Date.UTC`, store UTC noon.
- **Body markup is Facebook-pasted** — nested `<span class="html-strong">`/`html-span`, `&nbsp;`,
  `&amp;` — parse the `stripHtmlTags(content, "\n")` flattened text, never raw HTML.
- **No per-event coords** — venue is free text + UK postcode (occasional what3words token →
  `locationUrl https://what3words.com/<w1.w2.w3>`); leave lat/lng undefined, merge geocodes the
  postcode. No default-pin trap. `startTime` fixed "19:15" from "Circle up 7:15 pm".
- **`title` undefined** → merge synthesizes "Teign Valley H3 Trail #N" (the venue-y post title is NOT
  a theme). shortName "Teign Valley H3" (>4 chars) keeps the synth clean; don't use bare "TVH3".
- **Deep archive** (blog since 2007; public feed caps ~150 → use the keyed `fetchBloggerPosts` for the
  full set), but only ~half the posts are announcements → filter, then freeze to
  `scripts/data/<code>-history.json`. `config.upcomingOnly:true` (bounded-window fetch).

#### Devonport H3 addenda (researched 2026-07-26) — CUSTOM-DOMAIN Blogger, LABELED-ANNOUNCEMENT bodies + prose deep-archive

`dhash.com` (Devonport H3, Devonport **Tasmania**, weekly Monday — "The Odd Sock Hash") is another
**custom domain fronting Blogger** (blog id `7231198193475707740`; `meta-generator: blogger`; JSON feed
`/feeds/posts/default?alt=json` sandbox-fetchable, `application/json`, **1426 posts**). Unlike TVH3
(free-form-ish announcement bodies) it uses **cleanly LABELED advance-announcement bodies** — a distinct,
easy-to-parse variant, plus a couple of durable gotchas:

- **🔴 Detect the run by the TITLE (`^Run\s+\d+`) AND a `When:` body line — NOT title-only.** The blog
  interleaves clean `Run NNNN` announcement posts with **free-form prose** (RIP notices, recaps, social
  posts, titles like "Squeak!"/"Cloud Nine Hash"). The announcement body, after `stripHtmlTags(content,"\n")`,
  is a stack of labeled lines: `Hare: <name>` / `Where: <venue free text>` / `When: <full date + time>` /
  `Cost: $NN` / `Bring: …` / `Notes: …`. Labels use `Word:` (colon adjacent) → label regexes need no `\s*`
  (also S5852-clean). Pair with an `events.length===0 && posts.length>0` fail-loud guard.
- **🟢 `When:` date is YEAR-BEARING** ("Monday, 27 July 2026, 6.30pm for 6.45pm Sharp START (AEST)") → parse
  `D Month YYYY` / `chronoParseDate`, **NO year inference.** `startTime` = the *second* clock time ("6.45pm
  Sharp START" → "18:45"), or just the fixed schedule time. `title` undefined (bare "Run N") → merge synthesizes.
- **🔴 Embedded forward "Receding Hareline"** — the current announcement post ALSO carries a `Receding
  Hareline:` list of FUTURE runs (`Run NNNN – D/M  Hare`, EN-dash, **D/M has no year**). Optional enrichment:
  emit forward skeleton events (runNumber + date [infer year = next occurrence after the anchor run, roll
  Dec→Jan] + hare; venue/startTime from schedule). **Preserve source typos verbatim** (Devonport's list
  jumped 2329→2340 — a real typo; merge collapses by `(kennel,date)`, never renumber).
- **🔴 Deep archive is FREE-FORM PROSE — the labeled format is RECENT.** `openSearch$totalResults` said 1426
  posts back to ~2009, but a `start-index=800` sample (2012) was narrative prose with run details buried in
  sentences + Google-Maps links — NOT the labeled format. So a **full backfill is not worth scripting**; the
  adapter's recent-window fetch + `upcomingOnly:true` populates recent runs by itself. (Probe-before-dismiss
  satisfied: pulled the 2012 slice and it's prose.)
- **No per-event coords** (venue is free text: "K-Tek Workshop, Matthews Way, Don") → lat/lng undefined,
  merge geocodes. Logo = tokenized Blogger masthead banner (`blogger.googleusercontent.com/img/a/…=s1100`,
  no extension) → self-host + magic-byte ext (same as TVH3).
- **Region note:** Devonport, Tasmania → new **Tasmania STATE + "Devonport, TAS" METRO** under the existing
  Australia country (STATE→METRO hierarchy like SA→Adelaide; tz `Australia/Hobart`; yellow palette).
  `COUNTRY_INFERENCE_RULES` already covers `tasmania`/`hobart` — **omit bare `devonport`** (collides with
  Devonport, Plymouth UK and Devonport, Auckland NZ). Watch the name trap: "Devonport" reads like Devon,
  England but AEST +10:00 / AUD / East-Devonport venues confirm Tasmania.

#### City of Exeter H3 addenda (verified via real feed, 2026-07-27) — bare-Blogspot RECAP blog, run descriptor in the TITLE, **order-inconsistent middle segment**

`cityofexeterhhh.blogspot.com` (City of Exeter H3, Exeter/Devon, weekly Sunday 11am "family hash") is a
**bare `*.blogspot.com`** (not a custom domain like TVH3/Devonport; also served on `cityofexeterh3.org.uk`).
Public JSON feed `/feeds/posts/default?alt=json` sandbox-fetchable (`application/json`, **1077 posts**).
Distinct from the other Blogspot variants — the run data lives in the **post TITLE** (like Ghost Bali Hash 2
`parseBaliTitle` / Blogspot Brass Monkey), NOT the body, and the posts are **RECAPS of past runs** (there is
no advance-announcement surface — onboard on the recently-active rule + `upcomingOnly:true`, same as
Devonport/TVH3):

- **Title format:** `#NNNN <location> - <hares> - <date>` (e.g. `#1267 King George V playing fields - Speedy - 19 July 2026`).
- 🔴 **The two middle dash-segments (location vs hares) are ORDER-INCONSISTENT across the archive.** Almost
  all recent posts are `location - hare`, but 2023 `#1091 Wide - Dawlish` is **hare - location** ("Wide" is
  the GM's hash-name; "Dawlish" a town). Position alone can't tell venue from hare → **do NOT assign
  location/hares by position** (a hare nickname on a map pin is silent corruption). Leave both undefined by
  default; runNumber + trailing date are the only reliable title fields.
- **runNumber + date reliable in the run-numbered era** (≥~2021/2023). `extractHashRunNumber` keys on `#`;
  the trailing date is **year-bearing** but drifts (`19 July 2026`, `May 10 2026`, `May 3rd 2026`,
  `31 May 2026`, tight-dash `Can't Tell- 12 July 2026`, `". "`-separated `Pearl and Hansel. 31 May 2026`) →
  normalize (strip ordinals, unify separators) then `chronoParseDate` (no month-name alternation → S5852/S5843-safe).
- 🔴 **Pre-run-number era (≤2019) is messier** — NO `#NNNN`, some titles **missing the year**
  (`Pynes Hill - BluToe and Hole in 1 - 30th December`), and **non-run posts interspersed** ("... Haberdashery",
  "Updated ... hash diary", "New for 2023 follow us on Instagram") carrying **PII** (a `@hotmail.com` email in
  the merch post). **Detect run posts by a parseable trailing year-bearing date** (skip anything without one);
  backfill only the run-numbered era, defer the prose/PII era.
- **No per-event coords/times** — venue is free title text (bodies are recap prose; any Maps link is usually
  *next* week's venue). `startTime` is the fixed schedule (Sunday **11:00**), not per-event. `title` undefined
  → merge synthesizes `"<Kennel> Trail #N"`.
- **Metadata is on the blog's static pages** (`/p/an-introduction-to-city-of-exeter-h3.html`) even when the
  runs are recaps — schedule, dog/walker friendliness, FB group, IG handle, WhatsApp link all live there.
- **Logo:** tokenized Blogger asset (`.../coeh3-1-transp-small.gif`) → self-host + magic-byte ext (GIF here).
- **🔁 Re-verified + HANDED OFF 2026-10-12** (`handoffs/2026-10-12-coeh3.md`, `coeh3`): feed `updated 2026-10-11`, now **1087 posts**, newest **#1279 "Chudleigh Knighton play park - NoButt and Mouthful - 11 October 2026"**, weekly-Sunday cadence #1273→#1279 confirmed. New drift observed in the recent sample: **emoji inside a hare segment** (`#1278 … - Can't Tell and Capt 🦚 - 4 Oct 2026`) and a **2-segment special with NO hare/venue** (`#1273 Spockfest hangover hash - 30 August 2026` = `<theme> - <date>`). The 2026-07-27 **order-inconsistent-middle-segment** rule still holds and was carried into the handoff (location/hares left undefined by position; runNumber + trailing year-bearing date the only reliable fields). foundedYear **2001** nailed via feed **#1274 "25th Anniversary Hash" 6 Sep 2026**. Reconcile stance: model on OFH3 (ships WITHOUT `upcomingOnly`, scrapeDays:90) and verify no false-cancel at build before adding `upcomingOnly:true`.

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
`kennelCodes`. **`upcomingOnly` is OMITTED on a LIVE-ONLY HC source** — HC `getEvents` returns future-only
and the established HC kennels survive reconciliation without it.
- 🔴 **EXCEPTION — set `upcomingOnly:true` whenever the HC source ALSO carries a one-shot backfill (Bandung
  #2340).** The adapter is future-only, so reconcile's `timeMin` guard (`= now - days*86_400_000` when
  omitted; candidate query filters by `kennelId`+`date` with **no sourceId filter** — `reconcile.ts:144`,
  `:162-185`) makes every backfilled past row a sole-source cancellation candidate the live scrape never
  re-confirms → it **false-CANCELs the whole archive** inside the 365-day window (Bandung: ~52 of 55 rows).
  Matches Asunción / `nth3-tw` (future-only adapter + backfill ⇒ `upcomingOnly:true`). Only live-only HC
  kennels omit it; the "omit on every HC source" line does NOT survive a backfill.

- **`getEvents` (the adapter path) is future-only** — the API exposes only upcoming events (earliest ~6
  days out). A high run number (LH3's #1016) implies deep history the *adapter* won't serve. **But
  `hashruns.org/api/global-runs?isFuture=0` DOES serve the HC archive** (see the global-runs backfill note
  below) — so an HC kennel's history is recoverable from its HC-join date forward even without a separate
  Blogspot/WordPress/Sheet archive (LH3 predated that discovery).
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
  - 🟢 **BENIGN placeholder for GMT/UTC+0 kennels: `Atlantic/Reykjavik`** (learned from Sierra H4 / Freetown,
    2026-07-23). HC tags some UTC+0 kennels `Atlantic/Reykjavik` (a no-DST UTC+0 zone). When the real city is
    ALSO UTC+0 with no DST — e.g. **Freetown = `Africa/Freetown`** (GMT year-round), Accra, Dakar, Reykjavík
    itself — the placeholder is **wall-clock-correct**: `EventStartDatetime == EventStartDatetimeGmt` and a
    17:30 start stays 17:30. So **no event-level tz correction is needed** (unlike Belgrade `Europe/Warsaw` /
    KRASH / Heraultics `Europe/Berlin`, which DO shift the wall clock). Still set the METRO region record to the
    real IANA zone (`Africa/Freetown`), but don't chase a startTime bug that isn't there.
- **Reachable from the research sandbox?** `hashruns.org` is a normal HTTPS site — try `web_fetch` on the
  `/api/global-runs` URL first; if it's allowlist-blocked, run it from the Claude-in-Chrome extension
  (page-context `fetch`). Either way it beats replicating the Azure `generateAccessToken` token below.
- 🔑 **`global-runs` ALSO returns PAST events** — a **one-shot historical-backfill source for any HC
  kennel**, not just a discovery tool (the Azure `getEvents` adapter path is future-only). 🔴 **Endpoint
  mechanics (verified at the Bandung build #2340):** `isFuture=0` **REQUIRES** `minEventDate`+`maxEventDate`
  (HTTP 400 "minEventDate and maxEventDate are required for past runs" without them), and **`publicKennelId`
  is IGNORED** — the feed returns ALL kennels' past runs in the window, so filter **client-side** by
  `PublicKennelId`. Rows are **PascalCase** (`LocationOneLineDesc` + `LocationStreet`/`City`/`PostCode`/
  `Region`/`Country` — join with `", "` to byte-match the adapter's `composeHcLocation`). Window caps:
  `isFuture=1` ~200 rows; each `isFuture=0` request ~2 MB → page ≤6-month windows, dedup by `PublicEventId`.
  ⚠️ **Response shape is NOT always a bare array (verified Moonshine Dubai, 2026-06-29):** `isFuture=1`
  returns a **wrapper object `{ totalMatchingEvents, runs: [...] }`** (read `.runs`), while `isFuture=0`
  returns the rows under `.runs` too — code defensively (`const arr = raw.runs ?? (Array.isArray(raw) ? raw : [])`)
  so a `.filter is not a function` doesn't silently zero out the pull. Per-event fields on `isFuture=1`:
  `PublicKennelId`, `EventNumber`, `EventName`, `EventStartDatetime` (local) + `EventStartDatetimeGmt`,
  `EventPriceForMembers`/`EventCurrencyType`, `Hares`, `LocationOneLineDesc`, `Latitude`/`Longitude`,
  `EventDescription`, `KennelSlug`/`KennelShortName`/`KennelName`/`KennelLogo`/`KennelIANATimezone`.
  **Coverage is from the kennel's HC-join date forward, not its lifetime** (Bandung: 55 rows back to #2253
  2025-06, NOT to its 1984 founding — the LH3/PIH3 caveat). Bind the backfill to the live HC source AND set
  `upcomingOnly:true` (the EXCEPTION above). 2026-06-18 pulls: Bandung 55, Moonshine Dubai 17, Barbados 130.
- 🔑 **`SearchTags` is the location fallback when `LocationCity`/`LocationCountry` are blank (learned Big Lik H3 / BLHHH, 2026-10-17).** Some HC kennels carry **no `LocationCity`/`LocationCountry`** on the event object and a generic venue in `LocationOneLineDesc` (Big Lik: just `"The Hash House"`), which made the kennel "city unconfirmed" and parked it as verify-live-first across several runs. But the **kennel-level `SearchTags` string** holds the geography: Big Lik's was `"Incirlik  Turkey  Adana   Southern Europe"` (note double/triple spaces — split on `/\s+/` and discard the `KennelContinent` tail). That resolved it to **Incirlik Air Base / Adana, Turkey** and unblocked a config-only onboard (first Turkey kennel). **Always read `SearchTags` before declaring an HC kennel's city/country unidentifiable.** (Caveat: `SearchTags` is free-form kennel-authored text, so treat it as a strong hint, not a schema field — cross-check the continent/timezone.)
- 🔑 **Discovery sweeps must do a FULL name-by-name diff of the future feed vs seed — not "do the
  unfamiliar-looking names resolve" (learned Okinawa Poofters / OPH3, 2026-09-15).** Two consecutive
  "HC bench EXHAUSTED, nothing onboardable" runs (2026-09-13, -14) both had **Okinawa Poofters (OPH3,
  `PublicKennelId c4a54536-aa57-41b1-b487-f94db0fd2e71`)** sitting in the `isFuture=1` feed with a real
  upcoming run — but the sweeps only eyeballed the names that *looked* new and confirmed those were
  seeded, so a genuinely-new kennel whose name didn't jump out got skipped for two days. The reliable
  recipe: extract EVERY distinct `KennelName`/`KennelSlug` from the feed and `grep -il` each against
  `prisma/seed-data/{kennels,sources,aliases}.ts` — treat a 0-hit as a candidate, don't rely on
  recognition. (OPH3 was onboarded 2026-09-15 config-only once the diff surfaced it.)
- 🔑 **An umbrella hash can register a mid-week / sub-trail series as its OWN kennel on Harrier Central,
  with a distinct `PublicKennelId` + independent run-number sequence, while the umbrella's main trails
  live only on a Wix/other site (learned Okinawa Poofters, 2026-09-15).** The Okinawa Hash House Harriers
  (parent, `okinawah3.wixsite.com`, Saturday trails on a JS Wix Events widget) registers only its
  mid-week **"Poofter Trail"** series on HC as `KennelName "Okinawa Poofters"` / `KennelShortName "OPH3"`,
  run #383. So HC-registered "sub-series" are legitimate standalone kennels to onboard (config-only), and
  the umbrella's *other* series (Saturday, Full Moon) are separate future targets on their own source with
  **no bleed** (HC filters by `publicKennelId`). Watch two things: (a) `foundedYear` — the umbrella's
  founding (Okinawa HHH = Feb 1980) is NOT the sub-series' founding; leave blank+flag unless the sub-series'
  own start is cited; (b) `EventName` is often a systematic `"<SHORT> - <N> (<hare-initials>)"` label, not a
  real theme — `applyTitleFallback` passes non-empty names through verbatim, so either add a
  `staleTitlePattern` regex option or lean on `defaultTitle`.
- 🔑 **The `isFuture=1` ~200-row cap is DATE-ORDERED — a specific kennel whose next run is more than ~a
  week out (or which has 0 upcoming) will NOT appear in the global future feed, even though it's live
  (learned KRASH H3, 2026-07-09).** So `global-runs?isFuture=1` is a *discovery/enumeration* tool, not a
  reliable per-kennel liveness probe. To verify ONE specific kennel's upcoming slot, hit the adapter's
  actual Azure `getEvents` path directly — it filters server-side by `publicKennelIds` and returns just
  that kennel's current/next event. This is trivially reproducible **in-browser** (Claude-in-Chrome
  page-context, no sandbox host-allowlist issue) by porting `src/adapters/harrier-central/token.ts` to
  SubtleCrypto:
  ```js
  const PH="11111111-1111-1111-1111-111111111111", EP=Date.UTC(1963,7,15,9,52,28,0);
  const s=Math.floor(Math.floor((Date.now()*1000-EP*1000)/1e6)/86469);
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${PH}#hcportal_getEvents#${s}`.toUpperCase()));
  const accessToken=[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  const j=await fetch('https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({publicHasherId:PH,accessToken,queryType:'getEvents',publicKennelIds:'<GUID>'})}).then(r=>r.json());
  // → [[ {eventNumber, eventName, eventStartDatetime, daysUntilEvent, hares, locationOneLineDesc, ...} ]]
  ```
  `getEvents` is future-only but returns the **most-recent slot even when it's just passed** (KRASH's #32
  came back with `daysUntil: -1`) — so a negative `daysUntilEvent` on the sole returned event = "last run
  already happened, no next run posted yet" = the recently-active signal. Pair it with the `isFuture=0`
  past sweep for the cadence evidence. (This is cleaner than the city-name finder sweep below when you
  already have the GUID from the queue.)
- 🔴 **The converse trap: `global-runs?isFuture=1` can list a kennel the adapter's `getEvents` path returns
  0 for (learned YH3 sweep, 2026-09-11).** CERN H3 (`80886b52-…`) showed **3 future runs (next 2026-10-09)**
  in the `global-runs` future feed, yet the Azure `getEvents` POST for that same GUID returned **`count: 0`**
  (status 200) — i.e. the ADAPTER would scrape zero events for it. The two endpoints are different backends;
  `global-runs` (hashruns.org Next.js) is NOT a proxy for what `getEvents` (the adapter) serves. **Selection
  rule: never onboard an HC kennel on `global-runs` evidence alone — confirm the adapter path (`getEvents`
  by `publicKennelIds=<GUID>`) returns ≥1 upcoming (or the recently-active `daysUntil<0` slot). If `getEvents`
  is empty, the config-only source will scrape nothing, no matter how healthy `global-runs` looks.** (A
  clean 43-kennel sweep confirmed the rest: every other globally-upcoming HC kennel was already shipped/live;
  YH3 was the sole not-live one that `getEvents` also confirmed scrapeable — 2 upcoming.)
- 🔴 **Curated-backfill discipline — preserve STRUCTURAL quirks, FIX value errors that corrupt on load
  (Bandung #2340).** "Extract faithfully" applies to real identity facts (a genuine run-number reuse across
  two *distinct* events, gaps like Bandung's 2273/2289, a verbatim title typo like #2301's "Run 2231") — NOT
  to value errors. Two of Bandung's handoff-listed "quirks" were actually broken data: (a) the "#2292 reuse"
  was a **mis-dated duplicate** (same venue on 02-20 AND 02-27) that collides with the real #2291 on
  `(kennel,date,startTime)` and **folds into it** via the merge same-day match (`merge.ts:1463-1473`,
  `looksLikeSameEvent`) → mislabels #2291; drop the duplicate. (b) Three `02:30` start times were a **clerical
  AM/PM typo** (12h off 14:30, the GMT field agrees, contradicts the kennel's "2:30pm sharp") → normalize to
  14:30. **Dry-run the frozen JSON through the merge and scan for same-`(kennel,date,startTime)` collisions +
  12h-off / impossible times BEFORE trusting a "preserve quirks" line.** HC `Hares` remains unreliable
  per-kennel (location-bleed) → omit when it looks like a venue.
- 🔴 **DNS/HTTP-verify the seeded `website` + socials, not just the source (Bandung #2340).** The handoff's
  `bandung-hash.com` was **NXDOMAIN** (a dead `website` renders a broken card link). Drop a dead `website`;
  do NOT substitute `hashruns.org/<slug>` — no HC kennel uses the platform front-end as its `website` (own
  site or none). The live FB page (`facebookUrl`) is the external presence.
- 🔴 **`<shortcode>.org` resolving ≠ the kennel's site — a DNS Status 0 can be an UNRELATED org that owns
  the abbreviation (Algarve H3 2026-06-30).** A3H's queue-proposed `a3h.org` resolved (Status 0) but is the
  **"Activities & Attractions Association of Hawaii"** — same three-letter abbreviation, different entity.
  The DNS check passes, so the WSH3 NXDOMAIN guard does NOT catch this. **Fetch the page and confirm the
  CONTENT is the hash** (hash vocabulary: "On On", "hares", "kennel", trail) before citing it for any field.
  The real site is found by name-search, not by guessing `<code>.org`. (For A3H: `algarvehashhouseharriers.com`,
  while `a3h.org`/`algarvehhh.org` were a Hawaii trade body / NXDOMAIN respectively.)
- **HC `global-runs` has NO currency field** (only `EventPriceForMembers`/`EventPriceForNonMembers` numbers).
  Infer the currency from the kennel's country (Algarve → €5, not £5 — even though the HC `KennelIANATimezone`
  said `Europe/London`). State the inference + flag "confirm at build" in the handoff; never assert a currency
  the feed didn't carry.
- **HC kennels can carry a duplicate run number across two DISTINCT dates** (Algarve #2167 on both 2025-12-28
  and 2026-01-11 — a real renumber, not a mis-date like Bandung's #2292). When the two rows are on genuinely
  different dates, **keep both and dedup the backfill by DATE, not run number** (the merge fingerprint
  `kennelTag+date` separates them); only drop a dup when it's the SAME event mis-dated (Bandung). `console.warn`
  either way so it's visible. 🔴 **SHIPPED correction (Algarve #2486):** at build the 2025-12-28 #2167 turned
  out to be a **cancelled slot** — `EventName` literally `"HASH CANCELLED"`, `IsCountedRun=0`, venue `"Tbc"` —
  NOT a second real trail, so it was **dropped** (see the cancelled-row rule below), leaving a single clean
  #2167 and no dedup collision at all. The handoff's "keep both distinct dates" premise was written before the
  ground-truth pull; **check each dup row's `EventName`/`IsCountedRun` before assuming both are real.**
- 🔴 **Drop cancelled / uncounted HC rows (`IsCountedRun=0`, `EventName` like "HASH CANCELLED") — they are
  scrubbed slots, not trails (Algarve #2167 @ 2025-12-28, 2026-07-01).** Ingesting one produces a past
  "HASH CANCELLED" event card. Filter them out in the extractor (`IsCountedRun === 0` + a `/^hash cancelled$/i`
  name guard). Mirrors the Bandung/#2292 posture (drop non-events), and often resolves an apparent run-number
  "duplicate" for free.
- 🔴 **NEVER populate `description` from HC `EventDescription` — it frequently carries PII (Algarve, 2026-07-01;
  cf. Hua Hin FM #45 bank-account note).** A3H's `EventDescription` on real runs was a free-text blob with hare
  **emails and phone numbers** (the handoff's "description 0/28" field-fill was wrong — the field was full, just
  of PII). The live `HarrierCentralAdapter` emits **no `description`** at all, so omitting it in the backfill is
  both faithful and PII-safe. (The ONE documented exception — an online/virtual note moved to `description` —
  is a hand-authored string, never a copy of `EventDescription`.) Corollary quirk: A3H stores raw **coords AS
  the venue text** (`LocationOneLineDesc` = `"37.1, -8.0"`) on most runs, so `composeHcLocation`'s coords-only
  drop correctly leaves `location` empty while the village survives in the title — expected, not a parsing miss.
- 🔴 **HC `global-runs` PAST rows carry region-default geocode-fail pins on real venues (Barbados #2162,
  2026-06-30).** #2162's venue "MIle & a Quarter pavillion" (St Peter, Barbados) came back with
  **Tokyo/Roppongi coords `35.66, 139.73`** — HC's fallback pin. The live `HarrierCentralAdapter` drops
  these via `hcGeocodeFailed`/`dropApiCoords`, but that code does NOT run on the `global-runs` backfill
  path — so the extractor needs its own guard: a **country bounding-box** filter (drop lat/lng outside the
  kennel's country → merge re-geocodes from the venue text). Both Gemini and Codex flag this if missed.
- 🔴 **HC past archives contain AM/PM `startTime` typos (Barbados #2137 @ 22:00, #2128 @ 03:30).** #2137
  was an Easter-Monday holiday run (kennel does 10:00 holidays) stored at 22:00; #2128 at 03:30 amid 15:30
  neighbours. In the extractor, keep only plausible hash hours (**`06:00`–`20:00`**) and **drop**
  out-of-range to `undefined` rather than fabricate a corrected time (preserves legit 10:00 holiday +
  19:00 evening runs). Same faithful-but-safe posture as the coord scrub above.
- 🔴 **An ONLINE/virtual backfill row must CLEAR `location`, not just omit coords (Moonshine Dubai #360,
  2026-07-01).** #360's HC `LocationOneLineDesc` was a free-text sentence — "Online due to current security
  climate in Dubai. Contact admin via chat for Zoom link." — with fee 0 and no coords. Omitting lat/lng is a
  **half-fix**: `resolveCoords` (`merge.ts:~1290`) geocodes `event.location` whenever coords are absent and
  the text is truthy, and a sentence containing a city name ("Dubai") geocodes to a **real pin** that passes
  the 200 km kennel-proximity check → a virtual run shows a physical venue. This is DISTINCT from the
  placeholder-sentinel handling above: `stripPlaceholderLocation` only drops exact sentinels (`TBD`/`TBA`/
  "No location provided") — a free-text "Online due to…" sentence is NOT a sentinel and slips through. Fix
  (Codex P2, shipped unlocated): put the note in **`description`** (which merge never geocodes) and **omit
  `location`** entirely so the row renders unlocated (centroid fallback). Rule of thumb: for any
  online/virtual/no-physical-venue row, clear `location`; the geocoder pins ANY truthy location text.
- 🔴 **A literal placeholder venue (`"TBD"` etc.) in a frozen backfill row must be stripped to match
  live-adapter output (Moonshine Dubai #351, 2026-07-01).** #351's `LocationOneLineDesc` was `"TBD"`; the
  frozen JSON stored it verbatim, but the live adapter's `stripPlaceholderLocation` (`GEOCODE_FAIL_SENTINELS`
  includes `tbd`) would emit `undefined`. CodeRabbit caught the divergence. Run each `LocationOneLineDesc`
  through the same sentinel family the adapter uses and store `undefined`, not the placeholder — the frozen
  row should match what a live scrape produces. (General principle across all HC-backfill fixes: **a frozen
  row should be field-for-field what the live adapter would emit**, except where a documented data-quality
  decision overrides. Corollary: the HC adapter emits no `cost`/`description`, so a backfill omits both —
  kennel-level `hashCash` covers cost — the lone exception being an online note in `description` per above.)
- 🔴 **HC `KennelLogo` is NOT always a web URL — it can be a `bundle://…` app asset (SH2B / Seattle Hash
  House Bikers, 2026-07-18).** Most HC kennels return `KennelLogo` as a fetchable blob
  (`harriercentral.blob.core.windows.net/harrier/<name>.<ext>`), but some return an **in-app bundle
  reference** like `"bundle://C-180"` — an asset shipped inside the HC mobile app, **not resolvable over
  HTTP**. When you see `bundle://` (or any non-`https://` `KennelLogo`), treat the logo as **unavailable**:
  leave `logoUrl` blank + flag, ship without a logo, and do NOT fabricate a `…blob.core.windows.net` URL by
  pattern-matching the kennel name (the blob may not exist). Optional recovery: pull a logo from the kennel's
  FB page and self-host to `public/kennel-logos/<code>.<ext>` (confirm ext via magic bytes).
- 🟡 **A `KennelLogo`-less HC kennel often has a dead/parked own-domain — verify before citing it as
  `website` (SH2B, 2026-07-18).** SH2B's FB "Contact info" listed `gargoyle@hashbikers.com`, but
  `hashbikers.com` DNS-resolves (Status 0) to a **HugeDomains "for sale" parking page** — it is NOT the live
  kennel site. The email-domain of an HC/FB-only kennel is a lead, not a confirmed website: navigate it (or
  DNS + a quick fetch) and confirm real kennel content before citing. If parked/dead, leave `website` blank +
  flag; the FB page is the live presence.

#### Heraultics H3 addenda (config-only HC, Hérault/France, 2026-07-08)

- 🔴 **A country-bounding-box coord scrub is for geocode-FAIL DEFAULT pins — NOT for a kennel that does
  real international away-runs. Spot-check, don't blind-drop.** Heraultics (a Hérault kennel) has two
  genuinely-foreign past coords: #7 Helgoland, Germany (`54.188, 7.885`) and #10 a Baltic ferry
  Stockholm↔Turku (`59.469, 19.368`). Both are the **real venue** — the kennel travelled there
  (blog run reports confirm). A blanket France-bbox filter (the Barbados/Bandung reflex) would erase
  these true pins. Rule: apply the bbox scrub only when the out-of-country coord is a HC region-default
  *fallback* on a run whose venue is clearly local (Barbados #2162 = Tokyo pin on a St-Peter venue);
  when the venue TEXT itself is the foreign place (a named away-run), the foreign coord is correct —
  keep it. Distinguish by reading `LocationOneLineDesc`, not by lat/lng alone.
- 🟢 **The kennel's own blog is the tiebreaker for HC time typos AND for confirming out-of-range times
  are REAL — don't apply the 06:00–20:00 hour-gate blindly when a corroborating source exists.**
  Heraultics #6 HC-stored `00:30` was a 12h AM/PM typo → blog says "at **12:30**" (correct to 12:30,
  Bandung-class fix). But #10 HC-stored `22:30` is a **genuine** late ferry run — blog says "March 5th
  2026 - **22:30**" — so the Barbados hour-gate (which would drop >20:00) must NOT fire here. When a
  Blogspot/WordPress run post exists, prefer its verbatim "When:" time over both the HC value and a
  mechanical hour-gate; the gate is only a fallback for typos with no corroboration.
- **A HC kennel can have a shallow HC archive but a deeper OWN-SITE archive.** Heraultics joined HC at
  run #6 (2024-04) — `global-runs?isFuture=0` only reaches #6→#11 — but its Blogspot
  (`heraulticsh3.blogspot.com`) holds #1–#5 (2019–2021). For low-volume kennels, check the blog archive
  depth before declaring the HC window "full history"; a deeper one-shot Blogger backfill may be optional
  but available (`fetchBloggerPosts`). foundedYear/hashCash that HC can't give (HC has no currency/founding
  field) are usually on the blog verbatim ("Hashcash : 5€", Run #1 date).
- **Sporadic/irregular kennels are onboardable when there's a posted upcoming run.** Heraultics runs
  ~quarterly with 1–9-month gaps (blog literally says "running sporadically"), but a confirmed future
  #12 with hares assigned + a counted run ~80d ago = clearly active. Don't confuse "low cadence" with
  "stale" — the Step-3 recently-active bar is *last run within ~2× interval*; for a quarterly kennel an
  80-day-old last run + a scheduled next run passes easily. Onboard (handed-off), never `blocked: stale`.

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
- **Re-extracting the `anon` key from the research sandbox is hard — don't block on it (2026-06-25 Riyadh
  re-verify).** The key is NOT in the Vite **entry** bundle (`/assets/index-*.js`) — it's in a **code-split
  chunk** (the one imported by the data hooks, e.g. `useVisitorBlockManagement-*` / `secure-registration-*`),
  so grepping the entry returns nothing. `web_fetch` also **truncates** the entry's long minified lines, a
  cross-origin `fetch` of the bundle is CORS-blocked, and Chrome MCP auto-denies the brand-new SPA domain
  when no user is present. **Project reachability can be proven without the key — but NOT the table path:** a
  keyless `fetch('https://<ref>.supabase.co/rest/v1/<table>?select=...')` returns **HTTP 401 `{"message":"No
  API key found in request"}`** with an open CORS header — that confirms the **project + CORS** are live, but
  Supabase rejects a keyless request at the gateway *before* PostgREST resolves the relation, so an
  arbitrary/misspelled `<table>` returns the **same** 401 (Codex review, #2317). 🔴 **Table existence +
  columns stay unverified until the authenticated row pull** — gate "source verified" on that, not the 401
  (the documented recon sample is the only standing evidence of the table shape). Flag the actual row pull +
  current-key decode as a build-time step (Claude Code reads the live Network-tab `apikey:` header or decodes
  the chunk's `role:anon` JWT).

**Build corrections (Riyadh H3 SHIPPED 2026-06-25, [PR #2387](https://github.com/johnrclem/hashtracks-web/pull/2387) — see the retro):**
- 🔴 **The `anon` JWT goes in an ENV VAR, not a committed constant or `Source.config` literal.** It's
  publishable (RLS-gated) so it's not a *security* risk — but **Codacy's secret scanner fails the PR gate on
  the hardcoded JWT** (SonarCloud passed; Codacy is stricter), and excluding the whole adapter via `.codacy.yml`
  is too broad. Seed it as `RIYADH_H3_SUPABASE_ANON_KEY`, read by both the adapter and the backfill via a shared
  `resolveRiyadhAnonKey(configKey?)` (optional `config.supabaseAnonKey` override), failing loud if unset.
  Document it in CLAUDE.md and **set it in Vercel (Production) before merge** or the cron scrape fails loud
  (no events) until it's present.
- 🔴 **The recon's documented sample row is a FLOOR, not the schema.** Riyadh's live `hikes` rows carried three
  more populated columns than the 2026-06-18 recon captured: `map_link` (Google Maps shortlink → `locationUrl`),
  `location_gps` (DMS → lat/lng via `parseDMSFromLocation`), and a real `description`. Build-time `adapter.fetch`
  must `select=*` once and map **every** user-visible field present, not just the recon's columns.
- 🔴 **Single-sample premises about a field are unreliable — tally the whole column.** The recon said "weekly
  Thursday" and "titles are place-name dups (drop them)." The full 59-row feed showed **58 Friday / 1 Sat / 0
  Thursday** (the `date` column is authoritative over the card) and **56/59 real theme titles** ("Dead Camel
  Rage") — kept verbatim. Verify weekday + field-shape across the archive, not one row.
- 🔴 **Forward/past split uses the kennel's LOCAL date, not UTC.** Compute "today" via `Intl.DateTimeFormat
  ('en-CA', {timeZone: '<kennel zone>'})` (a shared `riyadhToday()` here), shared by the adapter (`date=gte`)
  and the backfill (`date=lt`) — `toISOString()` (UTC) misfiles rows around local midnight (≤3h for Riyadh).
- 🔴 **Per-event coords now participate in the RawEvent fingerprint (shared-infra, #2387).** Adapters that emit
  `latitude`/`longitude` from a mutable source column (Riyadh's `location_gps`, HC's `syncLat/syncLong`) get a
  gated coord token in `generateFingerprint`, so a corrected pin re-merges instead of being dropped at dedup.
  No per-adapter action needed.
- 🟡 **`tsx -e` DB probes need `import "dotenv/config"`** or `@/lib/db` connects to a phantom local DB
  ("database <user> does not exist"); backfill *scripts* already import it. Prefer `psql "$DATABASE_URL"` for
  quick prod reads. The kennel page URL uses the **slug** (`r3h4`, from shortName), not the kennelCode.

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

---

## Grav CMS — flat-file PHP CMS, markdown tables → SSR `<table>` + shallow `/news` collection (researched from Phnom Penh H3, 2026-06-19)

Grav (`getgrav.org`) is a flat-file PHP CMS some old-school clubs use (Phnom Penh H3 / `p2h3.com`).
Confirmed via real `web_fetch` of every page (the site is **fully server-rendered** — no JS, no
browserRender; a plain fetch returns complete content):

- **Detection:** theme/asset paths under `/user/themes/<theme>/…` and content under `/user/pages/…`;
  pages authored in Markdown render **pipe tables into real `<table>` HTML** and a blog collection at
  `/news` with Atom/RSS at `/news.atom` + `/news.rss`.
- **Run data lives in markdown tables on the home page.** P2H3's home renders two tables — "This week's
  Hash" (1 row, richest: `A-Site`/`B-Site` Maps links + a `Remarks` cell carrying the meeting/departure
  time) and "Upcoming Hashes" (≤5 rows, sparse — venues/hares often `TBC`). Columns:
  `Number | Date | By | Hares | A-Site | B-Site | Remarks`. Iterate `$("table tr")`, require a numeric
  first cell **and** `cells.length >= 4` to drop header/decorative rows. The `Number` cell is an
  `<a href="/news/<runNumber>">` → use it to follow the detail page.
- **🔴 The `/news` collection is the rich per-run surface, but SHALLOW.** Each `/news/<runNumber>` page
  (and the `/news` index, which SSRs the latest ~3 in full) carries a labeled block:
  `Run No. NNNN` / `Date/Time:- Sunday 21st June 2026` / `Meeting Point: <venue> (Maps), meeting at
  HH.MM for HH.MM departure` / `Location: <venue> (Maps)` / `Walking : Nkm` / `Running : Nkm` /
  `On On: <venue> (Maps)` / `Hares: …`. **But the archive is shallow** — only the most recent ~13 runs
  are published; **an out-of-range `/news/<n>` (e.g. `/news/1000`) 302-redirects to the home page**, so
  a high run number (#1841) ≠ archive depth. Probe an out-of-range number to size the real archive
  before assuming a deep backfill exists.
- **🔴 Multiple surfaces carry different date formats — all YEAR-BEARING (no inference):** home tables
  `DD.MM.YYYY` (dots); `/news` detail `Weekday Dth Month YYYY` (`Sunday 21st June 2026`); a separate
  `/hare_line` page `DD-MM-YYYY` (dashes). Parse each surface's own format.
- **🔴 `/hare_line` is stale + sparser than the home page — don't parse it.** P2H3's Hare Line showed a
  different (outdated) hare for the current run than both the home table and `/news` detail, and listed
  fewer rows. The home page (forward backbone) + `/news` (detail) are authoritative; cross-surface
  data can disagree (hares, departure time) — prefer the richest/most-current surface and don't hard-fail
  on a mismatch.
- **Venues are `maps.app.goo.gl` shortlinks → `locationUrl` only** (no extractable decimal coords; no
  default-pin corruption trap). Leave lat/lng undefined → merge geocodes the venue text / metro centroid.
- **Placeholders:** `TBC` / `TBA` / `Hares Needed!` / `N/A` / `/N/A` → undefined/null. A `By` column
  value like `Bus` is a logistics note, not a hare.
- **Logo:** Grav theme logos sit at a **stable** `/user/themes/<theme>/images/logo/…png` path (NOT a
  tokenized CDN URL) — durable, but self-host per convention and magic-byte the extension.
- **Effort:** small new static Cheerio scraper (~180–260 LoC + tests) — dual-surface merge by run number
  (home tables as backbone, `/news` detail as enrichment). Model on `dublin-hash.ts` + `bangkok-monday-hash.ts`.

---

## Bespoke SSR hash-club site — markdown tables + JS-rendered stats pages (researched from Saigon H3, 2026-06-20)

`saigonhashers.com` (Saigon H3 / Ho Chi Minh City, est. 1990) is a custom server-rendered hash-club site —
distinct from Grav (no `/user/themes` paths; assets live under `/assets/images/`, content under clean
nav paths `/home`, `/hareline`, `/runs`, `/reports`, `/hashers`, `/trails`). Confirmed via real `web_fetch`
of every page:

- **Detection:** clean single-segment nav routes (`/hareline`, `/runs`, `/reports`); a hash-specific nav
  ("Receding Hairline", "Run Stats", "Hasher Records", "Run Reports", "Map of Previous Trails") that
  signals a hash-management backend; logo at a **stable** `/assets/images/<name>.png` path.
- **🔴 SSR is per-page — confirm each surface, don't assume.** The **home page AND `/hareline`** SSR their
  run tables fully (a plain fetch returns complete `<table>` markup — markdown pipe tables rendered to
  real `<table>`). But the **`/runs` (stats) and `/reports` (recaps) pages do NOT SSR their content** —
  `/runs` timed out and `/reports` returned **nav + logo only** (JS-rendered DataTables, almost certainly
  an AJAX/JSON endpoint behind them). So the **forward feed is sandbox-reachable but the archive is not.**
- **`/hareline` ("Receding Hairline") is the deep forward backbone** — one SSR `<table>`, columns
  `numbers | Date | Name/Occasion | Hares | A-Site | On-On`, ~24 forward runs (the home page repeats a
  ~6-row subset). Parse `/hareline` alone; the home page adds nothing the hareline lacks.
- **🔴 Dates are ISO `YYYY-MM-DD` (year-bearing) → NO inference** — straight to UTC noon. Much simpler
  than the `DD MMM` / `Weekday Dth Month` SE-Asia variants (Bangkok Monday, Phnom Penh, Kaohsiung).
- **`Name/Occasion` is usually a run-TYPE, not a theme.** Most rows are `"Bus Trip/City Run"` (logistics)
  → leave `title` undefined (merge synthesizes `"<Kennel> Trail #N"`); keep it only for real occasions
  (`"William of Orange Run"`, `"<Kennel> 36th Birthday Run"`). `Hares` placeholder = `"Hares Needed!"` →
  undefined; real hares carry a trailing `"& Co"` — keep verbatim.
- **A-Site / On-On columns hold `maps.app.goo.gl` links when populated** (→ `locationUrl`), but were
  **empty on every current row** — the trail venue isn't published in the table; the only Maps links are
  prose-level (the weekly bus-departure point). No decimal coords, no default-pin trap → lat/lng undefined.
- **`upcomingOnly: true` + per-run fail-loud zero guard** (receding hareline ages out; single surface).
- **Founded-year corroboration via a milestone run row:** the hareline carried a `"… 36th Birthday Run"`
  whose date (2026) confirmed the history page's 1990 founding — the milestone-row trick works in a
  forward hareline, not just an archive.
- **Effort:** small new static Cheerio scraper (~120–180 LoC + tests) — single-surface table parse, ISO
  dates, run-type-vs-theme title discrimination, placeholder strip. Model on `dublin-hash.ts` +
  `phnom-penh-h3.ts`. Archive backfill (if `/runs`/`/reports` expose a clean JSON endpoint) = a separate
  low-priority follow-up.

## Custom Next.js single-current-run site + PLACEHOLDER state (researched Colombo Harriettes, 2026-06-22)

`hashcolombo.com` (Colombo Hash House Harriettes, Sri Lanka — est. 1984) is a bespoke **Next.js** site
(`/_next/image` asset URLs, custom build by a local agency — NOT Wix/Squarespace/WordPress) that
renders a **single "Next run" block on the home page, fully SSR'd**. Confirmed by a plain `web_fetch`
returning the block in the server HTML → **static Cheerio, no browserRender** (despite the modern SPA
look — verify per site, the JS-heavy frame doesn't mean the content is client-rendered). No JSON
API/feed; the filled block embeds a Google Map. Same shape as Manila/Warsaw single-current-run sites,
plus one new gotcha:

- **🔴 The "Next run" block has a between-postings PLACEHOLDER state.** When no run is posted, the block
  reads literally **"Next run / We will announce soon"** (no run number, no date) and reverts to it after
  each Saturday run. The adapter MUST treat this as a **legitimate 0-event state** (`events:[]`,
  `errors:[]`) — NOT a parse failure. Only push to `errors[]` when a run block IS present (a `#NNNN` or a
  date-like line) but fails to fully parse, OR when neither the placeholder phrase nor a parseable block
  is found (the committee reworded the placeholder / markup drifted). This three-way discriminator is the
  difference between a clean between-postings scrape and a silent zero on real drift. Detect the
  placeholder on a whitespace-collapsed, lowercased copy (`includes("wewillannouncesoon")`), not a strict
  selector.
- **Research consequence:** such a site is often in the placeholder state at research time (caught Colombo
  4 days after its last run), so you can't capture the FILLED-state wrapper DOM — flag for Claude Code to
  capture it at build when a run is posted, and onboard on **recently-active** evidence (last posted run +
  weekly cadence) per the daily prompt's Step 3, not as `blocked`.
- **Coords:** filled state embeds a Google **Map** → almost certainly a `maps/embed?pb=…!2d<lng>!3d<lat>`
  iframe → in-adapter parse (`!2d`=lng, `!3d`=lat; `extractCoordsFromMapsUrl` does NOT match embeds —
  Asunción lesson). Single venue per run → no default-pin trap, but verify the embed isn't a fixed office
  pin across runs.
- **No archive.** Single-block sites have no on-site history; a legacy marketing domain (here
  `colomboharriettes.com`) is usually a brochure page, not a per-run list (its `wp-json` was empty) → no
  backfill collection. `config.upcomingOnly: true` + a 1-row optional seed of the last known run.
- **Logo:** stable `/_next/image?url=%2Flogomain.png` / `/logomain.png` path (og:image type PNG) — still
  self-host + magic-byte the ext (Next.js `/_next/image` is a resizer proxy, not the raw asset).
- **Effort:** small new static Cheerio scraper (~120–170 LoC + tests). Model on `warsaw-h3.ts` /
  `manila-h3.ts`.

#### Colombo Harriettes addenda (build-time, SHIPPED 2026-06-22, [PR #2278](https://github.com/johnrclem/hashtracks-web/pull/2278))

The site stayed in its **placeholder state from research through merge** — so the FILLED-state DOM was never
observable and the run-detail parser + test fixtures are **constructed** from the documented #2223 sample.
Two consequences worth pre-empting next time:

- **🔴 Build the run-detail parse for BOTH render shapes, not just the one you sampled.** When you can't see
  the filled block, you don't know if the committee renders fields as separate `<p>`s or as a single
  dash-joined line (`Run #2223 — 2026-06-20 — KK's Crib — 17:00 — No.5, …`). The review bots caught the
  single-line case dropping venue/street (the whole line became the date line). Robust pattern: read the
  heading's parent block, then split each line into per-field **segments** on em/en-dash, pipe, bullet,
  middot **and a space-padded hyphen** — but **exclude a bare hyphen** so ISO dates (`2026-06-20`) survive.
  Do it with **two linear string passes** (`split(" - ")` then a char-class split), NOT a
  `/\s*[…]\s*|\s+-\s+/` alternation regex — that one backtracks and SonarCloud fails it (S8786 ReDoS).
- **🔴 Exclude street lines from date detection.** A worded address can carry a month token (`12 May Road`,
  `June Street`) and be mis-read as the run date — short-circuit `isDateLine` to return `false` on any
  street-hint line *before* the ISO / month-token checks.
- **🔴 Scope the Google-Maps-embed lookup to the run block's `<section>`, not the whole document** — an
  unrelated map iframe elsewhere on the page would otherwise mis-populate the event's coords (a wrong pin is
  worse than no pin; missing coords fall back to the kennel centroid).
- **🟡 Constrain time regexes** — a 12-hour `(\d{1,2}):(\d{2})\s*(am|pm)` accepts `5:99 PM` → `17:99`; bound
  hours `1–12` and minutes `00–59` so a malformed token is rejected, not emitted.
- **🟢 Geocode the street, not the venue name.** The #2223 backfill's `location: "KK's Crib"` geocoded
  **4543 km off** → the merge distance-sanity gate skipped it (centroid fallback). `locationStreet` is the
  safer geocode input.
- The placeholder three-way guard **held live**: build live-verify and the post-merge prod scrape both
  returned `events: 0, errors: []` (and `cancelled: 0`, so `upcomingOnly` kept the backfilled past #2223).

---

## WordPress + Modern Events Calendar (MEC) + Elementor — SSR calendar/Hare-Line (researched from Desert H3 / Dubai, 2026-06-23)

`deserthash.org` (Desert H3, Dubai's oldest hash, est. 1979) runs WordPress with **Elementor**
(`meta-generator: Elementor …`) and **Modern Events Calendar (MEC)**, NOT "The Events Calendar"
(Tribe). All pages are **fully server-rendered** → static Cheerio, no browserRender. Two surfaces:

- **Detection:** `meta-generator: Elementor`; event permalinks are `?mec-events=<slug>` (MEC's CPT)
  and the home calendar grid carries `id="mec-calendar-…"` / `mec1-…` anchors. (The Tribe equivalent
  would be `/event/<slug>` + a `tribe_events` REST API — different plugin.)
- **🔴 No REST feed — verify, don't assume config-only.** `wp-json/wp/v2/posts`, `wp-json/wp/v2/types`,
  AND `wp-json/tribe/events/v1/events` ALL returned **empty bodies** on this LiteSpeed/HostGator host
  (whole WP REST disabled). MEC has no public collection `.ics`/JSON either. So an MEC/Elementor kennel
  is **NOT config-only** — it needs a Cheerio scraper of the SSR HTML. (The queue had guessed "The
  Events Calendar → probe `/wp-json/tribe/events/v1/events`"; the probe returned empty. Always HEAD/GET
  the actual REST path before claiming a WordPress kennel is config-only.)
- **Upcoming surface = the home page** — MEC SSRs the next run(s) as a calendar grid + an "Events" card
  block: a date (`DD/MM/YYYY`), a time range (`HH:MM - HH:MM`), and a heading `<Kennel> – Run NNNN`
  linking `?mec-events=…`. The per-event **detail page is sparse** for future runs ("Details TBC" —
  no venue/hares/map; details go out via WhatsApp/email). 🔴 **Parse the rendered DOM
  first** — select `.mec-event-time` / `.mec-start-time` from the Cheerio-loaded HTML for
  dates and times. MEC does emit a JSON-LD `<script type="application/ld+json">` `@type:Event`
  block, but its `startDate` encodes **local time as if it were UTC** (e.g. `19:00+00:00`
  instead of `19:00+04:00`) — confirmed broken on Desert H3. Treat JSON-LD as **optional
  metadata only** (title, run number); never use `startDate` for time. `web_fetch` also
  strips `<script>` tags, so JSON-LD isn't accessible without `fetchHTMLPage` / curl anyway.
- **Recent-past surface = a "Hare Line" content page** (here `?page_id=5152`, "the last 50 runs"): month
  `##### Month YYYY` headings, then rows of `Weekday Month D` + `HH:MM - HH:MM` + `[<Kennel> – Run NNNN](…)`.
  **Year comes from the month heading → dates are year-bearing, no inference.** A "Load More" button
  pages older via admin-ajax. NOTE: current-era rows carry **date/time/run# only — no venue/hares**.
- **🔴 Deeper history lives in pre-migration WP posts** (`?cat=<DH3-Runs-id>`, `?m=YYYYMM`) with venues
  in the post titles (`Run 2202 – 8 Aug 2021 – Trade Centre Apartments`) — but the WP-post era often
  **stopped when the kennel switched to MEC** (~2021 here). So recent runs = sparse (date/time/run#);
  only old runs carry venues. Backfill value is therefore low for the MEC era.
- **🔴 The MEC calendar mixes kennels/series — TITLE-FILTER on `<Kennel> – Run NNNN`.** Desert H3's
  calendar also carries **Moonshine** (a separate kennel/series), **Virtual/online** runs, and one-off
  non-runs (`Interhash 2026 – Indonesia`, All Day). Filter to `/^<KennelShort>\s*[–-]\s*Run\s+\d+/i`
  so siblings don't ingest under the wrong kennelCode. Keep a trailing theme as `title` only when one
  follows the run number (`Run 2440 – The War Edition – ONLINE`); else leave `title` undefined.
- **No per-event coords** (venues distributed off-site) → lat/lng undefined, merge geocodes the metro
  centroid; no default-pin trap. **`config.upcomingOnly: true`** (rolling last-50 + calendar window age
  out → reconcile would false-cancel). **Zero-row fail-loud guard** (brand-new single source, baseline 0).
- **Logo:** `wp-content/uploads/.../<name>.jpg` (stable, non-tokenized) → still self-host + magic-byte
  the extension (WordPress/Elementor can mislabel; the camel-roundel og:image here is served `.jpg`).
- **Effort:** new ~150–250 LoC Cheerio adapter (two SSR surfaces, year-bearing dates, title filter,
  per-event time parse). Handoff: `handoffs/2026-06-23-dh3-ae.md`. 🟡 UNVERIFIED until built: the exact
  MEC home-calendar DOM (JSON-LD vs event-card markup) — `web_fetch` confirmed the SSR *text* (date,
  time, run#, detail link all present) but strips `<script>`; capture the real markup for the fixture.

---

## Self-hosted WordPress — runs live in ONE PAGE's content blocks, not posts (learned from Bombay H3, 2026-06-26)

`bombayhash.org` (Bombay H3 / Mumbai, est. 1983) is a **self-hosted WordPress 6.9.4** (Astra theme)
site where the committee hand-maintains every run as a **content block on the home page** (a single WP
`page`, id 930) — there is **no event post type and no per-run posts**. The `wp/v2/posts` collection
holds **only the WordPress default "Hello world!" post**. This is distinct from the WordPress.com
REST-blog pattern (ONH3/ASU = one post per run) and from the single-current-run PAGE pattern
(Hanoi/Manila = one run on the page) — here the page carries **several** runs (the last ~5: #627–#631)
as stacked blocks.

- **Two equivalent targets, both fetchable from the sandbox via plain `web_fetch`:**
  - **Home page SSR** (`https://bombayhash.org/`) — the run blocks render as headings + `<p>` text.
    **Recommended primary** (no hardcoded page-id dependency).
  - **WP REST page** (`/wp-json/wp/v2/pages/930?_fields=content,modified`) — returns the **same**
    blocks as `content.rendered` JSON, plus a `modified` timestamp. Useful as a cross-check, but the
    numeric page id can change; prefer the home page. (The whole REST response is ~55 KB — fetch with
    `_fields` to trim, and it'll save to a file you can `grep`.)
- **🔴 Run heading text is INCONSISTENT and the tag level varies** — `RUN #631` (h3), `BH3 RUN #629`,
  `BOMBAY HASH RUN #628` (h2), `Run 627 yeoor hill thane`. **Key on heading TEXT
  (`/\bRUN\s*(?:#\s*)?(\d{3,4})\b/i`), never the tag level.**
- **✅ AS-BUILT CORRECTION — the heading body is NOT a sibling; do NOT `nextUntil`.** In the Astra/Spectra
  markup the heading sits in its own nested container and the body `<p>`s are in a *different* container —
  `heading.nextUntil(...)` returns an empty set. The working mechanism: **climb from the heading to the
  nearest ancestor whose text already contains the run's year-bearing date** (that ancestor is the per-run
  block), capped at ~6 levels. 🔴 **Stop the climb *before* `.entry-content`** (the page-content wrapper
  holds *every* run's text) — else a dateless drift block (a `RUN #N` heading whose date won't parse)
  matches a *sibling*'s date there and silently mis-dates itself. The stop check must run *before* the
  date check.
- **Dates are year-bearing + ordinal** (`Sunday, 28th June 2026`, `Sunday, 29 March 2026`,
  `Sunday, 22nd Feb 2026` — note the abbreviated month variant). **✅ AS-BUILT: `chronoParseDate` parses
  the ordinal natively** (no manual `28th→28` strip needed); isolate the date by **requiring a 4-digit
  year** (`/\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\.?\s+20\d{2}\b/`) — that cleanly excludes the rego
  deadlines ("till Friday, 26th June") and "since Jan" noise. **NO year inference** (year is present). UTC noon.
- **🔴 AS-BUILT CORRECTION — the labeled fields are NOT on separate lines; line-scan FAILS.** The emoji
  labels (`📅 Date:`, `🕘 Time:`/`⏰ Assembly:`, `📍 Venue:`, `💰 REGO:`) are **jammed into one
  run-together `<p>` with no whitespace between fields** (`…the Hare!" 😂🐇📅 Date: Sunday, 28th June
  2026🕘 Time: 9:30 AM…📍 Venue: Shivaji Park Gymkhana`). `web_fetch`'d SSR *text* collapses whitespace and
  hides this. **Parse by splitting on the marker emoji** — find `📅`, capture until the next field-marker
  emoji; markers vary per run (`🕘`/`⏰`/bare `TIME:`; `📍 Venue:`/`📍 VENUE:`/bare `📍`). One run (#630)
  prefixes its venue with `🍻` that must be stripped AND excluded from the field-terminator set, or the
  venue comes back empty. `title` stays **undefined** (themes are unreliable in the emoji soup) → merge
  synthesizes `"<Kennel> Trail #N"`. Hares are tri-state: a present-but-`???` label → **`null`** (clear),
  label absent → `undefined` (preserve).
- **🔴 PII + a live waiver `<form>` on the same page.** Rego lines carry **phone numbers + payee names**
  (`+91 …`, "GPay/Paytm: <number> (<name>)"); the page embeds a join/waiver form (Name/Mobile/DOB/Email/
  SUBMIT); and the **WP author meta in `wp/v2/posts` leaks the developer's email**. The adapter must read
  run blocks only — strip phone/payee from stored fields, never submit the form.
- **No per-event coords / no Maps embed** (venue free-text + occasional written directions) → lat/lng
  undefined, merge geocodes the venue / metro centroid. **No default-pin trap.**
- **No archive** when the site is freshly built (Bombay's WP install is Feb 2026; run #631 implies ~630
  historical runs since 1983, but the source publishes none). **`config.upcomingOnly: true`** (rolling
  current-runs page — past blocks age off → reconcile would false-cancel) + **per-run AND zero-row
  fail-loud guards**. No backfill.
- **Effort:** ~270 LoC Cheerio adapter as-built (climb-to-dated-ancestor block parse, emoji-marker field
  split, year-bearing dates, PII strip, per-run + zero-row fail-loud). Reference: `kaohsiung-hash.ts`
  (multi-run heading blocks) + `himalayan-h3.ts` (single-page WordPress shape). **✅ SHIPPED**
  [PR #2406](https://github.com/johnrclem/hashtracks-web/pull/2406) · handoff
  `handoffs/2026-06-26-bombay-h3.md` · retro `handoffs/retros/2026-06-26-bombay-h3-retro.md` (the two
  structural gaps above + the `scrapeDays`-vs-run-span clip were all caught at live-verify; see retro).
- **`scrapeDays` must exceed the run span.** The 5 posted runs span ~126 days and `filterEventsByWindow`
  is **symmetric (±days)**, so a too-tight window clips the oldest run (120 dropped #627). For a small
  archive-less rolling page, default to **365** — `upcomingOnly` still protects reconcile.

---

## Self-hosted WordPress club site — "This Week's Meet Point" current-run block + `?cat=N` post archive (researched 2026-06-27, Creek H3 Dubai)

Old-school expat hash club sites on **self-hosted WordPress** (Creek H3 / `creekhash.org`, men-only Dubai,
est. 1983 — `meta-generator: WooCommerce`, Azure-hosted) follow a clean two-surface shape. **Fully SSR'd**
(plain `web_fetch`/`fetchHTMLPage` returns the run text) → static Cheerio, no browserRender. Confirmed by
real fetches of home + detail + category pages:

- **Forward/current surface = the home page's "This Week's Meet Point" block** — a single `<a href="?p=NNNNN">`
  whose text is the post title `<ordinal> <Month> <YYYY> – Run <N> – <venue>` (en-dash `–` separated). It
  carries only the **current/most-recent run** (rolls weekly) → `config.upcomingOnly: true` + a fail-loud
  zero-row guard. Follow the link to the **detail post** for the labeled fields: `Date:` / `Time:` (→ `HH:MM`
  startTime) / `Run No:` / `Location:` (venue + street) / `Hares:` / a "Google Maps Link" `<a>` (→ `locationUrl`;
  a `goo.gl/maps/…` shortlink → no extractable coords) / `Directions:` (prose).
- **🔴 Date: trust the post TITLE, not the body `Date:` field.** Creek's #2307 detail page titled "25th June
  2026" (a Thursday, matches the weekly cadence) carried a body `Date: Thursday 26th June 2026` (26 Jun = a
  Friday — internal weekday/day-number typo). The title's `<ordinal> Month YYYY` is year-bearing, identical
  across the listing pages, and cadence-consistent → parse the date from the **title**; treat the body `Date:`
  as enrichment/cross-check only.
- **🔴 PII in the body.** A `Contact if lost: <hash-name> – <phone>` line carries a real phone number → strip
  it in-adapter; never store it. Add a regression test asserting no digits leak into any field.
- **Deep archive = a WordPress category page** (`/?cat=N` — Creek's "Creek Runs" = `?cat=4`, **601 posts back
  to 2001**), clean `?cat=N&paged=1..M` pagination ("Next »" + numbered, ~16 posts/page). **Each listing entry
  is just a heading `### [<ordinal> <Month> <YYYY> – Run <N> – <venue>](?p=NNNNN)`** → date + run# + venue are
  available **from the listing titles alone** (no need to fetch every detail page for a lean backfill). Drive a
  one-shot `scripts/backfill-<code>-history.ts` (freeze + dumb loader per H7); set the source `upcomingOnly`.
- **🔴 Title middle-segment is NOT always `Run <N>`** — special runs use a different label in the number slot
  (`Spit Roast 3`, `Spit Roast 1`, …) and appear in the runs category alongside the weekly runs. Extract a
  numeric runNumber **only** when the segment matches `Run <N>`; skip the rest. Older eras can be **sparse
  milestone-only** (Creek pre-2015 = round-number Run 1000/1050/…/1389 + Spit Roasts; the dense weekly archive
  starts ~Jun 2015). Profanity appears in real venue names (`F*cking Dipstick's Scrapyard`) → keep verbatim.
- **Title 3rd segment = the venue**, not a theme → leave `title` undefined (merge synthesizes
  `"<Kennel> Trail #N"`); put the venue in `location`.
- **WP REST may be disabled.** `/wp-json/wp/v2/posts` returned **empty** to the research sandbox (machine JSON
  not rendered, or REST off — same as Desert H3's LiteSpeed host). Don't assume a clean REST path; the static
  Cheerio scrape of the SSR pages is the reliable surface. Confirm REST at build only as an optional upgrade.
- **Logos** are stable `wp-content/uploads/.../<name>.<ext>` URLs (not tokenized) but still self-host per
  convention; confirm the extension by **magic bytes**, not the URL.

### Harrier Central — "single logged run ≠ recently-active cadence" (learned from Rio Full Moon H3 hold, 2026-07-12)

A newly-HC-joined kennel can have exactly **one** run on the `global-runs` feed. One data point is NOT a
cadence — it cannot satisfy the Step 3 recently-active bar ("ran in ≥3 of the last 4 months"). Before
onboarding such a kennel, **check whether the kennel's own expected next slot was ALSO logged.** For a
**full-moon** hash this is decisive: full moons are ~29.5 days apart and well-run full-moon kennels
(Berlin FM, Frankfurt FM, Hua Hin FM) post their next runs to HC **months ahead**. If the target's single
run is 2026-05-30 (the May full moon) and the **June 29 full moon is absent** from HC with nothing
upcoming, that's concrete evidence the HC feed is not (yet) a reliable ongoing source for it — hold as
`verify-live-first`, re-check when a `#N+1` or an upcoming run appears. Contrast **Divahhh** (same day's
run): 9 logged runs across every month Jan→Jul 2026 with the latest 3 days old = a real cadence → onboard.
Rule: for a thin HC kennel, verify the *next expected occurrence* was logged, not just that the *last* one
was within 2× interval.

### Harrier Central — deep run # + ZERO `global-runs` archive = live-only, no backfill (learned from Steel City H3, 2026-07-13)

A brand-new-to-HC kennel can show a **non-trivial run number** (Steel City H3 = **#22**) yet return
**0 rows from `global-runs?isFuture=0`** across every past window, because it only just adopted HC — its
runs #1…#(N−1) predate the HC join and are on **no** clean machine-readable feed. Two consequences:
- **This is the "Run-number ≠ archive depth" case for HC** — the deep run # implies deep history, but the
  *source* exposes none. Don't promise a backfill you can't extract; confirm the `isFuture=0` past sweep
  actually returns rows for the `PublicKennelId` (filter client-side) before asserting "N-run backfill".
- **Live-only ⇒ OMIT `upcomingOnly`** (Lisbon/Taiwan contract): with no backfill there are no aged past
  rows for `reconcile.ts` to false-cancel. `upcomingOnly:true` is ONLY for HC sources that ALSO ship a
  one-shot backfill (Bandung/KRASH/Divahhh). One genuine upcoming event (Steel City's #22) is enough to
  onboard directly — this is NOT the "0-upcoming recently-active" path.

🔴 **Don't trust the queue's "founded/hashCash/website/socials unverifiable (HC-only)" pre-mark — a web
search often recovers them from the kennel's OWN site.** Steel City's queue row said all four were HC-only
blanks; a single `WebSearch` surfaced the kennel's **Google Sites** (`sites.google.com/view/steelcityh3/home`)
carrying an explicit founding weekend (11–13 Apr 2025 → `foundedYear 2025`, high confidence), the hash-cash
sub ("£3 per run"), and the schedule — plus a **stale Meetup** (`steel-city-hash-house-harriers`, last event
Aug 2025) that confirmed the observed 4th-Saturday cadence and held a thin early archive (#4–#7). HC gives you
the live feed; the kennel's site/Meetup/press give you the metadata HC omits. Always do the web-search pass
before writing "unverifiable" into a handoff. (A Meetup that a kennel has *abandoned* for HC is a metadata
corroborator + marginal backfill candidate, not a live source — its Apollo `Event` collection will be past-only.)

### Webnode-hosted kennel sites (`*.webnode.page`) — SSR HTML, fetch-friendly (Divahhh, 2026-07-12)

`divahhh.webnode.page` returned full server-rendered HTML to a plain fetch (meta description, nav, events
archive all present) — no browserRender needed. Useful metadata surfaces: `meta og:article:published_time`
(page-publish date, NOT founding), an `/events/` archive (earliest listed weekend ≈ founding-year signal —
flag as "earliest documented", may predate), `/contact/` + `/our-people/` sub-pages for socials/committee.
Logos/images are on `*.cbaul-cdnwnd.com` (Webnode CDN). Treat like any static SSR site; confirm founding
from the events archive rather than asserting.

### Refill discovery sources beyond the HC upcoming feed (2026-07-15, Douliu H3 run)

The HC config-only well is *upcoming-feed* exhausted (6+ consecutive runs found 0 genuinely-new in
`global-runs?isFuture=1`). Two productive additions for the dedicated non-HC / deeper-HC pass:

- **🔑 HC recent-past sweep (`global-runs?isFuture=0&minEventDate=…&maxEventDate=…`) finds the
  0-upcoming-but-recently-active kennels the upcoming feed misses.** Pull a ~10-week window (covers monthly
  kennels between postings), aggregate distinct `PublicKennelId`, diff vs the sitemap by **city-name
  fragment** (NOT the HC slug — HC slugs like `BH3-DE`/`AMSH3` don't match hashtracks slugs, so a naive
  slug-equality diff flags everything as "new"). This is how **Douliu H3** (Taiwan, 0 upcoming, last run
  46d ago) surfaced on 2026-07-15. Most hits are tokenizer false-positives (already-live: Amsterdam=`ah3-nl`,
  Frankfurt=`fh3`, Munich=`mh3-de`, etc.) or annual gatherings (Interscandi, Simmer Dim) / HC test kennels
  (`A Harrier Central Testx`); the genuinely-new ones are usually thin/gappy → verify-first. **Per-kennel
  history:** the global-runs response caps ~200 rows total, so pull several 6-month windows and filter by
  `PublicKennelId` to reconstruct one kennel's full HC archive + judge cadence.
- **🔴 HashRego (`hashrego.com/events`) is a POOR discovery source for NEW regular-trail kennels.** Its
  public events browse (~74–86 kennels) is **overwhelmingly campouts / hash weekends / red-dress runs /
  cruises / annual specials**, not regular weekly trails. A kennel appearing here for one campout does NOT
  establish a live recurring dynamic source (fails the dynamic-source rule) — the kennels that DO post their
  regular trails to HashRego (BFM, EWH3, O2H3…) are already seeded via the existing HASHREGO source. So
  HashRego is useful for *enriching* already-known kennels' special events, not for finding new queueable
  ones. Don't spend a refill budget enumerating it expecting regular-trail kennels.
- **Session note:** this scheduled run's Chrome MCP **could navigate to brand-new domains** (hashrego.com,
  china.hash.cn) without the auto-deny the queue header warns about — so non-HC website/directory
  verification IS sometimes possible from a scheduled run. Still, machine-readable feeds on non-allowlisted
  hosts and Meetup-Apollo extraction remain unreliable; treat per-session.
- **`china.hash.cn/taiwan/` (All China H3 directory) is a fetch-friendly metadata source for Taiwan/China
  kennels** — SSR HTML with per-kennel founding date, schedule (day/time/venue), and an "On On" link to the
  kennel's FB group. Confirmed Douliu H3's "last Saturday monthly, 13:00 Douliu Baseball Stadium, founded
  27 Jun 2009" verbatim. Good for HC-only kennels whose own site is FB-group-only.

### Harrier Central — `EventNumber` itself can be corrupted, not just `EventName` (learned from Prague H3, HC batch-11, 2026-08-12)

Every prior note here says "trust `EventNumber` over `EventName` for the run number" — `EventName` is a
known mix of real themes and placeholders. Prague H3's fuller archive (re-pulled fresh 3 weeks after the
onboarding handoff, recovering 15 more rows than the handoff's narrower sample) surfaces a sharper
problem: **`EventNumber` itself can carry a data-entry typo.** Four consecutive Nov–Dec 2023 rows read
`EventNumber: 1943, 1944, 1944, 1945, 1945` where chronological context makes the intended sequence
unambiguous — `1493, 1494, 1494, 1495, 1495` — a transposed middle digit (9↔4) in HC's own data entry,
not an adapter bug.

**Don't hand-correct it.** Follow the same faithful-data policy the Douliu backfill established (#165
named "#166", #201 named "200", never renumbered): ship `EventNumber` verbatim even when it's locally
non-monotonic or visibly wrong. Inventing a "fix" with no independent verification is worse than a
faithful anomaly. The corrected rule: **prefer `EventNumber` over `EventName`, but don't assume
`EventNumber` is error-free either — when in doubt, ship it as-is.**

---

## Embedded Google Calendar (small club sites) — config-only GOOGLE_CALENDAR (2026-07-21, Devon Lunatics H3)
- **Many small UK/club kennel sites are just a public Google Calendar embed.** `dlh3.org.uk` (Devon
  Lunatics H3) is a static CloudFront page whose only dynamic content is a single
  `<iframe src="https://calendar.google.com/calendar/embed?src=<BASE64_ID>&ctz=…">`.
- **The calendar id is the base64-decoded `src` query param of the iframe** (not the visible page). In-page:
  `const u=new URL(document.querySelector('iframe[src*="calendar.google.com"]').src); atob(u.searchParams.get('src'))`
  → e.g. `devonlunaticshashhouseharriers@gmail.com`. That address is the `Source.url` for a config-only
  `GOOGLE_CALENDAR` row (adapter already exists — **no new code**).
- **Verify live via the Calendar API v3** (the same endpoint/key the adapter uses), NOT the ICS
  (navigating the `.../ical/<id>/public/basic.ics` URL in Chrome bounced back to the referrer here):
  `GET https://www.googleapis.com/calendar/v3/calendars/<url-encoded id>/events?key=$GOOGLE_CALENDAR_API_KEY&singleEvents=true&orderBy=startTime&timeMin=<ISO>`
  — supports CORS from any origin, returns upcoming (timeMin=now) and the full past archive (timeMin far back).
- **Archive depth is often deep and free.** Devon Lunatics' calendar held **107 past events back to
  2018-01** in one query. Because a Google Calendar **retains every event**, set the source's `scrapeDays`
  wide (e.g. 3300 ≈ 9y) and the adapter pulls the whole archive idempotently every scrape → **no
  `upcomingOnly`, no separate backfill script** (full-archive case, unlike the ONH3 GCal which only ran
  ~4 weeks ahead).
- **Watch:** club calendars jam venue + hare into the event *summary*
  (`"<Kennel> - <venue> - <hare>"` / `"… Hare: <name>"`) with placeholder titles like `"…- vytbc"`
  (venue+hare TBC) or `"…- Cancelled"`. Use `defaultTitle` + `staleTitleAliases` for the placeholders and
  a tuned `titleHarePattern` for the trailing hare; take venue/coords from the `location` field (full
  postal addresses), not the title.
- **DNS-check the wrapper domain** (`dlh3.org.uk` → Status 0, CloudFront) even though the feed itself is on
  the known `calendar.google.com` platform.
- **Addendum (2026-08-05, Isca H3 — the embed can hide inside a `<frameset>`, and the ICS IS fetchable):**
  - `iscah3.uk` is a **classic HTML `<frameset>`** — the top page (`document.body.innerText.length === 0`,
    `bodyLen 0` even after a wait) looks JS-rendered/empty but is actually three plain SSR sub-pages
    (`document.querySelectorAll('frame')` → `header.html` / `linksbar.html` / `mainbody.html`). **The
    embed lives in a sub-page.** When a small-club home renders empty, check for `<frame>`/`<iframe>`
    src children and `web_fetch` those sub-pages directly (`text/html`, no JS) before concluding
    "browserRender needed." (The queue note had guessed Isca was Google-Sites-gated → browserRender;
    it wasn't.)
  - The base64 `src` can appear as a **plain link/URL in the sub-page text** (not always an `<iframe>`
    element) — `mainbody.html` carried the `calendar/embed?...&src=aXNjYWhhcmVyYWlzZXJAZ21haWwuY29t...`
    URL inline. `atob("aXNjYWhhcmVyYWlzZXJAZ21haWwuY29t")` → `iscahareraiser@gmail.com`.
  - **The public ICS DID fetch here (contra the DLH3 note):** navigate Chrome to the embed
    (`calendar.google.com/calendar/embed?...`) first, then a **same-origin** `fetch(
    'https://calendar.google.com/calendar/ical/<url-encoded-id>/public/basic.ics')` returns HTTP 200
    with the full archive — a clean way to gauge history depth + field-fill without the API key (the
    sandbox couldn't reach `www.googleapis.com` — HTTP 000 allowlist). Flag the API leg
    `⚠️ Claude Code must confirm at build`; the ICS 200 + rendered embed agenda already prove it's live.
  - Filter out spurious `DTSTART` artifacts (Isca's ICS carried two `1970xxxx` VTIMEZONE/recurrence
    anchors among 361 lines → 359 real events). Watch **multi-day all-day** events (Isca's annual
    "Roman Away Day": `DTSTART` date-only + multi-day `DTEND`, and **no kennel-name prefix** in the
    summary) → `includeAllDayEvents: true` to keep them.
  - **Unreliable hare delimiter:** Isca summaries are `"<Kennel> - <venue>. <hare>"` but the separator
    is inconsistent (`". Chardonnay."` vs `"Tally Ho! Bell Toll"` no-period vs `"TBC. Spocky Bitz"`).
    Prefer the structured `LOCATION` field for venue/geocode and **leave `hares` undefined** rather than
    mis-split (DLH3-gb silent-corruption precedent).

## Timely (events.timely.fun / "All-in-One Event Calendar" WP plugin) — config-only ICAL_FEED (2026-07-22, JaxH3)
- **Detection:** the WP site loads `events.timely.fun/embed.js` + `wp-content/plugins/all-in-one-event-calendar/apiki/…`
  and renders a `<iframe src="https://events.timely.fun/<shortcode>/…">` (JaxH3: `jaxh3.com`, shortcode `gg1wvzf4`).
  The visible calendar is a JS-rendered Angular SPA — do NOT try to scrape the iframe HTML.
- **Get the numeric calendar id (not the shortcode):** load the embed in Chrome and read a network XHR
  to `events.timely.fun/api/calendars/<NUMERIC_ID>/events` (JaxH3 shortcode `gg1wvzf4` → id `54747312`).
  Or click the SPA's **"Add to Calendar → Download ICS"** control — the anchor href is the export URL.
- **🟢 The public ICS export is a clean, AUTH-FREE iCal feed** → **config-only `ICAL_FEED`, no new adapter**:
  `https://events.timely.fun/api/calendars/<id>/export?format=ics`
  HEAD-verified for JaxH3: HTTP 200, `content-type: text/calendar`, valid `BEGIN:VCALENDAR`, one `VEVENT`
  per event, **no header required**. (The JSON `…/events` endpoint is different — it needs an
  `X-Api-Key` header the SPA injects — so point the source at the **ICS export**, never the JSON API.)
  Sandbox note: reading the ICS body cross-origin is CORS-blocked and it serves as a download; fetch it
  **same-origin** (from an `events.timely.fun` tab) to inspect, or just HEAD-check content-type + VEVENT count.
- **🔴 TZID mislabel trap:** the export's `VTIMEZONE`/`DTSTART` can carry a WRONG `TZID` (JaxH3 Eastern
  events were tagged `America/Vancouver`) while the **wall-clock digits are the true local time**. The
  `ICalAdapter`'s `formatDate`/`formatTime` round-trip through the event's own TZID, so the mislabel is
  **self-correcting** (startTime comes out as the authored wall-clock). Still assert `startTime` at
  live-verify — if node-ical ever stops preserving wall-clock, this is the canary.
- **Field reality:** `SUMMARY` = `"<Kennel> - #NNNN Theme"` (hyphen, not colon → `parseICalSummary` can't
  split it; use `titleStripPrefixAliases` to strip the kennel-label+run-marker off the title). `LOCATION`
  = real venue address (well populated). No `GEO`, no hares, `cost` display "0" (use kennel default).
  End dates are placeholder `T235959` (dropped by the adapter). Timed multi-day campouts ship single-day
  (adapter only sets `endDate` for all-day multi-day).
- **Archive = full but shallow:** the export returns the calendar's whole event set (JaxH3: 11, back ~9
  months) on every fetch → **full-archive feed → OMIT `upcomingOnly`, no backfill script**; set
  `scrapeDays` wide enough to reach the oldest event. (Confirm at live-verify the feed isn't aging out
  past rows; if it is, add `upcomingOnly`.)
- **Multi-kennel:** one Timely calendar can carry a sibling sub-brand's trails on a **shared run-number
  sequence** (JaxH3 + "Jax Urban H3") — fold into one kennel via `defaultKennelTag` unless the sequences
  diverge (then `kennelPatterns`).

---

## Legacy MS-Office static HTML (Word / FrontPage / Excel "Save as Web Page")

_First seen: Tamar Valley H3 (`tvh3.co.uk`, 2026-07-31). Old-school self-hosted club sites whose pages
were authored in Microsoft Word / FrontPage / Excel and "Saved as Web Page" — recognisable by
`meta-Generator: Microsoft Word 9` (or `Microsoft Excel 15`, `FrontPage`) in the head._

- **Platform detection:** `<meta name="Generator" content="Microsoft Word 9">` /
  `content="Microsoft Excel 15"`. Pages are plain **SSR `text/html`** (no JS render) → use
  `fetchHTMLPage` + Cheerio; **config-only `GenericHtmlAdapter` usually does NOT fit** because the
  "next run" is a **single label/value block**, not a repeating event list.
- **🟢 The homepage is the live surface** — these sites typically publish only the **single next run**
  on `index.html` as a labelled block (Tamar Valley: `Hash No:` / `Date:` / `Start:` / `On Down:` /
  `Hares:`, plus a "runs start at 7.00pm - The cost is £2.00" banner). Parse those labels;
  `config.upcomingOnly: true` is REQUIRED (the block rolls over weekly → reconcile would false-cancel).
- **🔴 STALE-SIBLING-PAGE TRAP — do NOT trust a `NextRun.htm` / `hareline.htm` sub-page.** Tamar
  Valley's `Pages/NextRun.htm` still served a **2020 snapshot** (Hash #2060, a Feb-2020 forward table)
  while the homepage showed the live #2367. These hand-maintained sites accumulate orphaned pages that
  were never deleted. **Confirm which page actually updated** (the homepage carried a visible
  "Website updated on <recent date>" banner; the sub-page did not) and scrape only the live one.
- **🔴 Field/format details also drift between pages.** The stale NextRun.htm said "7.30pm"; the live
  homepage said "7.00pm". Trust the page you confirmed is current; don't average across pages.
- **Dates carry the year** on the homepage block (`3rd August 2026`) → `chronoParseDate(text, "en-GB")`
  (ordinal-aware) → UTC noon. UK sites are day-first.
- **Coords:** these sites often give **what3words** (`///word.word.word`) instead of lat/lng — there are
  no coordinates to parse. Geocode the venue name or fall back to the kennel/metro centroid; never
  fabricate coords.
- **History:** an "Archive" nav link is often **weekly PDF hash-mags** (Tamar Valley: ~500 PDFs
  2012–2022, prose recaps) — high-effort, low-structured-value → usually **no backfill**. A "Hash
  Planner" page may hold a forward-year dates+hares table (Excel-exported, messy, no run#/venue) —
  treat as corroboration of cadence, not as a clean feed.
- **🔴 Fixtures from real `curl` output, not `web_fetch`.** The sandbox `web_fetch` renders these pages
  to clean text, hiding the real MS-Word DOM (label lines wrapped in `<p class="MsoNormal">` / `<b>` /
  `<span>` runs with `&nbsp;`). Build the test fixture from `curl -s <homepage>` verbatim or tests pass
  then live-verify fails.

### Herts H3 addendum (`hertshash.co.uk`, 2026-08-01) — FrontPage site with a FULL forward-hareline TABLE + a run-reports archive + MIXED kennels

Unlike Tamar Valley's single-next-run block, a FrontPage site can publish the **whole season's forward
hareline as one `<table>`** (`hare_line.htm`) AND a separate **run-report archive listing**
(`run_reports.htm`, run#+date pairs back years). Herts H3 (`meta-GENERATOR: Microsoft FrontPage 6.0`)
is the reference. New gotchas beyond the single-block case:

- **Still NOT config-only `GenericHtmlAdapter`** even though it's a clean `<table>`: the run-number cell
  is `"Herts H3 2227"` (prefix to strip), the time cell is `"11:00Hrs"`/`"Noon"` (suffix/word to
  normalise), the hares cell is sometimes a placeholder **image** (`Kitchener.JPG` = "Hares Required"),
  and — critically — the table **interleaves multiple kennels** (F.U.K Full Moon H3, H5) plus one-off
  social rows (`ADULT PANTO`, `Friday 13th Part LIX`). One selector→one field can't filter rows by
  kennel. → **bespoke Cheerio scraper** (model `dublin-hash.ts` table plumbing + `burlington-hash.ts`
  field cleaning).
- **🔴 MIXED-KENNEL TABLE → filter by kennel cell, don't route.** Emit only rows matching
  `/<Kennel> H3\s*(\d+)/`; SKIP everything else. Ingesting the interleaved sibling-kennel rows under the
  host kennelCode is the trap. The siblings are distinct kennels (own sites) → future targets, not this
  source's events.
- **Dates are `Weekday DD/MM/YY`** in the forward table (year-bearing, UK day-first) → strip weekday,
  parse `DD/MM/YY` → UTC noon, NO inference. (Sibling/one-off rows use year-less `"30th August"` — they
  get filtered out anyway.)
- **🟢 Separate run-report archive = a real backfill source.** `run_reports.htm` is a static SSR listing
  of `run# → date` (Herts: ~316 rows #1904→#2220, 2020→2026, + COVID "Virtual Hash No.1–22"). Freeze it
  to `scripts/data/<code>-history.json` (H7 pattern). 🔴 **Archive listings carry real date typos** —
  wrong-year labels (`"20th July 2026"` for a 2025 run), out-of-sequence dates, a single-digit run#
  typo that breaks monotonicity — so run the run#-monotonicity + gap-sanity + `Date.UTC` round-trip
  checklist before shipping. Multi-run weekend bundles (`2028/29/30`, `2161-63`) and un-numbered
  "Virtual Hash" rows need explicit handling (split, or skip).
- **Coords:** venues are **what3words** (`what3words.com/a.b.c`) + UK **postcodes** only — NO decimal
  coords and NOT a Maps URL, so do NOT set `locationUrl`. Leave lat/lng undefined; merge geocodes the
  postcode/venue/metro centroid. (Same "no coord-corruption trap" as a hareline list.)
- **`config.upcomingOnly: true` REQUIRED** (rolling forward hareline). **Logo** is a stable non-tokenized
  `images/<Name>.png` — still self-host + magic-byte the ext.

#### F.U.K Full Moon H3 addendum (`fukfmh3.co.uk/hareline.htm`, 2026-08-02) — SINGLE-kennel FrontPage forward-table with YEAR-LESS dates

The **sibling** of Herts H3 (Herts flagged it; its runs also appear interleaved in the Herts table).
FUKFM has its **own clean single-kennel** forward hareline `<table>` (`hareline.htm`), so no
kennel-filtering is needed — simpler than Herts. Columns: `Run No.` | `When?` | `Where?` | `Hare/s` |
`Details`. New gotchas vs Herts:

- **🔴 Dates are YEAR-LESS for near rows, with an inline `'YY` marker for later ones.** The "When?"
  cell is multi-line (`"Sat 29th\nAugust\nNoon"`); near rows carry **no year**, later rows carry
  `"Sat 23rd January '27"`. → normalise `'YY`→`20YY`, strip weekday + ordinal, and **infer the year**
  for year-less rows so dates are monotonic-non-decreasing and ≥ scrape date (increment on Dec→Jan
  wrap). This is the key difference from Herts (year-bearing `DD/MM/YY`) and Tamar Valley (year-bearing
  `3rd August 2026`). Let chrono validate the month name — don't enumerate months (S5843).
- **Venue placeholders:** `"TBC"` / `"Invite Only!"` are common in the forward rows → leave `location`
  undefined, don't synthesise. Times are word-form (`"Noon"`→`12:00`; evening pub-crawls `"7pm"`→`19:00`).
- **Coords:** what3words (`///a.b.c`) + UK postcode only — NO decimal coords, and the what3words link is
  NOT a Maps URL → don't set `locationUrl` (same as Herts).
- **No archive** — nav is only Home / Future Runs / Vindaloo / Links; the hareline is forward-only
  (#495→#511). **No backfill** (contrast Herts' `run_reports.htm`). `config.upcomingOnly: true` REQUIRED.
- **`rows.length === 0` fail-loud guard mandatory** (single-page single-table). **Logo**
  `images/wolfeyes.png` (stable path; still self-host + magic-byte ext).

---

## Legacy PHP club site — inline `runData` JSON island (learned from H5 Hare & Hounds, 2026-08-03)

Distinct from the FrontPage static-`<table>` UK sites (Herts / FUKFM / Tamar). `h5hashers.org.uk`
(self-hosted PHP + JS, `©2012-`) publishes its runs as a **plain-text JSON array embedded inline in the
page HTML** — `runData = [ {"runno":…,"date":…,"hares":…,"town":…,"pub":…,"postcode":…,"maplink":…}, … ];` —
which a small client script (`js/futureBuildTable.js`) renders into a `<table>` at load. Two consequences:

- **The `<table>` does NOT exist in a static fetch** (it's JS-built). A `web_fetch`/Cheerio-on-`<table>`
  parse sees only the SSR shell + "Your browser does not appear to support JavaScript". **But the raw HTML
  DOES contain the inline `runData = [...]`** (verified at byte ~12940). So the adapter path is: static
  `fetchHTMLPage` → regex the inline array (`runData\s*=\s*(\[[\s\S]*?\])\s*;`) → `JSON.parse`. **No
  browserRender needed.** (Chrome MCP `window.runData` confirms the same object at runtime — handy for
  research verification.)
- **Two surfaces, same shape, different pages:** `hareline.php` (`window.runData`) = the **forward** hareline
  (H5: 13 rows, `#1855+`); `runsList.php` ("Runs Archive", `window.runData`) = the **complete history** (H5:
  1842 rows back to `#1` 1991). → forward = adapter (`upcomingOnly:true`); archive = one-shot frozen backfill.
  Enumerate the site's PHP pages (`grep` the raw HTML for `\w+\.php`) — the archive page (`runsList.php` here)
  is easy to miss but is the whole backfill.
- **Date format** `Weekday DD Mon YY` (`"Sun 09 Aug 26"`), **single stable format across all 1842 rows**
  1991→2026 (no drift). Strip the leading weekday, parse `DD Mon YY`, **2-digit-year pivot**
  (`yy>=50?1900+yy:2000+yy`). The `D MMM YY` chrono pitfall applies → use `chronoParseDate`.
- **`runno` has three shapes:** plain int; **letter suffix** (`1846A`/`1846B`, 70 rows → `eventLabel`
  A/B, Mijas pattern — else same-base rows collapse and one is deleted); **`V`-prefix** COVID **virtual**
  runs (`V1559` — Creek H3 virtual-sub-series pattern; strip `V`, label distinctly).
- **Coords:** `maplink` is a **streetmap.co.uk `?x=&y=` British-National-Grid** (easting/northing) link — NOT
  decimal lat/lng. Do **not** emit coords; carry the UK **postcode** into `locationStreet` and let merge
  geocode. (what3words appears only on the home-page next-run block, not in the feed.)
- **No time field** in `runData` → infer from weekday (Sunday→11:00) or `inferTimeFromSchedule`; hares field
  sometimes carries a run-type/time annotation (`"Old King Cole 4pm BH Run"`) → strip it, and null
  placeholder hares (`"Hares Needed"`). **Logo** `images/h5logo2021_small.png` (stable path; still self-host).

---

## Events Manager (WordPress `wp-events-plugin.com`) — SSR run list + rich per-event pages, but a STALE collection iCal (learned from South Hams H3/SH4, 2026-08-04)

A self-hosted WordPress club running the **Events Manager** plugin (Marcus Sykes / `wp-events-plugin.com`) — NOT
"The Events Calendar" (Tribe), so `/wp-json/tribe/events/v1/events` returns **empty**. `sh4.org.uk` (South Hams
H4, Devon; weekly Wed, run #1594, est. 1998):

- **Detection (verified):** per-event ICS + the "Add To Calendar" block carry `PRODID:-//wp-events-plugin.com//7.4.1//EN`.
  A locations page with List/Grid/**Map** + distance search ("No upcoming events" per venue) is the Events Manager
  Locations UI.
- **🔴 The collection iCal `/<events-page>/?ical=1` is a STALE, CAPPED window — do NOT seed it as ICAL_FEED (verified
  via real `web_fetch`).** SH4's `?ical=1` returned HTTP 200 `text/calendar` but only **79 VEVENTs: Hash 0001 (1998)
  + Hash 947→1062 (2015→Jan 2017)**, ordered by internal event-ID, with **no recent/upcoming runs**. Appending
  `&scope=future` / `&scope=all` was **ignored** (byte-identical body). So Events Manager's default collection feed
  can silently omit the live events entirely. It IS useful as a **backfill input** for the events it does cover — those
  VEVENTs carry clean per-event `GEO:lat;lng` (varies per event, no default-pin trap), `DTSTART/DTEND` (TZID), `SUMMARY`
  with the run # + venue, and `LOCATION` with the address.
- **Per-event surfaces are rich (verified).** `/events/<slug>/` (HTML detail) has the human fields the list lacks —
  `Hares:`, What3Words, `RA:`, "On Down is at …", and a "7:30 pm – 11:00 pm" time. `/events/<slug>/ical/` gives the
  same run as a clean single-VEVENT ICS with `GEO`, `DTSTART/DTEND`, `LOCATION`, and an "On Down" `DESCRIPTION` — but
  **no hares** (hares are HTML-detail-only).
- **The live source is an SSR content page** (an `[events_list]`-style "List of Hashes" / "Hash Diary" page) that
  server-renders **Today / Future Events / Past Events** sections, plus a separate SSR **"Historical Hashes"** page
  that embeds **every year** as `Hash NNNN – Venue – DD/MM/YY` (year tabs are cosmetic; all lists are in the HTML) —
  the backfill source. Both are plain `web_fetch`/Cheerio (no browserRender). ⚠️ **UNVERIFIED — confirm the exact
  `<li>`/`<p>`/`<a>` DOM at implementation time**: the research sandbox could only read readability-stripped markdown
  (Chrome MCP auto-denies the new domain; CORS blocks cross-origin fetch), so the tag structure for the fixture must
  be captured with a real `curl`/`fetchHTMLPage` at build. The line **shape** seen in markdown was
  `DD/MM/YY - [Hash NNNN <theme?>](/events/<slug>/) - [Venue](/locations/<slug>/) - <address> - <POSTCODE>`.
- **🔴 The homepage "Upcoming Hashes" widget can be misconfigured** (SH4's showed "No events" while the List page
  correctly carried the next run) — scrape the List page, never the homepage widget.
- **Disposition:** bespoke HTML adapter over the List page (`config.upcomingOnly:true`, fail-loud zero guard,
  `startTime` from the fixed schedule since the list omits it) + a one-shot frozen-JSON backfill from the Historical
  Hashes page (run#+venue+date), optionally merging `GEO` from the collection iCal for the years it covers.

## Elementor/Astra WordPress hash-club site — receding-hareline grid + trail detail pages + archive `<table>` (learned from Surrey H3, 2026-08-06)

A self-hosted WordPress club on the **Astra theme + Elementor 3.31.5 + All-in-One SEO** (detect: `<meta name="generator" content="Elementor 3.x…">`, `.elementor-widget-*` classes, `wp-sitemap.xml` redirects to AIOSEO `/sitemap.xml` → `/page-sitemap.xml`). `surreyhashhouseharriers.com` (Surrey H3, England; weekly Sun 11:00, run #2637, est. 1975). **Runs are WordPress *pages*, NOT posts** — `/wp-json/wp/v2/posts` returns `[]`; there is no clean per-run REST/JSON feed. Everything is **fully SSR** (`web_fetch`/Cheerio; no browserRender). Three distinct surfaces, each parsed differently:

- **Forward feed = `/receding-hareline/` — an Elementor 3-column `text-editor` grid, NOT a `<table>`** (verified via Chrome DOM: `document.querySelector('table')` is null; the header/cells are `.elementor-widget-text-editor` `heading.default`/text widgets). Cells appear in **document order**: `run# + date` → `hare(s)` → `location`, repeating. Dates are **year-bearing** (`"02 August 2026"`). A cell rendered as `¦` (broken-bar) = **TBD** hare/location → leave the field undefined, never synthesize. `web_fetch` renders this grid as **separate paragraphs** (not a pipe-table) — that's the tell it's a column grid, not a table. Robust parse: walk the content region's text cells in order; detect a run row by a cell matching `/^\s*(\d{3,4})\s+(\d{1,2}\s+[A-Za-z]+\s+20\d\d)\s*$/`, then take the next two cells as hare + location. 🔴 **Capture the exact `.elementor-widget-text-editor` cell selector from the live DOM at build** — Elementor markup varies per column layout; a flat fixture will pass tests then miss live.
- **Per-run detail = `/trail-<runNo>-<dd>-<month>/`** (discoverable from both the receding-hareline content links **and** the header nav submenu). Each field is an Elementor **`heading.default` `<h2>`** whose text is a fixed label — the **value is the text of the widget immediately following the label heading** (verified): `Trail no:` → `"2637, 9 August 2026"` (run# + full year-bearing date), `Hare(s):`, `From:` (venue + postcode), `On on:`. Plus link widgets: `Map link to Start` (`maps.app.goo.gl/…`) → `locationUrl`, `What3Words` (`w3w.co/…`), `Map link to On On`, and prose Directions. This label/value pattern is the **most robust** parse — prefer it for venue/coords/description; fall back to the grid row for runs without a detail page yet.
- **Archive/backfill = `/archive-runday-shags/` — a REAL single `<table>`** (verified via Chrome: `tableCount:1`, header `Issue no. | Date | Hare(s) | Location | On-on | Directions`). `web_fetch` renders it as a clean pipe-delimited markdown table (the tell it's a genuine `<table>`, unlike the forward grid). Surrey's held **224 rows, rs2398 (2 Jan '22) → rs2616 (15 Mar '26)**, date format `DD Mon 'YY` (2-digit-year pivot). A few non-run rows exist (`rs n/a` "No trail", sub-letter away-runs `rs2568a`/`rs2513a` sharing a trail link) — skip or keep as `eventLabel`. Pre-archive-table issues were **PDFs in a Google-Drive folder** (off-site, out of scope). The **individual `/rs<n>/` report pages** carry the same labeled header at the top (`Issue N / Date: / Hare: / Venue: / On On:`) followed by a long "Hash Trash" prose recap (member hash-names throughout — fine; but the recap bodies also embed a contact phone → for a frozen backfill use only the archive-`<table>` fields, NOT the report bodies).
- **Note on the archive/adapter gap:** the receding-hareline forward grid only retains the current week + forward; the archive `<table>` lagged by ~20 runs behind "now" (ended at rs2616 while the live run was #2637). To make history contiguous, backfill from the archive `<table>` **plus** the ~19 individual `/rs<n>/` report pages that fill the gap between the archive tail and the adapter's forward window.
- **Disposition:** bespoke static-Cheerio adapter over `/receding-hareline/` (enumerate forthcoming) with per-`/trail-…/`-page enrichment (Creek/DFW detail-fetch pattern), `config.upcomingOnly:true` (rolling forward window ages out → reconcile would false-CANCEL), constant `startTime` from the fixed schedule (per-run time not published), fail-loud `rows.length===0` guard (single-page feed, brand-new baseline of 0) + a frozen-JSON one-shot backfill from the archive `<table>`. Logo is a stable `wp-content/uploads/.../cropped-*-logo-*.jpg` (not tokenized) — still self-host per convention, magic-byte the ext.

## Classic-WordPress club — run data as plain HTML `<table>` inside per-year Pages (learned from Donnington H3, 2026-08-07)

The **oldest-school** self-hosted-WordPress shape (distinct from the Elementor/Avada/TablePress cousins above): a stock WordPress (6.8.7, no page-builder) whose run data lives as a **hand-maintained classic-editor HTML `<table>` pasted directly into WordPress *Pages*** — one Page per year plus a deep "all history" Page. `donningtonh3.co.uk` (Donnington H3, Shropshire/Telford, England; weekly, run #2661, est. 1976 — the 3rd hash founded in the UK). **Runs are NOT posts and NOT events** — `/wp-json/wp/v2/pages` returns `[]` (empty), `/wp-json/wp/v2/posts` unused; there is **no config-only path**. Everything is **fully SSR** (`web_fetch`/Cheerio render the full pipe-table; **no browserRender**). Surfaces:

- **Forward feed = the homepage `/`** — the current rolling forward `<table>` (Donnington: #2640→#2661, ~22 rows Aug→Dec). Columns: `Run No | Date | Time | Venue | Area | Post Code | Hare 1 | Hare 2 | Notes`. Dates **year-bearing `DD/MM/YYYY`**. Times are messy: `"18.30"`, `"11.00"`, `"1830"` (no dot), plus non-time labels (`"Summertime 'Do'"`). No theme titles (the `Notes` col is occasional prose, not a run theme) → synth `"<Kennel> Trail #N"`. `TBA`/`HARE NEEDED`/blank cells → leave field undefined. No lat/lng (postcode + occasional `///w3w` per row → geocode postcode; **no default-pin trap**).
- **Archive/backfill = per-year Pages** (`/2026-runs/`, `/2025-runs/`, … `/2010-runs/`) **+ a deep all-history Page** (`/run-number-1-through-to-1791/`, a single ~172 KB SSR page back to Run #1 / 21 Jun 1976). 🔴 **Two date formats across the archive** — modern year Pages use `DD/MM/YYYY`; the deep Page uses **`DD MMM YYYY`** ("21 Jun 1976"). 🔴 **Header labels drift** — the deep Page labels columns `Run Number`/`Hare One`/`Hare Two` vs the year Pages' `Run No`/`Hare 1`/`Hare 2` → **map columns by header text, not fixed index**, so one parser drives both. 🔴 **Non-run/spacer rows** — blank-run-number rows carry section text ("No Hash in winter of 76") and `N/A`-numbered social days → skip any row whose Run-No cell isn't an integer. `chronoParseDate` handles both date shapes (don't hand-roll a month alternation — Sonar S5843).
- **Disposition:** bespoke static-Cheerio adapter over the homepage `<table>` (header-text column map, `config.upcomingOnly:true` — rolling forward table ages out, fail-loud `rows.length===0` guard) + a frozen-JSON one-shot backfill (H7 pattern) parsing the year Pages + deep Page (strict `date < today`). Logo is `wp-content/uploads/.../Hash-Logo.jpg` — the origin **403s bare `curl`/cloud IPs** (assets + logo) while serving full SSR HTML to browser-UA fetches, so fetch via `safeFetch`/browser UA and **magic-byte the ext** (the `.jpg` was NOT confirmable via curl).

## JS-shell run page backed by a clean per-year XML feed (learned from Quorn H3, 2026-08-08)

A deceptively-simple shape that reads as "JS-rendered / needs browserRender" but is actually the **cleanest kind of source**. `quornh3.org.uk` (Quorn H3, East Midlands England; monthly 1st-Sunday, run #1141, est. 1987). The forward hareline page `runlog.html` is a **thin JS shell**: an inline script `fetch()`es a same-origin XML file `runlog<YYYY>.xml`, then `document.write`/`innerHTML`-builds a `<table>` client-side. Consequences:

- **`web_fetch` / Cheerio-on-`runlog.html` returns almost nothing** (just the static header + "Today is:"), because the run rows are injected by JS. This is exactly what makes such a site *look* like it needs browserRender — and two prior refill passes (Surrey, Donnington) rejected Quorn on that basis. **The right move is to find what the shell fetches, not to render it.** Detect the feed: inspect the raw `runlog.html` source for a path literal — here `document.body.innerText.matchAll` on the *rendered* page + reading the inline script surfaced `"runlog2026.xml"` (the script text itself was clipped by the Chrome tool's cookie/query-string guard, but a regex for `["'][^"']+\.(?:js|php|txt|csv|json|xml)["']` on the raw HTML found the filename). 🔴 If the tool blocks echoing the script, don't fight it — grep the raw HTML for the path literal instead.
- **The XML feed is well-formed and trivial to parse** — `cheerio.load(xml, { xmlMode: true })` (cheerio is already a dep; no new library, no browserRender). One `<run>` element per event with child tags `number / date / month / year / time / hares / pubname / place / postcod / info`. **`<time>` is 24-hr "HH:MM"** (maps straight to `startTime`). No coords in the feed (postcode only → geocode; no default-pin trap).
- **Per-year files = a free backfill archive.** The site keeps one `runlog<YYYY>.xml` per year (Quorn: `runlog2014.xml`…`runlog2026.xml`; earlier years 404 — that's the archive floor). Same schema every year → one parser drives both the forward feed and the backfill. Probe `runlog2006..2013.xml` etc. to find the floor; a next-year file (`runlog2027.xml`) 404s until published — that's the **expected** end, not truncation.
- 🔴 **Data-hygiene quirks:** `number` can be `0000` or blank for cancelled/TBA/special rows (skip — never emit numeric 0 as a run number); `pubname`/`hares` can be `tba`/`tbA`/`***CANCELLED***` (→ undefined, case-insensitive); **month/day are NOT reliably zero-padded** across years (`<month>1</month>`, `<date>5</date>` in 2014 vs `03` in 2026 → `Number.parseInt`, don't string-slice); a prior-year file **forward-lists next January's run** (2025 file carried `#1134` dated 2026-01-03, also in the 2026 file → backfill must dedup by run number across files); two events can share a date with distinct run numbers (Quorn #1145 + #1146 both 06 Dec — the merge fingerprint keys on kennel+date+runNumber+title, so they stay separate — don't collapse them).
- **`config.upcomingOnly: true` REQUIRED.** The adapter fetches the *current-year* file; at the year boundary it will fetch a new file and the prior year's runs vanish from the fetch → without `upcomingOnly`, `reconcile.ts` false-CANCELs them. Optionally fetch `runlog<YYYY+1>.xml` too (404-tolerant) so early-January runs surface as soon as the club publishes next year's file.
- **Disposition:** register as an `HTML_SCRAPER` URL route (`htmlScrapersByUrl`, `/quornh3\.org\.uk/i`) with a bespoke ~120–180 LoC `QuornH3Adapter` (model `dublin-hash.ts` fetch plumbing + `burlington-hash.ts` field cleaning; parsing is simpler than either because it's well-formed XML), `fetchHTMLPage(runlog<YYYY>.xml)`, UTC-noon dates, fail-loud `events.length===0` guard, + a frozen-JSON one-shot backfill across the per-year files. **HTTP-only origin** → Sonar S5332 on the 3 prod URL literals (use https in tests; mark the 3 real literals SAFE).

## Google Sheets "run log" as a config-only full-archive source (learned from Mickleover H3, 2026-08-09)

A whole class of small UK/older kennels keep their **entire run history in one public Google Sheet** that a plain content page (often a Google Sites page) merely links or embeds. This is the **config-only jackpot** — `GoogleSheetsAdapter` already handles it, no new code — but there are four non-obvious traps. `mickleover-h3` (Mickleover H3, Derby, England; monthly, run #362, est. 1993): the "MH3 Full Run log" sheet (`1oZFMbkKFQp2rBM3x4LUt9vGOImCbsFOnyriQdO6xSCg`) carries `Run # | Date | Pub Name | GoogleMaps | street | town/village | PostCode | Hares | Info | Pack Size | Pubs`, 362 runs 1993→2026.

- **🔴 gid inversion — never trust "gid=0 is the first visible tab."** Two tabs: a **"Next run" form** (a single-cell block that shows `#N/A` when no hare is booked — useless) and the **full log**. Here the *full log is `gid=0`* and the form is `gid=1624247485` — inverted from the visual tab order. Worse: `gviz/tq?...&gid=<N>` **silently served the WRONG tab** (returned the form for both gids), while `gviz/tq?...&sheet=<TabName>` and `/export?format=csv&gid=<N>` returned the right data. **Determine the right gid by fetching each `/export?format=csv&gid=N` and eyeballing which one is the archive** — don't infer it from the htmlview tab list. Seed that exact `/export?format=csv&gid=N` URL.
- **🔴 Use `config.csvUrl` (the `/export?format=csv&gid=N` URL), NOT `config.gid`.** `GoogleSheetsAdapter` checks `GOOGLE_CALENDAR_API_KEY` before the gid branch, so a gid-mode source errors without the key even though gid-mode never calls the Sheets API (same as the NSWHHH note). `csvUrl` routes through `fetchDirectCsv`, skipping the key gate. Keep `sheetId` for `validateSourceConfig`.
- **🟢 Full archive → NO `upcomingOnly`, NO backfill script.** The sheet returns *every* row on every fetch, and `buildDateWindow(days)` in `src/adapters/utils.ts` is **symmetric** (`[now − days, now + days]`) — so a wide `scrapeDays` (Mickleover: `12500` ≈ 34 yr, reaching #1 in 1993) makes the adapter self-backfill the whole history on every scrape. `reconcile.ts` never false-cancels because the old rows keep reappearing. This is the **opposite** of the NSWHHH forward-only *tab* (which needs `upcomingOnly`); the discriminator is "does the feed return old rows every time?" — a single full-log tab does, a forward-only hareline tab doesn't.
- **🟢 `DD-MMM-YY` is a first-class supported format.** `parseDate → parseDMonDate` (regex `^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$`) + `normalizeYear` (2-digit pivot `<50 → 2000+`, `≥50 → 1900+`) → `10-Aug-26`→2026, `02-May-94`→1994, `10-May-93`→1993, each validated by a `Date.UTC` round-trip. No date code needed for this format.
- **🔴 Blank-Run# "social" rows are EMITTED by the adapter, not dropped.** Many kennels log un-numbered off-season pub "socials" (blank `Run #`, real date, "Social only" text). `resolveKennelTagFromSheetRow` deliberately emits blank-run# rows with `runNumber: undefined` (#1625 — to keep legit unnumbered specials on other sheets), so these socials ingest as junk unless skipped. **`silentlySkipPatterns` can only match mapped RawEventData fields** (`title|description|location|hares` — `skip-rules.ts`), so a marker that lands in an *unmapped* column (Mickleover's "social only?" often sits in the unmapped `Pack Size` col) slips through. The clean, reusable fix is a small opt-in **`requireRunNumber?: boolean`** on `GoogleSheetsConfig` (~5–10 LoC + 1 test): in `processRows`, after `resolveKennelTagFromSheetRow`, `continue` when `requireRunNumber && runNumber === undefined`. Default `false` preserves MASS H3/MFMH3 behavior. Use it for any numbered-runs-only kennel; fall back to `silentlySkipPatterns` only when every skip marker is guaranteed to be in a mapped column.
- **Columns / geocoding:** map `location` = the venue (Pub Name) col; map `address` = the **PostCode** col (best UK geocode key — street/town cols are partial). The `GoogleMaps` column here is a bare `maps?q=<postcode>` search URL or a pub-name dup — **never lat/lng**, so no coords and **no default-pin trap** (merge geocodes the postcode). No per-run time col → `startTimeRules: { default: "HH:MM" }` from the fixed schedule. No theme titles → leave `title` unmapped (synth `"<Kennel> Trail #N"`); route notes (Info col) to `description`.
- **Logo:** if the sheet is fronted by a **Google Sites** page, its `og:image` is the tokenized `lh3.googleusercontent.com/sitesv/…=w16383` token that 403s server-side and rotates per load (see the Google Sites `sitesv` note above) → grab via Chrome MCP + self-host + magic-byte the ext.
- **Effort:** genuinely config-only (source config only) if you accept the `silentlySkipPatterns` fallback; **+ ~5–10 LoC + 1 test** if you add the cleaner `requireRunNumber` flag. Either way far below a new adapter.

---

## GoDaddy Website Builder "Calendar" widget (learned from Essex H3, 2026-08-11)

`essexhhh.co.uk/hareline` (Essex H3, first Essex kennel, founded Dec 1984) is a **GoDaddy Website
Builder** site (`meta-generator: Starfield Technologies; Go Daddy Website Builder 8.0.0000`; assets
on `img1.wsimg.com`). Its hareline page uses GoDaddy's built-in **Calendar/Events widget**, which is
**fully server-rendered** — a plain `web_fetch`/`curl` returns the whole run list as real HTML (no
browserRender, no anti-bot). Verified via both `web_fetch` and a Chrome MCP DOM read.

- **🔴 Key the parser on stable `data-aid` / `data-ux` attributes, NOT the CSS classes.** Every
  element carries rotating opaque classes (`x-el x-el-h3 c2-1 c2-2 …`) that change on each publish,
  but the widget also stamps **stable semantic hooks**: `data-aid="CALENDAR_EVENT_DATE"` (the
  `"<Weekday> <Dth> <Month> <YYYY> - Run <NNNN>"` heading), `CALENDAR_EVENT_TITLE` (venue + street +
  UK postcode), `CALENDAR_EVENT_TIME` (`"11am"`/`"7pm"`), `CALENDAR_DESC`/`CALENDAR_DESC_TEXT` (hares
  line + event note + the "Map" link). Also `data-ux="Grid"|"GridCell"|"Block"`. These are the parse
  anchors.
- **🔴 Each event renders TWICE — once per responsive breakpoint.** The widget emits a
  `data-aid="CALENDAR_SMALLER_SCREEN_CONTAINER"` (mobile) AND a `CALENDAR_BIGGER_SCREEN_CONTAINER`
  (desktop) copy of every run, so `CALENDAR_EVENT_DATE` (and every sibling field) appears **2× the
  real event count** (3 runs → 6 nodes). **Iterate ONE container type OR dedup by run number**, or you
  double-emit every event.
- **🟢 Per-run coords are real and distinct** — the "Map" link is a full Google-Maps place URL in
  `!3d<lat>!4d<lng>` form (e.g. `!3d51.6289054!4d0.2799618`) → `extractCoordsFromMapsUrl` **Pattern 1a**
  handles it directly. Pins differ per run (no tenant-default-pin trap). ⚠️ The Chrome MCP
  `javascript_tool` **blocks returning the raw Maps href** (query-string guard) — parse `!3d/!4d` to
  numbers in-page and return those instead.
- **Date is YEAR-BEARING** (`"Sunday 9th August 2026"`, weekday + ordinal + full month + year) → strip
  the ordinal, loose `\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b` validated by a month `Map` (no month-name
  alternation → S5843/S5852-safe), **no year inference**. Run number is `Run NNNN` (no `#`, so
  `extractHashRunNumber` does NOT fit → local `/Run\s+(\d+)/i`). Time `"11am"`/`"7pm"` → simple
  `/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i`. Event note ("PICNIC RUN"/"Beer Festival") → `description`,
  leave `title` undefined (merge synthesizes).
- **Rolling forward hareline → `config.upcomingOnly: true` + fail-loud zero guard** (single page, no
  pagination, brand-new source with a 0 baseline). The separate "Run Reports" page is **PDF downloads
  only** (shallow, gaps) → not a machine-readable backfill.
- **Logo** = the widget's og:image on `img1.wsimg.com/isteam/…/blob-NNNN.png` — a tokenized GoDaddy
  CDN URL → self-host + magic-byte the extension.
- **Effort:** small **new bespoke ~150–220 LoC HTML adapter** (`GenericHtmlAdapter` can't split the
  combined `<date> - Run <NNNN>` heading or the multi-field cards). Model `dublin-hash.ts` fetch
  plumbing + `burlington-hash.ts` field cleaning.

**⚠️ Addendum (Hyderabad H3, 2026-09-18) — not every GoDaddy WSB hash site populates the SSR Calendar
widget.** `hyderabadhash.com` (same `Go Daddy Website Builder 8.0.0000` generator + `img1.wsimg.com`
assets, founded 1990) does **NOT** carry a populated Calendar/Events widget: its "Next Run" is a bare
in-page anchor and its "Receding Hareline" heading renders **empty** in `web_fetch`, and the page's
primary run-coordination CTA is **WhatsApp** (`wa.me/…`). So an **empty `web_fetch` render of a WSB
hash page ≠ dead, but ≠ a confirmed dated feed either** — it usually means the club coordinates off-site
(WhatsApp/IG/email) rather than in the widget. **Do not classify such a site as onboardable from a
sandbox `web_fetch` alone** — either (a) browserRender/Chrome the live page to confirm the widget
actually holds dated rows (Essex `data-aid` pattern above), or (b) treat it as `verify-live-first`. The
Essex "fully-SSR populated widget" case is the exception that earns a handoff; the Hyderabad "empty
widget + WhatsApp CTA" case is the more common one.

---

## Blazor (.NET) SPA hash-club site — SSR-empty, `browserRender` required (learned from Cambridge H3, 2026-08-12)

`ch3.co.uk` (Cambridge H3, est. 1978, weekly Sunday, run #2486) is a **Blazor (.NET) single-page
app** — a rendering shape distinct from Wix/Google-Sites SPAs. Detection + gotchas (all verified in
Chrome):

- **Detection:** page `<head>`/scripts load `_framework/blazor.web.js` + `_content/CSE.Blazor.Bootstrap/js/cse.bootstrap.js`
  and `lib/bootstrap/...`. `performance.getEntriesByType('resource')` shows **no JSON/REST/XML data
  URL** — Blazor Server streams the rendered DOM over a **SignalR WebSocket**, so there is nothing to
  intercept as a plain `fetch`. (Blazor WASM variants would fetch data files; this one doesn't.)
- **🔴 A plain `web_fetch`/`curl` of the https site returns an EMPTY shell** (`<meta base>` +
  viewport only — zero run data). The content only exists after the Blazor runtime hydrates. →
  **`browserRender` is mandatory** (there is no config-only / Cheerio-on-raw-HTML path). Call
  `browserRender({ url, waitFor: "<content selector>", timezoneId: "Europe/London", timeout: 30000 })`
  and Cheerio-load the returned HTML. ⚠️ Confirm the NAS render service actually drives the SignalR
  hydration to completion (wait on a real content selector, not `body`); this is the single build
  risk. From the research sandbox you CAN capture the live sample via the Chrome MCP (Chrome runs the
  Blazor runtime), but `browserRender` itself must be verified at build.
- **🔴 Legacy-cache trap: the `http://` (no-TLS) host can serve a stale OLD site.** Cambridge's
  `http://www.ch3.co.uk/` still returns a 2022-era SSR snapshot (runs #1971–#1974, Jul-2022 Sundays)
  while `https://www.ch3.co.uk/` is the live Blazor app. Always pin **https** and ignore an http
  snapshot — it's a different, dead site version, not a fallback.
- **Two useful surfaces, both Blazor-rendered:**
  - **Homepage `/` → `div.RunList`** = the rolling forward hareline: alternating `<h3>` **"Month YYYY"**
    headers (unambiguous year — no inference) + run `<div>`s
    (`Run NNNN <Mon> <Dth> - <Venue> , <Town>, <POSTCODE> [ - Tel: …]` + `Hare: …` + optional note).
    The next upcoming run's div carries a **`.nextRun`** class. Forward-only, ages out → `upcomingOnly:true`.
  - **`/runlist` → 20 per-year `<table>`s** captioned `Runs X-Y  Years A/B` (newest first), columns
    `Date | Run | Relive | Venue | Hare` (older tables append `Scribe`). A **full run archive** (Cambridge:
    #1458 2006 → present ≈ 1,033 runs) — the historical-backfill source.
- **🔴 Year rollover in the archive tables.** Data rows carry only a month sub-header + ordinal day
  (no year); each table spans a "hash year" (AGPU/October boundary) labeled `Years A/B`. Don't
  hard-code an Oct/Sep split — resolve by walking runs **newest→oldest** ~7 days/run, snapping to each
  row's month/day with the caption's two years as candidates, then validate with run-number
  monotonicity + gap-sanity. The homepage's explicit "Month YYYY" headers avoid this for the live
  adapter → do the live parse off the homepage, the backfill off `/runlist`.
- **No coords / no per-row time** — venue + UK postcode only (the on-page "map" is a Blazor widget,
  not a Maps URL) → geocode the postcode, `startTime` constant from the schedule. No default-pin trap.
- **No theme titles** — event names ("Beer Festival"/"Seaside Run") are trailing **notes** → leave
  `title` undefined (merge synthesizes "Cambridge H3 Trail #N"). Run number is `Run NNNN` (no `#` →
  `extractHashRunNumber` doesn't fit; use `/^Run\s+(\d+)\b/`).
- **Logo** = `ch3.co.uk/images/ch3logo.gif` (stable own-domain **GIF**, not tokenized) → self-host +
  magic-byte the ext (`GIF8`). Socials: email + Google-group only (no FB/IG/X) → blank+flag.
- **Effort:** new bespoke **~180–260 LoC `browserRender` adapter** (homepage `.RunList` parse) + a
  one-shot `/runlist` backfill. Model `northboro-hash.ts` (browserRender plumbing) + `dublin-hash.ts` /
  `burlington-hash.ts` (field cleaning).

---

## concrete5 CMS "Forthcoming Runs" hash-club site (MKH3, 2026-08-13)

**Platform tell:** `<meta name="generator" content="concrete5">` (an older PHP CMS, often via a
small web-design agency — MKH3's footer credits "Bays Media"). URLs are clean paths
(`/runs-events`, `/about-us`, `/history`) sometimes aliasing internal `index.php?cID=<n>` block IDs.

**Source shape (VERIFIED via `web_fetch` on `mkh3.co.uk/runs-events`, 2026-08-13 — SSR, no browser needed):**
The forward hareline is a repeating **"Forthcoming Runs"** block list. Each entry renders as:
- a short date label (`Aug 17`),
- a **venue line** (`Cannon, Newport Pagnell - MK16 8AQ` → venue before ` - `, UK postcode after),
- a **full datetime line** (`Aug 17, 2026, 6:50 PM – 9:00 PM`) — **YEAR-BEARING** (chrono-parse, no inference) with **same-day start+end**,
- a **body** (`Run: NNNN` / `Hares: A, B` / free-text details),
- a **Google Maps `<iframe>` embed** whose `src` carries real per-venue coords as `!3d<lat>!2d<lng>` (⚠️ `!2d`=lng, `!3d`=lat).
"No Run" placeholder blocks (`No Run` / "running approximately fortnightly") appear inline and **must be skipped**.

**Gotchas learned:**
- 🔴 **Forward-widget run numbers can be UNRELIABLE.** MKH3 showed the *same* `Run: 1931` on two
  distinct dated runs (a hand-editing typo). Never key event identity/dedup on `runNumber` from this
  block — use `kennel + date` (the merge fingerprint). Treat `runNumber` as best-effort display only.
- 🟢 **Coords are clean per-venue Maps embeds** (not a repeated default pin) — parse `!3d/!2d`; reject
  if the embed is absent rather than synthesizing a centroid. No `dropCachedCoords` needed.
- 🟢 **Rolling forward window ⇒ `config.upcomingOnly: true` REQUIRED** (blocks roll off after the date;
  otherwise `reconcile.ts` false-cancels).
- **Single-page source ⇒ explicit `events.length === 0` fail-loud guard** (baseline is 0 for a new source).
- **Effort:** new bespoke **~160–220 LoC static-Cheerio adapter** (`fetchHTMLPage`; two-pass block slice
  so date/time regexes stay S5852/S5843-safe). Model `dublin-hash.ts` (block iteration) +
  `burlington-hash.ts` (labeled-field + safe-regex helpers).

**Archive backfill = a PUBLISHED GOOGLE SHEET (not the CMS).** concrete5 sites frequently embed the run
archive as a Google Sheets `pubhtml` iframe on a `/history/past-runs` page (MKH3:
`docs.google.com/spreadsheets/d/e/2PACX-…/pubhtml`, per-year tabs, cols `Run, Date, Day, Venue/Details,
Hares`). This is a rich one-shot backfill source **separate from the forward adapter** — pull each
year-tab via `.../pub?output=csv&gid=<gid>` (or the default `?output=csv` = newest tab), derive the year
from the tab **title** ("2025 - 6 MKH3 Runs") + the `DD Mon` cell, skip `Run = "-"` / "No Run" /
"Hares Required" rows. Freeze the ingested rows to `scripts/data/<code>-history.json` + a dumb loader
(H7 pattern). **Always check `/history` and `/history/past-runs` on a concrete5 hash site before
concluding "no backfill."**

**Logo:** concrete5 serves uploads from tokenized `application/files/<id>/<id>/<id>/<name>.<ext>` paths
that rotate on re-upload → **self-host** to `public/kennel-logos/<code>.<ext>` (confirm ext by
Content-Type **and** magic bytes; MKH3's is a `.gif`).

---

## The Events Calendar (Tribe, WordPress) — config-only ICAL_FEED + paginated REST archive (verified from Bicester H3, 2026-08-14, SHIPPED handoff)

Distinct from the two cautionary TEC-adjacent notes above (Desert H3 = **Modern Events Calendar**, a
different plugin whose `/wp-json/tribe/...` is empty; South Hams SH4 = **Events Manager**, whose
`?ical=1` is a stale capped window). When a WordPress hash site runs the **genuine "The Events
Calendar" (Tribe)** plugin — detect via `meta-tec-api-version: v1` / `meta-tec-api-origin` in the page
`<head>` — it exposes three mutually-consistent, sandbox-fetchable surfaces and is a clean
**config-only `ICAL_FEED`** (the `ICalAdapter` already handles it; **Iron City H3 `sources.ts:1560`**
is the reference source config). Bicester H3 (`bicesterh3.com`) confirmed all three via real `web_fetch`:

- **iCal export** `…/?post_type=tribe_events&ical=1&eventDisplay=list` — returns `Content-Type:
  text/calendar` with upcoming VEVENTs (`SUMMARY`, `DTSTART`/`DTEND`, `LOCATION` = venue + street +
  city + county + postcode + country). This is the **seeded live URL**. 🔴 It is **upcoming-only**
  (past runs age off) → `config.upcomingOnly: true` REQUIRED, and 🔴 TEC returns **HTTP 200 + 0-byte
  body when there are no upcoming events** (the ICH3 #1753 quirk) → `config.allowEmptyBody: true`.
- **REST API** `…/wp-json/tribe/events/v1/events` — same events as JSON; `?start_date=…&end_date=…&per_page=N&page=M`
  paginates the **full past archive** (Bicester: `total: 419, total_pages: 84` back to run #2294 /
  Jan 2018; `next_rest_url` signals continuation). Per-event: `title`, `description` (often carries the
  run number as `# NNNN`), `venue{}` object, `organizer[].organizer` (**the hare**), `cost`,
  `start_date`. This is the **backfill source** — a one-shot `scripts/backfill-<code>-history.ts`
  (H7 frozen-JSON + dumb loader), NOT the live cron. Keep the `?eventDisplay=past` / REST URL out of
  the seed (a script-side override, exactly like `scripts/backfill-ich3-history.ts`).
- **HTML `/runs` (or the TEC list view)** — the same events, plus per-page `?eventDisplay=past`
  navigation and the `webcal://…?ical=1` subscribe links. Useful for eyeballing parity.

SUMMARY-parse note: kennels commonly format the SUMMARY as `Trail # NNNN - <hare> - <venue>`
(dash-delimited, **no colon**). The `ICalAdapter`'s built-in `Prefix:`/`#N:` title-splitter only
fires on a colon, so the whole SUMMARY becomes the `title` — acceptable (it's the source's own event
name). `extractHashRunNumber` still pulls the run number from `# NNNN` (the space-after-`#` form
parses — same as ICH3's "ICH3# 60", #2160). Add `config.titleHarePattern` to capture the hare from the
middle segment. For a fully clean `title → synth "<Kennel> Trail #N"` you'd need a small adapter flag
to split the dash-delimited SUMMARY (~15–30 LoC) — optional polish, not required for a working onboard.

Other gotchas: these club sites are frequently **http-only** (no https) → the source `url` + kennel
`website` literals trip Sonar **S5332** (mark SAFE via the SonarCloud REST API per the AH3-NZ process).
Venues carry an address/postcode but **no lat/lng** → merge geocodes; no default-pin trap. Same-day
`DTEND` → `endTime` for free.

---

## Bespoke hash-club CMS: config-only `hash-cal.ics` ICAL_FEED + `/hashes/?year=` HTML archive (learned from Malvern H3, 2026-08-19)

`malvernhash.co.uk` (Malvern H3) is a **custom-built** hash-club site (no `meta-generator`, no
`wp-content`, no recognisable platform) — but it exposes a clean, standards-compliant split that
makes it **config-only** for the forward feed:

- **Forward feed = a static iCal at a fixed path** (`/hash-cal.ics`). GET → HTTP 200
  `content-type: text/calendar; charset=…`, a **rolling ~4-week forward window** (~5 VEVENTs). Each
  VEVENT carries `DTSTART` + **`DTEND`** (→ same-day `endTime`), `SUMMARY` (`<CODE> Hash @ <venue>`),
  **`DESCRIPTION` = `Hare(s): <names>`** (the existing `ICalAdapter`'s built-in
  `/(?:^|\n)\s*Hare\(s\):\s*([^\n]+)/im` extractor fires with no config), and `LOCATION` = venue +
  UK postcode. **No `GEO`** → geocode the postcode (no default-pin trap). **No run number in the iCal**
  → `parseICalSummary` finds none and `merge.ts` can't synth `"… Trail #N"`; the SUMMARY becomes the
  title (`"MH3 Hash @ <venue>"`). Config: `defaultKennelTag`, `upcomingOnly:true` (rolling window ages
  out → suppress reconcile), `scrapeDays:90`. **Both config-only conditions met** (feed verified +
  `ICalAdapter` exists) → no adapter code.
- **Deep archive = paginated HTML tables at `/hashes/?year=YYYY`** (one page per year, e.g. 2003…2026,
  ~52 rows each). Columns `# | Date | Venue | Hare(s) | Link | Notes`; dates `D Mon YYYY`
  (non-zero-padded day, 3-letter month); the `#` column carries the run number the iCal lacks. This is
  the backfill source → frozen-JSON one-shot (H7 pattern), strict `date < today` so it never overlaps
  the live iCal forward rows. Skip non-numeric `#` rows (socials/TBC). **No time column and no coords
  in the archive** → omit `startTime` on backfill rows (or use the standard ON time), geocode postcode.
  Archive rows carry run numbers → their synthesized titles are clean (`"<Kennel> Trail #N"`), unlike
  the iCal forward events.

**Detection / handling shortcut:** when a hash-club site advertises an "Add to calendar (iCal)" link
AND a separate "hashes"/"runs" archive listing, check the `.ics` first — if it's `text/calendar` with
real VEVENTs, the forward feed is config-only ICAL_FEED regardless of the site's platform; harvest run
numbers + history from the HTML archive via a one-shot backfill. The two surfaces disagree on which
fields they carry (iCal: times/hares/venue, no run#; archive: run#/venue/hares, no times) — that's the
normal shape, not a defect.

---

## Classic PHP table-layout hash-club site (learned from Wyre Forest H3, 2026-08-20, VERIFIED via browser fetch + DataTables API)

`wyreforesthhh.org.uk` (Wyre Forest H3, Kidderminster, weekly Thursday, est. 2008) is an old-school
hand-maintained **PHP site** (`index.php`, `Page_on-back.php`; no meta-generator, no wp-content). Two
distinct run surfaces, each needs a different fetch treatment — confirmed against the real markup:

- **Forward hareline = `index.php`, a plain SSR `<table>` (NO DataTables).** The **whole page** is a
  layout `<table>`; the run rows are `<tr>` with 6 `<td>` `[Number, Date, Location, Postcode(<a>),
  Hare(s), Notes]`. There is **no `<thead>`/`<th>`** — key run rows on `td[0]` matching `/^\d+$/` + the
  expected column count, never on header text. Dates are `Dth Mon YYYY` (ordinal + abbreviated month,
  **year-bearing** → strip ordinal + `chronoParseDate`, no inference). Postcode cell is a
  `google.com/maps/dir/?destination=<postcode>` link (no coords → geocode postcode; no default-pin trap).
  A blank Location/Postcode is a real "TBD" run — keep it, leave `location` undefined. `Notes` column
  carries blurbs ("Annual birthday hash", "Retirement hash") — NOT clean themes → leave `title`
  undefined (merge synthesizes), optionally route Notes → `description`. `fetchHTMLPage` works; small
  rolling list → `config.upcomingOnly:true`.

- **Archive = `Page_on-back.php`, a client-side jQuery DataTables initialized from a fully-SSR'd table.**
  The DataTable init is `$('#runs').DataTable({paging,searching,ordering,pageLength:10})` with **NO ajax
  source** — so all rows come from an HTML `<table>` that is **fully server-rendered in the raw response**
  (Wyre Forest: 259 KB, 918 `<tr>` = 1 header + 917 data rows, 917 `data-order` attrs). Columns here are
  `Number | Date | Location | Grid Ref | Hare(s)` (**5 cols, no Notes** — differs from the forward table).
  🟢 **Each date `<td>` carries a clean ISO `data-order="YYYY-MM-DD"` attribute** (DataTables sort key) —
  read THAT, not the visible ordinal text → zero date-inference. The "Grid Ref" column is **mixed**: old
  runs use **OS 6-fig grid refs** (`SO744738`), newer runs use **UK postcodes** (`DY12 2AQ`) — don't feed
  a grid ref to a postcode geocoder; leave coords undefined for those and let merge geocode the venue text.
  → Backfill source: `fetchHTMLPage` + Cheerio over `#runs tbody tr`, freeze to `scripts/data/<code>-history.json`.

- **🔴 The research sandbox's `web_fetch` returns an EMPTY/whitespace body for the DataTables archive page**
  (its HTML→markdown converter chokes on the large in-page DataTables table) — a **false empty**. Do NOT
  conclude "no archive / JS-rendered / needs browserRender" from that. Verify with a **same-origin
  in-browser `fetch()` via Chrome MCP** (or trust that the DataTables `rows().data()` count in the live DOM
  reflects the raw HTML) — Wyre Forest's `fetch()` returned the full 259 KB with all 918 `<tr>`. A
  server-side `fetchHTMLPage` (raw fetch + Cheerio) gets the rows; only the sandbox tool stripped them.
  🔴 **Getting the full row set out of the live DOM:** after DataTables inits, the DOM shows only
  `pageLength` rows (the rest are held in DataTables' internal model), so `document.querySelectorAll('tr')`
  under-counts — use the API `window.jQuery('#runs').DataTable().rows().data()` (and `.cell(i,1).node()`
  for the `data-order` attr) to read all rows during research.

**Effort:** NEW ~120–180 LoC bespoke Cheerio adapter (mirror `dublin-hash.ts` table plumbing +
`burlington-hash.ts` field cleaning) + a frozen archive backfill (H7 pattern). Not config-only
(`GenericHtmlAdapter` can't split a run row across the multi-`<td>` layout, and the two surfaces have
different column sets). Logo is a stable own-domain asset (`SmallLogo.<ext>`) → still self-host +
magic-byte the extension (don't assume `.gif`).

---

## Hand-maintained SSR HTML hash-table with the DATE cell as `<th scope="row">` (learned from N.E.W. Cotswold H3, 2026-08-21, VERIFIED via web_fetch + Chrome DOM read)

`newch3.org.uk` (N.E.W. Cotswold H3, Cotswolds, biweekly Sunday, est. 2019) is the *cleanest* variant
of the classic hand-maintained hash-club table — simpler than Wyre Forest (no DataTables, no PHP; both
surfaces are plain fully-SSR `<table>`s, `fetchHTMLPage`-able / `web_fetch` returns them whole). Two
surfaces, one column layout: forward `/` (upcoming runs) + `/past/` (full dated archive). Columns
`Date | Run No. | Venue | Address | Hare(s)`.

- **🔴 The DATE cell is a `<th scope="row">`, not a `<td>` — on BOTH tables.** Each row is
  `<tr><th scope="row">30th August, 2026</th><td>183</td><td>Venue</td><td>Town, POSTCODE</td><td>Hares</td></tr>`.
  An adapter that reads `$(tr).find("td")` gets **only 4 cells** and **silently drops every date** (the
  scrape "succeeds" with dateless events). Iterate `$(tr).children()` (or a `th, td` selector) and index
  cell[0]=date(`<th>`), cell[1]=run#, cell[2]=venue, cell[3]=address, cell[4]=hares. **This is the one
  real gotcha** — put a `<th>`-date row in the test fixture + a regression assertion, or a `find("td")`
  refactor reintroduces it. (My earlier `querySelectorAll('td')` DOM probe returned 4 cells and looked
  like a "no dates" table — the dates were there, just in the `<th>`.)
- **Dates are `Dth Month, YYYY`** (ordinal + full month + comma + year) — **year-bearing** → strip the
  ordinal (`/(\d)(?:st|nd|rd|th)\b/→$1`), drop the comma, `chronoParseDate`, **NO inference**. Same
  format on the archive → the frozen backfill needs no date guessing.
- **No coords** — the Address `<td>` is `Town, POSTCODE` with a `maps.app.goo.gl` shortlink (no lat/lng)
  → geocode the postcode; no default-pin trap. `TBD` venue rows are real future runs with a blank
  venue/address → keep the run, leave `location` null (tri-state), don't synth.
- **No per-event times / no theme titles** — fixed schedule time (11:00) → `startTime` from the kennel
  default; leave `title` undefined → merge synthesizes "N.E.W. Cotswold H3 Trail #N".
- **Forward table is a rolling window** (runs move to `/past` after they happen) → `config.upcomingOnly:true`
  REQUIRED (else reconcile false-cancels aged-off archive rows) + a fail-loud `rows.length === 0` guard
  (single page, no pagination, 0 baseline on a brand-new source).
- **Archive `/past/` is the backfill source** — a single un-paginated page of all past runs, fully dated,
  continuous into the forward table's run numbers → frozen ~N-row JSON + dumb loader (H7 pattern), strict
  `date < today`. Founding date is Run #1 on `/past` (a reliable `foundedYear` signal).
- **Logo** is a stable own-domain `og:image` (`/images/hare.png`) → still self-host + magic-byte the ext.
  🔴 **Chrome MCP DOM probes get [BLOCKED: Cookie/query string data]** when the serialized output contains
  the `maps.app.goo.gl/<token>` shortlinks — strip/neutralize hrefs and output text-only, or read the
  table via `web_fetch` markdown instead.

**Effort:** NEW ~100–160 LoC bespoke Cheerio adapter (mirror `dublin-hash.ts` + `burlington-hash.ts`) +
a frozen archive backfill. Distinct from the Wyre Forest "Classic PHP table-layout" note above: no
DataTables, no PHP, no OS-grid-ref column, and the `<th>`-date gotcha replaces the `data-order` one.

## Self-hosted WordPress hash-club site with a custom public `.ics` feed → config-only ICAL_FEED (learned from Cheltenham & Cotswold H3 / C2H3, 2026-08-22, VERIFIED via web_fetch)

Not every self-hosted WordPress hash site needs a bespoke scraper (contrast Donnington's per-year
Pages, Bombay's content-block runs, Creek's `?cat=N` archive). Some ship a **custom-built public iCal
feed at a bespoke path** — e.g. `c2h3.co.uk` serves `https://c2h3.co.uk/c2h3-calendar.ics`
(`Content-Type: text/calendar` 200, `PRODID:-//C2H3//…`). When present, that's a **config-only
ICAL_FEED** (`ICalAdapter`), no code. Checklist when you hit a WP hash site:

- **Look for a calendar-subscribe link first.** The Upcoming Runs page here had a `webcal://…/…ics`
  "Subscribe to Calendar" button — the fastest tell. `webcal://` → fetch as `https://`.
- **The feed can be RICHER than a generic WP export.** This one carried per-VEVENT: `SUMMARY:Run
  #NNNN — <Venue>`, `GEO:lat;lon` (real distinct per-run pins), `LOCATION` (venue+street+postcode),
  `DTEND` (same-day, +2h), and `DESCRIPTION:Hare(s): …\n<notes>\nMap: …\n<detail-url>`. `ICalAdapter`
  parses run# (`extractHashRunNumber`), hares (`HARE_PATTERNS`), venue, endTime, and GEO→`locationUrl`
  (`/maps/search/?api=1&query=lat,lng`) → merge's `extractCoordsFromMapsUrl` **Pattern 4** all natively.
- 🔴 **SUMMARY with an em-dash (`—`) and NO colon defeats `parseICalSummary`'s title regex** (it is
  colon-anchored). Result: the adapter keeps the **full SUMMARY as the title** (`Run #2834 — Bredon
  Cricket Club`). That's acceptable (source's own naming, run# included; Bicester precedent). Do NOT
  reach for `titleStripPrefixAliases: ["Run"]` to "clean" it — it demotes venue-bearing titles to a
  bare venue name (redundant with `location`) and leaves venue-less runs synthesizing, i.e. worse and
  inconsistent.
- 🔴 **The `.ics` can be FRESHER than the site's own HTML "Upcoming Runs" page.** Here the iCal had
  already inserted a new run #2837 and renumbered the tail (`LAST-MODIFIED` timestamps prove it) while
  the HTML page still showed the pre-renumber order (a stale render/cache). **The machine-readable feed
  is canonical** — sample from the `.ics`, not the HTML page.
- 🔴 **The WP `runs`/`events` custom-post REST endpoints are often auth-gated**
  (`{"code":"rest_not_logged_in","status":401}`) even when the `.ics` is fully public. So "REST 401"
  does NOT mean "no dynamic source" — the iCal is the source. It DOES usually mean **no deep backfill**
  (the archive lives behind the Members Area); combined with a recently-rebuilt site (`wp-content/
  uploads/2026/…`), treat as forward-only + `upcomingOnly:true`. The rolling `.ics` window here still
  carried ~19 recent-past runs, giving the kennel page instant history for free on first scrape.
- **Effort:** config-only — one `sources.ts` ICAL_FEED row (`defaultKennelTag` + `upcomingOnly:true` +
  `scrapeDays` wide enough to catch the recent-past window, ~180). No adapter, no backfill script.

---

## Custom PHP hash-club site — JS-built hareline table from INLINE embedded data, no XHR (learned from H5 Hare & Hounds, 2026-08-23)

`h5hashers.org.uk` (H5 Hare & Hounds, Bedfordshire, weekly-Sunday, since 1991) is a bespoke PHP/`.shtml`
site whose **`hareline.php` "Receding Hareline" is JS-rendered** — a plain `web_fetch`/`curl` returns a
shell ("Your browser does not appear to support JavaScript"). Key finding, confirmed via Chrome MCP
`read_network_requests`:

- **The runs data is EMBEDDED INLINE in the `hareline.php` HTML** (an inline `<script>`, ~2 KB) and a
  static asset `includes/futureBuildTable.js` renders it into `<table id="fTable">` (columns:
  Number, Date, Hares, Town, Pub, Postcode, Maplink). **NO data XHR is made** (only the `.js` + images
  load). So `fetchHTMLPage` (raw HTML) DOES contain the data — the text-extractor just drops the
  `<script>`. Two adapter paths: (1) **static** — locate the inline `<script>` (`colHeads = [...]` +
  run objects) and parse it; 🔴 the run objects are **JS object literals with UNQUOTED keys**
  (`date:`/`town:`/`pub:`/`postcode:`) → NOT valid JSON, don't `JSON.parse`; do tolerant field
  extraction. (2) **`browserRender`** reading `table#fTable` (northboro pattern) — simplest/robust,
  and the only way to get the *rendered* rows if a server-side fetch is ever served the shell.
- **Homepage (`index.shtml`) SSRs the CURRENT run** ("Next Hash" block) as plain text — a reliable
  fallback for the single next run even without JS.
- **Dates are year-bearing** (`"Sun 23 Aug 26"` = weekday D Mon YY) → NO year inference.
- **Sub-letter run numbers** (`1862A`/`1862B` — Away Hash vs local, same date) → base integer
  `runNumber` + `eventLabel` (Mijas pattern); dropping the suffix collapses both rows in the merge.
- **`Hares` column carries non-hare NOTES on TBC rows** (`Hares Needed`, `Away Hash`, `35 Year
  Anniversary`, `AGM`, `4pm BH Run`) — skip as hares AND as titles (leave both undefined → merge
  synthesizes `Trail #N`). Anniversary-run rows are a reliable `foundedYear` signal ("35 Year
  Anniversary" on the 2026 hareline → founded 1991).
- **Maplinks are streetmap.co.uk `map.srf?X=<easting>&Y=<northing>` = OS National Grid, NOT lat/lng**
  → `extractCoordsFromMapsUrl` won't parse them; leave coords undefined, geocode the postcode. No
  default-pin trap.
- **Archive = "The Words" newsletter pages** (`words/archiveIndex.shtml`, run #1 1991 → present, ~80%
  coverage, prose) — NOT cleanly machine-readable → forward-only adapter + `upcomingOnly:true`, no
  backfill. A "Search in Previous Runs" box hints at a structured backend run DB (optional build-time
  probe for deeper history — don't block the onboard on it).
- **Chrome MCP `read_network_requests` is the fast way to prove "inline data vs XHR"** on any
  JS-rendered hareline: if the only same-origin requests are the builder `.js` + images (no
  JSON/`?ajax` call), the data is embedded inline and a static fetch suffices.

---

## UK county hash: empty website hareline + embedded Google Doc, but the kennel logs to Harrier Central (Yorkshire H3, 2026-08-26)

Observed on Yorkshire Hash House Harriers (`yorkshirehash.net`, a Google Sites site). The pattern recurs
on hand-maintained UK club sites and is a **trap**: the obvious "scrape the website hareline" plan is the
wrong source; the config-only Harrier Central feed is the right one.

- **The website hareline is a shell.** The "Home/Hairline" page rendered **242 chars of nav-only text**
  (`document.body.innerText`), **0 `<table>`, 0 `<img>`**. The actual run list lives on a `/complete_<year>`
  sub-page whose only real content is an **embedded published Google Doc** via
  `<iframe src="docs.google.com/document/d/e/<pubId>/pub?embedded=true">`. Fetch the doc's `…/pub` URL
  directly for the text.
- **That Google Doc is a poor structured source.** It's a free-form 3-column prose table
  (`Date & Time | Event | Details`) that **mixes multiple kennels** (YH3 + SH4 + PUPS + Hash Walks),
  carries **no run numbers**, and uses ambiguous month/day dates (`"Jan 11"`, glued `"Jan18"`, bare
  month headers). Parsing it = a bespoke multi-kennel adapter with routing + heavy date normalization.
  Do NOT reach for it when a cleaner source exists.
- **Check Harrier Central first.** Sweep `hashruns.org/api/global-runs?isFuture=1` (public HC mirror, no
  token, works from Chrome) for the kennel's shortName. If it's there, it's **config-only HARRIER_CENTRAL**
  — clean structured events (date, time, hares, price, sometimes venue). This is the ONE clean feed even
  when the club's own site is a shell.
- **`hashruns.org/api/global-runs` is the token-free way to verify + backfill any HC kennel.**
  `?isFuture=1` = upcoming (single global list, filter by `PublicKennelId`/`KennelShortName`);
  `?isFuture=0&minEventDate=YYYY-MM-DD&maxEventDate=YYYY-MM-DD` = past runs (min/max **required**, else
  HTTP 400 `"minEventDate and maxEventDate are required for past runs"`). The token-authed `getEvents`
  POST that `HarrierCentralAdapter` actually calls is upcoming-only — verify the adapter separately at
  build; the mirror is enough to confirm the kennel is live + capture the sample.
- 🔴 **HC user-entered data can be messy per-kennel** (independent of platform): non-monotonic AND
  **duplicated** EventNumbers (Yorkshire reused `#2195` for both an Aug-2026 run and its Jan-2027 upcoming)
  → `config.suppressRunNumber:true`; the `hares` field sometimes carries a **location** (`"Near Leeds"`)
  the adapter's location-bleed guards miss when no venue is set; EventNames sometimes carry the full
  pasted hareline → rely on `defaultTitle` synthesis, not the raw name.
- **`config.upcomingOnly:true` is required** for HC sources (the getEvents feed ages events off after they
  pass; without it `reconcile.ts` CANCELs any backfilled past rows — the "Bandung contract").

## "kbean" / Kerribean-Design PHP hash sites (Jamaica H3, 2026-08-28)

Some long-running kennels run a bespoke PHP hash-management app under a `/kbean/` path (built by
"Kerribean Design"; Jamaica H3 = `jah3.com/kbean/hareline.php`). Pattern (VERIFIED for JAH3; treat
as UNVERIFIED for other tenants until confirmed at build):

- **SSR, not JS.** A raw `fetch()` of `hareline.php` returns the fully-rendered HTML (both tables
  inline, ~113 KB for JAH3) — use static `fetchHTMLPage` + Cheerio, NOT browserRender. (A "loading"
  heading can appear in the visible text but the data is already server-rendered.)
- **Two `<table class="hareline">` on one page.** Table 0 = **upcoming "Hare Line"** (often just a
  sentinel row *"Sorry, nothing in the calendar yet."* — the next run is posted only ~6 days prior);
  Table 1 = **"Receding Hare Line"**, the **complete run archive** (JAH3: 534 rows, #001 1998 →
  present). Both share the header `Run | Date | Location | Hares`. → parse Table 0 for forward events
  (adapter, `upcomingOnly:true`), Table 1 for a one-shot frozen backfill.
- **Fail-loud only when BOTH tables are missing** — an empty *forward* table with the archive present
  is the normal between-postings state, not a scrape failure.
- Date format `"Weekday, D Mon, YYYY"` (4-digit year, occasional single-digit day) → `chronoParseDate`.
  Location cells may be prefixed `*** CANCELLED ***` → skip. No coords / no start times in the table
  (JAH3 start time is "up to the hare"); geocode from the free-text Location, fall back to the city
  centroid. Per-run detail pages exist at `/kbean/runtemplate.php?runnum=N` (enrichment only, not needed).

#### Larnaca H3 addenda (researched 2026-08-29) — Google Sites `view/...` with a NEXT-RUN page carrying BOTH a current-run block AND a "Future Hares" forward list

`sites.google.com/view/larnaca-hash-house-harriers` (Larnaca H3, Cyprus, founded 1987) is a `view/` Google
Sites variant (like Larnaca; distinct from Manila's `sites.google.com/site/...` and NH4's custom domain).
Fully SSR'd — `web_fetch`/`fetchHTMLPage` returns everything; no browserRender.

- **The `/next-run` page is a DUAL surface on ONE page:** (1) a labeled current-run detail block
  (`RUN NUMBER:` / `HARES:` / `LOCATION:` / `ON ON:` / `DATE:` / `TIME:` / directions + a Google Maps
  embed `q=<lat>,<lng>` pin + a `what3words` token), AND (2) a **"Future Hares:-" forward list** of ~15
  runs (`<runNo>  <Dth Mon YY>  <hares>  <location>  <on-on>`). Parse the forward list as the primary event
  set; enrich the first row (the current run) from the detail block. This is richer than Manila (single
  current run) — you get a real forward hareline.
- **The forward list is tab/whitespace-delimited text** (renders with large gaps in `web_fetch`), very likely
  a single content block like Auckland's Rocketspark Draft.js list — **NOT** a `<table>`. ⚠️ Confirm the real
  delimiter in-DOM at build and split on `\t` / collapsed whitespace.
- **Dates are year-bearing** — forward list `31st Aug 26` (ordinal + abbreviated month + **2-digit** year;
  the month uses the British **"Sept"** 4-letter form — the month `Map` must contain "Sept" as well as "Sep");
  detail block `31st August 2026` (full). NO year inference (`+2000` on the 2-digit year).
- **Coords:** only the current run has a real RV pin (Maps embed `q=`); all forward rows are "TBA" → single
  real pin, **no default-pin trap**. Others: undefined → merge geocodes the town / metro centroid.
- **Metadata lives on `/the-larnaca-hash` (the About page), not the empty `/larnaca-hash` child** — founded year,
  weekly-Monday, seasonal start times (winter 16:00 / spring-autumn 17:00 / summer 18:00), hash cash, walkers-welcome
  all in one prose block. **`/previous-hash-details` is empty → no reachable archive → future-only, no backfill.**
- **Committee page (`/mismanagement`) is PII** (personal emails + phone) — never seed it.
- **`sitesv` og:image logo** — tokenized/rotating; try a `Referer: https://sites.google.com/` curl first (Manila
  precedent), else Chrome-grab; self-host + magic-byte the ext.
- **Cyprus is a dense hash scene** — Larnaca's "Links to other Cyprus hashes" page lists 7 siblings (Amathus,
  Dhekelia, Nicosia Horrible, Episkopi, Happy Valley, Kition, Polygon), each on its OWN separate site → future
  targets, not co-hosted.

---

## Self-hosted WordPress + Elementor — "Next Run Location" two-column block, data in a PAGE not posts (learned from Dhekelia H3, Cyprus, 2026-08-30)

**Detection:** `<meta name="generator" content="Site Kit by Google …">` (often) + Astra theme +
`elementor-*` class soup. The runs are NOT in `posts` — `/wp-json/wp/v2/posts?per_page=8` returns `[]`.
They live in the rendered content of a single **page** (Dhekelia: `/info/`, page id 511).

**The clean fetch path is the WP REST *page* endpoint, not HTML scraping:**
`GET /wp-json/wp/v2/pages?slug=<slug>` → `[{ content: { rendered }, modified, _links }]`.
- `content.rendered` = the exact Elementor markup (parse with Cheerio).
- `modified` = last-edit timestamp → a **staleness / recently-active** signal (Dhekelia: `2026-08-24`,
  6 days before research).
- `_links["version-history"][0].count` = revision count → **maintenance-frequency** signal. Dhekelia's
  page had **960 revisions** since 2021-01 ⇒ hand-edited ~weekly ⇒ strong recently-active evidence even
  with **0 upcoming** and only the single current run visible.

**The "Next Run Location" block is TWO 50% Elementor columns (labels | values), positionally paired.**
VERIFIED against Dhekelia's real `content.rendered` (not speculation):
- Column A = `div.elementor-widget-text-editor` with `<p>Hash Number:</p><p>Date:</p><p>Time:</p><p>Hares:</p><p>Location:</p><p>Directions:</p>`
- Column B = a second `text-editor` widget whose `<p>` children carry the VALUES in the same order,
  then extra `<p>` for multi-paragraph directions + a trailing signature (`""`, a bare first name,
  `On On`). Values had MORE `<p>` than labels.
- Parse: locate `h2:contains("Next Run Location")`, take the two `.elementor-widget-text-editor` under
  it, read column B's `<p>` list positionally (idx 0–4 = number/date/time/hares/location; 5+ =
  directions). Verify column A's first `<p>` starts with `Hash Number` (Elementor `data-id` hashes
  rotate — content-key, never selector-key) and **fail loud** if it doesn't.
- Dates are British **`D/M/YYYY`** (`26/8/2026`) — day-first, split on `/`, build `Date.UTC(y,m-1,d,12)`.
  Times are `HH.MM` (`18.00`) — `.replace(".",":")`.
- Only the current run is exposed (overwritten weekly) → `config.upcomingOnly: true` + a fail-loud
  zero guard; **no on-page archive/backfill** (page **revisions** endpoint `/wp-json/wp/v2/pages/<id>/revisions`
  holds the weekly history but is **auth-gated** — returned empty to an unauthenticated fetch).

## Carrd landing page + public Google Sheet hareline (Bucharest H3, 2026-08-31)

**Pattern:** a tiny [Carrd](https://carrd.co) one-page site (`<kennel>.carrd.co`) whose "See our
Hare Line" link points at a **public Google Sheet** — the sheet, not the Carrd, is the dynamic
source. Carrd itself is static marketing copy + photos + social links (WhatsApp/FB/IG); do NOT treat
it as the source. Confirm the sheet is world-readable via the anonymous CSV export
(`…/export?format=csv&gid=<gid>` with `credentials:'omit'` → HTTP 200 `text/csv`) and/or gviz
(`…/gviz/tq?tqx=out:json&gid=<gid>`).

**Why it's usually NOT config-only** (two blockers seen on Bucharest's sheet — verify per sheet):
1. **British `D/M/YYYY` dates.** The shared `GoogleSheetsAdapter.parseDate` assumes **month-first**
   for slash dates, so `20/09/2026` (month=20) is dropped and `5/3/2023` is silently swapped. A
   day-first parser is required. Real cells also carry variants: dot separators (`23.10.2026`),
   trailing text (`18/05/2024 Hash Home Brew Fest`, `17/5/25 - Homebrew Fest`, `(TBD)`), and date
   **ranges** for away weekends (`25-27/10/2024 Transylvanian Hash` → take the first day).
2. **Run-# prefix routing (multi-kennel, no Group column).** The sheet interleaves two kennels in the
   Run # column by prefix — `#N` (the regular hash) and `FM#N` / `FM #N` (the Full Moon sister, its
   own independent sequence). The stock adapter's `/^\d+$/` run test rejects the `#`/`FM#` prefixes,
   and `groupFilter` only routes off a dedicated *column*, which these sheets lack. → bespoke adapter
   that strips the prefix for `runNumber` and maps `FM#`→sister-kennel, `#`→primary.

**Other observations:** the "Trail type and location" column mixes trail type (`A-A`/`A-B`), a venue
(metro/park), AND theme text (`Frankenstein Day`, `Sturgeon Moon`) — map it to `location` (geocode
with a city bias), never to `title` (leave title undefined → merge synthesizes). Start-time column is
mostly blank → default by kennel/day (regular Sun 14:00, Full Moon Fri 19:00). Because the sheet keeps
the entire archive on one always-present tab, a **wide `scrapeDays` + NO `upcomingOnly`** ingests past
+ future in one pass (Isca full-archive precedent) — no separate backfill script. Single-tab source →
add a **fail-loud `events.length === 0` guard** so a layout change surfaces instead of silently
cancelling.

---

## Joomla (Helix Ultimate template) — hareline article table (Nicosia H4, 2026-09-01)

**What it is:** A self-hosted Joomla site (footprint: `meta[name=generator] = "Helix Ultimate …
Joomla! Template Framework"`, URLs under `/index.php/<section>/<article>`). The forward hareline
lives in a Joomla *article* at a stable path (Nicosia: `/index.php/hare-line/upcoming-hares`).

**Fully SSR — static scrape, no browserRender.** A plain `web_fetch`/`fetchHTMLPage` (no JS) returns
the complete run table. Confirmed on `nh4.com.cy`: Content-Type `text/html`, the `<table>` with all
run rows is present in the initial HTML.

**Structure (verify per site):** the run list is a **class-less `<table>`** (no `<thead>`, no header
row — the first `<tr>` is already data) sitting inside the Joomla article body
(`.article-details` / `.com-content-article__body`). Nicosia's is 3 columns:
`run# (integer) | date (DD-Mon, NO year) | hares (often empty)`. Select the table **inside the
article content**, not a nav/menu table — Joomla menus can also render as tables.

**Gotchas:**
- ⚠️ **Chrome's raw-HTML/`outerHTML` extraction gets filtered** ("[BLOCKED: Cookie/query string
  data]") because Joomla markup carries session tokens / query-string form actions. Use
  `get_page_text` (or a server-side `curl`/`fetchHTMLPage`) to read content, and **capture the test
  fixture from a real fetch**, not a hand-typed guess.
- **Dates often lack a year** (`25-Aug`) → infer current year + Dec→Jan rollover, store UTC noon.
- **Archive is a separate messy section.** Nicosia's "Receding Hare Lines" links only years 2008–2015
  as raw Joomla article IDs with an odd `/../nh4/` path prefix (clean paths 404), with a multi-year
  gap to the current forward window → not a clean backfill source. Don't assume the archive is
  continuous or reachable just because the forward table is.
- **Per-run location/time/coords may be absent** (venues posted weekly to Facebook) → rely on the
  kennel's fixed schedule for `startTime` and a city-centroid fallback for coords; don't synth venues.

#### Muscateers H3 addenda (verified via real web_fetch, 2026-09-02) — WordPress.com "Receding Hareline" SSR `<table>` PAGE (REST gated)

A fourth WordPress.com variant, distinct from ONH3 (REST-blog) and Hanoi (single-current-run page):
the forward/history data lives in a **single WordPress.com _page_** rendered as a plain SSR `<table>`
(`muscateersh3.com/mush3-meets/receding-hareline/`, columns `Date | Meet(run#) | Details(venue) | Hares`).
- **REST is gated for pages** here: `wp-json/wp/v2/sites/<host>/pages/<id>` → empty, and
  `rest/v1.1/sites/<host>/posts/slug:<slug>` → empty (it's a `page`, not a `post`). **Don't rely on REST** —
  the rendered HTML page is fully SSR, so `fetchHTMLPage` + Cheerio on the page URL is the verified path.
  (`rest/v1.1/sites/<host>/posts/<id>` by numeric id *might* return page content — the id + blog id are in the
  page's "View post in Reader" link — but live-verify before trusting it.)
- **"Receding hareline" = a PAST log** (newest-first, no future rows). It's a **full always-present archive**
  (every run from #1 stays on the page), so treat it like Bucharest/Isca: **wide `scrapeDays`, NO `upcomingOnly`,
  no separate backfill script** — one pass ingests everything; the newest completed run refreshes each scrape.
  0 future rows is NOT a block — apply the Step 3 recently-active rule (last run within ~2× cadence).
- **Dotted day-first dates** (`28.8.26`, `16.01.26`, `2.1.2026`) → build UTC noon directly, expand 2-digit years,
  no chrono/regex. Watch for **year typos** revealed by run-number monotonicity (`5.6.25` should be `5.6.2026`).
- **Blank-run# rows are real socials/specials** (title = the Details cell); **cancelled rows** ("Cancelled due to
  weather") get skipped. No time/cost/coord columns → leave those undefined, city-centroid coord fallback.

## The Events Calendar (Tribe) REST — abandoned-plugin staleness trap (learned from Bahrain H3, 2026-09-02, BLOCKED: stale)

`meta-tec-api-origin` / `meta-generator: … The Events Calendar` in a WordPress site's `<head>` signals the Tribe
plugin, whose events REST API is `wp-json/tribe/events/v1/events` (`?start_date=YYYY-MM-DD&per_page=N`). **But a
site can keep the plugin installed long after it stopped entering events there.** Bahrain H3 (`bahrainhash.com`)
returned `total:0` for upcoming, and only **6 events total** (all May–Jul 2024) with a past-inclusive query — the
kennel migrated its forward hareline off the plugin to WhatsApp/Facebook and left a manually-edited Elementor
"next run" block that was itself **8 months stale** (Jan-2026). **Verify recency with a wide past-inclusive query**
(`start_date` a few years back) and read the newest `start_date` before trusting a Tribe feed — an empty upcoming
list plus a tiny, old total = abandoned source (blocked: stale), not "0 upcoming but recently active". Empty
hareline pages + a stale static "next run" block corroborate abandonment.

## Bespoke PHP hash-club site — SSR forward "upcoming-runs" page + JS/DataTables archive (researched from Puerto Galera H3, 2026-10-16)

**What it is:** A hand-built bespoke club site (`pgh3.org`, HostGator-hosted, custom template with sponsor
footer + a `rego.<host>` registration subdomain — NOT Squarespace/Wix/WordPress/Joomla; no generator meta).
The site splits forward vs archive across two pages with **different render strategies**, which is the key trap:

- **Forward feed = `upcoming-runs.html` is FULLY SSR** → `fetchHTMLPage` + Cheerio works, no browserRender.
  web_fetch returned the complete "Upcoming Regular Runs" list (5 weekly-Saturday runs with run #, departure
  time, hares, location, comments, fees). This is the live adapter source.
- **Archive = `run-list.html` is an EMPTY `<table>` in SSR** — rows are injected client-side by a DataTable
  ("click on the table headers to sort columns"; meta "Runs since August 2008"). The ~1,900-run history is
  **NOT in the static HTML** → you must find the DataTable's JSON/AJAX endpoint (browser DevTools / browserRender)
  to backfill. The `hares.html` / `top-runners.html` stat pages are likely fed by the same backend endpoint.

**⚠️ UNVERIFIED (confirm at implementation): exact DOM tags.** The forward-page structure below is from
web_fetch's *rendered* text, not raw markup — capture real HTML (`fetchHTMLPage`/`curl`) for the fixture.
Observed block shape (one per run, under a "REGULAR RUNS" section): a **date heading** ("Saturday October 17th",
**NO YEAR**) → "**Run** NNNN" → "**Departure:** H:MM am/pm (sign-in closes…)" → "**Hare(s):** …" →
"**Location:** …" → "**Comments:** …" → "**Fees:** normal fee".

**Gotchas:**
- **Year-less date headings** → infer year from a reference `now` (forward Saturdays; +1 across Dec→Jan). UTC noon.
- **Seasonal default start time** stated in prose ("depart 3:00 pm Oct–Feb / 3:30 pm Mar–Sep") but the per-run
  "Departure:" string is authoritative and overrides it.
- **Tagalog placeholder hares** — `"Walang Hare!"` means "No Hare!" (no hare assigned). Treat as no-hare; don't let
  it (or a "Comments" theme like "The Secret Hash!") become the event `title`.
- **Scope to the REGULAR RUNS block.** The same page carries a men-only unnumbered "BLOOD RUN" (last Wed/month),
  a suspended "HASH HIKE", a "2027 NASH HASH" blurb and a "SPECIAL RUNS: Watch this space…" placeholder — all of
  which must be excluded or they leak as events.
- **No per-event coords / informal venue names** ("Away", "Fug Nose") → city-centroid fallback; don't geocode or synth.
- **Rolling forward window** (~5 runs) → source needs `config.upcomingOnly: true` (reconcile would false-cancel aged-off runs).
- **No standalone logo** — the header is a rotating banner photo; self-host a real logo only if the favicon/FB
  profile yields one (magic-byte ext), else leave blank. Don't treat the banner as a logo.

## Self-hosted static-HTML single-next-run hareline + Apache `/Photos/` autoindex archive (learned from Athens H3, 2026-09-03)

`athenshash.com` (Greece's oldest hash, founded 1978) is a classic hand-built static site (AI-generated
button/hero art under `Images/AI_Images/`, http-only). Two useful surfaces:

- **Forward source = a single "NEXT HASHING EVENT" block** at `Main_HTML/hareline.htm` (linked from
  `Main_HTML/upcoming-links.htm` as "Upcoming Runs"). One run only, labeled lines: `Date:` (playful,
  ordinal, **no year**, e.g. "Sunday 31st May – 11am-ish"), `Run:` ("2329-ish"), `Hare/s:`, `Venue:`,
  `On Inn:`, `GPS:` (a real decimal lat/lng pair + DMS), `MAP LINK:` (`maps.app.goo.gl`). 🔑 **The block's
  `<img src>` folder path encodes run# + date unambiguously** (`../Photos/R2329_260531_<Venue>/…` →
  `R<run>_<YYMMDD>`) — parse that first; treat the "-ish"/ordinal text as a fallback. Single-block →
  `config.upcomingOnly:true` + fail-loud zero guard (North Hants/Tamar/Warwick pattern).
- **Backfill = the Apache `/Photos/` autoindex itself** (directory listing enabled). Every run has a folder
  `R<run>_<YYMMDD>_<Venue-with-dashes>` (Athens: **915 folders, `R1161_000715` 2000 → `R2331_260614` 2026**;
  runs #1–#1160 pre-2000 are not archived). The folder-name list IS a machine-readable run archive
  (run# + date + venue; no hares/coords). 🔴 Variants: a **`ph<YYMMDD>_R<run>_…`** prefix form also occurs,
  and **multi-part folders share one run#** (`R2327_…_Saturday-Run` + `_Walk`; `R1472_…-1` + `-2`; island
  weekends) → match run#/date by token (not position) and **dedup by run#**. Dates are all `20YY` → build
  UTC noon directly. Freeze the curated JSON + dumb loader (H7 pattern); don't commit the parser.

- **`web_fetch` returns EMPTY on the hero/menu + run-map hareline pages** (no extractable innerText — the
  content is images + short labeled lines the text-extractor collapses), but the pages ARE SSR and render
  in a real browser. Use the in-app browser to read them at research time, and `fetchHTMLPage` (raw markup)
  — NOT the text-extractor — in the adapter. Text-bearing pages (About, otherhhh) `web_fetch` fine.
- **Seasonal kennel (documented summer break Jun–Aug)** → 0 upcoming in the off-season is expected; the
  hareline lags on the last spring run until the autumn restart. Onboard on the Step 3 recently-active rule
  using the `/Photos/` autoindex mtime + folder dates as the cadence evidence; the daily scrape picks up the
  restart run automatically. UNVERIFIED-until-build: the exact autumn hareline layout may differ slightly —
  Claude Code confirms the live DOM.

---

## Self-hosted WordPress "umbrella" — multiple single-current-run PAGES via WP REST `pages/<id>`, one page per sibling kennel (Laos HHH / hashlaos.com, 2026-09-04)

`hashlaos.com` (**WordPress 6.9.7**, Spacious theme) is the umbrella for **three Vientiane kennels** — VH3
(Monday Town Hash), VBH3 (Saturday Bush Hash), and the Monthly Bicycle Hash. Distinct from the Bombay H3 shape
(*several* runs stacked on ONE page) and the Hanoi/Manila shape (ONE kennel on ONE page): here there is **one
WP `page` per kennel, each carrying that kennel's single current run**, hand-overwritten weekly.

- **Runs are in PAGES, not posts.** `wp/v2/posts` holds a single static "About VH3" blurb (id 2430). The run
  data lives in three pages, each fetchable **without auth** via plain `web_fetch`:
  `GET /wp-json/wp/v2/pages/<id>?_fields=content,modified` → `content.rendered` HTML + a `modified` timestamp.
  Page ids: 78 (`monday-map` → VH3), 22 (`saturday-bush-hash` → VBH3), 26 (`monthly-bicycle-hash` → Bicycle).
  The same blocks SSR at the page URLs (`/monday-map/` etc.) as a fallback if an id ever changes; the page
  **slug** is a stable alternate (`/wp-json/wp/v2/pages?slug=<slug>`).
- **`modified` + revision count = the recently-active signal.** All three pages showed `modified` = the prior
  day with 200–700 revisions each (weekly overwrite). For a single-current-run block this is the reliable
  liveness proof — treat it like Dhekelia's `modified`/revision-count evidence.
- **Adapter is config-driven page→kennel routing** (one adapter, one Source row, `kennelCodes: [all three]`):
  `config.pages = [{ pageId, slug, kennelCode, defaultStartTime, hasRunNumber }]`. This satisfies the
  sibling-sweep rule (don't ship a source that quietly carries siblings) in a single handoff.
- **Facebook copy-paste soup in the markup.** Page 78's `content.rendered` is wrapped in nested Draft.js /
  Facebook divs (`_2cuy _3dgx`, `kvgmc6g5 cxmmr5t8 …`) but the run data is in clean `<p>` tags inside — a
  Cheerio `.root().text()` collapse extracts it fine; **do not** try to key on the FB class names.
- **Dates: NO year + a Laos `##` quirk.** Blocks read `"Saturday 05# September"`, `"27 # SEPTEMBER"`,
  `"the 7th of September"`. Normalize `#`→space, extract day+month (loose regex + chrono/month-map to dodge
  S5843), **infer the year with Dec→Jan rollover**, UTC noon.
- **Start times are am/pm-ambiguous.** VH3's `"A2A 5:30 departure"` has no am/pm and is really 17:30 → use a
  per-kennel config default (VH3 17:30 / VBH3 17:00 / Bicycle 09:30) and only trust an explicit am/pm time.
- **Hares tri-state.** `"X is the Hare"` / `"hare is X"`; `"????"` / `"we need a hare"` → `null` (clear);
  label absent → `undefined`.
- **Coords: at most one page has a Maps link** (VH3's `maps.app.goo.gl` **shortlink**) → best-effort resolve
  the redirect, else geocode the venue text / metro centroid. No repeated default pin → no default-pin trap.
- **No archive → `config.upcomingOnly: true` + zero-row fail-loud guard.** Pages hold only the current run
  (overwritten weekly → past runs age off → reconcile would false-cancel); revisions are WP-default
  auth-gated → no backfill. A brand-new source's health baseline is 0, so `if (events.length===0) errors.push(...)`.
- **PII:** GM emails + mobile numbers appear in the blocks — read run fields only, strip contacts.
- Reference adapters: `bombay-hash.ts` (WP page content, upcomingOnly, per-run + zero-row fail-loud),
  `hanoi-h3.ts` (single-current-run WP page). UNVERIFIED-until-build: exact block phrasing may drift week to
  week — Claude Code confirms the live `content.rendered` at implementation time.

## Self-hosted WordPress — hand-maintained forward schedule `<table>` PAGE, blog/REST posts dead (learned from Grenada H3, 2026-09-06)

A distinct self-hosted-WordPress shape (vs the Creek H3 flexslider "This Week's Meet Point" and the Laos
per-page-per-kennel patterns above): the **blog is dead** (Grenada's `/wp-json/wp/v2/posts` "Hash Diary"
category has only ~8 recap posts, newest 2019-03), but the club keeps a **static WordPress *page* with a
forward schedule `<table>`** that is edited in place. Two surfaces:

- **`/schedule/`** — a plain WordPress content `<table>` (cols `Date | Hash No | Hares | Location | Extra Info`)
  listing ~6 months of forward runs (Grenada: 29 rows, #1414 → #1442, weekly Saturday). This is the canonical
  **forward feed** — scrape it.
- **`/next-hash/`** — a single-run **detail page** (venue, Google Maps shortlink, arrive/On-On time, food,
  drinks, hares, hash cash) for the *imminent* run only.

Gotchas:
- **The pages are current even though the blog is dead.** Prove liveness via `article:modified_time` in the
  page `<head>` (Grenada `/schedule/` = 2026-07-25, `/next-hash/` = 2026-08-31), NOT the blog `article:modified`
  (2019). Do **NOT** conclude "stale" from the dead blog archive or the `Archives` widget's last month.
- **Scrape the page HTML, not WP REST.** The runs are in page markup, not `posts`/`pages` REST JSON worth
  parsing — `fetchHTMLPage` + Cheerio over the `<table>` is the path.
- **Schedule table = tentative PLAN; next-hash = confirmed for the imminent run.** They can disagree on
  hares/venue for the same run# (Grenada #1415: table "Frank / Mt Airy" vs next-hash "Bloody Mary & Rum Runner
  / Ahoma"). Prefer the schedule table as the single canonical feed (all forward runs, self-corrects on each
  scrape); treat next-hash as **optional** enrichment for the one imminent run (match by run#) — don't dual-emit.
- **`config.upcomingOnly: true` REQUIRED** — the schedule table is a rolling window (past rows drop off) →
  reconcile would false-cancel. Plus a **`rows.length === 0` fail-loud guard** (single-page/single-table; a
  brand-new source's health baseline is 0, so a markup drift must surface as an error, not `events: []`).
- **Dates are `DD Mon YYYY` (year-bearing)** → `chronoParseDate` → UTC noon; no year inference needed.
- **`Extra Info` column** carries event themes ("Halloween Hash", "Red Dress Hash", "Carriacou Hash") → map to
  `description`, NOT `title` (leave title undefined → `merge.ts` synth).
- **Blank/`TBA` cells** (Grenada had `location: "TBA"` and 2 fully-blank future rows) → `undefined`, don't synth.
- **No coords in the table** (place-name venues only) → kennel centroid fallback; only the next-hash page has a
  Maps shortlink (1 pin, no default-pin trap). http-only WP asset URLs → Sonar S5332 (mark the 2–3 real literals SAFE).
- Reference adapters: `dublin-hash.ts` (thin table parse), `burlington-hash.ts` (Sonar-safe terminators),
  `nswhhh.ts` (cell cleaning). UNVERIFIED-until-build: web_fetch returns rendered markdown, so the exact
  `<table>` markup (thead/tbody, td count) must be captured live before writing the fixture.

## Self-hosted static-HTML "Upcoming Runs" page + JS-populated stats archive (Puerto Galera H3, `pgh3.org`, 2026-09-08)

A hand-rolled static HTML site (HostGator-hosted; multi-page, header/footer template) where the **forward
hareline is fully server-rendered** but the **statistics/archive pages are JavaScript-populated**. Two distinct
behaviours on the same site:
- **`/upcoming-runs.html` (and `/index.html`) are SSR** — a plain `fetchHTMLPage`/`web_fetch` returns the full
  forward run list. Each run is a `Saturday <Month> <Dayordinal>` heading (NO year) followed by labeled lines
  `Run <N>` / `Departure: <H:MM am/pm>` / `Hare(s): <…>` / `Location: <…>` / `Comments: <…>` / `Fees: <…>`.
  This is the adapter's forward source (`config.upcomingOnly: true` — rolling window; + `rows.length === 0`
  fail-loud guard).
- **`/run-list.html` is a JS-populated `<table>`** ("Runs since August 2008") — SSR returns the header row and
  an **empty tbody**; a plain fetch sees no rows. `/run-list.json` at the obvious path is empty/404. For a
  backfill you must inspect the page's `<script>` for the real data URL (a `.json`/`.js` array or a per-run
  detail endpoint) or use browserRender. **Do not conclude "no history" from the empty SSR table** — the
  archive exists, it's just client-rendered.
- 🔴 **Tagalog / joke placeholders** (Philippine hashes especially): `"Walang Hare!"` = Tagalog for **"No
  Hare!"** (hare not yet assigned) — map to **no hares**, never emit as a hare name. Placeholder locations
  like `"Fug Nose"`, `"Away"`, `"TBA"` (recurring gags — "The Secret Hash!") → pass through verbatim or
  `locationOmitIfMatches`; never synthesize a venue or let them become the title.
- Dates NO year → strip ordinal suffix, infer year (Dec→Jan rollover), UTC noon; startTime from the per-run
  "Departure" line (seasonal 2:30/3:00pm handled automatically because it's read per-run, not from the flat
  schedule). Reference adapters: `dublin-hash.ts`, `burlington-hash.ts`, plus the Athens/Nicosia/Grenada
  single-page current-run parsers. UNVERIFIED-until-build: capture the real `upcoming-runs.html` DOM
  (`curl -s`) before writing the fixture — web_fetch returned rendered markdown, so heading level and
  `<strong>`/`<br>` delimiting of the labeled lines are unconfirmed.

#### City of Exeter H3 addenda (researched 2026-09-09) — Blogspot RECAP blog whose FORWARD source is an embedded Google Calendar

A common UK pattern: the Blogspot is a **recap** blog (posts appear day-of/after each run, so it is
never a source of *upcoming* runs), but the club maintains its schedule on a **Google Calendar
embedded on a "Upcoming hashes" / "Hash diary" page**. This makes the onboarding the ONH3 split:
**config-only GOOGLE_CALENDAR for the forward hareline + a one-shot Blogspot backfill for history** —
NOT a bespoke Blogspot adapter (unless the GCal turns out empty at build).
- **Find the calendar id in the embed URL:** the "Upcoming hashes" page embeds
  `calendar.google.com/calendar/embed?...&src=<BASE64>&ctz=Europe/London`. The `src=` value is the
  **base64 of the calendar id** (an email). e.g. `Y2l0eW9mZXhldGVyaDNAZ21haWwuY29t` → decode →
  `cityofexeterh3@gmail.com`. Put that email in the GCal source `url` (mirror the EWH3 row shape).
- **🔴 The public `.ics` (`/calendar/ical/<id>/public/basic.ics` or `/full.ics`) returns an EMPTY
  body via the research sandbox's `web_fetch`** (machine-readable calendar bodies are stripped here —
  same class as the allowlist `.ics`/JSON limitation). This is NOT evidence the calendar is empty →
  flag `⚠️ Claude Code must confirm at build` (API v3 with the key, or the ICS), don't block. The
  *embed's existence* + a currently-edited recap blog is sufficient liveness evidence to hand off.
- **Recap-blog recency nuance:** the newest recap can lag the actual runs by weeks (volunteer scribe /
  summer lull). Judge liveness from the embedded forward GCal + the blog `feed.updated` + the newest
  post's "next week we're at…" line, not from the recap date alone. Confirm the GCal at build.
- **Backfill format drift (City of Exeter, 2008→2026, ~1,079 posts):** title format CHANGED over the
  archive — recent `#<run> <Location> - <Hares> - <DD Month YYYY>` (run# + year present) vs pre-2010
  `<Dordinal> <Month> - <Location> - <Hares>` (NO run#, NO year → take year from `published`). The feed
  also carries **non-run noise** (announcements, YouTube links, "Autumn Gathering", "THIS SUNDAY…"
  reminders) that must be filtered, and `published` ≠ run date (write-ups post days late; same-day
  double-posts happen). Parse the run date from the title; leave `runNumber` undefined for the
  pre-numbering era. Reference: OFH3 / Brasília Blogspot adapters + `fetchBloggerPosts`.

## WordPress.com free site — Jetpack "Upcoming Events" widget as the forward hareline (learned from Cebu H3, 2026-09-10)

Some hash clubs on **WordPress.com-hosted free sites** (`*.wordpress.com`, `meta-generator: WordPress.com`)
publish their forward schedule through the built-in **Jetpack "Upcoming Events" widget** rather than a
blog, a table, or an events plugin (free WordPress.com can't run arbitrary plugins). The widget renders
**server-side** into every page's sidebar/footer as a list of events, so a plain `fetchHTMLPage` +
Cheerio scrape works (NO browserRender). Reference: Cebu H3 (`cebuhash.wordpress.com`), an active weekly-
Sunday kennel whose homepage "Upcumming Events" block listed `Hash #` 13/20/27 Sep 2026.

**Structure (Jetpack widget convention — ⚠️ confirm the real markup before writing the parser):**
- A `ul.upcoming-events` with one `li` per event; children typically `span.upcoming-event-title`,
  `span.upcoming-event-date`, and (for timed events only) `span.upcoming-event-time` /
  `span.upcoming-event-location` / `span.upcoming-event-summary`.
- `web_fetch` renders the widget as a flat markdown list, so the exact tag/class structure is
  **UNVERIFIED from the sandbox** — `curl -s <site> | grep -i upcoming` at build and pin the fixture
  to the real DOM (per the platform-notes UNVERIFIED rule).

**The widget is iCal-backed but the iCal URL is NOT exposed.** Jetpack's "Upcoming Events" widget reads
a public iCalendar feed configured in **widget settings**, which do not appear anywhere in the page
HTML. So you generally **cannot** turn this into a config-only ICAL_FEED without admin access — treat a
bespoke SSR scrape of the rendered widget as the default. (If a club *also* publishes the same Google
Calendar/iCal publicly elsewhere, prefer config-only ICAL_FEED — but don't assume it's discoverable.)

**Data richness is often thin — recurring "placeholder" run entries + detailed special events in the
same list.** The widget mixes two VEVENT shapes:
- **All-day placeholder runs** — e.g. `Hash #` with a **date only** (no run number, hares, venue or
  time; those details are posted to the club's Facebook group, not the site). These are the actual
  trails → emit date + synth title (`merge.ts` → `"<Kennel> Trail"`, no `#N` since there's no run #),
  no coords → kennel centroid fallback.
- **Timed special events** — committee/"Mismanagement" meetings, AGMs, socials — carry a time range +
  venue + summary. These are **NOT runs** → the adapter MUST **filter them out** (match the run title,
  e.g. `/^Hash\b/`, and drop everything else). A mis-filter ships a Friday committee meeting as a trail.

**Handling:** dates are year-bearing (`"13th Sep 2026"`) → strip the ordinal (`st|nd|rd|th`) and hand to
`chronoParseDate` → UTC noon. `config.upcomingOnly: true` REQUIRED (rolling forward window ages events
off; without it `reconcile.ts` false-CANCELs them). Single-widget source → **fail-loud
`rows.length === 0` guard** (a widget re-skin/removal otherwise "succeeds" with `events: []`/`errors:[]`
and the zero-event alert never fires for a baseline-0 new source). NB the "Hash Stats" page on such
sites is usually **published Google Sheets of hasher A–Z / attendance lists** (`/pubhtml?gid=N`), NOT a
dated run log — not a backfill source. Reference: Cebu H3 handoff `handoffs/2026-09-10-cebu-h3.md`;
mirror `muscateers` (WordPress.com SSR) + `dublin-hash.ts` for the parser shape.

---

## WordPress + "The Events Calendar" plugin (Tribe REST / iCal) — config-ish forward source (UNVERIFIED end-to-end — no live onboard yet)

Discovered on `bahrainhash.com` (2026-09-12 discovery pass; the kennel itself was BLOCKED-stale, so
this pattern has NOT yet been used in a shipped adapter — treat as a lead, confirm at build).

Many WordPress hash sites run the **"The Events Calendar" (Modern Tribe)** plugin. Tells in the page
`<head>`: `meta-tec-api-origin` / `meta-tec-api-version` (and often `et-api-*` from Event Tickets).
When present, the site exposes a **public REST endpoint** that is far cleaner than scraping the
JS-rendered calendar/hareline widgets:

- **REST:** `https://<host>/wp-json/tribe/events/v1/events?per_page=N&start_date=YYYY-MM-DD 00:00:00&end_date=YYYY-MM-DD 23:59:59`
  - Returns `{"events":[…],"total":N,"total_pages":N}`. Each event carries `title`, `start_date`
    (local) + `utc_start_date` + `timezone` (e.g. `Asia/Bahrain`), `end_date`, `venue` (name/city/
    country/address), `organizer[]` (often the **hares**, e.g. `"Spanks The Turkey + Just Ben"`),
    `cost`, `url`. Run number is usually only in the `title` (`"BH3 #2770 – Memorial Day"`).
  - **Default filter is future + `status=publish`.** To sample history, pass a past `start_date`.
  - **Empty result is authoritative 0-events evidence** (`{"events":[],"total":0}`) — capture it verbatim
    for a "stale/0-upcoming" claim.
- **iCal:** The Events Calendar also serves `https://<host>/events/?ical=1` (all) and per-view/per-category
  iCal — if populated, that's a config-only `ICAL_FEED` path (HEAD-check `content-type: text/calendar`).

**🔴 The plugin being installed does NOT mean the calendar is maintained.** On `bahrainhash.com` the
Tribe REST worked but held only **6 events, all May–Jul 2024** (0 upcoming); the club had moved live
scheduling to WhatsApp/FB while the WordPress **homepage next-run block (Elementor)** was hand-edited
to a later run and the `/hareline/` page auto-touched its `modified_time` — i.e. a cosmetically-fresh
`article:modified_time` on a hareline page can hide a dead event pipeline. **Always confirm recency via
the Tribe REST/iCal event dates themselves, not the page's modified_time or a hand-edited Elementor
block.** If Tribe REST returns current dated events → near-config-only (a small Tribe-REST adapter, or
ICAL_FEED if the ical view is populated); if it's empty/stale → the site is FB/WhatsApp-driven, BLOCK
as stale. Reference: 2026-09-12 run-log entry (Bahrain H3 blocked-stale).

## Blogspot / Blogger — forward "Hareline" TABLE embedded inside a single post (distinct from per-post recaps)

Most Blogspot H3 sources are one-run-per-post (recap prose parsed via `fetchBloggerPosts`, e.g. OFH3,
Chiang Rai). **Subic Bay Hash** (`subicbayhash.blogspot.com`, 2026-09-16) is a different shape worth
recognizing: the **forward schedule lives as an HTML `<table>` inside a single recurring post titled
"Hareline"** (columns `Run# | Date | Hares | Venue | Att. | Total`), re-published roughly monthly.
Per-run **"Run NNNN"** posts are separate recaps carrying DMS start + on-home coords + confirmed
hares, and **"Hashstats YYYY"** posts are attendance tables (real member NAMES — PII; never emit).

Recipe: `fetchBloggerPosts` → pick the **latest** post whose title === "Hareline" → Cheerio-parse its
`<table>` → each row is a forward event. Gotchas confirmed on Subic Bay:
- **Dates are `M/D` with NO year** → infer year from the Hareline post's `publishOn`, with a Dec→Jan
  rollover guard.
- **No coords / no startTime in the table** → kennel-centroid fallback + kennel-default start time.
  Coords only exist in the separate "Run NNNN" recap posts (DMS; use `parseDMSFromLocation`).
- **Blogger feed `openSearch$totalResults` ≠ run-number depth** — Subic Bay is on run #1723 but the
  blog only holds 190 posts back to Run 1622 / Oct 2024 (created recently); #1–#1621 are historical,
  NOT archived on the source. Always read `openSearch$totalResults` + walk `start-index` for true depth.
- **`config.upcomingOnly: true` required** — the Hareline is a rolling forward window; recaps age out.
- Bespoke adapter needed (~150–220 LoC) — no existing adapter parses a table-inside-a-post.
Reference: `handoffs/2026-09-16-sbh3-ph.md`.

## WordPress — in-place "next run" *pages* (edited each week, not dated posts) — Laos HHH

Some self-hosted WordPress kennels publish the **current run on a static Page that is edited in place**
each week, rather than as dated blog posts. `wp-json/wp/v2/posts` returns little or nothing (Laos HHH:
one static intro post); the live data is on **Pages** reachable at
`/wp-json/wp/v2/pages/{id}?_fields=id,slug,modified,content`. Each page's `content.rendered` holds the
current run as free-text prose, and `modified` is a reliable **year-inference anchor** (dates in the body
carry no year). Confirmed on `hashlaos.com` (WordPress 6.9.8), which runs THREE kennels off three pages —
`/monday-map/` id 78 (VH3), `/saturday-bush-hash/` id 22 (VBH3), `/monthly-bicycle-hash/` id 26 (Bike).

Recipe: one adapter, N pages → N kennels. Per page: `safeFetch` the wp-json page JSON →
`cheerio.load(json.content.rendered).text()` (flatten — page 78 is Draft.js-style nested `<div>`s, page 22
clean `<p>`, page 26 `<h2>/<h3>`; DON'T depend on selectors) → regex the flattened text. Gotchas confirmed:
- **One current run per page (the "next run" pattern)** → `config.upcomingOnly: true` REQUIRED (else
  reconcile false-CANCELs last week's run) + a fail-loud zero-row guard (single-block source).
- **Dates carry no year and drift in format** across sibling pages: `"the 14th of September"` (ordinal+"of"),
  `"19# September"` (number+`#`), `"27 # SEPTEMBER"` (spaced `#`, ALL-CAPS). Normalize (strip `#`/ordinals/"of",
  collapse spaces), match day + a month via an **EN month-map + validator** (NOT a 12-way alternation — Sonar
  S5843), then infer year from `json.modified` with a Dec→Jan rollover guard.
- **No coords / times sometimes absent** — locations are `goo.gl/maps` **shortlinks** (redirects, not lat/lng)
  → capture as `locationUrl`, fall back to the metro centroid; per-kennel default start times.
- **Run number formats vary:** `Run #NNNN` vs `Hash-run no. NNNN`; some pages (bike) have none → undefined.
- **History = 0 on this source** despite high run numbers (pages edited in place; history only as WP
  revisions). No backfill. Run-number ≠ archive depth.
- **PII:** GM emails/phones appear in the page body — keep them out of seed + diagnostics.
- Bespoke adapter (~220–300 LoC) — no existing adapter parses a free-text single-run WP page.
Reference: `handoffs/2026-09-20-vh3-la.md`.

## Bespoke WordPress "hash-stats" apps (JS/admin-ajax run DB) — UNVERIFIED endpoint pattern (2026-09-25, Hanoi Hash)

Some long-running kennels run a **custom WordPress + Elementor stats site** ("by VD"-style: menu of
`/runs/`, `/hashers/`, `/stats/`, `/cash-list/`, `/compare/`, `/wankers/`, `/in-memoriam/`). Observed on
`hanoihash.com` (the original Hanoi Hash).

- **The run archive + forward "This week's run" / "Coming up" are client-rendered — EMPTY in SSR HTML.**
  A plain `web_fetch`/`curl` of `/runs/` returns only the page chrome (nav + copyright), no rows.
- **No custom WP REST namespace.** `/wp-json/` lists only `wp/v2`, `rankmath/*`, `elementor/*`,
  `indexnow`, `oembed` — so the data is NOT at a discoverable `/wp-json/<plugin>/…` route. It is served
  via `admin-ajax.php?action=…` or a bespoke PHP endpoint, discoverable only by watching the network
  tab while `/runs/` hydrates (browserRender/Chrome). ⚠️ **UNVERIFIED — confirm the exact endpoint at
  implementation time.**
- **The WP posts blog (`/wp-json/wp/v2/posts`, "Run Reports"/"News" categories) can be STALE while the
  stats app is live.** On Hanoi Hash the newest Run-Report post is Hash #1728 (Sep-2024); the run log
  moved into the stats app. So a stale WP blog is NOT evidence the kennel is dormant — check the stats
  app itself for recent activity. Conversely, do not treat the WP blog's recap posts as the run feed.
- **`/stats/` can time out** (loads the whole DB) — probe `/runs/` for the lighter data request.
- Founding year is usually NOT on the About page (generic Mother-Hash lore); look in the stats app,
  "In Memoriam", or anniversary/milestone runs.

---

## WordPress hand-built "run info" page (hareline table + per-run label/value tables) — VERIFIED (Nuremberg H3, 2026-10-06)

Some kennels run a plain WordPress site (not The Events Calendar / no `tribe` namespace) whose **one
`/run-info/` page** is hand-edited in place each week and carries the *complete* hareline. Nuremberg H3
(`nuremberg-h3.de`) is the reference. VERIFIED via `wp/v2/pages?slug=run-info` → `content.rendered` tag
inspection on 2026-10-06.

- **Fetch machine-readably via WP REST:** `GET /wp-json/wp/v2/pages?slug=run-info` → `[0].content.rendered`
  (clean ~30 KB HTML; `[0].modified` tells you how fresh it is). Prefer this over a raw GET of the page
  (raw GET can be slow / anti-bot). Confirm `wp/v2` exists and there is **no `tribe`** namespace via
  `GET /wp-json/` (`.namespaces`) — if `tribe` is present, use the config-only TEC/iCal path instead.
- **The page mixes THREE block shapes, all Gutenberg `<figure><table>`:**
  1. **"Next run" / "Upcoming runs"** — a **2-column label/value** table: `<tr><td>Number</td><td>…</td></tr>`
     with rows `Number` (→ `NH3 Run #NNN – <theme>`), `Description`, `Hare`, `Date`, `Time`, `Venue`,
     `How to get there`, `Google Maps`.
  2. **"Hareline (scheduled runs) – <YEAR>"** — a **3-column** table: header `Date | HARE | LOCATION`, rows
     `"October 10th, 2026 (Saturday)" | <hare>(+sub-note on <br>) | <location>`. **No run number, no time.**
  3. **"Old runs"** — a run of the same 2-column label/value tables (one per past run), descending.
- **Join strategy:** forward events = current-year hareline-table rows (date ≥ today) ∪ the Next/Upcoming
  detail blocks; enrich a table row from a detail block **by matching date** (that's where run#, time,
  Maps URL, description live). Table-only rows get `undefined` run#/title (let `merge.ts` synth) and a
  default time from source config.
- **Date formats to expect on one page:** `"October 10th, 2026 (Saturday)"`, `"July 11th 2026"` (no comma),
  `"February 9th, 2025 (Sunday)"`, German numeric `"30.11.2024"`, and ranges `"July 25-27th 2025"` /
  `"December 19+20th 2025"` (→ primary date). Strip ordinals + `(Weekday)` before `chronoParseDate`.
- **Placeholders to skip for hare/location:** `Cancelled`, `Not scheduled`, `TBA`, `TBD`, `–`.
- **Coords:** typically none — venues are place names + `maps.app.goo.gl` shortlinks → `locationUrl`; fall back
  to kennel centroid (no default-pin trap).
- **Cross-platform caveat (Harrier Central):** the same kennel may ALSO be on `hashruns.org` (HC) but with
  **sparse coverage and WRONG run numbers** (Nuremberg: HC had ~40% of runs and labeled the website's #87 as
  "#85"). Treat the kennel's own `/run-info/` page as canonical for run numbers; use HC only as a lat/lng
  cross-reference, never as the run-number source.

## `dupee.xyz`-generated club `.ics` — a REAL `text/calendar` feed that is NOT config-only ICAL_FEED (learned from Chichester H3, 2026-10-11, VERIFIED via web_fetch)

Some long-running UK club sites (Chichester HHH, `chihhh.org.uk`) are plain SSR PHP with a **"SUBSCRIBE TO
CALENDAR" link that serves a genuine `.ics`** — but the calendar is generated by a bespoke backend
(`dupee.xyz`), and its field packing defeats the stock `ICalAdapter`. VERIFIED 2026-10-11: `GET
https://www.chihhh.org.uk/diary` (redirects `/diary/`) → `Content-Type: text/calendar; charset=utf-8`,
`PRODID:-//Chichester HHH …`, 75 VEVENTs, a rolling ~2-year window (past + future).

- **It LOOKS config-only but is NOT** (the SACH3 "earn the claim" trap, inverted — here the feed is real but
  the *structure* is wrong). The stock `ICalAdapter` handles fetch/validate/date-window/run#-from-description,
  but this feed needs a small enhancement for all the user-visible fields:
  1. **SUMMARY packs `<hares>␠␠<OSgrid> <venue>`** with **no colon and no `#` run marker**, e.g.
     `"Old Faithful and Bambi  SU752074 Westbourne Ems Valley Memorial Arboretum"`. `parseICalSummary`'s title
     regex needs a `…:` / `Prefix:`; with none it falls through and makes the WHOLE summary the title (ugly).
     Fix: split on the first OS grid-ref token `/\b[A-Z]{2}\d{6}\b/` → hares (prefix) + venue (suffix), leave
     `title` undefined (merge synthesizes `"<Kennel> Trail #N"`). Drop `"???"` / `"& ???"` / `"Please volunteer"`
     / `"TBA"` hare placeholders.
  2. **No `LOCATION` field** — the venue is ONLY in the SUMMARY (above). `locationPatterns` (DESCRIPTION-based)
     won't find it; the DESCRIPTION is just `DETAIL=…/trash<UID> <br>MAPS=https://dupee.xyz/maps.php?p=<gridref>`.
  3. **Coords live in the `URL` property as `https://maps.google.co.uk/maps?q=loc:LAT,LNG`.** The adapter's
     `MAPS_URL_PATTERN` matches only `maps.google.com` / `.app.goo.gl` / `goo.gl/maps` — **NOT `.co.uk`** — so
     `resolveLocationUrl` never routes it. Widen the pattern to `maps.google.co.*` OR parse `?q=loc:` directly.
  4. **Placeholder coords `loc:00.000000,-0.000000`** on not-yet-scheduled (TBA) future runs → MUST reject
     `0,0` (and `dropCachedCoords:true` if ever persisted).
- **Run number IS config-recoverable:** the `#NNNN` isn't in the SUMMARY, but the DESCRIPTION carries
  `…trashRun 1094 <br>…` (and the UID is `"Run 1094"`). `runNumberPatterns: ["Run (\\d+)"]` matches the
  description. Non-numeric UIDs exist (`IOW4`, `WWH3`, `1081a` for visits/specials/split days) → leave run#
  undefined for those; guard a malformed multi-day `DTSTART:20250307to10` (non-ISO).
- **Rolling window → `config.upcomingOnly: true` REQUIRED** (feed drops old runs as new ones are added;
  without it `reconcile.ts` false-CANCELs the aged-off events). The `.ics` reaches back ~2 years; deep archive
  (to the club's founding) lives on a separate `runstodate.php` full-list page + a "Hash Trash" archive.
- **Source-pivot signal:** Chichester was queued as a Harrier Central lead, but HC was a sparse mirror (0
  upcoming + a single reachable away-weekend run) while the club's own `.ics` had the full fortnightly schedule
  + 4 upcoming. When a UK club's HC listing looks thin, check the club's own site for a `/diary`-style `.ics`
  first (Devon-Lunatics / Nuremberg pattern). Reuse the shared `ICalAdapter` + new opt-in config flags rather
  than a bespoke adapter — the `dupee.xyz` format may recur across other South-Coast UK hashes.
- 🟡 **UNVERIFIED generalization:** the grid-ref split + `loc:` parse above are confirmed against Chichester's
  live feed, but the "other dupee.xyz hashes share this exact shape" claim is a hypothesis — confirm against a
  second feed before treating the config flags as a stable shared pattern.

### Harrier Central — the `isFuture=0` past feed finds recently-active kennels the future bench misses (learned from SUNH3, 2026-10-30)
A future-only sweep (`global-runs?isFuture=1`) enumerates only kennels with an **upcoming** run posted.
A live kennel on a longer cadence (monthly / full-moon) often has **0 upcoming between postings**, so it
is **absent from the future bench entirely** yet is genuinely recently-active. **Shenanagains Under
Nightfall (SUNH3)**, Raleigh NC — a monthly full-moon night hash — was invisible to the 2026-10-29
future-only sweep but surfaced immediately on `global-runs?isFuture=0` with a run 4 days old
(#10 "Hunter's Moon Trail", 2026-10-26). **When the future bench looks exhausted, sweep the recent
`isFuture=0` window too** (last ~6–8 weeks) and dedup the distinct `KennelSlug`s vs the sitemap — that is
where the long-cadence uncovered kennels live.
- **Full-moon run names are the cadence proof.** Consecutive full-moon event names (Strawberry=Jun,
  Buck=Jul, Sturgeon=Aug, Harvest=Sep, Hunter's=Oct, Beaver=Nov) + monotonic `EventNumber` establish a
  clean monthly cadence from just a few sampled rows — satisfies the Step 3 recently-active evidence bar
  without a full history pull. (Still treat `foundedYear` inferred from the run-# sequence as LOW
  CONFIDENCE — leave blank unless a milestone/kennel post confirms.)
- **`global-runs` is future-vs-past, PortalApi is future-only.** The adapter's HC `getEvents` PortalApi
  returns **future** events only; the **past** runs for a backfill come from `hashruns.org/api/global-runs?isFuture=0`
  filtered to the `publicKennelId`. So a monthly HC kennel still needs `config.upcomingOnly:true` + a
  `scripts/backfill-<code>-history.ts` (same Moonshine/ONH3 contract).
- **WebFetch truncation when the sandbox has no raw-fetch path.** Unattended (no Chrome approval, cloud
  proxy + device-VM both 403 `hashruns.org`), the only read is **WebFetch rendering the JSON**, which caps
  each response to the window's most-recent slice. To enumerate one kennel's full history, **step
  `maxEventDate` backward** window-by-window (e.g. Oct→Sep→Jul→Apr) and extract only that kennel's rows
  each pass; a complete single-pull is not possible that way — flag the full enumeration for Claude Code
  (which can raw-fetch + paginate) at build.

## Half-Mind (rebuilt 2026) as a bulk discovery oracle — VERIFIED (Music City H3 run, 2026-11-06)

- `half-mind.com` returns HTTP 406 to curl, but the **built-in browser** works. From a half-mind.com tab, a same-origin
  `fetch('/regionalwebsite/p_list1.php?ALL=&category=fixed&region=&country=&HASHCLUB=<name>&LOCATION=&showdead=AliveOnly&CONTACT=')`
  returns the server-rendered results page. `HASHCLUB` blank with `region=USA` gave **548 listings (~4 MB)**. They
  covered the whole Americas, not only the USA, so treat `region` as loose.
- Parse in-page with `DOMParser`. Each listing has a `Direct Link` anchor. Walk up to the ancestor whose text contains
  "Usual schedule" to get name, `Current State: Alive and Verified|Alive|UNKNOWN`, `Location …` and website links.
  Don't walk further up: the next ancestor is the whole list, and the result blows past the tool output limit.
- Single-listing queries (`HASHCLUB=<name>`) also return the **Details** block (schedule prose, hash cash, adults-only
  policy), **First Hash (DOB)**, **Parent Hash**, the "Last verified … Evidence: …" line, and the listing number to cite.
- Contact emails and phones are listed in plain text. **Don't copy them into handoffs** (PII), except as a
  `contactEmail` that the kennel publishes as its own club address.
- Workflow that found Music City: filter "Alive and Verified" + website → diff against the sitemap, seed and handoffs →
  `curl` each homepage and grep for `calendar/embed?src=`, `meetup.com/`, `.ics`, `tribe-events`, `hashruns`.
  Only a marker hit is worth a deep look.

## The Events Calendar (Tribe) — organizers can be the KENNEL, and archives carry bogus spans (Music City H3, 2026-11-06, VERIFIED via curl)

- On `musiccityhash.com`, Tribe `organizer` is `"MCH3"` (107×, last used 2018) plus a few cross-posted *other kennels*
  (Governators, Rocket Shitty, Savannah…). It is **not hares**, so `haresFromOrganizers` must stay off. Check the organizer
  names before copying the Dayton config.
- Archives can hold hand-entry errors such as a single Saturday run entered with a 29-day `end_date` (#982,
  2024-06-01 → 06-29). The adapter maps `endDate` for multi-day spans, so a backfill must clamp or drop implausible spans.
- `?start_date=2000-01-01&end_date=<future>&per_page=50&page=N` paginates the full archive (418 events, 9 pages here).
  The adapter's default `maxEvents` is 200, so raise it for backfills.

## Embedded Google Calendar — in-place-edited template series with STALE run numbers (learned from Hill Country H3, 2026-11-07)
- **Pattern:** some kennels keep ONE recurring "template" series (`FREQ=WEEKLY;INTERVAL=2;BYDAY=SA`, no UNTIL)
  and turn each instance into the real trail by editing it in place (a RECURRENCE-ID override). Every
  instance nobody has edited yet keeps the template's title, which carries a **stale run number**
  (`Hill Country H3 Trail #760 WARNO` repeated biweekly through late 2027). Google splits the series when
  "this and following" is edited (UID suffix `_R20270206T200000`), so the template UID changes over time.
- **`suppressICalUids` is the WRONG tool here.** The real trails are overrides that share the series UID, so
  suppression would drop them. **Use `futureHorizonDays`** sized just past how far the kennel actually
  curates (HCH3: real overrides ran 91 days ahead → 100). Verified via API `singleEvents=true`: real
  overrides and template instances share a summary prefix, and only the run number/theme differ.
- **The same staleness exists in history** (`#689` reused on ~15 consecutive 2024–25 runs; `#69` on every
  weekly run for 3 years). Any backfill from such a calendar must null run numbers that repeat across dates.
- **A multi-`src` embed can hide non-kennel calendars.** HCH3's iframe carries a second `src` that decodes
  to a "Phases of the Moon" calendar, and `nexthash.htm` adds Google's holiday calendar. Decode every `src`
  and read `X-WR-CALNAME` from each public ICS before picking the source.
- **Owner-personal entries** (`Fly to Chicago for CLT Meeting`, `Danielle in Rome`) and neighbor-kennel
  cross-posts sit on small-club calendars. Use anchored `kennelPatterns` + `strictKennelRouting: true`.
- Fetching the ICS with plain `curl` works on the desktop runner
  (`calendar.google.com/calendar/ical/<url-encoded id>/public/basic.ics` → 200 `text/calendar`), and so
  does the API with the owner's `GOOGLE_CALENDAR_API_KEY` (read-only from the owner's `.env`).
