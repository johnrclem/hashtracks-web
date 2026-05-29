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
- **Annual "Hareline YYYY" master posts** — one post containing a `<table>` of every run for the year (Run nr | Day | Date | Hare | Venue | Location). These arrive through the same posts list — route by title (`/^\s*hareline\s+\d{4}/i`) to a `cheerio` table parser; the merge pipeline dedupes table rows against per-post announcements by kennel + date. **Caveat:** only newer years use `<table>` — older "Hareline" posts may be a prose list, and those runs usually have individual announcement posts anyway.
- **Pagination:** `page=N+1` returns HTTP **400** (not 404) past the last page — treat 400 as a clean end. Only set a non-null `kennelPagesStopReason` on genuine truncation (a full page left unfetched / an HTTP or fetch error); a non-empty string suppresses stale-event reconciliation in `scrape.ts`.

**Detection:** WordPress.com hosting shows a `gravatar.com/blavatar/…` favicon and `meta-generator: WordPress.com` in the page `<head>`.

**Effort:** ~200–280 LoC per kennel (each kennel's title + body format is bespoke; the WP REST plumbing is trivial). Once 3–4 ship, factor a shared `WordPressComAdapter` base class taking a `parseTitle`/`parseBody` config.
