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
 * Pre-compiled form of `KennelPattern`. Adapters that match the same
 * patterns against many events per scrape should compile once via
 * `compileKennelPatterns()` and pass the result to
 * `matchCompiledKennelPatterns()` to avoid `new RegExp(...)` overhead per
 * event.
 */
export type CompiledKennelPattern = readonly [RegExp, KennelPatternValue];

/**
 * Compile a list of source-config kennel patterns into runtime form.
 * Malformed regex strings are dropped (with `console.warn`) so a single
 * bad config entry doesn't kill the whole scrape.
 */
export function compileKennelPatterns(
  patterns: readonly KennelPattern[],
): CompiledKennelPattern[] {
  const compiled: CompiledKennelPattern[] = [];
  for (const [regex, value] of patterns) {
    try {
      // nosemgrep: detect-non-literal-regexp — patterns are pre-validated via safe-regex2 in config-validation.ts
      compiled.push([new RegExp(regex, "i"), value]); // NOSONAR
    } catch (err) {
      console.warn(
        `[kennel-patterns] Skipping malformed regex ${JSON.stringify(regex)}: ${(err as Error).message}`,
      );
    }
  }
  return compiled;
}

/** Update accumulator state for a single matched pattern (extracted to keep
 *  the matcher's cognitive complexity below SonarCloud's threshold). */
function applyMatch(
  value: KennelPatternValue,
  acc: { arrayMatches: string[] | null; firstStringMatch: string | null },
): void {
  if (Array.isArray(value)) {
    acc.arrayMatches ??= [];
    for (const tag of value) {
      if (!acc.arrayMatches.includes(tag)) acc.arrayMatches.push(tag);
    }
  } else if (acc.firstStringMatch === null && acc.arrayMatches === null) {
    acc.firstStringMatch = value;
  }
}

/**
 * Match `text` against pre-compiled kennel patterns. Always returns an
 * array; empty when nothing matched. See module docstring for precedence.
 */
export function matchCompiledKennelPatterns(
  text: string,
  compiled: readonly CompiledKennelPattern[],
): string[] {
  const acc: { arrayMatches: string[] | null; firstStringMatch: string | null } = {
    arrayMatches: null,
    firstStringMatch: null,
  };
  for (const [regex, value] of compiled) {
    if (regex.test(text)) applyMatch(value, acc);
  }
  if (acc.arrayMatches !== null) return acc.arrayMatches;
  if (acc.firstStringMatch !== null) return [acc.firstStringMatch];
  return [];
}

/**
 * Convenience: compile + match in one call. Use only for one-off matches
 * (tests, scripts). Hot paths should compile once per scrape via
 * `compileKennelPatterns()` and reuse `matchCompiledKennelPatterns()`.
 */
export function matchKennelPatterns(
  text: string,
  patterns: readonly KennelPattern[],
): string[] {
  return matchCompiledKennelPatterns(text, compileKennelPatterns(patterns));
}
