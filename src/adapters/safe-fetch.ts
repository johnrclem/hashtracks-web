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

/**
 * Which NAS proxy-relay egress to route a request through instead of fetching
 * directly from the app's own (datacenter) IP:
 *  - "residential" — the NAS's home residential IP (`RESIDENTIAL_PROXY_URL/KEY`).
 *    For origins that block datacenter IPs but allow residential ones.
 *  - "vpn" — a VPN-routed relay egress (`VPN_PROXY_URL/KEY`). For origins that
 *    block BOTH datacenter and the home residential range — e.g. OVH's
 *    anti-DDoS firewall on board.atlantahash.com, which drops Vercel and the
 *    home Spectrum IP alike but lets a VPN exit through (#2054).
 */
export type ProxyEgress = "residential" | "vpn";

export interface SafeFetchOptions extends RequestInit {
  /**
   * Route through the NAS residential proxy (for WAF-blocked domains).
   * Convenience alias for `egress: "residential"`; an explicit `egress` takes
   * precedence when both are set.
   */
  useResidentialProxy?: boolean;
  /**
   * Route through a named NAS proxy-relay egress. Takes precedence over
   * `useResidentialProxy`. Fails CLOSED (throws) when the corresponding proxy
   * env vars are unset — an explicit egress must not silently degrade to a
   * direct fetch, because the caller depends on that specific exit (e.g. the
   * origin blocks direct datacenter traffic).
   */
  egress?: ProxyEgress;
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

/**
 * Resolve the proxy-relay endpoint + auth key for a named egress. Both the
 * residential and VPN egresses speak the same `/proxy` JSON envelope; they only
 * differ in which NAS relay (and therefore which outbound IP) handles the request.
 */
function resolveProxyEgress(egress: ProxyEgress): {
  proxyUrl: string | undefined;
  proxyKey: string | undefined;
  envLabel: string;
} {
  switch (egress) {
    case "vpn":
      return {
        proxyUrl: process.env.VPN_PROXY_URL,
        proxyKey: process.env.VPN_PROXY_KEY,
        envLabel: "VPN_PROXY_URL/KEY",
      };
    case "residential":
      return {
        proxyUrl: process.env.RESIDENTIAL_PROXY_URL,
        proxyKey: process.env.RESIDENTIAL_PROXY_KEY,
        envLabel: "RESIDENTIAL_PROXY_URL/KEY",
      };
    default: {
      // Exhaustiveness guard: a new ProxyEgress value fails to compile here
      // rather than silently resolving to the residential defaults.
      const unknown: never = egress;
      throw new Error(`Unknown proxy egress: ${String(unknown)}`);
    }
  }
}

export async function safeFetch(
  url: string,
  init?: SafeFetchOptions,
): Promise<Response> {
  // Proxy-relay egress path. An explicit `egress` wins and fails CLOSED when its
  // env vars are missing (the caller depends on that exit — e.g. Atlanta's origin
  // blocks direct datacenter traffic, so a silent direct fetch would just hammer
  // the known-bad path). `useResidentialProxy` is the legacy alias and keeps a
  // graceful direct-fetch fallback so dev environments (no proxy env) work unchanged.
  const explicitEgress = init?.egress;
  const egress: ProxyEgress | undefined =
    explicitEgress ?? (init?.useResidentialProxy ? "residential" : undefined);
  // `egress` can only be set when `init` is defined; the `&& init` restores that
  // narrowing for TS inside the block (init.headers/method/body/signal below).
  // Track whether the URL was already DNS-validated here so the direct-fetch
  // fallback (legacy alias + no proxy env) doesn't redundantly re-resolve it.
  let urlValidated = false;
  if (egress && init) {
    await validateSourceUrlWithDns(url); // Defense-in-depth: validate even when proxying
    urlValidated = true;

    const { proxyUrl, proxyKey, envLabel } = resolveProxyEgress(egress);

    if (!proxyUrl || !proxyKey) {
      if (explicitEgress) {
        throw new Error(
          `safeFetch: egress "${egress}" requested but ${envLabel} not configured — refusing to fall back to a direct fetch`,
        );
      }
      console.warn(
        `Residential proxy requested but ${envLabel} not set — falling back to direct fetch`,
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
          `${egress} proxy error (${proxyResponse.status}): ${body}`,
        );
      }

      return proxyResponse;
    }
  }

  // Direct fetch path (default). Skip re-validation if the proxy branch already
  // DNS-validated this URL (legacy-alias fallback with no proxy env configured).
  if (!urlValidated) {
    await validateSourceUrlWithDns(url);
  }
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
