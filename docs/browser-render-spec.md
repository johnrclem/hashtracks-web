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
