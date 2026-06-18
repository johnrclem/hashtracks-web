/**
 * Residential Proxy Relay Server
 *
 * Zero-dependency Node.js HTTP proxy that forwards requests from Vercel
 * through the NAS's residential IP. Runs behind Cloudflare Tunnel.
 *
 * POST /proxy  — proxy a request (requires X-Proxy-Key auth)
 * GET  /health — health check
 */

const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "3100", 10);
const API_KEY = process.env.PROXY_API_KEY;

if (!API_KEY || API_KEY.length < 32) {
  console.error(
    "PROXY_API_KEY must be set and at least 32 characters. Exiting.",
  );
  process.exit(1);
}

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_REQUEST_BODY_SIZE = 1 * 1024 * 1024; // 1 MB (JSON envelope only)
const API_KEY_BUFFER = Buffer.from(API_KEY);

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const FORWARDED_HEADERS = [
  "content-type",
  "content-encoding",
  "last-modified",
  "etag",
];

// Headers dropped when a redirect crosses to a different origin, so caller
// credentials can't leak to an untrusted host (lowercase for case-insensitive match).
const SENSITIVE_REDIRECT_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

/**
 * Check if a hostname resolves to a private/reserved IP range.
 * Blocks SSRF through the proxy.
 *
 * NOTE: This uses string-based hostname checks only (no DNS resolution).
 * A hostname that resolves to a private IP (e.g. rebinding attack) would
 * bypass this check. Acceptable trade-off given: zero-dependency server,
 * API-key gated access, runs on a NAS behind Cloudflare Tunnel.
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

  // Check numeric IP patterns
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const octets = parts.map(Number);
    // 127.x.x.x
    if (octets[0] === 127) return true;
    // 10.x.x.x
    if (octets[0] === 10) return true;
    // 192.168.x.x
    if (octets[0] === 192 && octets[1] === 168) return true;
    // 172.16.0.0 – 172.31.255.255
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    // 169.254.x.x (link-local)
    if (octets[0] === 169 && octets[1] === 254) return true;
    // 0.0.0.0
    if (octets.every((o) => o === 0)) return true;
  }

  return false;
}

/**
 * Fetch a URL using Node built-in http/https, following redirects.
 * `body` (optional string) is sent for POST/PUT/etc. requests — adapters
 * that proxy a POST (e.g. Bangkok's PHP hareline API) need their request
 * body forwarded to the upstream.
 * Returns { statusCode, headers, body (Buffer) }.
 */
function fetchUrl(targetUrl, method, headers, body, redirectCount) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      return reject(new Error(`Too many redirects (>${MAX_REDIRECTS})`));
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return reject(new Error(`Unsupported protocol: ${parsed.protocol}`));
    }

    if (isPrivateTarget(parsed.hostname)) {
      return reject(
        new Error(`Blocked: target resolves to private IP (${parsed.hostname})`),
      );
    }

    const client = parsed.protocol === "https:" ? https : http;
    const mergedHeaders = { ...DEFAULT_HEADERS, ...headers };
    const hasBody = typeof body === "string" && body.length > 0;
    if (hasBody) {
      // Recompute Content-Length and send unchunked — PHP/nginx endpoints
      // often reject chunked transfer-encoding on POST. Strip any caller-
      // supplied content-length (any case) so we don't emit a duplicate.
      for (const k of Object.keys(mergedHeaders)) {
        if (k.toLowerCase() === "content-length") delete mergedHeaders[k];
      }
      mergedHeaders["Content-Length"] = Buffer.byteLength(body);
    }
    const options = {
      method: method || "GET",
      headers: mergedHeaders,
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = client.request(targetUrl, options, (res) => {
      // Follow redirects
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const nextParsed = new URL(res.headers.location, targetUrl);
        res.resume(); // drain response
        // Strip sensitive headers when the redirect crosses to a different
        // origin, so a redirect to an untrusted host can't exfiltrate
        // caller-supplied credentials.
        let nextHeaders = headers;
        if (nextParsed.origin !== parsed.origin) {
          nextHeaders = { ...headers };
          for (const k of Object.keys(nextHeaders)) {
            if (SENSITIVE_REDIRECT_HEADERS.has(k.toLowerCase())) {
              delete nextHeaders[k];
            }
          }
        }
        return resolve(
          fetchUrl(nextParsed.toString(), method, nextHeaders, body, redirectCount + 1),
        );
      }

      const chunks = [];
      let totalSize = 0;
      res.on("data", (chunk) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          res.destroy();
          return reject(
            new Error(`Response body exceeds ${MAX_BODY_SIZE} bytes`),
          );
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on("error", reject);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    if (hasBody) req.write(body);
    req.end();
  });
}

/**
 * Read the full request body as a string (capped at MAX_REQUEST_BODY_SIZE).
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
      timestamp: new Date().toISOString(),
    });
  }

  // Only accept POST /proxy
  if (req.method !== "POST" || req.url !== "/proxy") {
    return jsonResponse(res, 404, { error: "Not found" });
  }

  // Auth check (timing-safe to prevent key brute-forcing)
  const proxyKey = req.headers["x-proxy-key"];
  if (
    typeof proxyKey !== "string" ||
    proxyKey.length !== API_KEY.length ||
    !crypto.timingSafeEqual(Buffer.from(proxyKey), API_KEY_BUFFER)
  ) {
    return jsonResponse(res, 403, { error: "Invalid API key" });
  }

  try {
    const rawBody = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return jsonResponse(res, 400, { error: "Invalid JSON body" });
    }

    const { url, method, headers, body } = parsed;
    if (!url || typeof url !== "string") {
      return jsonResponse(res, 400, { error: "Missing or invalid 'url' field" });
    }
    if (body !== undefined && typeof body !== "string") {
      return jsonResponse(res, 400, { error: "'body' field must be a string" });
    }

    console.log(
      `[${new Date().toISOString()}] Proxying ${method || "GET"} ${url}`,
    );

    const result = await fetchUrl(url, method || "GET", headers || {}, body, 0);

    // Forward select response headers
    const responseHeaders = {};
    for (const name of FORWARDED_HEADERS) {
      if (Object.hasOwn(result.headers, name) && result.headers[name]) {
        responseHeaders[name] = result.headers[name];
      }
    }

    res.writeHead(result.statusCode, responseHeaders);
    res.end(result.body);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Proxy error: ${err.message}`);
    jsonResponse(res, 502, { error: "Proxy request failed" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy relay listening on 0.0.0.0:${PORT}`);
});
