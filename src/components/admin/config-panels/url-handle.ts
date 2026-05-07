/**
 * Shared helper for admin config panels that accept either a full URL or a
 * raw handle/slug.
 *
 * MeetupConfigPanel and FacebookHostedEventsConfigPanel both need this
 * pattern: paste a full URL like `https://www.facebook.com/SomePage/` and
 * extract just `SomePage` for the persisted config. Without a shared helper
 * the two panels duplicate the try/catch + URL parse + path-split logic.
 */

export interface ExtractFirstPathSegmentOptions {
  /**
   * First-path-segments that aren't valid handles on the target host.
   * For Facebook, paths like `/events/{id}/` and `/groups/{id}/` are
   * structural namespaces, not Page handles — accepting them would build
   * an invalid scrape URL like `facebook.com/events/upcoming_hosted_events`.
   * When the first segment matches one of these, we fall back to returning
   * the original trimmed input so the server-side validator rejects it
   * with a meaningful "doesn't match handle shape" message instead of
   * silently persisting a bad value.
   */
  readonly reservedFirstSegments?: readonly string[];
}

/**
 * Extract the first path segment from a URL on the given host (or any
 * subdomain of it). Returns the trimmed input unchanged when:
 *   - The input doesn't parse as a URL.
 *   - The URL's host doesn't match `allowedHostSuffix`.
 *   - The URL has an empty path.
 *   - The first path segment is in `options.reservedFirstSegments`.
 *
 * The fallback shape is intentional — admin can paste either a full URL or
 * a bare slug, and the server-side validator (`FB_PAGE_HANDLE_RE`,
 * meetup `groupUrlname` shape, etc.) rejects malformed slugs at save time.
 */
export function extractFirstPathSegment(
  value: string,
  allowedHostSuffix: string,
  options: ExtractFirstPathSegmentOptions = {},
): string {
  const trimmed = value.trim();
  const reserved = options.reservedFirstSegments;
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const allowed =
      url.hostname === allowedHostSuffix || url.hostname.endsWith(`.${allowedHostSuffix}`);
    if (allowed) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        const first = parts[0];
        if (reserved?.some((r) => r.toLowerCase() === first.toLowerCase())) {
          return trimmed;
        }
        return first;
      }
    }
  } catch {
    // Not a URL — fall through to return the trimmed input as-is.
  }
  return trimmed;
}

