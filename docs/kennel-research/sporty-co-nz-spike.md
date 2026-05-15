# sporty.co.nz WAF bypass spike — Phase 1.5 findings

**Date:** 2026-05-15
**Targets:** Capital H3, Mooloo HHH, Geriatrix H3 (three NZ kennels publishing harelines on `sporty.co.nz`)
**Verdict:** ❌ **Phase 2 blocked on existing infrastructure.** Cloudflare's "I'm Under Attack" / Bot Fight Mode is applied platform-wide to sporty.co.nz; every dynamic path (the kennel homepages, hareline sub-pages, even the platform's own JS bundle) returns the JS challenge regardless of headers, IP, or whether the request originates from a server-side Playwright session.

The good news, from inspecting the real pages via Claude in Chrome: **the hareline data is server-side-rendered HTML, varies in layout per kennel, and is straightforward to parse once we have an HTML response.** If we ever clear the CF challenge — by adding `playwright-extra` + stealth plugin to the NAS render service, paying for a commercial CF-bypassing scraping API, or running the scrape from an authenticated user's browser — the adapter work is a few hours, not days.

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

## Phase 2 decision

**Cancel Phase 2 as a standalone PR. Roll Capital/Mooloo/Geriatrix into Phase 3 STATIC bulk** (Option A). Track Option B as a candidate "stealth-Playwright NAS upgrade" infra PR — the same one would unblock any future CF-protected kennels we hit, so the cost/benefit improves with each region.

The three kennels are also priority entries on the **Phase 4 FB Page audit**: if `facebook.com/Capitalhhh` / `facebook.com/mooloohhh` / `facebook.com/GeriatrixHHH` publishes scrapeable FB Events, the `FACEBOOK_HOSTED_EVENTS` adapter is our only remaining path to live data without touching sporty.co.nz.

---

## Reproduction

The spike script tests strategies 1, 3, 4, 5, 6 above against all three kennel URLs:

```bash
set -a; source /Users/johnclem/Developer/hashtracks-web/.env; set +a
npx tsx scripts/spike-sporty-co-nz.ts
```

Requires `RESIDENTIAL_PROXY_URL`, `RESIDENTIAL_PROXY_KEY`, `BROWSER_RENDER_URL`, `BROWSER_RENDER_KEY` in the env. Expected wall time: ~3 minutes.

When NAS stealth-Playwright lands (Option B), re-run the script as the post-deploy gate — if it succeeds, Phase 2 unblocks immediately. The script is intentionally retained in `scripts/` for exactly this purpose.
