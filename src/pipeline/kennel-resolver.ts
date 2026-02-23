import { prisma } from "@/lib/db";

interface ResolveResult {
  kennelId: string | null;
  matched: boolean;
}

// In-memory cache for a single scrape run
const cache = new Map<string, ResolveResult>();

/** Clear the resolver cache (call between scrape runs) */
export function clearResolverCache() {
  cache.clear();
}

/** Step 1-2: Try exact shortName match (source-scoped then global), then alias match. */
async function resolveViaExactMatch(
  normalized: string,
  sourceId?: string,
): Promise<ResolveResult | null> {
  if (sourceId) {
    const sourceLinked = await prisma.kennel.findFirst({
      where: {
        shortName: { equals: normalized, mode: "insensitive" },
        sources: { some: { sourceId } },
      },
      select: { id: true },
    });
    if (sourceLinked) return { kennelId: sourceLinked.id, matched: true };
  }

  const kennel = await prisma.kennel.findFirst({
    where: { shortName: { equals: normalized, mode: "insensitive" } },
    select: { id: true },
  });
  if (kennel) return { kennelId: kennel.id, matched: true };

  return null;
}

/** Step 2: Try alias match. */
async function resolveViaAlias(normalized: string): Promise<ResolveResult | null> {
  const alias = await prisma.kennelAlias.findFirst({
    where: { alias: { equals: normalized, mode: "insensitive" } },
    select: { kennelId: true },
  });
  if (alias) return { kennelId: alias.kennelId, matched: true };
  return null;
}

/** Step 3: Pattern mapping + retry exact/alias with mapped name. */
async function resolveViaPatternMapping(
  normalized: string,
  sourceId?: string,
): Promise<ResolveResult | null> {
  const mapped = mapKennelTag(normalized.toLowerCase());
  if (!mapped) return null;

  const exactResult = await resolveViaExactMatch(mapped, sourceId);
  if (exactResult) return exactResult;

  const aliasResult = await resolveViaAlias(mapped);
  if (aliasResult) return aliasResult;

  return null;
}

/**
 * Resolve a raw kennel tag to a Kennel ID.
 *
 * Pipeline:
 * 1. Exact match on Kennel.shortName (case-insensitive)
 *    - When shortName is ambiguous (multiple regions), prefer source-linked kennel
 * 2. Case-insensitive match on KennelAlias.alias
 * 3. Pattern matching fallback (PRD Appendix D.2) → retry step 1
 * 4. No match → { kennelId: null, matched: false }
 *
 * @param tag - Raw kennel tag from scraper
 * @param sourceId - Optional source ID for disambiguation when shortName matches multiple kennels
 */
export async function resolveKennelTag(
  tag: string,
  sourceId?: string,
): Promise<ResolveResult> {
  const normalized = tag.trim();
  if (!normalized) return { kennelId: null, matched: false };

  const cacheKey = sourceId ? `${normalized.toLowerCase()}:${sourceId}` : normalized.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const exactResult = await resolveViaExactMatch(normalized, sourceId);
  if (exactResult) { cache.set(cacheKey, exactResult); return exactResult; }

  const aliasResult = await resolveViaAlias(normalized);
  if (aliasResult) { cache.set(cacheKey, aliasResult); return aliasResult; }

  const patternResult = await resolveViaPatternMapping(normalized, sourceId);
  if (patternResult) { cache.set(cacheKey, patternResult); return patternResult; }

  const result = { kennelId: null, matched: false };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Pattern matching fallback from PRD Appendix D.2.
 * Data-driven: patterns are evaluated in order (multi-word first, then shorter).
 * Returns the canonical shortName or null.
 */
const KENNEL_PATTERNS: [RegExp, string][] = [
  // Multi-word patterns FIRST (longer before shorter)
  [/ballbuster|bobbh3|b3h4/, "BoBBH3"],
  [/queens black knights/, "QBK"],
  [/(?:new amsterdam)|(?:^nass)/, "NAH3"],
  [/long island|lunatics/, "LIL"],
  [/staten island/, "SI"],
  [/drinking practice/, "Drinking Practice (NYC)"],
  [/knickerbocker/, "Knick"],
  [/pink taco|pt2h3/, "Pink Taco"],

  // Brooklyn (before generic "br" patterns)
  [/^(?:brooklyn|brh3)/, "BrH3"],

  // NAWW
  [/naww/, "NAWWH3"],

  // NAH3
  [/^nah3/, "NAH3"],

  // NYC (after more specific NYC-area kennels)
  [/^(?:nyc|nych3)/, "NYCH3"],

  // Boston area
  [/^(?:boston hash|bh3|boh3)/, "BoH3"],
  [/moon|moom/, "Bos Moon"],
  [/beantown/, "Beantown"],

  // Remaining short patterns
  [/queens/, "QBK"],
  [/knick/, "Knick"],
  [/lil/, "LIL"],
  [/columbia/, "Columbia"],
  [/ggfm/, "GGFM"],
  [/harriettes/, "Harriettes"],
  [/(?:si hash)|(?:^si$)/, "SI"],
  [/special/, "Special (NYC)"],

  // Philadelphia
  [/ben franklin|bfm/, "BFM"],
  [/philly|hashphilly/, "Philly H3"],

  // Chicago
  [/(?:^ch3)|(?:chicago)/, "CH3"],

  // Summit / NJ area
  [/asssh3|all seasons summit shiggy/, "ASSSH3"],
  [/(?:summit full moon)|(?:^sfm$)/, "SFM"],
  [/summit/, "Summit"],
  [/rumson/, "Rumson"],
];

export function mapKennelTag(input: string): string | null {
  const normalized = input.trim();
  for (const [pattern, result] of KENNEL_PATTERNS) {
    if (pattern.test(normalized)) return result;
  }
  return null;
}
