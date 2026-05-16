# Browser Render Service — Architecture Spec

## Purpose

Self-hosted headless browser rendering service on the NAS that renders JS-heavy pages (Wix, Google Sites, SPAs) and returns the rendered HTML for Cheerio parsing. Same deployment pattern as the residential proxy (`infra/proxy-relay/`).

## Architecture

```text
┌─────────────────────┐     Cloudflare Tunnel      ┌──────────────────────────┐
│  hashtracks-web     │  (outbound-only from NAS)   │  Synology DS423+ NAS     │
│  (Vercel)           │                             │                          │
│                     │                             │  ┌─ proxy-relay (existing)│
│  safeFetch() ───────│── POST /proxy ──────────────│──┘  port 3100            │
│                     │                             │                          │
│  browserRender() ───│── POST /render ─────────────│──┐  browser-render (NEW) │
│                     │   { url, waitFor?, selector?}│  └─ port 3200            │
│                     │   + X-Render-Key header     │     Playwright + Chromium │
│                     │                             │                          │
│                     │◄── rendered HTML ───────────│                          │
└─────────────────────┘                             └──────────────────────────┘
```

## API

### `POST /render`

Renders a URL with Chromium and returns the HTML.

**Headers:**
- `X-Render-Key` (required) — API key for authentication

**Body (JSON):**
```json
{
  "url": "https://www.northboroh3.com/",
  "waitFor": ".event-list",
  "selector": ".main-content",
  "timeout": 15000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | Page URL to render |
| `waitFor` | string | `"body"` | CSS selector to wait for before capturing |
| `selector` | string | full page | CSS selector to extract (returns only that element's HTML) |
| `timeout` | number | 15000 | Max wait in ms (capped at 30000) |
| `timezoneId` | string | UTC | IANA timezone identifier (e.g. `"America/Chicago"`). See #960. |
| `userAgent` | string | Chrome 130 macOS | Override the context UA. Default matches the stealth fingerprint. |

**Response:**
- `200` — Rendered HTML (`text/html`)
- `400` — Invalid request
- `403` — Invalid API key
- `413` — Rendered HTML exceeds 5MB
- `422` — Selector not found on page
- `429` — Server busy (one render at a time)
- `502` — Render failed

### `GET /health`

Returns service status.

```json
{
  "status": "ok",
  "browserConnected": true,
  "busy": false,
  "timestamp": "2026-03-08T12:00:00.000Z"
}
```

## Cloudflare bypass (Bot Fight Mode / "Just a moment…" challenge)

The service auto-clears Cloudflare's JS challenge when it lands on a challenged page. Two pieces combine to make this work:

1. **Stealth shaping** via [`playwright-extra`](https://www.npmjs.com/package/playwright-extra) + [`puppeteer-extra-plugin-stealth`](https://www.npmjs.com/package/puppeteer-extra-plugin-stealth). The stealth plugin removes the standard headless tells (`navigator.webdriver = false`, normalised plugin list, fixed `chrome.runtime` gap, Permissions API fix, etc.) so the challenge JS can complete its fingerprint check. Plus a realistic Chrome 130 macOS UA + 1440×900 viewport + `en-NZ` locale set at context level so the stealth claim is consistent.

2. **Challenge-aware wait** in `clearCloudflareChallenge()`. After `page.goto()`, if the title matches `/just a moment|attention required|checking your browser/i`, the service polls the page title every 500 ms until the marker disappears (CF redirects post-challenge to the real page). Capped at the remaining page-timeout budget. Fast no-op for non-CF pages (single title read).

3. **Per-hostname `cf_clearance` cookie cache** (25-minute TTL — 5-min safety margin under CF's typical 30-min expiry). When the challenge clears, the service grabs `cf_clearance` + `__cf_*` cookies from the context and caches them keyed by hostname. Subsequent renders of the same host within the TTL prime the new context with these cookies before navigation, skipping the puzzle solve entirely. Memory cost is trivial (~few hundred bytes per cached host); cache is process-local and rebuilds on container restart.

The bypass is on by default for every render — callers don't need to opt in. Non-CF sites pay no perceptible cost (one title read after `domcontentloaded`).

**Limitations:** Cloudflare regularly updates its detection. If the stealth plugin starts failing for a specific site, the falling-back pattern is FlareSolverr as a sidecar service — currently deferred.

## Security

- **API key auth**: Timing-safe comparison of `X-Render-Key` header
- **SSRF protection**: Same `isPrivateTarget()` check as proxy-relay
- **Non-root**: Runs as `pwuser` (built into Playwright Docker image)
- **Concurrency**: One render at a time (rejects with 429 if busy)
- **Limits**: 30s page timeout, 5MB response cap, 1MB request body cap

## Resource Budget

| Service | RAM | Storage |
|---------|-----|---------|
| proxy-relay | ~30MB | ~5MB |
| cloudflared | ~30MB | ~50MB |
| browser-render | ~300-512MB | ~400MB (Chromium) |
| **Total** | ~560MB | ~455MB |

## Environment Variables

```bash
# NAS-side (.env in infra/proxy-relay/)
RENDER_API_KEY=<32+ char random key>

# App-side (.env.local)
BROWSER_RENDER_URL=https://proxy.hashtracks.xyz
BROWSER_RENDER_KEY=<same as RENDER_API_KEY>
```

## Deployment

Same workflow as proxy-relay. From the `infra/proxy-relay/` directory:

```bash
# Build and start all services (proxy-relay + browser-render + cloudflared)
docker compose up -d --build

# Or rebuild just browser-render
docker compose up -d --build browser-render
```

Cloudflare Tunnel routing (configure in Cloudflare dashboard):
- `proxy.hashtracks.xyz/proxy` → `proxy-relay:3100`
- `proxy.hashtracks.xyz/render` → `browser-render:3200`

## App Integration

### Low-level API

```typescript
import { browserRender } from "@/lib/browser-render";

// Render a Wix site
const html = await browserRender({
  url: "https://www.northboroh3.com/calendar",
  waitFor: "body",
  timeout: 20000,
});

// Parse with Cheerio as usual
const $ = cheerio.load(html);
```

### Adapter utility (recommended)

Use `fetchBrowserRenderedPage()` from `src/adapters/utils.ts` for the same `page.ok` / `page.$` pattern as all other HTML scrapers:

```typescript
import { fetchBrowserRenderedPage } from "@/adapters/utils";

const page = await fetchBrowserRenderedPage(calendarUrl, {
  waitFor: "body",
  timeout: 20000,
});
if (!page.ok) return page.result;
const { $, structureHash, fetchDurationMs } = page;
```

### Reference implementation

See `src/adapters/html-scraper/northboro-hash.ts` — the first browser-rendered adapter, scraping a Wix-hosted hash kennel site.

Future: add `useHeadlessBrowser` flag to Source config so HTML_SCRAPER adapters can automatically route through the render service.
