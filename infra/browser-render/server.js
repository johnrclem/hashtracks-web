/**
 * Headless Browser Rendering Service
 *
 * Node.js HTTP server that renders JS-heavy pages via Playwright/Chromium.
 * Runs on NAS behind Cloudflare Tunnel, same pattern as proxy-relay.
 *
 * POST /render  — render a URL and return HTML (requires X-Render-Key auth)
 * GET  /health  — health check
 */

const crypto = require("crypto");
const http = require("http");

// playwright-extra wraps playwright's chromium so we can register puppeteer
// extras. Stealth applies a curated set of fingerprint overrides
// (navigator.webdriver = false, normalised plugin list, chrome.runtime
// gap, Permissions API fix, etc.) so Cloudflare's Bot Fight Mode JS
// challenge can't see headless tells. Registering at module load (not
// inside getBrowser) makes the intent obvious and avoids any edge case if
// playwright-extra's internal double-registration guard ever changes.
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

const PORT = parseInt(process.env.PORT || "3200", 10);
const API_KEY = process.env.RENDER_API_KEY;

if (!API_KEY || API_KEY.length < 32) {
  console.error(
    "RENDER_API_KEY must be set and at least 32 characters. Exiting.",
  );
  process.exit(1);
}

const API_KEY_BUFFER = Buffer.from(API_KEY);
const PAGE_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_REQUEST_BODY_SIZE = 1 * 1024 * 1024; // 1 MB

// Default context options. The realistic Chrome 130 UA + viewport + locale
// pair with the stealth plugin's fingerprint overrides so Cloudflare's
// "I'm Under Attack" / Bot Fight Mode JS challenge can't see headless tells.
// Callers may override `userAgent` per request.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const DEFAULT_LOCALE = "en-NZ";

// Per-(hostname, UA) cf_clearance cookie cache. cf_clearance is bound to
// (IP, UA) by Cloudflare; the IP component is fixed (single NAS host) but
// callers can supply a custom userAgent per-request, so the cache key MUST
// include the effective UA — otherwise a default-UA render warms the cache
// and a later custom-UA render reuses cookies CF will reject.
// TTL: 25 min (5-min safety margin under CF's typical 30-min cookie expiry).
// Eviction is lazy (on re-access of an expired entry) — fine since we scrape
// a bounded set of sources (~150 entries × few hundred bytes = ~50 KB
// ceiling); process-local, rebuilds on restart.
const CF_COOKIE_TTL_MS = 25 * 60 * 1000;
// Single source of truth for the title markers that signal a CF challenge.
// Kept as a string array so the in-browser `waitForFunction` callback can
// do a plain `Array#some(includes)` rather than build a dynamic RegExp
// from a passed-in pattern source (Codacy/Semgrep flag dynamic RegExp
// construction as a DoS hazard — false positive here since the array is
// a hardcoded literal, but the includes-on-array form sidesteps the lint
// entirely AND keeps Node + page sides locked to the same marker list).
const CF_CHALLENGE_TITLE_MARKERS = [
  "just a moment",
  "attention required",
  "checking your browser",
];
const CF_CHALLENGE_TITLE_RE = new RegExp(CF_CHALLENGE_TITLE_MARKERS.join("|"), "i");
const cfCookieCache = new Map(); // "hostname|userAgent" → { cookies, expiresAt }

/** Build the cache key for a (hostname, UA) pair. */
function cfCacheKey(hostname, userAgent) {
  return `${hostname}|${userAgent}`;
}

let browser = null;
let launching = false;
let busy = false;

/**
 * Check if a hostname resolves to a private/reserved IP range.
 * Same SSRF protection as proxy-relay.
 */
function isPrivateTarget(hostname) {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "metadata.google.internal" ||
    lower.endsWith(".internal")
  ) {
    return true;
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const octets = parts.map(Number);
    if (octets[0] === 127) return true;
    if (octets[0] === 10) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    if (octets.every((o) => o === 0)) return true;
  }

  return false;
}

/**
 * Launch or reconnect to the browser instance.
 */
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) {
    // Wait for in-progress launch
    while (launching) await new Promise((r) => setTimeout(r, 100));
    if (browser && browser.isConnected()) return browser;
  }

  launching = true;
  try {
    // Stealth plugin registered at module load (see top of file).
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        // Blink feature flag — disables one CDP-exposed surface that
        // some bot-detectors (incl. Cloudflare's heuristics) read.
        "--disable-blink-features=AutomationControlled",
      ],
    });
    console.log(`[${new Date().toISOString()}] Browser launched (stealth)`);
    browser.on("disconnected", () => {
      console.log(`[${new Date().toISOString()}] Browser disconnected`);
      browser = null;
    });
    return browser;
  } finally {
    launching = false;
  }
}

/**
 * Wait for Cloudflare's "Just a moment…" / Bot Fight Mode JS challenge to
 * resolve. Fast no-op when the current page isn't challenged. When it is,
 * polls the page title every 250 ms until the challenge marker disappears
 * (CF redirects post-challenge to the real page), capped at `maxWaitMs`.
 *
 * Returns `"cleared"` when the challenge was observed and resolved within
 * the budget, `"timeout"` when it was observed but never cleared (don't
 * cache the resulting cookies — they're bogus), and `"none"` when the
 * page was never challenged.
 */
async function clearCloudflareChallenge(page, maxWaitMs) {
  const titleNow = await page.title().catch(() => "");
  if (!CF_CHALLENGE_TITLE_RE.test(titleNow)) return "none";
  console.log(
    `[${new Date().toISOString()}] Cloudflare challenge detected (title: "${titleNow}"), waiting up to ${maxWaitMs}ms`,
  );
  // Pass the marker array verbatim into the page context; the callback
  // does case-insensitive substring checks. Same array as Node-side so the
  // two can't drift, and no `new RegExp(pattern)` to upset DoS linters.
  await page
    .waitForFunction(
      (markers) => {
        const t = (document.title || "").toLowerCase();
        return !markers.some((m) => t.includes(m));
      },
      CF_CHALLENGE_TITLE_MARKERS,
      { timeout: maxWaitMs, polling: 250 },
    )
    .catch(() => {
      // Timeout — fall through to the post-check below.
    });
  // Re-read the title; only report "cleared" if the marker is actually gone.
  const titleAfter = await page.title().catch(() => titleNow);
  return CF_CHALLENGE_TITLE_RE.test(titleAfter) ? "timeout" : "cleared";
}

/** Extract CF-bypass cookies (cf_clearance + any __cf_* helpers) for a context's origin. */
async function readCfCookies(context, origin) {
  const cookies = await context.cookies(origin).catch(() => []);
  return cookies.filter((c) => c.name === "cf_clearance" || c.name.startsWith("__cf"));
}

/** Prime a fresh browser context with cached CF cookies for the
 *  (hostname, UA) pair, if a fresh cache entry exists. Evicts expired
 *  entries. The UA must be the *effective* UA the new context will use,
 *  since CF binds cf_clearance to (IP, UA). */
async function primeCfCookies(context, hostname, userAgent) {
  const key = cfCacheKey(hostname, userAgent);
  const cached = cfCookieCache.get(key);
  if (!cached) return;
  if (cached.expiresAt <= Date.now()) {
    cfCookieCache.delete(key);
    return;
  }
  await context.addCookies(cached.cookies).catch(() => {});
}

/** Read fresh CF cookies from the context and cache them by (hostname, UA)
 *  for the configured TTL. Called only after we know the challenge actually
 *  cleared (otherwise the cookies are bogus and would waste the next
 *  request). UA must be the same one the cleared context used. */
async function captureCfCookies(context, parsedUrl, userAgent) {
  const cfCookies = await readCfCookies(context, parsedUrl.origin);
  if (cfCookies.length === 0) return;
  const key = cfCacheKey(parsedUrl.hostname, userAgent);
  cfCookieCache.set(key, {
    cookies: cfCookies,
    expiresAt: Date.now() + CF_COOKIE_TTL_MS,
  });
  console.log(
    `[${new Date().toISOString()}] Cached ${cfCookies.length} CF cookie(s) for ${parsedUrl.hostname} (TTL ${CF_COOKIE_TTL_MS / 60000}min)`,
  );
}

/**
 * Read the full request body as a string.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    req.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_REQUEST_BODY_SIZE) {
        req.destroy();
        return reject(
          new Error(`Request body exceeds ${MAX_REQUEST_BODY_SIZE} bytes`),
        );
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    return jsonResponse(res, 200, {
      status: "ok",
      browserConnected: browser?.isConnected() ?? false,
      busy,
      timestamp: new Date().toISOString(),
    });
  }

  // Only accept POST /render
  if (req.method !== "POST" || req.url !== "/render") {
    return jsonResponse(res, 404, { error: "Not found" });
  }

  // Auth check (timing-safe)
  const renderKey = req.headers["x-render-key"];
  if (
    typeof renderKey !== "string" ||
    renderKey.length !== API_KEY.length ||
    !crypto.timingSafeEqual(Buffer.from(renderKey), API_KEY_BUFFER)
  ) {
    return jsonResponse(res, 403, { error: "Invalid API key" });
  }

  // Concurrency guard — one render at a time
  if (busy) {
    return jsonResponse(res, 429, { error: "Server busy, try again later" });
  }

  busy = true;
  let page = null;
  let context = null;

  try {
    const rawBody = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      busy = false;
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }

    const { url, waitFor, selector, frameUrl, timeout, timezoneId, userAgent } = parsed;
    if (!url || typeof url !== "string") {
      busy = false;
      return jsonResponse(res, 400, {
        error: "Missing or invalid 'url' field",
      });
    }

    // Optional caller-supplied UA. Length-bounded and control-char-rejecting
    // — real Chrome UAs need `()`, `;`, `,`, `/` so a strict allowlist won't
    // fit, but `\x00-\x1f\x7f` are never valid in a header value and rejecting
    // them prevents request-smuggling-style injection when Playwright sets
    // the UA on the outbound request. Defaults to DEFAULT_USER_AGENT.
    let safeUserAgent;
    if (userAgent !== undefined) {
      if (
        typeof userAgent !== "string" ||
        userAgent.length === 0 ||
        userAgent.length > 256 ||
        /[\x00-\x1f\x7f]/.test(userAgent)
      ) {
        busy = false;
        return jsonResponse(res, 400, {
          error: `Invalid userAgent (length 1-256, no control chars)`,
        });
      }
      safeUserAgent = userAgent;
    }

    // Validate timezoneId — Playwright accepts any IANA timezone identifier.
    // Cap length to keep the surface small; defer full validation to Playwright
    // which throws a clear error on unknown zones. Any non-undefined value that
    // fails length OR charset checks returns 400 (no silent fallback to UTC).
    let safeTimezoneId;
    if (timezoneId !== undefined) {
      if (
        typeof timezoneId !== "string" ||
        timezoneId.length === 0 ||
        timezoneId.length > 64 ||
        // Allow only the IANA charset: letters, digits, /, _, -, +
        !/^[A-Za-z0-9/_+\-]+$/.test(timezoneId)
      ) {
        busy = false;
        return jsonResponse(res, 400, {
          error: `Invalid timezoneId: ${timezoneId}`,
        });
      }
      safeTimezoneId = timezoneId;
    }

    // SSRF check
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      busy = false;
      return jsonResponse(res, 400, { error: `Invalid URL: ${url}` });
    }

    if (
      parsedUrl.protocol !== "http:" &&
      parsedUrl.protocol !== "https:"
    ) {
      busy = false;
      return jsonResponse(res, 400, {
        error: `Unsupported protocol: ${parsedUrl.protocol}`,
      });
    }

    if (isPrivateTarget(parsedUrl.hostname)) {
      busy = false;
      return jsonResponse(res, 400, {
        error: `Blocked: target resolves to private IP (${parsedUrl.hostname})`,
      });
    }

    const pageTimeout = Math.min(
      typeof timeout === "number" ? timeout : 15000,
      PAGE_TIMEOUT_MS,
    );
    const waitForSelector = typeof waitFor === "string" ? waitFor : "body";

    const renderStart = Date.now();
    console.log(
      `[${new Date().toISOString()}] Rendering ${url} (waitFor: ${waitForSelector}, timeout: ${pageTimeout}ms${safeTimezoneId ? `, tz: ${safeTimezoneId}` : ""})`,
    );

    const b = await getBrowser();
    // Always create an explicit context so cleanup is uniform across the
    // timezone and no-timezone paths. When timezoneId is supplied, the context
    // makes JS calendars (Wix, Google Sites) format dates in the kennel's
    // local zone rather than the server's UTC default (#960). The stealth
    // plugin only shapes the browser globally — context-level fields (UA,
    // viewport, locale) must be set per-context so they match the stealth
    // plugin's claim that the browser is a real Chrome.
    const effectiveUserAgent = safeUserAgent ?? DEFAULT_USER_AGENT;
    const contextOpts = {
      userAgent: effectiveUserAgent,
      viewport: DEFAULT_VIEWPORT,
      locale: DEFAULT_LOCALE,
      ...(safeTimezoneId ? { timezoneId: safeTimezoneId } : {}),
    };
    context = await b.newContext(contextOpts);
    await primeCfCookies(context, parsedUrl.hostname, effectiveUserAgent);

    page = await context.newPage();

    // Use domcontentloaded instead of networkidle — Wix/SPA sites have
    // continuous background requests that prevent networkidle from firing.
    // The waitForSelector call below handles waiting for actual content.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: pageTimeout,
    });

    // Clear Cloudflare's "Just a moment…" JS challenge if the response
    // landed on one. No-op for non-CF sites (single title read). Use the
    // remaining page-timeout budget so we never exceed PAGE_TIMEOUT_MS.
    const cfRemaining = Math.max(pageTimeout - (Date.now() - renderStart), 5_000);
    const cfOutcome = await clearCloudflareChallenge(page, cfRemaining);
    if (cfOutcome === "cleared") {
      await captureCfCookies(context, parsedUrl, effectiveUserAgent);
    } else if (cfOutcome === "timeout") {
      // The default `waitFor: "body"` selector would otherwise succeed on
      // the challenge page itself, causing us to return Cloudflare's wall
      // HTML with a 200 status. Fail fast and explicitly so downstream
      // parsers don't silently see the wrong document.
      await page.close().catch(() => {});
      page = null;
      await context.close().catch(() => {});
      context = null;
      busy = false;
      return jsonResponse(res, 502, {
        error: "Cloudflare challenge did not clear within page timeout",
        detail: `Title still matched challenge markers after ${cfRemaining}ms wait`,
      });
    }

    // Wait for the requested selector
    await page.waitForSelector(waitForSelector, {
      timeout: pageTimeout,
    });

    let html;
    if (typeof frameUrl === "string") {
      // Extract content from a child iframe matching the URL pattern.
      // Used for cross-origin iframes (e.g., Wix Table Master widgets)
      // that return "unauthorized" when rendered standalone.
      const allFrames = page.frames();
      console.log(
        `[${new Date().toISOString()}] Looking for frame matching "${frameUrl}" among ${allFrames.length} frames:`,
      );
      for (const f of allFrames) {
        const fUrl = f.url();
        const matches = fUrl.includes(frameUrl);
        console.log(`  ${matches ? "✓" : " "} ${fUrl.slice(0, 150)}`);
      }

      // Skip the main frame (index 0) — only search child frames
      const frame = allFrames.slice(1).find((f) => f.url().includes(frameUrl));
      if (!frame) {
        const frameCount = allFrames.length;
        await page.close();
        page = null;
        if (context) { await context.close(); context = null; }
        busy = false;
        return jsonResponse(res, 422, {
          error: `No child frame matching "${frameUrl}" found (${frameCount} frames total)`,
        });
      }

      // Wait for frame content to render, capped to remaining page timeout.
      // Two-phase wait: first for any table cell, then for a cell with text content.
      // Phase 2 catches Angular/Table Master widgets that render empty placeholder
      // rows before populating data (e.g., NTKH4's Table Master).
      const frameTimeout = Math.max(pageTimeout - (Date.now() - renderStart), 5000);
      try {
        await frame.waitForSelector("table tr td, table tbody tr", { timeout: Math.min(frameTimeout, 15000) });
        // Phase 2: wait for a <td> with non-whitespace text (data row, not empty placeholder)
        const phase2Timeout = Math.max(frameTimeout - (Date.now() - renderStart), 3000);
        try {
          await frame.waitForFunction(
            () => {
              const cell = document.querySelector("table tbody td, table tr td");
              return cell !== null && cell.textContent.trim().length > 0;
            },
            { timeout: Math.min(phase2Timeout, 10000) },
          );
        } catch {
          // Data rows may not appear (empty table) — continue with whatever loaded
        }
      } catch {
        try {
          await frame.waitForLoadState("networkidle", { timeout: Math.min(frameTimeout, 10000) });
        } catch {
          // Frame may not reach networkidle — continue with whatever loaded
        }
      }
      html = await frame.content();
    } else if (typeof selector === "string") {
      const element = await page.$(selector);
      if (!element) {
        await page.close();
        page = null;
        if (context) { await context.close(); context = null; }
        busy = false;
        return jsonResponse(res, 422, {
          error: `Selector "${selector}" not found on page`,
        });
      }
      html = await element.evaluate((el) => el.outerHTML);
    } else {
      html = await page.content();
    }

    await page.close();
    page = null;
    if (context) {
      await context.close();
      context = null;
    }

    // Size check
    const htmlBytes = Buffer.byteLength(html, "utf-8");
    if (htmlBytes > MAX_RESPONSE_SIZE) {
      busy = false;
      return jsonResponse(res, 413, {
        error: `Rendered HTML exceeds ${MAX_RESPONSE_SIZE} bytes (${htmlBytes})`,
      });
    }

    console.log(
      `[${new Date().toISOString()}] Rendered ${url} (${htmlBytes} bytes)`,
    );

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": htmlBytes,
    });
    res.end(html);
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Render error: ${err.message}`,
    );
    if (page) {
      try {
        await page.close();
      } catch {}
    }
    if (context) {
      try {
        await context.close();
      } catch {}
    }
    jsonResponse(res, 502, { error: "Render failed", detail: err.message });
  } finally {
    busy = false;
  }
});

// Launch browser on startup
getBrowser().catch((err) => {
  console.error(`Failed to launch browser: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Browser render service listening on 0.0.0.0:${PORT}`);
});
