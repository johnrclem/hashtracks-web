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

// ── Region display (delegated to src/lib/region.ts — single source of truth) ──

export {
  regionTimezone,
  regionAbbrev,
  regionColorClasses,
  regionNameToSlug,
} from "@/lib/region";

// ── URL param helpers (shared by KennelDirectory + HarelineView) ──

/** Parse a comma-separated URL param into an array of non-empty strings. */
export function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

/** Parse region URL param with backward compat — resolves old name strings to slugs. */
export function parseRegionList(value: string | null): string[] {
  const raw = parseList(value);
  return raw.map((v) => regionNameToSlug(v) ?? v);
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

/**
 * Derive a human-readable label from a URL.
 * Recognizes well-known services and falls back to the bare hostname.
 * If an existing label is provided and is not the generic "Source" placeholder,
 * it is returned as-is.
 */
export function getLabelForUrl(url: string, existingLabel?: string | null): string {
  if (existingLabel && existingLabel !== "Source") return existingLabel;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const isDomain = (d: string) => hostname === d || hostname.endsWith("." + d);

    if (isDomain("calendar.google.com")) return "Google Calendar";
    if (hostname === "google.com" && parsed.pathname.startsWith("/calendar")) return "Google Calendar";
    if (isDomain("docs.google.com")) return "Google Sheets";
    if (isDomain("facebook.com")) return "Facebook";
    if (isDomain("hashrego.com")) return "Hash Rego";
    if (isDomain("meetup.com")) return "Meetup";
    if (isDomain("blogspot.com")) return "Blogspot";
    if (isDomain("digitalpress.blog")) return "DigitalPress";
    return hostname;
  } catch {
    return "Source";
  }
}
