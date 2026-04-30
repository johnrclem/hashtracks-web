/**
 * Shared markdown fragments for audit prompts.
 *
 * Centralized so the deep-dive (chrome-kennel) and hareline (chrome-event)
 * prompts can't drift apart on suppression/schema-gap guidance, and the
 * cross-reference issue numbers (#503, #504) update in one place when the
 * schema work lands.
 */

/** Live suppressions endpoint shown to chrome agents before they file. */
export const AUDIT_SUPPRESSIONS_URL =
  "https://hashtracks.xyz/api/audit/suppressions";

/**
 * Markdown bullet list of fields that have no visible home on a HashTracks
 * event card today. Tag findings against these as `schema-gap`, not as
 * extraction bugs, so they route to a PRD decision instead of an adapter PR.
 */
export const SCHEMA_GAP_FIELDS_MD = [
  "- `endTime` — schema work tracked in #504",
  "- `cost` — schema work tracked in #503",
  "- `trailType`, `shiggy level`, `beer meister`, `on-after venue`, `what to bring` — no schema decision yet; flag with rule `schema-gap` and the PRD owner can group them",
].join("\n");
