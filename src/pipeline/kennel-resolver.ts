import { prisma } from "@/lib/db";

/** Outcome of resolving a raw kennel tag to a database Kennel record. */
interface ResolveResult {
  /** The matched Kennel ID, or null if no match was found. */
  kennelId: string | null;
  /** Whether the tag was successfully matched (via exact, alias, or pattern). */
  matched: boolean;
}

// In-memory cache for a single scrape run
const cache = new Map<string, ResolveResult>();

/** Clear the resolver cache (call between scrape runs) */
export function clearResolverCache() {
  cache.clear();
}

/** Step 0: Try kennelCode match (immutable identifier). Source-scoped first, then global. */
async function resolveViaKennelCode(
  normalized: string,
  sourceId?: string,
): Promise<ResolveResult | null> {
  if (sourceId) {
    const sourceLinked = await prisma.kennel.findFirst({
      where: {
        kennelCode: { equals: normalized, mode: "insensitive" },
        sources: { some: { sourceId } },
      },
      select: { id: true },
    });
    if (sourceLinked) return { kennelId: sourceLinked.id, matched: true };
  }

  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: { equals: normalized, mode: "insensitive" } },
    select: { id: true },
  });
  if (kennel) return { kennelId: kennel.id, matched: true };

  return null;
}

/** Step 1: Try exact shortName match. Source-scoped first, then global. Alias matching is handled separately by resolveViaAlias. */
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

/** Step 2: Try alias match. Source-scoped first, then global. */
async function resolveViaAlias(
  normalized: string,
  sourceId?: string,
): Promise<ResolveResult | null> {
  // Source-scoped first: prefer alias on a kennel linked to this source
  if (sourceId) {
    const linked = await prisma.kennelAlias.findFirst({
      where: {
        alias: { equals: normalized, mode: "insensitive" },
        kennel: { sources: { some: { sourceId } } },
      },
      select: { kennelId: true },
    });
    if (linked) return { kennelId: linked.kennelId, matched: true };
  }
  // Global fallback
  const alias = await prisma.kennelAlias.findFirst({
    where: { alias: { equals: normalized, mode: "insensitive" } },
    select: { kennelId: true },
  });
  if (alias) return { kennelId: alias.kennelId, matched: true };
  return null;
}

/** Step 3: Pattern mapping + retry steps 0–2 with mapped kennelCode. */
async function resolveViaPatternMapping(
  normalized: string,
  sourceId?: string,
): Promise<ResolveResult | null> {
  const mapped = mapKennelTag(normalized.toLowerCase());
  if (!mapped) return null;

  const kennelCodeResult = await resolveViaKennelCode(mapped, sourceId);
  if (kennelCodeResult) return kennelCodeResult;

  const exactResult = await resolveViaExactMatch(mapped, sourceId);
  if (exactResult) return exactResult;

  const aliasResult = await resolveViaAlias(mapped, sourceId);
  if (aliasResult) return aliasResult;

  return null;
}

/**
 * Resolve a raw kennel tag to a Kennel ID.
 *
 * Pipeline:
 * 0. Exact match on Kennel.kennelCode (case-insensitive, immutable identifier)
 *    - When source-scoped, prefer source-linked kennel
 * 1. Exact match on Kennel.shortName (case-insensitive)
 *    - When shortName is ambiguous (multiple regions), prefer source-linked kennel
 * 2. Case-insensitive match on KennelAlias.alias
 * 3. Pattern matching fallback (PRD Appendix D.2) → retry steps 0, 1, and 2 with mapped kennelCode
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

  const kennelCodeResult = await resolveViaKennelCode(normalized, sourceId);
  if (kennelCodeResult) { cache.set(cacheKey, kennelCodeResult); return kennelCodeResult; }

  const exactResult = await resolveViaExactMatch(normalized, sourceId);
  if (exactResult) { cache.set(cacheKey, exactResult); return exactResult; }

  const aliasResult = await resolveViaAlias(normalized, sourceId);
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
 * Each entry maps a regex to the canonical kennelCode (immutable identifier).
 */
const KENNEL_PATTERNS: readonly [RegExp, string][] = [
  // Multi-word patterns FIRST (longer before shorter)
  [/ballbuster|bobbh3|b3h4/, "bobbh3"],
  [/queens black knights/, "qbk"],
  [/(?:new amsterdam)|(?:^nass)/, "nah3"],
  [/long island|lunatics/, "lil"],
  [/staten island/, "si"],
  [/drinking practice/, "drinking-practice-nyc"],
  [/knickerbocker/, "knick"],
  [/pink taco|pt2h3/, "pink-taco"],

  // Brooklyn (before generic "br" patterns)
  [/^(?:brooklyn|brh3)/, "brh3"],

  // NAWW
  [/naww/, "nawwh3"],

  // NAH3
  [/^nah3/, "nah3"],

  // NYC (after more specific NYC-area kennels)
  [/^(?:nyc|nych3)/, "nych3"],

  // Boston area
  [/^(?:boston hash|bh3|boh3)/, "boh3"],
  [/moon|moom/, "bos-moon"],
  [/beantown/, "beantown"],

  // Remaining short patterns
  [/queens/, "qbk"],
  [/knick/, "knick"],
  [/lil/, "lil"],
  [/columbia/, "columbia"],
  [/ggfm/, "ggfm"],
  [/harriettes/, "harriettes-nyc"],
  [/(?:si hash)|(?:^si$)/, "si"],
  [/special/, "special-nyc"],

  // Philadelphia
  [/ben franklin|bfm/, "bfm"],
  [/philly|hashphilly/, "philly-h3"],

  // Chicago
  [/(?:^ch3)|(?:chicago)/, "ch3"],

  // Summit / NJ area
  [/asssh3|all seasons summit shiggy/, "asssh3"],
  [/(?:summit full moon)|(?:^sfm$)/, "sfm"],
  [/summit/, "summit"],
  [/rumson/, "rumson"],
];

/** Apply regex pattern matching to map a raw kennel tag to a canonical kennelCode. Returns null if no pattern matches. */
export function mapKennelTag(input: string): string | null {
  const normalized = input.trim();
  for (const [pattern, result] of KENNEL_PATTERNS) {
    if (pattern.test(normalized)) return result;
  }
  return null;
}
