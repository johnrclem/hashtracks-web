/**
 * SSRF-safe fetch wrapper.
 * Validates URLs against private/reserved ranges before making requests.
 * Follows redirects manually to re-validate each target URL.
 * All adapter fetches should use this instead of raw `fetch()`.
 *
 * DNS-rebinding protection: `validateSourceUrlWithDns` resolves each
 * hostname and re-validates every A/AAAA record against private ranges.
 */
import { validateSourceUrlWithDns } from "./ssrf-dns";

// Re-export the sync variant for callers that imported it here historically.
export { validateSourceUrl } from "./utils";

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
      // Forward the request body so proxied POSTs work (e.g. Bangkok's PHP
      // hareline API needs its JSON body). Only string bodies are forwarded —
      // the JSON envelope can't carry Blob/FormData/stream bodies, and every
      // adapter that proxies a POST already serializes to a string.
      const proxyPayload: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
      } = {
        url,
        method: init.method || "GET",
        headers: headerRecord,
      };
      if (typeof init.body === "string") {
        proxyPayload.body = init.body;
      }
      const proxyResponse = await fetch(`${proxyUrl}/proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proxy-Key": proxyKey,
        },
        body: JSON.stringify(proxyPayload),
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

  // Default timeout so a slow / non-responding endpoint can't hang the scrape
  // indefinitely (mirrors the residential-proxy branch). One signal is shared
  // across every redirect hop, so it bounds the *total* request time rather
  // than resetting per hop; a caller-supplied signal takes precedence.
  const signal = init?.signal ?? AbortSignal.timeout(45_000);

  while (redirectCount < MAX_REDIRECTS) {
    // This IS the SSRF guard: currentUrl is validated by validateSourceUrlWithDns()
    // before the first fetch and again after every redirect target is computed
    // (the call above the loop + line 105). The variable-URL fetch is intentional.
    // nosemgrep
    const response = await fetch(currentUrl, { ...init, redirect: "manual", signal }); // NOSONAR nosemgrep
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
