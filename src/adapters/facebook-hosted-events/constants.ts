/**
 * Shared constants for the FACEBOOK_HOSTED_EVENTS adapter.
 *
 * Centralizes regexes that are referenced by both the runtime adapter
 * (`adapter.ts`) and the admin form validator (`config-validation.ts`).
 * Single source of truth keeps cron-side and admin-side rejection rules
 * locked in step.
 */

/**
 * FB Page handle character set: alnum + dash + underscore + period, 2–80 chars.
 * Anchored with a fixed-bound character class — ReDoS-safe (no unbounded
 * repetition over alternation).
 */
export const FB_PAGE_HANDLE_RE = /^[A-Za-z0-9._-]{2,80}$/;

/**
 * Long numeric FB event IDs (typically 14–18 digits). The parser uses this
 * to filter unrelated node ids (page handles, photo ids, etc.) that share
 * the same `id` key name in the GraphQL graph.
 */
export const FB_EVENT_ID_RE = /^\d{14,18}$/;

/**
 * First-path-segments under `facebook.com` that are FB structural namespaces,
 * not Page handles. Pasting any of these as a URL into a Facebook config
 * panel must NOT be silently accepted as a `pageHandle` — they pass the
 * shape regex (alnum + dot/dash/underscore, 2–80 chars) but would build an
 * invalid scrape URL like `facebook.com/events/upcoming_hosted_events`.
 *
 * Single source of truth for both the admin panel's URL extractor and the
 * server-side validator — Codex review pass-1 finding on PR #1292.
 *
 * Adding entries to this list is purely defensive: missing one just means
 * the existing handle-shape regex is the only line of defense against a
 * pasted URL like `facebook.com/<reserved>/foo`. Source: union of FB
 * namespace prefixes we've seen admins paste accidentally — there is no
 * official published list.
 */
export const FB_RESERVED_FIRST_SEGMENTS = [
  "events",
  "groups",
  "people",
  "pages",
  "profile.php",
  "watch",
  "marketplace",
  "messages",
  "gaming",
  "settings",
  "help",
  "policies",
  "login",
  "logout",
  "recover",
  "reg",
  "home.php",
  "story.php",
  "video.php",
  "photo.php",
  "permalink.php",
  "share",
  "saved",
  "memories",
  "fundraisers",
  "discover",
  "search",
  "ads",
  "business",
  "creators",
  "developers",
  "lite",
  "messenger",
  "sharer.php",
] as const;

/** Case-insensitive membership check against `FB_RESERVED_FIRST_SEGMENTS`. */
export function isReservedFacebookHandle(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return FB_RESERVED_FIRST_SEGMENTS.some((r) => r.toLowerCase() === normalized);
}
