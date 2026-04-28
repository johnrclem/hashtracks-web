/**
 * Shared kennelPatterns config grammar + matcher (#1023 step 4).
 *
 * A pattern entry is a tuple of `[regexString, kennelTagOrTags]`. The tag
 * value may be:
 *   - a `string` — single-kennel routing, preserves the legacy first-match
 *     behavior so existing single-tag configs are unaffected.
 *   - a `string[]` — declares the regex legitimately tags multiple kennels
 *     (a true co-host). Multi-kennel emission is opt-in per pattern; an
 *     adapter author has to consciously promote a pattern to array form.
 *
 * Precedence (spec §2 D15):
 *   1. If any array-typed pattern matches anywhere in the list, return the
 *      union of all array values from matched entries (deduplicated, in
 *      first-seen order).
 *   2. Otherwise return `[firstStringMatch]` for the first matching string
 *      pattern (legacy behavior preserved for string-only configs).
 *   3. Otherwise return `[]`.
 *
 * Once any array pattern matches, subsequent string matches are advisory
 * only — they do NOT contribute to the result. This keeps the routing
 * deterministic when a source author intentionally promotes one pattern
 * to array form.
 */

export type KennelPatternValue = string | string[];

/**
 * One kennelPatterns entry: regex string + tag value. Stored as a tuple in
 * source.config so the order is preserved through JSON round-trips.
 */
export type KennelPattern = readonly [string, KennelPatternValue];

/**
 * Match `text` against the configured patterns and return the resolved
 * kennel tags per the precedence rules above. Always returns an array;
 * empty when nothing matched.
 *
 * Malformed regex strings from source config are skipped silently.
 */
export function matchKennelPatterns(
  text: string,
  patterns: readonly KennelPattern[],
): string[] {
  let arrayMatches: string[] | null = null;
  let firstStringMatch: string | null = null;

  for (const [regex, value] of patterns) {
    let matched: boolean;
    try {
      matched = new RegExp(regex, "i").test(text);
    } catch {
      continue;
    }
    if (!matched) continue;

    if (Array.isArray(value)) {
      arrayMatches ??= [];
      for (const tag of value) {
        if (!arrayMatches.includes(tag)) arrayMatches.push(tag);
      }
    } else if (firstStringMatch === null && arrayMatches === null) {
      firstStringMatch = value;
    }
  }

  if (arrayMatches !== null) return arrayMatches;
  if (firstStringMatch !== null) return [firstStringMatch];
  return [];
}
