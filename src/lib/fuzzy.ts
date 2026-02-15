/**
 * Fuzzy string matching utilities.
 * Levenshtein distance + substring boost, no external deps.
 * Used for kennel tag resolution and user-to-hasher name matching.
 */

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    Array(lb + 1).fill(0),
  );

  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[la][lb];
}

/**
 * Compare two names for similarity. Returns 0–1 (1 = exact match).
 * Case-insensitive, trims whitespace. Used for user-to-hasher matching.
 */
export function fuzzyNameMatch(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

export interface FuzzyCandidate {
  id: string;
  shortName: string;
  fullName: string | null;
  aliases?: string[];
}

export interface FuzzyMatch {
  id: string;
  shortName: string;
  score: number;
}

/**
 * Rank candidates by fuzzy similarity to the input tag.
 * Returns top N matches sorted by score (0–1, higher = better).
 */
export function fuzzyMatch(
  input: string,
  candidates: FuzzyCandidate[],
  limit = 5,
): FuzzyMatch[] {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return [];

  const scored = candidates.map((c) => {
    const names = [
      c.shortName.toLowerCase(),
      ...(c.fullName ? [c.fullName.toLowerCase()] : []),
      ...(c.aliases?.map((a) => a.toLowerCase()) ?? []),
    ];

    let bestScore = 0;

    for (const name of names) {
      // Exact match
      if (name === normalized) {
        bestScore = 1;
        break;
      }

      // Substring containment boost
      const containsBoost =
        name.includes(normalized) || normalized.includes(name) ? 0.3 : 0;

      // Levenshtein similarity (normalized to 0–1)
      const maxLen = Math.max(name.length, normalized.length);
      const dist = levenshtein(name, normalized);
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;

      bestScore = Math.max(bestScore, similarity + containsBoost);
    }

    return { id: c.id, shortName: c.shortName, score: Math.min(bestScore, 1) };
  });

  return scored
    .filter((s) => s.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
