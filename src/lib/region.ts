/**
 * Region data module — single source of truth for region display data.
 *
 * Provides:
 * 1. REGION_SEED_DATA — canonical region records for migration & seed
 * 2. Sync compat wrappers — drop-in replacements for the old REGION_CONFIG lookups
 * 3. DB-backed async queries — for admin CRUD and future use
 *
 * The sync wrappers use an in-memory fallback map built from REGION_SEED_DATA so they
 * work even without a DB connection (tests, build-time, etc.). Once the Region table
 * is populated, the async functions read from DB with caching.
 */

// ── Canonical region data (used for seed + migration + sync fallback) ──

export interface RegionSeedRecord {
  name: string;
  country: string;
  timezone: string;
  abbrev: string;
  colorClasses: string;
  pinColor: string;
  centroidLat: number | null;
  centroidLng: number | null;
  /** Names that should resolve to this region (e.g., "London, England" → "London") */
  aliases?: string[];
}

/**
 * Canonical region seed data — merges the old REGION_CONFIG, REGION_CENTROIDS,
 * and REGION_COLORS into a single array. Deduplicated: variants like
 * "London, England" / "London, UK" map to the canonical "London" record via aliases.
 */
export const REGION_SEED_DATA: RegionSeedRecord[] = [
  // ── US East Coast ──
  {
    name: "New York City, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NYC",
    colorClasses: "bg-blue-200 text-blue-800",
    pinColor: "#2563eb",
    centroidLat: 40.71,
    centroidLng: -74.01,
  },
  {
    name: "Long Island, NY",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "LI",
    colorClasses: "bg-cyan-200 text-cyan-800",
    pinColor: "#0891b2",
    centroidLat: 40.79,
    centroidLng: -73.13,
  },
  {
    name: "Boston, MA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "BOS",
    colorClasses: "bg-red-200 text-red-800",
    pinColor: "#dc2626",
    centroidLat: 42.36,
    centroidLng: -71.06,
  },
  {
    name: "North NJ",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NNJ",
    colorClasses: "bg-emerald-200 text-emerald-800",
    pinColor: "#059669",
    centroidLat: 40.78,
    centroidLng: -74.11,
  },
  {
    name: "New Jersey",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NJ",
    colorClasses: "bg-green-200 text-green-800",
    pinColor: "#16a34a",
    centroidLat: 40.06,
    centroidLng: -74.41,
  },
  {
    name: "Philadelphia, PA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "PHI",
    colorClasses: "bg-amber-200 text-amber-800",
    pinColor: "#d97706",
    centroidLat: 39.95,
    centroidLng: -75.17,
  },
  // ── US Midwest ──
  {
    name: "Chicago, IL",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "CHI",
    colorClasses: "bg-purple-200 text-purple-800",
    pinColor: "#9333ea",
    centroidLat: 41.88,
    centroidLng: -87.63,
  },
  {
    name: "South Shore, IN",
    country: "USA",
    timezone: "America/Chicago",
    abbrev: "IN",
    colorClasses: "bg-violet-200 text-violet-800",
    pinColor: "#7c3aed",
    centroidLat: 41.60,
    centroidLng: -87.34,
  },
  // ── US DC / DMV ──
  {
    name: "Washington, DC",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "DC",
    colorClasses: "bg-slate-200 text-slate-800",
    pinColor: "#475569",
    centroidLat: 38.91,
    centroidLng: -77.04,
  },
  {
    name: "Northern Virginia",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "NoVA",
    colorClasses: "bg-stone-200 text-stone-800",
    pinColor: "#57534e",
    centroidLat: 38.85,
    centroidLng: -77.20,
  },
  {
    name: "Baltimore, MD",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "BAL",
    colorClasses: "bg-orange-200 text-orange-800",
    pinColor: "#ea580c",
    centroidLat: 39.29,
    centroidLng: -76.61,
  },
  {
    name: "Frederick, MD",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "FRD",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 39.41,
    centroidLng: -77.41,
  },
  {
    name: "Fredericksburg, VA",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "FXBG",
    colorClasses: "bg-stone-100 text-stone-700",
    pinColor: "#78716c",
    centroidLat: 38.30,
    centroidLng: -77.46,
  },
  {
    name: "Southern Maryland",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "SMD",
    colorClasses: "bg-orange-100 text-orange-700",
    pinColor: "#f97316",
    centroidLat: 38.55,
    centroidLng: -76.80,
  },
  {
    name: "Jefferson County, WV",
    country: "USA",
    timezone: "America/New_York",
    abbrev: "WV",
    colorClasses: "bg-lime-200 text-lime-800",
    pinColor: "#65a30d",
    centroidLat: 39.32,
    centroidLng: -77.87,
  },
  // ── US West Coast ──
  {
    name: "San Francisco, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SF",
    colorClasses: "bg-teal-200 text-teal-800",
    pinColor: "#0d9488",
    centroidLat: 37.77,
    centroidLng: -122.42,
  },
  {
    name: "Oakland, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "OAK",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 37.80,
    centroidLng: -122.27,
  },
  {
    name: "San Jose, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "SJ",
    colorClasses: "bg-sky-200 text-sky-800",
    pinColor: "#0284c7",
    centroidLat: 37.34,
    centroidLng: -121.89,
  },
  {
    name: "Marin County, CA",
    country: "USA",
    timezone: "America/Los_Angeles",
    abbrev: "MRN",
    colorClasses: "bg-teal-100 text-teal-700",
    pinColor: "#14b8a6",
    centroidLat: 37.97,
    centroidLng: -122.53,
  },
  // ── UK ──
  {
    name: "London",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "LDN",
    colorClasses: "bg-rose-200 text-rose-800",
    pinColor: "#e11d48",
    centroidLat: 51.51,
    centroidLng: -0.13,
    aliases: ["London, England", "London, UK"],
  },
  {
    name: "South West London",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "SWL",
    colorClasses: "bg-rose-200 text-rose-800",
    pinColor: "#e11d48",
    centroidLat: 51.46,
    centroidLng: -0.20,
  },
  {
    name: "Surrey",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "SRY",
    colorClasses: "bg-pink-200 text-pink-800",
    pinColor: "#db2777",
    centroidLat: 51.31,
    centroidLng: -0.31,
    aliases: ["Surrey, UK"],
  },
  {
    name: "Old Coulsdon",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "OC",
    colorClasses: "bg-pink-100 text-pink-700",
    pinColor: "#ec4899",
    centroidLat: 51.32,
    centroidLng: -0.10,
  },
  {
    name: "Enfield",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "ENF",
    colorClasses: "bg-pink-100 text-pink-700",
    pinColor: "#ec4899",
    centroidLat: 51.65,
    centroidLng: -0.08,
  },
  {
    name: "Barnes",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "BRN",
    colorClasses: "bg-pink-200 text-pink-800",
    pinColor: "#db2777",
    centroidLat: 51.47,
    centroidLng: -0.25,
  },
  {
    name: "West London",
    country: "UK",
    timezone: "Europe/London",
    abbrev: "WL",
    colorClasses: "bg-rose-100 text-rose-700",
    pinColor: "#f43f5e",
    centroidLat: 51.51,
    centroidLng: -0.27,
  },
];

// ── Sync fallback map (built from REGION_SEED_DATA at module load) ──

interface RegionLookup {
  name: string;
  timezone: string;
  abbrev: string;
  colorClasses: string;
  pinColor: string;
  centroidLat: number | null;
  centroidLng: number | null;
}

/** Map from region name (and aliases) to canonical data. */
const REGION_MAP = new Map<string, RegionLookup>();

for (const r of REGION_SEED_DATA) {
  const entry: RegionLookup = {
    name: r.name,
    timezone: r.timezone,
    abbrev: r.abbrev,
    colorClasses: r.colorClasses,
    pinColor: r.pinColor,
    centroidLat: r.centroidLat,
    centroidLng: r.centroidLng,
  };
  REGION_MAP.set(r.name, entry);
  if (r.aliases) {
    for (const alias of r.aliases) {
      REGION_MAP.set(alias, entry);
    }
  }
}

/** Get the primary IANA timezone for a region string, defaults to America/New_York */
export function regionTimezone(region: string): string {
  const entry = REGION_MAP.get(region);
  if (entry) return entry.timezone;

  // Case-insensitive partial match fallback
  const lc = region.toLowerCase();
  for (const [key, val] of REGION_MAP) {
    const keyLc = key.toLowerCase();
    if (lc.includes(keyLc) || keyLc.includes(lc)) {
      return val.timezone;
    }
  }
  return "America/New_York";
}

/** Short abbreviation for a region. "New York City, NY" → "NYC" */
export function regionAbbrev(region: string): string {
  return REGION_MAP.get(region)?.abbrev ?? region;
}

/** Tailwind color classes for a region badge. Falls back to gray. */
export function regionColorClasses(region: string): string {
  return REGION_MAP.get(region)?.colorClasses ?? "bg-gray-200 text-gray-800";
}

/** Hex pin color for a region on maps. Falls back to gray. */
export function getRegionColor(region: string): string {
  return REGION_MAP.get(region)?.pinColor ?? "#6b7280";
}

/** Region centroid {lat, lng} for map fallback. Returns null for unknown regions. */
export function getRegionCentroid(
  region: string,
): { lat: number; lng: number } | null {
  const entry = REGION_MAP.get(region);
  if (entry?.centroidLat != null && entry?.centroidLng != null) {
    return { lat: entry.centroidLat, lng: entry.centroidLng };
  }
  return null;
}

/** Generate a slug from a region name. */
export function regionSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[,.\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Default pin color for unknown regions. */
export const DEFAULT_PIN_COLOR = "#6b7280"; // gray-500
