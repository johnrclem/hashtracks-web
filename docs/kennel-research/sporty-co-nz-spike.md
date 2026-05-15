# sporty.co.nz WAF bypass spike — Phase 1.5 findings

**Date:** 2026-05-15
**Targets:** Capital H3, Mooloo HHH, Geriatrix H3 (three NZ kennels publishing harelines on `sporty.co.nz`)
**Verdict:** ❌ **Phase 2 blocked.** All available bypass mechanisms hit Cloudflare's "I'm Under Attack" JS challenge.

---

## What we tested

`scripts/spike-sporty-co-nz.ts` probes each of the three kennel URLs with five strategies in order of escalation:

| # | Strategy | Result |
|---|---|---|
| 1 | Plain `safeFetch` | HTTP 403 — Cloudflare "Just a moment..." (5,413 bytes) |
| 2 | `safeFetch({ useResidentialProxy: true })` (NAS residential proxy) | HTTP 403 — same Cloudflare challenge page |
| 3 | `browserRender({ waitFor: "footer", timeout: 30s })` | NAS render service 502 (Playwright timeout — challenge never resolved) |
| 4 | `browserRender({ waitFor: "nav, [class*=nav]", timeout: 30s })` | Same 502 timeout |
| 5 | `browserRender({ waitFor: "a[href*=sporty.co.nz], #footer", timeout: 30s })` | 31,458 bytes — STILL the Cloudflare challenge HTML (selector false-matched a link in the challenge template) |

All three kennels (`capitalh3`, `mooloohhh`, `geriatrixhhh`) returned identical Cloudflare challenge pages across all five strategies. Re-run the script via `npx tsx scripts/spike-sporty-co-nz.ts` to reproduce.

---

## Why it's blocked

sporty.co.nz fronts every account page with **Cloudflare "I'm Under Attack" mode** (also called Bot Fight Mode / Turnstile JS challenge). The challenge page:

1. Loads minimal HTML (`<title>Just a moment...</title>`, `<head>` only — no real content).
2. Runs a 5–10 second cryptographic JS puzzle that fingerprints the browser (TLS handshake, `navigator.webdriver`, canvas/WebGL signatures, mouse-movement signals).
3. Posts the result to Cloudflare's `cf_chl_chk_v8` endpoint.
4. Sets a `cf_clearance` cookie scoped to the IP+UA pair, then reloads to the real page.

Our infrastructure fails at step 2:

- **Residential proxy** only changes the source IP. Cloudflare's challenge fingerprints the *browser*, not just the IP — IP rotation alone doesn't pass.
- **NAS headless Playwright** is detected by Cloudflare's heuristics (`navigator.webdriver === true`, default Chromium TLS fingerprint, missing/abnormal mouse-movement signals). Even with 30 s waits, the challenge never resolves in headless Chromium — it just keeps spinning until Playwright times out.

The 31 KB "success" from variant 5 is a false positive: our looks-like-real-page check matched `<head>` text on the challenge template; the page has no kennel content.

---

## Options for Phase 2

### A. **Recommended: downgrade Capital / Mooloo / Geriatrix to STATIC_SCHEDULE in Phase 3** ✅

Ship the three kennels with the same `STATIC_SCHEDULE` + Facebook-page-URL-in-description pattern we already use for Tokoroa H3 (Phase 1) and the HK/Singapore static kennels. Each kennel gets:

- A `Kennel` record with metadata
- A `STATIC_SCHEDULE` source row matching the kennel's known weekly cadence (Capital Mon 18:30, Mooloo Mon 18:00, Geriatrix Tue 18:30)
- `defaultDescription` pointing to the kennel's Facebook page so users find each week's start

**Trade-off:** No live hareline data (run number, hares, location). Users see "scheduled run" stubs with FB deep-link for details.

**Why this is the right call:** Capital/Mooloo/Geriatrix's FB pages are all active. Trustlevel 3 (FB-only) is honest about the data limits. The kennels remain on the hareline so users can discover them; richer enrichment can come later if we ever unblock sporty.

### B. Add `playwright-extra` + stealth plugin to NAS browser-render service ⚠️

Patch the NAS render service with [`playwright-extra`](https://www.npmjs.com/package/playwright-extra) + [`puppeteer-extra-plugin-stealth`](https://www.npmjs.com/package/puppeteer-extra-plugin-stealth) (the latter works with Playwright too). Stealth plugins remove the `navigator.webdriver` flag, override common fingerprint properties, and emulate human-like timing — clears most Cloudflare JS challenges.

**Trade-off:** Real NAS infrastructure change (Dockerfile + server.js edit + cf-clearance cookie persistence to avoid hitting the puzzle on every scrape). Cloudflare regularly updates its detection, so this becomes a maintenance treadmill. **Not in scope for any NZ-onboarding PR** — would be its own infra PR.

### C. Use a commercial scraping API (ScraperAPI, ScrapingBee, ZenRows) ⚠️

These services maintain stealth-Playwright fleets + cf-clearance pools and handle CF challenges as a service. Costs ~$50–200/month for the volume we'd need.

**Trade-off:** Recurring cost, new external dependency, key/secret management. Worth the spend only if sporty.co.nz onboarding unlocks ≥10 kennels (currently 3).

### D. Find a non-Cloudflare alternative source per kennel ⚠️

- **Capital H3** — facebook.com/Capitalhhh is public. If the page maintains `/upcoming_hosted_events`, the FACEBOOK_HOSTED_EVENTS adapter could ingest it. Worth probing during Phase 3.
- **Mooloo HHH** — facebook.com/mooloohhh is public. Same probe.
- **Geriatrix H3** — facebook.com/GeriatrixHHH is public. Same probe.

If any of the three publish real FB Events (not just posts), we get live data without ever touching sporty.co.nz.

---

## Phase 2 path forward

**Roll Capital/Mooloo/Geriatrix into Phase 3 (the STATIC bulk PR) with FB-described STATIC_SCHEDULE sources.** Add the three kennels to the Phase 4 FB Page audit list — if any of them publishes scrapeable FB Events, upgrade that kennel's source from STATIC to FACEBOOK_HOSTED_EVENTS at that time.

**Do NOT** invest in playwright-extra/stealth or a commercial scraping API for just these three kennels. The cost/benefit only makes sense if sporty.co.nz turns out to host many more H3 kennels (currently we've found only these three on the platform across all of NZ).

---

## Reproduction

```bash
set -a; source /Users/johnclem/Developer/hashtracks-web/.env; set +a
npx tsx scripts/spike-sporty-co-nz.ts
```

Requires `RESIDENTIAL_PROXY_URL`, `RESIDENTIAL_PROXY_KEY`, `BROWSER_RENDER_URL`, `BROWSER_RENDER_KEY` in the env (already set in `.env`).

Expected wall time: ~3 minutes (each browserRender variant burns its full 30 s timeout, × 3 variants × 3 kennels).
