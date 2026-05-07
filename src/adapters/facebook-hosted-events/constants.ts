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
