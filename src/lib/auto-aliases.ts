/**
 * Auto-alias generation for kennels.
 *
 * Pure function that generates common alias variations from shortName and fullName.
 * Rules derived from the 246 existing aliases in prisma/seed.ts.
 */

const HASH_SUFFIXES = ["Hash House Harriers", "Hash House Harriettes", "Hash", "H3", "H4", "HHH"];
const STOP_WORDS = new Set(["hash", "house", "harriers", "harriettes", "h3", "h4", "hhh", "the", "and", "of", "in"]);

/** Known city name → abbreviation mappings */
const CITY_ABBREVIATIONS: Record<string, string> = {
  "new york city": "NYC",
  "new york": "NYC",
  "san francisco": "SF",
  "washington dc": "DC",
  "washington d.c.": "DC",
  "los angeles": "LA",
  "long island": "LI",
  "staten island": "SI",
  "east bay": "EB",
  "west london": "WL",
  "south london": "SL",
  "mount vernon": "MV",
  "old coulsdon": "OC",
  "old frederick": "OF",
};

/** Pre-compiled suffix patterns, sorted longest-first to avoid partial matches. */
const SORTED_SUFFIX_PATTERNS = [...HASH_SUFFIXES]
  .sort((a, b) => b.length - a.length)
  .map((s) => new RegExp(`\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"));

/**
 * Strip known hash-related suffixes from a name.
 * "East Bay Hash House Harriers" → "East Bay"
 */
function stripHashSuffix(name: string): string {
  let result = name.trim();
  for (const re of SORTED_SUFFIX_PATTERNS) {
    result = result.replace(re, "").trim();
  }
  return result;
}

/**
 * Extract an abbreviation from uppercase letters + digits in a name.
 * "East Bay Hash House Harriers" → "EBH3" (if has H3) or "EBHHH"
 * "Ben Franklin Mob H3" → "BFMH3"
 */
function extractAbbreviation(fullName: string): string | null {
  // Get the base name (without hash suffixes)
  const base = stripHashSuffix(fullName);
  if (!base) return null;

  // Take first letter of each word (uppercase)
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;

  const abbrev = words.map((w) => w[0].toUpperCase()).join("");
  return abbrev.length >= 2 ? abbrev : null;
}

/**
 * Generate common alias variations for a kennel.
 *
 * @param shortName - The kennel's shortName (e.g., "EBH3", "BFM")
 * @param fullName - The kennel's fullName (e.g., "East Bay Hash House Harriers")
 * @returns Array of alias strings (deduplicated, excludes shortName and fullName)
 */
export function generateAliases(shortName: string, fullName: string): string[] {
  const short = shortName.trim();
  const full = fullName.trim();

  if (!short && !full) return [];

  const aliases = new Set<string>();
  const lowerExclusions = new Set([short.toLowerCase(), full.toLowerCase()]);

  function add(alias: string) {
    const trimmed = alias.trim();
    if (!trimmed) return;
    if (lowerExclusions.has(trimmed.toLowerCase())) return;
    aliases.add(trimmed);
  }

  // 1. Base name (fullName without hash suffixes)
  const baseName = stripHashSuffix(full);
  if (baseName) {
    add(baseName);
  }

  // 2. Abbreviation from fullName
  const abbrev = extractAbbreviation(full);
  if (abbrev) {
    add(abbrev);
    // Also add abbreviation + H3 if the abbreviation doesn't already end with H3/H4
    if (!/H[34]$/i.test(abbrev)) {
      add(`${abbrev}H3`);
    }
  }

  // 3. H3/Hash variants of the base name
  if (baseName) {
    add(`${baseName} Hash`);
    add(`${baseName} H3`);
  }

  // 4. ShortName-based variants
  // If shortName ends with H3/H4, generate base + Hash variants
  const shortH3Match = short.match(/^(.+?)\s*H([34])$/i);
  if (shortH3Match) {
    const shortBase = shortH3Match[1];
    add(shortBase);
    add(`${shortBase} Hash`);
    add(`${shortBase} H${shortH3Match[2]}`);
  }

  // If shortName ends with HHH, generate H3 variant
  if (/HHH$/i.test(short)) {
    const shortBase = short.replace(/HHH$/i, "").trim();
    if (shortBase) {
      add(`${shortBase}H3`);
      add(`${shortBase} H3`);
    }
  }

  // 5. Geographic abbreviations
  const lowerBase = baseName.toLowerCase();
  for (const [city, abbr] of Object.entries(CITY_ABBREVIATIONS)) {
    if (lowerBase.startsWith(city) || full.toLowerCase().includes(city)) {
      add(abbr);
      add(`${abbr} Hash`);
      add(`${abbr} H3`);
    }
  }

  // 6. "The" prefix handling
  if (full.startsWith("The ") || full.startsWith("the ")) {
    const withoutThe = full.slice(4).trim();
    const withoutTheBase = stripHashSuffix(withoutThe);
    if (withoutTheBase) {
      add(withoutTheBase);
    }
  }

  // 7. Significant words from fullName (non-stop words, non-hash)
  const words = baseName.split(/\s+/).filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  if (words.length >= 2 && words.length < baseName.split(/\s+/).length) {
    // Only add if we actually filtered something
    add(words.join(" "));
  }

  return [...aliases];
}
