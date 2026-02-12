/**
 * Convert 24-hour "HH:MM" string to 12-hour AM/PM format.
 * e.g. "14:30" → "2:30 PM", "09:00" → "9:00 AM"
 */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${suffix}`;
}

const LEVEL_LABELS: Record<string, string> = {
  RUN: "Run",
  HARE: "Hare",
  BAG_HERO: "Bag Hero",
  DRINK_CHECK: "Drink Check",
  BEER_MILE: "Beer Mile",
  WALK: "Walk",
  CIRCLE_ONLY: "Circle Only",
};

const LEVEL_ABBREVS: Record<string, string> = {
  RUN: "R",
  HARE: "H",
  BAG_HERO: "BH",
  DRINK_CHECK: "DC",
  BEER_MILE: "BM",
  WALK: "W",
  CIRCLE_ONLY: "C",
};

/** Full label for a participation level enum value. "BAG_HERO" → "Bag Hero" */
export function participationLevelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

/** Short abbreviation for a participation level. "BAG_HERO" → "BH" */
export function participationLevelAbbrev(level: string): string {
  return LEVEL_ABBREVS[level] ?? level;
}

/** All participation levels in display order. */
export const PARTICIPATION_LEVELS = Object.keys(LEVEL_LABELS);

// ── Region display ──

const REGION_CONFIG: Record<string, { abbrev: string; classes: string }> = {
  "New York City, NY": { abbrev: "NYC", classes: "bg-blue-200 text-blue-800" },
  "Long Island, NY":   { abbrev: "LI",  classes: "bg-cyan-200 text-cyan-800" },
  "Boston, MA":        { abbrev: "BOS", classes: "bg-red-200 text-red-800" },
  "North NJ":          { abbrev: "NNJ", classes: "bg-emerald-200 text-emerald-800" },
  "New Jersey":        { abbrev: "NJ",  classes: "bg-green-200 text-green-800" },
  "Philadelphia, PA":  { abbrev: "PHI", classes: "bg-amber-200 text-amber-800" },
  "Chicago, IL":       { abbrev: "CHI", classes: "bg-purple-200 text-purple-800" },
};

/** Short abbreviation for a region. "New York City, NY" → "NYC" */
export function regionAbbrev(region: string): string {
  return REGION_CONFIG[region]?.abbrev ?? region;
}

/** Tailwind color classes for a region badge. Falls back to gray. */
export function regionColorClasses(region: string): string {
  return REGION_CONFIG[region]?.classes ?? "bg-gray-200 text-gray-800";
}
