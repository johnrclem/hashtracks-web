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
    const { chromium } = require("playwright");
    browser = await chromium.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    console.log(`[${new Date().toISOString()}] Browser launched`);
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

  try {
    const rawBody = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      busy = false;
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }

    const { url, waitFor, selector, frameUrl, timeout } = parsed;
    if (!url || typeof url !== "string") {
      busy = false;
      return jsonResponse(res, 400, {
        error: "Missing or invalid 'url' field",
      });
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
      `[${new Date().toISOString()}] Rendering ${url} (waitFor: ${waitForSelector}, timeout: ${pageTimeout}ms)`,
    );

    const b = await getBrowser();
    page = await b.newPage();

    // Use domcontentloaded instead of networkidle — Wix/SPA sites have
    // continuous background requests that prevent networkidle from firing.
    // The waitForSelector call below handles waiting for actual content.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: pageTimeout,
    });

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
        busy = false;
        return jsonResponse(res, 422, {
          error: `No child frame matching "${frameUrl}" found (${frameCount} frames total)`,
        });
      }

      // Wait for frame content to render, capped to remaining page timeout
      const frameTimeout = Math.max(pageTimeout - (Date.now() - renderStart), 5000);
      try {
        await frame.waitForSelector("table tr td, table tbody tr", { timeout: Math.min(frameTimeout, 15000) });
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
