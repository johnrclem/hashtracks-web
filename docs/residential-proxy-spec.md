# Residential Proxy Relay — Implementation Spec

Bypass WAF/bot-protection blocks on scraping targets that reject datacenter IPs (Vercel).
Route failing requests through a lightweight proxy on the home NAS, which exits via a
trusted residential IP.

---

## Architecture

```
┌─────────────────────┐     Cloudflare Tunnel      ┌──────────────────────────┐
│  hashtracks-web     │  ── (outbound-only from  ─► │  Synology DS423+ NAS     │
│  (Vercel)           │      NAS, no port fwding)   │  192.168.0.35 (local)    │
│                     │                             │  100.122.201.59 (TS)     │
│  safe-fetch.ts ─────│── POST /proxy ──────────────│─► proxy-relay container  │
│  { useResidential   │   { url, headers }          │   (Node.js, ~30MB RAM)   │
│    Proxy: true }    │   + X-Proxy-Key header      │   fetches target from    │
│                     │                             │   residential IP         │
│                     │ ◄── raw HTML ───────────────│                          │
└─────────────────────┘                             └──────────────────────────┘
```

**Why Cloudflare Tunnel:** Vercel serverless functions can't reach the NAS via Tailscale.
Cloudflare Tunnel creates an outbound-only connection from the NAS to Cloudflare's edge,
which reverse-proxies requests back. Zero inbound ports opened on the home router.
Cloudflare Tunnels are free.

---

## Part 1: NAS Infrastructure (`infra/proxy-relay/`)

All NAS-side files live in the repo under `infra/proxy-relay/`. They get deployed to
the NAS manually (see Deployment section below). They are NOT part of the Vercel build.

### 1.1 `infra/proxy-relay/server.js`

Zero-dependency Node.js HTTP server. Accepts `POST /proxy` with JSON body
`{ url, method?, headers? }`, authenticates via `X-Proxy-Key` header, fetches
the target URL from the NAS's residential IP, and returns the raw response.

Requirements:
- Validate `X-Proxy-Key` header matches `PROXY_API_KEY` env var (reject with 403)
- Require `PROXY_API_KEY` to be set and ≥32 chars on startup (exit 1 if not)
- Only accept `POST /proxy` (return 404 for anything else except `GET /health`)
- `GET /health` returns `{ status: "ok", timestamp }` (for monitoring)
- Parse JSON body: `{ url: string, method?: string, headers?: Record<string, string> }`
- Validate target URL: must be http/https, must NOT be private IP (127.x, 10.x, 192.168.x, 172.16.x-172.31.x, localhost, metadata.google.internal) — this prevents SSRF through the proxy
- Apply default browser-like headers (User-Agent Chrome 124, Accept text/html, Accept-Language en-US) that can be overridden by caller-provided headers
- Follow redirects (up to 5) using Node built-in http/https modules
- 30-second request timeout
- Forward response status code and content-type/content-encoding/last-modified/etag headers
- Return raw response body (Buffer)
- On fetch error, return 502 with `{ error: message }`
- Log each proxied request with timestamp and target URL
- Listen on `PORT` env var (default 3100), bind `0.0.0.0`
- **Zero npm dependencies** — use only Node built-ins (http, https)

### 1.2 `infra/proxy-relay/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server.js .
EXPOSE 3100
CMD ["node", "server.js"]
```

### 1.3 `infra/proxy-relay/docker-compose.yml`

Two services:

**proxy-relay:**
- Build from current directory (the Dockerfile above)
- Container name: `proxy-relay`
- Restart: `unless-stopped`
- Environment: `PROXY_API_KEY` and `PORT=3100` from `.env` file
- `mem_limit: 64m`
- JSON file logging: max-size 5m, max-file 3
- No published ports (cloudflared connects to it internally via Docker network)

**cloudflared:**
- Image: `cloudflare/cloudflared:latest`
- Container name: `cloudflared`
- Restart: `unless-stopped`
- Command: `tunnel run`
- Environment: `TUNNEL_TOKEN` from `.env` file
- `mem_limit: 64m`
- Depends on: `proxy-relay`
- JSON file logging: max-size 5m, max-file 3

### 1.4 `infra/proxy-relay/README.md`

Short deployment instructions covering:

1. **Cloudflare Tunnel setup** (one-time):
   - Create tunnel at https://one.dash.cloudflare.com → Networks → Tunnels
   - Name it `nas-proxy`
   - Configure public hostname: subdomain `proxy`, your Cloudflare domain, service `http://proxy-relay:3100`
   - Copy tunnel token

2. **NAS deployment** (from Chromebook via Tailscale SSH):
   ```bash
   # First time: clone repo on NAS
   ssh nas-tailscale "git clone https://github.com/johnrclem/hashtracks-web.git /volume1/repos/hashtracks-web"

   # Create working directory and .env
   ssh nas-tailscale "mkdir -p /volume1/docker/proxy-relay"
   ssh nas-tailscale "cat > /volume1/docker/proxy-relay/.env << 'EOF'
   PROXY_API_KEY=<generate with: openssl rand -hex 32>
   TUNNEL_TOKEN=<from Cloudflare dashboard>
   EOF"

   # Deploy (and on subsequent updates)
   ssh nas-tailscale "cd /volume1/repos/hashtracks-web && git pull && \
     cp infra/proxy-relay/* /volume1/docker/proxy-relay/ && \
     cd /volume1/docker/proxy-relay && \
     sudo docker compose up -d --build"
   ```

3. **Testing:**
   ```bash
   # Via Tailscale (direct, bypassing cloudflared)
   curl -X POST http://100.122.201.59:3100/proxy \
     -H "Content-Type: application/json" \
     -H "X-Proxy-Key: YOUR_KEY" \
     -d '{"url": "https://www.enfieldhash.org/"}'

   # Via Cloudflare Tunnel (production path)
   curl -X POST https://proxy.yourdomain.com/proxy \
     -H "Content-Type: application/json" \
     -H "X-Proxy-Key: YOUR_KEY" \
     -d '{"url": "https://www.enfieldhash.org/"}'
   ```

4. **Vercel env vars** — add to Vercel dashboard:
   - `RESIDENTIAL_PROXY_URL` = `https://proxy.yourdomain.com`
   - `RESIDENTIAL_PROXY_KEY` = the PROXY_API_KEY value from the NAS .env

---

## Part 2: Codebase Changes

### 2.1 Update `src/adapters/safe-fetch.ts`

Extend `safeFetch` with an opt-in `useResidentialProxy` flag. Backwards compatible —
existing callers that don't pass the flag behave identically.

**New type:**
```typescript
export interface SafeFetchOptions extends RequestInit {
  /** Route through NAS residential proxy. Use for WAF-blocked domains. */
  useResidentialProxy?: boolean;
}
```

**Updated signature:**
```typescript
export async function safeFetch(url: string, init?: SafeFetchOptions): Promise<Response>
```

**Behavior when `useResidentialProxy: true`:**
1. Read `RESIDENTIAL_PROXY_URL` and `RESIDENTIAL_PROXY_KEY` from `process.env`
2. If either is missing, log a warning and fall back to direct fetch (graceful degradation)
3. Convert `init.headers` to a plain `Record<string, string>` (handle Headers object, array, and plain object forms)
4. `POST` to `${RESIDENTIAL_PROXY_URL}/proxy` with:
   - Header `Content-Type: application/json`
   - Header `X-Proxy-Key: ${RESIDENTIAL_PROXY_KEY}`
   - JSON body `{ url, method: init.method || "GET", headers: convertedHeaders }`
5. If proxy returns non-2xx, throw `Error("Residential proxy error (${status}): ${body}")`
6. Return the proxy's Response as-is (status, headers, body pass through)

**Behavior when `useResidentialProxy` is falsy (default):**
Identical to the current implementation — validate URL, follow redirects manually with
SSRF checks. No changes to existing code path.

### 2.2 Update `src/adapters/html-scraper/enfield-hash.ts`

The only adapter that currently needs the proxy (gets 403 from Vercel IPs).

Two changes:
1. Add a constant near the top: `const USE_RESIDENTIAL_PROXY = true;`
2. In `tryFetchWithUrlVariants`, change the `safeFetch` call to pass
   `useResidentialProxy: USE_RESIDENTIAL_PROXY`

The existing `requestHeaders` (User-Agent, Sec-Fetch-*, etc.) should still be passed
and will be forwarded through the proxy.

### 2.3 Update `.env.example`

Add (commented out, with description):

```bash
# Residential proxy for WAF-blocked scrape targets (optional, see docs/residential-proxy-spec.md)
# RESIDENTIAL_PROXY_URL=https://proxy.yourdomain.com
# RESIDENTIAL_PROXY_KEY=
```

### 2.4 Update `CLAUDE.md`

Add to **Environment Variables** section:
```
- RESIDENTIAL_PROXY_URL=  # NAS residential proxy URL (for WAF-blocked scrape targets)
- RESIDENTIAL_PROXY_KEY=  # API key for residential proxy auth
```

Add to **Important Files** section:
```
- `infra/proxy-relay/` — NAS-deployed residential proxy (Cloudflare Tunnel + Node.js forwarder)
- `docs/residential-proxy-spec.md` — Architecture and deployment guide for residential proxy
```

Add to **Architecture** section, after the "Scraping" bullet:
```
- **Residential Proxy:** Optional NAS-based forward proxy for WAF-blocked targets (Cloudflare Tunnel, see `docs/residential-proxy-spec.md`)
```

---

## Part 3: Opt-In Pattern for Future Adapters

Any adapter that gets 403s from datacenter IPs can opt in with one flag:

```typescript
const response = await safeFetch(url, {
  headers: requestHeaders,
  useResidentialProxy: true,
});
```

No other adapters currently need this. If more sites start blocking, the pattern is
to add `useResidentialProxy: true` to that adapter's safeFetch call.

---

## Resource Budget

| Container | RAM | Purpose |
|-----------|-----|---------|
| proxy-relay | ~30MB | Node.js HTTP forwarder |
| cloudflared | ~30MB | Outbound tunnel to Cloudflare |
| **Total** | **~60MB** | Well within 2GB NAS budget |

## Port Registry

| Port | Service | Exposed? |
|------|---------|----------|
| 3100 | proxy-relay | Internal only (Docker network, accessed by cloudflared) |

## Security Layers

1. API key auth (`X-Proxy-Key` header, 256-bit random)
2. No inbound ports on home router (Cloudflare Tunnel is outbound-only)
3. SSRF protection in proxy (blocks private IP targets)
4. Cloudflare edge DDoS/abuse protection
5. Graceful fallback if proxy env vars not configured (dev environments work unchanged)
