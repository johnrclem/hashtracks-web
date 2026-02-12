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

/**
 * Resolve a raw kennel tag to a Kennel ID.
 *
 * Pipeline:
 * 1. Exact match on Kennel.shortName (case-insensitive)
 * 2. Case-insensitive match on KennelAlias.alias
 * 3. Pattern matching fallback (PRD Appendix D.2) → retry step 1
 * 4. No match → { kennelId: null, matched: false }
 */
export async function resolveKennelTag(
  tag: string,
): Promise<ResolveResult> {
  const normalized = tag.trim();
  if (!normalized) return { kennelId: null, matched: false };

  // Check cache first
  const cacheKey = normalized.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Step 1: Exact match on shortName (case-insensitive)
  const kennel = await prisma.kennel.findFirst({
    where: { shortName: { equals: normalized, mode: "insensitive" } },
    select: { id: true },
  });
  if (kennel) {
    const result = { kennelId: kennel.id, matched: true };
    cache.set(cacheKey, result);
    return result;
  }

  // Step 2: Case-insensitive match on alias
  const alias = await prisma.kennelAlias.findFirst({
    where: { alias: { equals: normalized, mode: "insensitive" } },
    select: { kennelId: true },
  });
  if (alias) {
    const result = { kennelId: alias.kennelId, matched: true };
    cache.set(cacheKey, result);
    return result;
  }

  // Step 3: Pattern matching fallback (PRD Appendix D.2)
  const mapped = mapKennelTag(normalized.toLowerCase());
  if (mapped) {
    // Retry step 1 with the mapped short name
    const mappedKennel = await prisma.kennel.findFirst({
      where: { shortName: { equals: mapped, mode: "insensitive" } },
      select: { id: true },
    });
    if (mappedKennel) {
      const result = { kennelId: mappedKennel.id, matched: true };
      cache.set(cacheKey, result);
      return result;
    }

    // Retry step 2 with the mapped name as alias (handles renamed kennels)
    const mappedAlias = await prisma.kennelAlias.findFirst({
      where: { alias: { equals: mapped, mode: "insensitive" } },
      select: { kennelId: true },
    });
    if (mappedAlias) {
      const result = { kennelId: mappedAlias.kennelId, matched: true };
      cache.set(cacheKey, result);
      return result;
    }
  }

  // Step 4: No match
  const result = { kennelId: null, matched: false };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Pattern matching fallback from PRD Appendix D.2.
 * Multi-word patterns first, then shorter patterns.
 * Returns the canonical shortName or null.
 */
function mapKennelTag(input: string): string | null {
  // Multi-word patterns FIRST (longer before shorter)
  if (input.includes("ballbuster") || input.includes("bobbh3"))
    return "BoBBH3";
  if (input.includes("queens black knights")) return "QBK";
  if (input.includes("new amsterdam") || input.startsWith("nass"))
    return "NAH3";
  if (input.includes("long island") || input.includes("lunatics"))
    return "LIL";
  if (input.includes("staten island")) return "SI";
  if (input.includes("drinking practice")) return "Drinking Practice (NYC)";
  if (input.includes("knickerbocker")) return "Knick";
  if (input.includes("pink taco")) return "Pink Taco";

  // Brooklyn (before generic "br" patterns)
  if (input.startsWith("brooklyn") || input.startsWith("brh3")) return "BrH3";

  // NAWW
  if (input.startsWith("naww") || input.includes("naww")) return "NAWWH3";

  // NAH3
  if (input.startsWith("nah3")) return "NAH3";

  // NYC (after more specific NYC-area kennels)
  if (input.startsWith("nyc") || input.startsWith("nych3")) return "NYCH3";

  // Boston area
  if (
    input.startsWith("boston hash") ||
    input.startsWith("bh3") ||
    input.startsWith("boh3")
  )
    return "BoH3";
  if (input.includes("moon") || input.includes("moom")) return "Bos Moon";
  if (input.includes("beantown")) return "Beantown";

  // Remaining short patterns
  if (input.includes("queens")) return "QBK";
  if (input.includes("knick")) return "Knick";
  if (input.includes("lil")) return "LIL";
  if (input.includes("columbia")) return "Columbia";
  if (input.includes("ggfm")) return "GGFM";
  if (input.includes("harriettes")) return "Harriettes";
  if (input.includes("si hash") || input === "si") return "SI";
  if (input.includes("special")) return "Special (NYC)";

  // Ben Franklin / Philadelphia
  if (input.includes("ben franklin") || input.includes("bfm")) return "BFM";

  // Chicago
  if (input.startsWith("ch3") || input.includes("chicago")) return "CH3";

  // Summit / NJ area
  if (input.includes("asssh3") || input.includes("all seasons summit shiggy"))
    return "ASSSH3";
  if (input.includes("summit full moon") || input === "sfm") return "SFM";
  if (input.includes("summit")) return "Summit";
  if (input.includes("rumson")) return "Rumson";

  return null;
}
