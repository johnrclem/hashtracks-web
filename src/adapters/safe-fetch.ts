/**
 * SSRF-safe fetch wrapper.
 * Validates URLs against private/reserved ranges before making requests.
 * Follows redirects manually to re-validate each target URL.
 * All adapter fetches should use this instead of raw `fetch()`.
 *
 * DNS-rebinding protection: `validateSourceUrlWithDns` resolves each
 * hostname and re-validates every A/AAAA record against private ranges.
 */
import { validateSourceUrl, validateSourceUrlWithDns } from "./utils";

const MAX_REDIRECTS = 5;

export interface SafeFetchOptions extends RequestInit {
  /** Route through NAS residential proxy. Use for WAF-blocked domains. */
  useResidentialProxy?: boolean;
}

/**
 * Convert various header formats to a plain Record<string, string>.
 */
function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const record: Record<string, string> = {};
    headers.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }
  if (Array.isArray(headers)) {
    const record: Record<string, string> = {};
    for (const [key, value] of headers) {
      record[key] = value;
    }
    return record;
  }
  return { ...headers };
}

export async function safeFetch(
  url: string,
  init?: SafeFetchOptions,
): Promise<Response> {
  // Residential proxy path
  if (init?.useResidentialProxy) {
    await validateSourceUrlWithDns(url); // Defense-in-depth: validate even when proxying

    const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
    const proxyKey = process.env.RESIDENTIAL_PROXY_KEY;

    if (!proxyUrl || !proxyKey) {
      console.warn(
        "Residential proxy requested but RESIDENTIAL_PROXY_URL/KEY not set — falling back to direct fetch",
      );
    } else {
      const headerRecord = headersToRecord(init.headers);
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Key": proxyKey,
        },
        body: JSON.stringify({
          url,
          method: init.method || "GET",
          headers: headerRecord,
        }),
        signal: init.signal ?? AbortSignal.timeout(45_000), // caller can override; default = 30s proxy + 15s tunnel
      });

      if (!proxyResponse.ok) {
        const body = await proxyResponse.text();
        throw new Error(
          `Residential proxy error (${proxyResponse.status}): ${body}`,
        );
      }

      return proxyResponse;
    }
  }

  // Direct fetch path (default)
  await validateSourceUrlWithDns(url);
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      await validateSourceUrlWithDns(currentUrl);
      redirectCount++;
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}

// Keep the sync re-export so callers that imported it here still resolve
// during the transition. Prefer importing from `./utils` directly.
export { validateSourceUrl };
