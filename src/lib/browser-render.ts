/**
 * Client for the NAS headless browser rendering service.
 * Used to render JS-heavy pages (Wix, Google Sites, SPAs) that
 * can't be scraped with Cheerio alone.
 *
 * Follows the same pattern as safeFetch() residential proxy integration.
 */

import { validateSourceUrlWithDns } from "@/adapters/ssrf-dns";

/**
 * Format a non-2xx response body from the NAS render service into a human
 * diagnostic string. The server returns:
 *   - 502 + `{error: "Render failed", detail: "<playwright msg>"}` on Playwright errors
 *   - 422 + `{error: "..."}` (no detail) on selector/frame mismatches
 *   - 4xx + `{error: "..."}` on bad input
 * If the body isn't JSON (e.g. an actual Cloudflare 5xx page), returns it raw.
 *
 * Exported for unit testing.
 */
export function formatRenderErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; detail?: unknown };
    const errStr = typeof parsed.error === "string" ? parsed.error : null;
    const detailStr = typeof parsed.detail === "string" ? parsed.detail : null;
    if (errStr && detailStr) return `${errStr}: ${detailStr}`;
    if (errStr) return errStr;
    if (detailStr) return detailStr;
  } catch {
    // Not JSON — fall through to raw body.
  }
  return body;
}

export interface RenderOptions {
  /** URL of the page to render */
  url: string;
  /** CSS selector to wait for before capturing (default: "body") */
  waitFor?: string;
  /** CSS selector to extract — returns only that element's HTML (default: full page) */
  selector?: string;
  /** URL substring to match a child iframe — returns that frame's rendered content instead of the main page.
   *  Used for cross-origin iframes (e.g., Wix Table Master) that can't be rendered standalone. */
  frameUrl?: string;
  /** Max wait in ms (default: 15000, capped at 30000 server-side) */
  timeout?: number;
  /** IANA timezone (e.g. "America/Chicago") for the rendering browser context.
   *  Wix and other JS-rendered calendars use the browser's timezone via
   *  Intl.DateTimeFormat to format event dates. Without this, Playwright's
   *  default UTC context yields viewer-local dates that are off by hours
   *  for kennels in non-UTC zones (#960 BCH3 — Thu 8pm CDT shown as Fri
   *  12am UTC). Default: undefined → server uses UTC (current behavior). */
  timezoneId?: string;
}

/**
 * Render a JS-heavy page via the NAS headless browser service.
 * Returns the rendered HTML as a string.
 *
 * Requires BROWSER_RENDER_URL and BROWSER_RENDER_KEY env vars.
 */
export async function browserRender(options: RenderOptions): Promise<string> {
  // Defense-in-depth: validate the target URL before forwarding to the NAS
  // render service. The NAS service has its own SSRF check but we want to
  // block alternate IP notations, IPv4-mapped IPv6, and DNS rebinding here
  // too.
  // (frameUrl is a URL substring for iframe matching, not a full URL, so
  // it is not validated here — the NAS service only matches it against
  // frames already loaded by the primary URL.)
  await validateSourceUrlWithDns(options.url);

  const renderUrl = process.env.BROWSER_RENDER_URL;
  const renderKey = process.env.BROWSER_RENDER_KEY;

  if (!renderUrl || !renderKey) {
    throw new Error(
      "Browser render service not configured: set BROWSER_RENDER_URL and BROWSER_RENDER_KEY",
    );
  }

  // Retry budget: the cron scrape route has maxDuration=120s. Each fetch below
  // can take up to 45s. We allow at most one retry on 429 and bound the backoff
  // so the worst-case wall time is ~100s (45 + 10 + 45), leaving ~20s for the
  // rest of the scrape pipeline to run and record its result.
  const maxAttempts = 2;
  const backoffMs = 10_000;
  const fetchTimeoutMs = 45_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${renderUrl}/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Render-Key": renderKey,
      },
      body: JSON.stringify({
        url: options.url,
        waitFor: options.waitFor,
        selector: options.selector,
        frameUrl: options.frameUrl,
        timeout: options.timeout,
        timezoneId: options.timezoneId,
      }),
      signal: AbortSignal.timeout(fetchTimeoutMs), // 30s render timeout + 15s tunnel buffer
    });

    if (response.status === 429 && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Browser render error (${response.status}): ${formatRenderErrorBody(body)}`,
      );
    }

    return response.text();
  }

  // Unreachable: the loop's final iteration always exits via the !response.ok
  // throw above. Kept as a defensive assertion for TypeScript control flow.
  throw new Error("Browser render: unexpected exit from retry loop");
}
