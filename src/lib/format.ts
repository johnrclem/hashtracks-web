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
