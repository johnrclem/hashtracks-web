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

const REGION_CONFIG: Record<string, { abbrev: string; classes: string; tz: string }> = {
  // US East Coast
  "New York City, NY": { abbrev: "NYC", classes: "bg-blue-200 text-blue-800", tz: "America/New_York" },
  "Long Island, NY": { abbrev: "LI", classes: "bg-cyan-200 text-cyan-800", tz: "America/New_York" },
  "Boston, MA": { abbrev: "BOS", classes: "bg-red-200 text-red-800", tz: "America/New_York" },
  "North NJ": { abbrev: "NNJ", classes: "bg-emerald-200 text-emerald-800", tz: "America/New_York" },
  "New Jersey": { abbrev: "NJ", classes: "bg-green-200 text-green-800", tz: "America/New_York" },
  "Philadelphia, PA": { abbrev: "PHI", classes: "bg-amber-200 text-amber-800", tz: "America/New_York" },
  // US Midwest
  "Chicago, IL": { abbrev: "CHI", classes: "bg-purple-200 text-purple-800", tz: "America/Chicago" },
  "South Shore, IN": { abbrev: "IN", classes: "bg-violet-200 text-violet-800", tz: "America/Chicago" },
  // US DC / DMV
  "Washington, DC": { abbrev: "DC", classes: "bg-slate-200 text-slate-800", tz: "America/New_York" },
  "Northern Virginia": { abbrev: "NoVA", classes: "bg-stone-200 text-stone-800", tz: "America/New_York" },
  "Baltimore, MD": { abbrev: "BAL", classes: "bg-orange-200 text-orange-800", tz: "America/New_York" },
  "Frederick, MD": { abbrev: "FRD", classes: "bg-orange-100 text-orange-700", tz: "America/New_York" },
  "Fredericksburg, VA": { abbrev: "FXBG", classes: "bg-stone-100 text-stone-700", tz: "America/New_York" },
  "Southern Maryland": { abbrev: "SMD", classes: "bg-orange-100 text-orange-700", tz: "America/New_York" },
  "Jefferson County, WV": { abbrev: "WV", classes: "bg-lime-200 text-lime-800", tz: "America/New_York" },
  // US West Coast
  "San Francisco, CA": { abbrev: "SF", classes: "bg-teal-200 text-teal-800", tz: "America/Los_Angeles" },
  "Oakland, CA": { abbrev: "OAK", classes: "bg-teal-100 text-teal-700", tz: "America/Los_Angeles" },
  "San Jose, CA": { abbrev: "SJ", classes: "bg-sky-200 text-sky-800", tz: "America/Los_Angeles" },
  "Marin County, CA": { abbrev: "MRN", classes: "bg-teal-100 text-teal-700", tz: "America/Los_Angeles" },
  // UK
  "London": { abbrev: "LDN", classes: "bg-rose-200 text-rose-800", tz: "Europe/London" },
  "London, England": { abbrev: "LDN", classes: "bg-rose-200 text-rose-800", tz: "Europe/London" },
  "London, UK": { abbrev: "LDN", classes: "bg-rose-200 text-rose-800", tz: "Europe/London" },
  "South West London": { abbrev: "SWL", classes: "bg-rose-200 text-rose-800", tz: "Europe/London" },
  "Surrey": { abbrev: "SRY", classes: "bg-pink-200 text-pink-800", tz: "Europe/London" },
  "Surrey, UK": { abbrev: "SRY", classes: "bg-pink-200 text-pink-800", tz: "Europe/London" },
  "Old Coulsdon": { abbrev: "OC", classes: "bg-pink-100 text-pink-700", tz: "Europe/London" },
  "Enfield": { abbrev: "ENF", classes: "bg-pink-100 text-pink-700", tz: "Europe/London" },
  "Barnes": { abbrev: "BRN", classes: "bg-pink-200 text-pink-800", tz: "Europe/London" },
  "West London": { abbrev: "WL", classes: "bg-rose-100 text-rose-700", tz: "Europe/London" },
};

/** Get the primary IANA timezone for a region string, defaults to America/New_York */
export function regionTimezone(region: string): string {
  // Exact match first
  if (REGION_CONFIG[region]?.tz) return REGION_CONFIG[region].tz;
  // Case-insensitive partial match fallback (handles variants like "London, England")
  const lc = region.toLowerCase();
  for (const [key, cfg] of Object.entries(REGION_CONFIG)) {
    if (lc.includes(key.toLowerCase()) || key.toLowerCase().includes(lc)) {
      return cfg.tz;
    }
  }
  return "America/New_York";
}

/** Short abbreviation for a region. "New York City, NY" → "NYC" */
export function regionAbbrev(region: string): string {
  return REGION_CONFIG[region]?.abbrev ?? region;
}

/** Tailwind color classes for a region badge. Falls back to gray. */
export function regionColorClasses(region: string): string {
  return REGION_CONFIG[region]?.classes ?? "bg-gray-200 text-gray-800";
}

/**
 * Format ISO date string to short display: "Wed, Feb 18".
 * Uses UTC to match the date storage convention (UTC noon).
 */
export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
