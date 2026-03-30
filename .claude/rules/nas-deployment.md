---
description: NAS (Synology) deployment commands for browser-render and proxy-relay services
globs:
  - infra/**
---

# NAS Deployment (browser-render + proxy-relay)

Both services share a Docker Compose stack at `/volume1/docker/proxy-relay/` on the NAS (`nas-tailscale`).
Browser render source files live at `/volume1/docker/browser-render/` (referenced via `context: ../browser-render` in compose).

```bash
# Copy updated server.js to NAS
scp -O infra/browser-render/server.js nas-tailscale:/volume1/docker/browser-render/

# Rebuild and restart browser-render service
ssh nas-tailscale "cd /volume1/docker/proxy-relay && \
  /volume1/@appstore/ContainerManager/usr/bin/docker compose up -d --build browser-render"

# Check logs
ssh nas-tailscale "docker logs browser-render --tail 20"

# For proxy-relay updates
scp -O infra/proxy-relay/server.js nas-tailscale:/volume1/docker/proxy-relay/
ssh nas-tailscale "cd /volume1/docker/proxy-relay && \
  /volume1/@appstore/ContainerManager/usr/bin/docker compose up -d --build proxy-relay"
```

**Note:** `scp -O` flag is required for Synology SSH. Container Manager docker binary is at `/volume1/@appstore/ContainerManager/usr/bin/docker`.
