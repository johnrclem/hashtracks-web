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

/**
 * Compact 12-hour time following Google Calendar conventions.
 * e.g. "19:00" → "7pm", "14:30" → "2:30pm", "09:00" → "9am"
 */
export function formatTimeCompact(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${m.toString().padStart(2, "0")}${suffix}`;
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

const VALID_LEVELS = new Set(PARTICIPATION_LEVELS);

type ParticipationLevel = "RUN" | "HARE" | "BAG_HERO" | "DRINK_CHECK" | "BEER_MILE" | "WALK" | "CIRCLE_ONLY";

/** Validate and return a ParticipationLevel, or default to "RUN" if invalid/missing. */
export function parseParticipationLevel(value: string | undefined): ParticipationLevel {
  if (value && VALID_LEVELS.has(value)) return value as ParticipationLevel;
  return "RUN";
}

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

// ── Kennel profile helpers ──

/**
 * Combine schedule fields into a natural sentence.
 * "Wednesdays at 7:00 PM · Weekly", "Saturdays · Biweekly", "Monthly", etc.
 * Returns null if no schedule fields are populated.
 */
export function formatSchedule(kennel: {
  scheduleDayOfWeek?: string | null;
  scheduleTime?: string | null;
  scheduleFrequency?: string | null;
}): string | null {
  const parts: string[] = [];
  if (kennel.scheduleDayOfWeek) {
    parts.push(kennel.scheduleDayOfWeek + "s");
  }
  if (kennel.scheduleTime) {
    parts.push(parts.length ? `at ${kennel.scheduleTime}` : kennel.scheduleTime);
  }
  if (kennel.scheduleFrequency) {
    parts.push(parts.length ? `· ${kennel.scheduleFrequency}` : kennel.scheduleFrequency);
  }
  return parts.length ? parts.join(" ") : null;
}

/** Build Instagram profile URL from handle, stripping leading @ if present. */
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, "")}`;
}

/** Build X/Twitter profile URL from handle, stripping leading @ if present. */
export function twitterUrl(handle: string): string {
  return `https://x.com/${handle.replace(/^@/, "")}`;
}

/** Extract hostname from URL, stripping www. prefix. Returns raw string on parse failure. */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
