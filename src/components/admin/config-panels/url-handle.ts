/**
 * Shared helper for admin config panels that accept either a full URL or a
 * raw handle/slug.
 *
 * MeetupConfigPanel and FacebookHostedEventsConfigPanel both need this
 * pattern: paste a full URL like `https://www.facebook.com/SomePage/` and
 * extract just `SomePage` for the persisted config. Without a shared helper
 * the two panels duplicate the try/catch + URL parse + path-split logic.
 */

/**
 * Extract the first path segment from a URL on the given host (or any
 * subdomain of it). Returns the trimmed input unchanged when:
 *   - The input doesn't parse as a URL.
 *   - The URL's host doesn't match `allowedHostSuffix`.
 *   - The URL has an empty path.
 *
 * The fallback shape is intentional — admin can paste either a full URL or
 * a bare slug, and the server-side validator (`FB_PAGE_HANDLE_RE`,
 * meetup `groupUrlname` shape, etc.) rejects malformed slugs at save time.
 */
export function extractFirstPathSegment(value: string, allowedHostSuffix: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const allowed =
      url.hostname === allowedHostSuffix || url.hostname.endsWith(`.${allowedHostSuffix}`);
    if (allowed) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 0) return parts[0];
    }
  } catch {
    // Not a URL — fall through to return the trimmed input as-is.
  }
  return trimmed;
}
