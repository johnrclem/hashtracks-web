/**
 * REF code resolver for the boarding-pass search form. Returns an
 * IATA-style 3-letter code for a destination label, falling back to
 * a 3-letter slug when the city isn't in the lookup.
 *
 * The empty-destination case renders as `—` (em-dash) in the form —
 * stronger gesture than a literal "HT-XXX" placeholder.
 *
 * Values here are IATA metropolitan codes where they exist (NYC, LON,
 * WAS) since travelers arrive at multiple airports per metro. Single-
 * airport cities use their airport code (ORD, SEA, BOS, etc.). Match
 * happens on a normalized city prefix so "Boston, MA, USA" and
 * "Boston" both resolve to BOS.
 */

const IATA_LOOKUP: Record<string, string> = {
  // Curated popular destinations (seeded in popular-destinations.ts)
  "washington": "DCA",
  "london": "LHR",
  "bangkok": "BKK",
  "new york": "NYC",
  "san francisco": "SFO",
  "singapore": "SIN",
  "berlin": "BER",
  "tokyo": "HND",

  // Common US metros
  "boston": "BOS",
  "chicago": "ORD",
  "los angeles": "LAX",
  "miami": "MIA",
  "seattle": "SEA",
  "portland": "PDX",
  "austin": "AUS",
  "atlanta": "ATL",
  "dallas": "DFW",
  "denver": "DEN",
  "minneapolis": "MSP",
  "philadelphia": "PHL",
  "phoenix": "PHX",
  "san diego": "SAN",
  "nashville": "BNA",
  "new orleans": "MSY",
  "las vegas": "LAS",
  "detroit": "DTW",
  "houston": "IAH",
  "pittsburgh": "PIT",

  // International
  "paris": "CDG",
  "madrid": "MAD",
  "rome": "FCO",
  "amsterdam": "AMS",
  "dublin": "DUB",
  "hong kong": "HKG",
  "sydney": "SYD",
  "melbourne": "MEL",
  "mexico city": "MEX",
  "toronto": "YYZ",
  "vancouver": "YVR",
};

/**
 * Normalize a destination label for lookup: strip everything after the
 * first comma (country/state suffix), lowercase, trim. "Boston, MA, USA"
 * → "boston"; "New York, NY, USA" → "new york".
 */
function normalizeCityKey(label: string): string {
  return label.split(",")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Resolve a 3-letter REF code for a destination label. Empty label
 * returns "—" (em-dash) for the landing-state REF stamp.
 */
export function resolveRefCode(label: string | null | undefined): string {
  const clean = label?.trim() ?? "";
  if (!clean) return "—";
  const key = normalizeCityKey(clean);
  const iata = IATA_LOOKUP[key];
  if (iata) return iata;
  // Fallback: first 3 alphanumeric chars of the city slug, uppercased.
  const fallback = key.replace(/[^a-z0-9]/g, "").slice(0, 3).toUpperCase();
  return fallback || "—";
}
