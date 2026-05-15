# sporty.co.nz WAF bypass spike — Phase 1.5 findings (resolved)

**Date:** 2026-05-15
**Targets:** Capital H3, Mooloo HHH, Geriatrix H3 (three NZ kennels publishing harelines on `sporty.co.nz`)
**Original verdict:** ❌ Phase 2 blocked on existing infrastructure.
**Resolved verdict (after 1.5-B stealth upgrade):** ✅ **All three pages render cleanly via `browserRender()` — Phase 2 unblocked.**

The initial round confirmed Cloudflare's "I'm Under Attack" / Bot Fight Mode was applied platform-wide to sporty.co.nz; every dynamic path returned the JS challenge regardless of headers, IP, or whether the request originated from a server-side Playwright session. The follow-up infra upgrade in **Phase 1.5-B** added `playwright-extra` + `puppeteer-extra-plugin-stealth` to the NAS browser-render service, plus a realistic Chrome 130 UA / 1440×900 viewport / `en-NZ` locale at the context level. Result: Cloudflare doesn't even gate the request — the challenge is never triggered, the page returns directly with the real HTML.

Live verification after deploy (`scripts/spike-sporty-co-nz.ts`):
- **Capital H3**: 108–111 KB real HTML, hareline (`2326 – 18 May 2026 – …` through `2330 – 15 Jun 2026 – Hare required!`) present in the response
- **Mooloo HHH**: 54–60 KB real HTML
- **Geriatrix H3**: 91 KB real HTML
- **NAS docker logs**: zero "Cloudflare challenge detected" entries on both runs — the stealth fingerprint passes CF transparently
- **Wix regression (Northboro)**: 475 KB real HTML, no regression on non-CF sites
- **Per-render time**: ~3–5 s (no puzzle solve needed)

---

## What we tested

### From the NAS render service / our backend (everything we tried)

| # | Strategy | Result |
|---|---|---|
| 1 | Plain `safeFetch` (default User-Agent) | 403 — Cloudflare "Just a moment…" (5,413 bytes) |
| 2 | `safeFetch` with full Chrome 130 UA + `sec-ch-ua-*` + `Accept-Language: en-NZ` + `sec-fetch-*` navigation headers | Still 403 challenge (3,440 bytes) |
| 3 | `safeFetch({ useResidentialProxy: true })` (NAS residential proxy) | 403 — same challenge body |
| 4 | `browserRender({ waitFor: "footer", timeout: 30s })` | 502 timeout — challenge never resolved in headless Chromium |
| 5 | `browserRender({ waitFor: "nav, [class*=nav]", timeout: 30s })` | Same 502 timeout |
| 6 | `browserRender({ waitFor: "a[href*=sporty.co.nz], #footer", timeout: 30s })` | 31 KB but still challenge HTML (selector false-matched a link inside the challenge template) |

Reproducible via `npx tsx scripts/spike-sporty-co-nz.ts` (~3-minute wall time).

### What paths CF *does* leave open (probed via curl)

| Path | Status | Notes |
|---|---|---|
| `/robots.txt` | 200, 207 bytes | Real robots.txt, no challenge |
| `/favicon.ico` | 200, 3,608 bytes | Static asset, no challenge |
| `/.well-known/security.txt` | 302 redirect | Not the actual file |
| `/sitemap.xml` | 404 | Sporty doesn't ship one |
| `/capitalh3.rss`, `/capitalh3.ics`, `/capitalh3.xml` | 404 | No kennel-level feeds |
| `/capitalh3/feed`, `/capitalh3/calendar.ics`, `/capitalh3/notices` | 200 but page-shell HTML | All return the same homepage shell, not a feed |
| Every guessed CMS API path (`/notice/Public/GetNotices?moduleId=242832`, `/api/notice/...`, `/Module/Notice/...`) | 403 challenge | Cloudflare challenges them too |
| `/bundles/sporty-scripts` (the platform's own JS bundle) | 403 challenge | Even Sporty's static-ish assets are behind the challenge |

**Conclusion:** Cloudflare is configured to challenge every path except whitelisted static assets. There is no API-bypass shortcut.

### What real users see (Claude in Chrome — driving the user's Chrome session)

Because the user's browser holds a valid `cf_clearance` cookie, it gets through the challenge transparently. From that session I confirmed:

**Capital H3 — homepage embeds the hareline directly in a CMS "notices" panel:**
```
2326 – 18 May 2026 – The Bond Sports Bar – Geestring
2327 – 25 May 2026 – The Bridge Bar – Scrac Thing
2328 – 1 Jun 2026 – 5pm? Kings B'day – Hare required! –
2329 – 8 Jun 2026 – Hare required! –
2330 – 15 Jun 2026 – Hare required! –
```
DOM: `<span>` per run, inside `<p>` inside `<div id="notices-prevContent-242832">` inside `.panel-body-text` (CMS module ID 242832).

**Geriatrix H3 — homepage shows only "Next Run"; full hareline at `/Receding-Hareline/NewTab1`:**
```
05/05/2026 — Chapman Taylor Cafe, Molesworth St., Thorndon — GATECRASHER + Maps link
12/05/2026 — The Cutting Sports Cafe, 32 Miramar Avenue, Miramar — Hey Baby + Maps link
19/05/2026 — TBA — Hare Required
26/05/2026 — TBA — Hare Required
02/06/2026 — TBA — Hare Required
```
4-line repeating block (`<date>` / `Venue: …` / `Hare: …` / `Map: …`).

**Mooloo HHH — `/UpCumming-Runs` is more of a newsletter than a structured hareline:**
```
25 May 2026 RUN# 1886 Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St. 6PM.
… Next run, your place? …
```
Free-form `<p>` paragraphs with one explicit run + placeholders. Lowest-fidelity layout of the three.

The page bundles call only Facebook tracking, Google ads, and Cloudflare RUM — **no app-level XHR fetches the hareline data**. The HTML is fully server-rendered.

---

## Why Cloudflare wins here

sporty.co.nz fronts every account page with **Cloudflare "I'm Under Attack"** mode (also called Bot Fight Mode / Turnstile JS challenge). The challenge:

1. Returns minimal HTML (`<title>Just a moment...</title>`, `<head>` only — no real content)
2. Runs a 5–15 s cryptographic JS puzzle that fingerprints the browser (TLS handshake, `navigator.webdriver`, canvas/WebGL signatures, mouse-movement signals)
3. Posts the result to Cloudflare's `cf_chl_chk_v8` endpoint
4. Sets a `cf_clearance` cookie scoped to the IP+UA pair, then reloads to the real page

Our infrastructure fails at step 2:

- **Residential proxy** only changes the source IP. CF challenges fingerprint the *browser*, not just the IP — IP rotation alone doesn't pass.
- **NAS headless Playwright** is detected by `navigator.webdriver === true`, default Chromium TLS fingerprint, and absence of human-like mouse-movement signals. The challenge JS never resolves, so the page never loads, so Playwright eventually times out.

Realistic Chrome 130 headers (UA, `sec-ch-ua-*`, `sec-fetch-*`) make no difference: CF's check happens at the JS-execution layer, not the request-header layer.

---

## Path forward — four options

### A. **Recommended for this round: roll Capital/Mooloo/Geriatrix into Phase 3 STATIC bulk** ✅

Ship the three kennels with the same `STATIC_SCHEDULE` + FB-page-in-description pattern Tokoroa H3 uses in Phase 1. Each gets:
- A `Kennel` record with metadata (founded year, run day/time, region)
- A `STATIC_SCHEDULE` source with the known recurring cadence:
  - Capital H3 — `FREQ=WEEKLY;BYDAY=MO` at 18:30, FB description → `facebook.com/Capitalhhh`
  - Mooloo HHH — `FREQ=WEEKLY;BYDAY=MO;INTERVAL=2` (biweekly) at 18:00, FB description → `facebook.com/mooloohhh`
  - Geriatrix H3 — `FREQ=WEEKLY;BYDAY=TU` at 18:30, FB description → `facebook.com/GeriatrixHHH`

**Trade-off:** No live hareline data (run number, hare, venue). Users see scheduled-run stubs with an FB deep-link.

**Why this is the right call right now:** All three kennels have active FB pages; trust-level 3 (FB-only) is honest about the data limits; the kennels remain visible on the hareline so users can discover them. Richer enrichment can come later if Option B or C lands.

### B. Stealth-Playwright on NAS browser-render service ⚠️ (separate infra PR)

Add [`playwright-extra`](https://www.npmjs.com/package/playwright-extra) + [`puppeteer-extra-plugin-stealth`](https://www.npmjs.com/package/puppeteer-extra-plugin-stealth) (works with Playwright too) to the NAS render service. Stealth plugins remove `navigator.webdriver`, override common fingerprint properties (`chrome` runtime, plugin list, language vector), and emulate human-like timing — clears most Cloudflare JS challenges. Also need `cf_clearance` cookie persistence so we don't burn 10 s on every scrape.

**Trade-off:** Real NAS infra change (Dockerfile + server.js edit + cookie-cache). CF regularly updates detection — becomes a maintenance treadmill. Worth doing as a separate infra-track PR if we hit more CF-protected sites in future onboarding rounds (likely, given how widespread Bot Fight Mode is becoming).

**Triggering criteria:** Pull the trigger when we have ≥2 future kennel-onboarding regions blocked by CF, not just for these 3 kennels.

### C. Commercial scraping API (ScraperAPI, ScrapingBee, ZenRows) ⚠️

Pay-for-CF-bypass as a service (~$30–50/month for our volume). Recurring cost + new external dependency + key management. Not justified for 3 kennels.

### D. Browser-assisted snapshot import 🟡

Long-term option: a one-off admin UI / bookmarklet that the user (or a kennel admin) periodically pastes the rendered hareline HTML into, parsed server-side. Closer to "manual data entry with browser help" than scraping. Worth considering if Option B keeps getting deferred.

---

## Phase 2 decision (updated)

**Phase 2 is now unblocked.** Option B (stealth upgrade) shipped as **Phase 1.5-B** in this same PR — see `infra/browser-render/server.js` for the implementation (stealth plugin, default Chrome 130 UA / viewport / locale, `clearCloudflareChallenge()` helper, per-hostname `cf_clearance` cookie cache). Live verification against all three sporty.co.nz pages is green.

**Phase 2 (follow-up PR)** will:
- Add `Kennel` records for Capital H3 / Mooloo HHH / Geriatrix H3 with their metadata
- Add per-kennel `HTML_SCRAPER` adapters — three different layouts:
  - Capital H3: parse the homepage `<div id="notices-prevContent-*">` panel; each row is a `<p>` of `<span>RUN# – DD MMM YYYY – LOCATION – HARE</span>`
  - Geriatrix H3: parse `/Receding-Hareline/NewTab1` — 4-line repeating blocks of `<date>` / `Venue: …` / `Hare: …` / `Map: …`
  - Mooloo HHH: parse `/UpCumming-Runs` — freeform `<p>` paragraphs (lower fidelity)
- Live-verify each adapter via `npm test` + `scripts/verify-nz-adapters.ts` extension
- Optionally migrate `Tokoroa H3` / `Auckland H3` / any other CF-protected NZ kennel from STATIC to HTML_SCRAPER if their pages are also on Cloudflare (cf_clearance cache makes this cheap).

The three kennels remain priority entries on the **Phase 4 FB Page audit** as a defensive layer: if sporty.co.nz ever tightens CF further (or moves off Sporty), `FACEBOOK_HOSTED_EVENTS` against `facebook.com/Capitalhhh` / `facebook.com/mooloohhh` / `facebook.com/GeriatrixHHH` is our fallback path.

---

## Reproduction

The spike script tests strategies 1, 3, 4, 5, 6 above against all three kennel URLs:

```bash
set -a; source /Users/johnclem/Developer/hashtracks-web/.env; set +a
npx tsx scripts/spike-sporty-co-nz.ts
```

Requires `RESIDENTIAL_PROXY_URL`, `RESIDENTIAL_PROXY_KEY`, `BROWSER_RENDER_URL`, `BROWSER_RENDER_KEY` in the env. Expected wall time: ~3 minutes.

When NAS stealth-Playwright lands (Option B), re-run the script as the post-deploy gate — if it succeeds, Phase 2 unblocks immediately. The script is intentionally retained in `scripts/` for exactly this purpose.
