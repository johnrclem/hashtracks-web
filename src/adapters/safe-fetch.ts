/**
 * SSRF-safe fetch wrapper.
 * Validates URLs against private/reserved ranges before making requests.
 * Follows redirects manually to re-validate each target URL.
 * All adapter fetches should use this instead of raw `fetch()`.
 */
import { validateSourceUrl } from "./utils";

const MAX_REDIRECTS = 5;

export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  validateSourceUrl(url);
  let currentUrl = url;
  let redirectCount = 0;

  while (redirectCount < MAX_REDIRECTS) {
    // eslint-disable-next-line -- fetch is SSRF-safe: URL validated by validateSourceUrl above
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).toString();
      validateSourceUrl(currentUrl);
      redirectCount++;
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}
