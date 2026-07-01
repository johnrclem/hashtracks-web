# Residential Proxy Relay

Lightweight forward proxy running on the home Synology DS423+ NAS, reached via Cloudflare Tunnel. Exits via a trusted residential IP to bypass WAF blocks on datacenter IPs (Vercel).

See `docs/residential-proxy-spec.md` for full architecture details.

## Infrastructure

- **Domain:** `hashtracks.xyz` (Cloudflare Registrar, ~$1/yr)
- **Tunnel:** `nas-proxy` → `proxy.hashtracks.xyz` → `http://proxy-relay:3100`
- **Protocol:** HTTP/2 (QUIC fails on Synology kernel — limited UDP buffer)
- **NAS path:** `/volume1/docker/proxy-relay/`
- **Docker binary:** `/volume1/@appstore/ContainerManager/usr/bin/docker`

## Setup

### 1. Cloudflare Tunnel (one-time)

1. Go to https://one.dash.cloudflare.com → Networks → Tunnels
2. Create a tunnel named `nas-proxy`
3. Configure public hostname: subdomain `proxy`, domain `hashtracks.xyz`, service `http://proxy-relay:3100`
4. Copy the tunnel token

### 2. NAS Deployment (via Tailscale SSH)

```bash
# Create working directory and .env
ssh nas-tailscale "mkdir -p /volume1/docker/proxy-relay"
ssh nas-tailscale "cat > /volume1/docker/proxy-relay/.env << 'EOF'
PROXY_API_KEY=<generate with: openssl rand -hex 32>
TUNNEL_TOKEN=<from Cloudflare dashboard>
EOF"

# Copy files and deploy
scp -O infra/proxy-relay/{server.js,Dockerfile,docker-compose.yml,README.md} \
    nas-tailscale:/volume1/docker/proxy-relay/
ssh nas-tailscale "cd /volume1/docker/proxy-relay && \
  /volume1/@appstore/ContainerManager/usr/bin/docker compose up -d --build"
```

### 3. Updating (after code changes)

```bash
scp -O infra/proxy-relay/server.js nas-tailscale:/volume1/docker/proxy-relay/server.js
ssh nas-tailscale "cd /volume1/docker/proxy-relay && \
  /volume1/@appstore/ContainerManager/usr/bin/docker compose up -d --build proxy-relay"
```

### 4. Testing

```bash
# Health check
curl https://proxy.hashtracks.xyz/health

# Proxy test
curl -X POST https://proxy.hashtracks.xyz/proxy \
  -H "Content-Type: application/json" \
  -H "X-Proxy-Key: YOUR_KEY" \
  -d '{"url": "https://www.enfieldhash.org/"}'

# From inside container (if port not exposed to host)
ssh nas-tailscale "/volume1/@appstore/ContainerManager/usr/bin/docker exec proxy-relay \
  wget -qO- http://localhost:3100/health"
```

### 5. Vercel Environment Variables

Add to Vercel dashboard (Settings → Environment Variables):

- `RESIDENTIAL_PROXY_URL` = `https://proxy.hashtracks.xyz`
- `RESIDENTIAL_PROXY_KEY` = the `PROXY_API_KEY` value from the NAS `.env`

## VPN Egress (Atlanta board — #2054)

`board.atlantahash.com` sits behind OVH's anti-DDoS firewall, which drops **both**
Vercel (datacenter) **and** the home residential range — so the residential relay
above cannot reach it. Diagnosed live: home Spectrum ✗, Vercel ✗, NAS ✗; but
cellular ✓, work WiFi ✓, home WiFi + ExpressVPN ✓ (IP/ASN-based block). The fix
is a second relay whose traffic egresses through a **VPN exit** (ExpressVPN's exit
is confirmed to reach the board). The app opts a source in via
`config.egress: "vpn"` → `safeFetch({ egress: "vpn" })` → `VPN_PROXY_URL`.

The `proxy-relay-vpn` service in `docker-compose.yml` implements this by **reusing
the existing standalone `gluetun` container** (the one that already carries the
torrent stack's ExpressVPN tunnel) via `network_mode: container:gluetun` — the
same pattern qbittorrent uses. No second tunnel, no duplicate creds. Because the
relay lives inside gluetun's network namespace, its `:3101` is reached at
**gluetun's** address, not via a compose service name.

### Setup

1. **.env** (NAS `/volume1/docker/proxy-relay/.env`) — add only:
   ```
   VPN_PROXY_API_KEY=<openssl rand -hex 32>
   ```
   (No VPN creds here — they already live on the standalone gluetun container.)

2. **Revive gluetun with the relay port published**, so the relay (sharing its
   netns) is reachable from the host. The existing gluetun is stopped and does
   NOT publish 3101 — add a `3101:3101` port mapping when you bring it back
   (Container Manager → gluetun → Port Settings, or recreate with `-p 3101:3101`),
   then start it.

3. **Go/no-go gate** — confirm the VPN exit actually reaches the board BEFORE
   enabling the source (this is the one unproven link):
   ```bash
   ssh nas-tailscale "/volume1/@appstore/ContainerManager/usr/bin/docker exec gluetun \
     wget -qO- --timeout=15 'https://board.atlantahash.com/app.php/feed/forum/2' | head"
   #   → expect XML starting with <feed ...>. If it times out, rotate the gluetun
   #     SERVER_COUNTRIES / SERVER_CITIES to a different US exit and retry.
   ```

4. **Deploy the relay** (gluetun must already be running — `container:gluetun`
   requires it):
   ```bash
   scp -O infra/proxy-relay/{docker-compose.yml,server.js,Dockerfile,README.md} \
       nas-tailscale:/volume1/docker/proxy-relay/
   ssh nas-tailscale "cd /volume1/docker/proxy-relay && \
     /volume1/@appstore/ContainerManager/usr/bin/docker compose up -d --build proxy-relay-vpn"
   ```

5. **Cloudflare Tunnel** — add a public hostname `proxy-vpn.hashtracks.xyz` →
   `http://<NAS-LAN-IP>:3101` (the relay is in gluetun's netns on the default
   bridge, so target the host-published port — NOT a compose service name).

6. **Vercel env** — add:
   - `VPN_PROXY_URL` = `https://proxy-vpn.hashtracks.xyz`
   - `VPN_PROXY_KEY` = the `VPN_PROXY_API_KEY` value from the NAS `.env`

7. **Enable** — the `Atlanta Hash Board` source already has `config.egress: "vpn"`
   (seed). Re-seed prod + trigger a scrape:
   `POST /api/cron/scrape/{atlantaSourceId}` (`Authorization: Bearer $CRON_SECRET`).

## Security

1. Timing-safe API key auth (`crypto.timingSafeEqual`, 256-bit random key)
2. No inbound ports on home router (Cloudflare Tunnel is outbound-only)
3. SSRF protection in proxy (blocks private IP targets)
4. Cloudflare edge DDoS/abuse protection
5. 1MB incoming body cap + 5MB outgoing body cap (OOM prevention)
6. Generic error responses (no internal detail leakage)
7. Graceful fallback if proxy env vars not configured (dev environments work unchanged)

## Gotchas

- **scp requires `-O` flag** — Synology's SSH server doesn't support the newer SCP protocol
- **Docker not in PATH** — use full path: `/volume1/@appstore/ContainerManager/usr/bin/docker`
- **No `sudo` needed** — user `johnrclem` is in the `docker` group
- **QUIC protocol fails** — Synology kernel limits UDP buffer sizes; use `--protocol http2`
- **DNS propagation** — new `.xyz` domains take 15-30 min for TLD registry propagation
