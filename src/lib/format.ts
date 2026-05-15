import { regionNameToSlug } from "@/lib/region";
import { formatSeasonHint, type ScheduleSlot } from "@/lib/schedule-season";
import { parseRRule } from "@/adapters/static-schedule/adapter";

// Re-export ScheduleSlot from format.ts for backward compat with existing
// component imports. The canonical home is now @/lib/schedule-season.
export type { ScheduleSlot };

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
 * Parse "HH:MM" into minutes since midnight. Returns null if unparseable
 * or out of range. Promoted from src/lib/strava/match-score.ts so the
 * pipeline can share the same parser without depending on Strava.
 */
export function timeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
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

export type ParticipationLevel = "RUN" | "HARE" | "BAG_HERO" | "DRINK_CHECK" | "BEER_MILE" | "WALK" | "CIRCLE_ONLY";

/** Chart colors for each participation level. */
export const LEVEL_COLORS: Record<ParticipationLevel, string> = {
  RUN: "#3b82f6",
  HARE: "#f59e0b",
  BAG_HERO: "#8b5cf6",
  DRINK_CHECK: "#10b981",
  BEER_MILE: "#ef4444",
  WALK: "#6366f1",
  CIRCLE_ONLY: "#6b7280",
};

/** Chart color for a participation level string. Returns gray for unknown levels. */
export function levelColor(level: string): string {
  return LEVEL_COLORS[level as ParticipationLevel] ?? "#6b7280";
}

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
  regionBgClass,
  regionNameToSlug,
} from "@/lib/region";

// ── Array toggle helper (shared by filter components) ──

/** Toggle an item in an array: add if missing, remove if present. Returns a new array. */
export function toggleArrayItem<T>(array: T[], value: T): T[] {
  return array.includes(value)
    ? array.filter((v) => v !== value)
    : [...array, value];
}

// ── URL param helpers (shared by KennelDirectory + HarelineView) ──

/**
 * Parse a pipe-or-comma-separated URL param into an array of non-empty strings.
 * Pipe is the current format; comma is accepted for backward compat with legacy
 * bookmarked URLs for params whose values never contain commas (e.g. days, kennels).
 * Do NOT use this for region params — use parseRegionParam instead.
 */
export function parseList(value: string | null): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  if (trimmed.includes("|")) return trimmed.split("|").map(s => s.trim()).filter(Boolean);
  if (trimmed.includes(",")) return trimmed.split(",").map(s => s.trim()).filter(Boolean);
  return [trimmed];
}

/**
 * Parse a region URL param without splitting on commas, since region names
 * contain commas (e.g. "Boston, MA"). Pipe is the only multi-value delimiter.
 */
export function parseRegionParam(value: string | null): string[] {
  const trimmed = value?.trim();
  if (!trimmed) return [];
  if (trimmed.includes("|")) return trimmed.split("|").map(s => s.trim()).filter(Boolean);
  return [trimmed];
}

/**
 * Parse region URL param with backward compat — resolves old name strings to slugs.
 */
export function parseRegionList(value: string | null): string[] {
  const raw = parseRegionParam(value);
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

/**
 * Format ISO date string to long display: "Monday, March 2, 2026".
 * Uses UTC to match the date storage convention (UTC noon).
 */
export function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Short weekday abbreviation from ISO date: "Mon", "Tue", etc.
 * Uses UTC to match the date storage convention (UTC noon).
 */
export function getDayOfWeek(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

// ── Kennel profile helpers ──

/**
 * Combine schedule fields into a natural sentence.
 * "Wednesdays at 7:00 PM · Weekly", "Saturdays · Biweekly", "Monthly", etc.
 * Returns null if no schedule fields are populated.
 *
 * Multi-cadence path (#1390): when `scheduleRules` is non-empty, it overrides
 * the flat fields. Each slot renders as "<weekday day-text> at <time> (<hint>)"
 * and slots are joined by " / " in displayOrder ascending. The legacy flat-field
 * path remains the fallback for ~190 kennels that haven't migrated yet.
 */
export function formatSchedule(kennel: {
  scheduleDayOfWeek?: string | null;
  scheduleTime?: string | null;
  scheduleFrequency?: string | null;
  scheduleRules?: ScheduleSlot[] | null;
}): string | null {
  if (kennel.scheduleRules && kennel.scheduleRules.length > 0) {
    const rulesText = formatScheduleRules(kennel.scheduleRules);
    // Fall through to legacy flat-field rendering ONLY if scheduleRules
    // produced nothing displayable (e.g. all slots had unrecognized RRULE
    // shapes like FREQ=LUNAR with no other content). This preserves the
    // override semantics for the common case while preventing a kennel
    // with valid legacy fields from rendering empty when scheduleRules
    // were present but unrenderable. (Codex review on PR #1406.)
    if (rulesText !== null) return rulesText;
  }
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

function formatScheduleRules(rules: ScheduleSlot[]): string | null {
  const ordered = [...rules].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const rendered = ordered.map(formatScheduleSlot).filter((s): s is string => s !== null);
  return rendered.length > 0 ? rendered.join(" / ") : null;
}

function formatScheduleSlot(slot: ScheduleSlot): string | null {
  const dayLabel = describeRruleDay(slot.rrule);
  const timeText = slot.startTime ? formatTime(slot.startTime) : null;
  const head = [dayLabel, timeText ? `at ${timeText}` : null].filter(Boolean).join(" ");
  const seasonHint = formatSeasonHint(slot.label, slot.validFrom, slot.validUntil);
  if (!head && !seasonHint) return null;
  if (head && seasonHint) return `${head} (${seasonHint})`;
  return head || seasonHint;
}

/**
 * Human-readable weekday phrase from a calendar-rule RRULE. Delegates the RRULE
 * shape interpretation to `parseRRule` from the static-schedule adapter — the
 * same parser that drives event generation and Travel Mode projection. This
 * means format.ts inherits the parser's contract for free (e.g. BYSETPOS
 * rejection, multi-day BYDAY rejection, FREQ=LUNAR rejection).
 *
 * Returns null on shapes we can't summarize (the caller falls through to other
 * slot text or to the legacy flat-field path).
 */
function describeRruleDay(rrule: string): string | null {
  let parsed: ReturnType<typeof parseRRule>;
  try {
    parsed = parseRRule(rrule);
  } catch {
    return null;
  }
  if (parsed.freq === "WEEKLY" && parsed.byDay) {
    return `${WEEKDAY_NAMES[parsed.byDay.day]}s`;
  }
  if (parsed.freq === "MONTHLY" && parsed.byDay) {
    const day = WEEKDAY_NAMES[parsed.byDay.day];
    if (parsed.byDay.nth === undefined) return `${day}s`;
    const ord = ordinalWord(parsed.byDay.nth);
    return ord ? `${ord} ${day}` : `${day}s`;
  }
  if (parsed.freq === "MONTHLY" && parsed.byMonthDay !== undefined) {
    return `${ordinal(parsed.byMonthDay)} of the month`;
  }
  return null;
}

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

/**
 * Ordinal WORD for the small set used in nth-weekday display ("1st", "last",
 * etc.). Distinct from `ordinal()` because past 5th we degrade to "5th Saturday"
 * isn't a real schedule shape — we render plain plural day name instead.
 */
function ordinalWord(n: number): string | null {
  if (n === -1) return "last";
  switch (n) {
    case 1: return "1st";
    case 2: return "2nd";
    case 3: return "3rd";
    case 4: return "4th";
    case 5: return "5th";
    default: return null;
  }
}

/**
 * Collect every weekday name this kennel runs on, considering both the legacy
 * flat `scheduleDayOfWeek` and any `scheduleRules`. Single source of truth for
 * the KennelDirectory day filter and the region-page intro/metadata "days"
 * computations — keeping these in lockstep avoids the kennel-vanishes-from-
 * filter-but-shows-on-card drift that previously hit migrated kennels.
 *
 * Rejects multi-day BYDAY values (`BYDAY=SA,SU`) so it stays in lockstep with
 * `describeRruleDay()` — only single-weekday slots round-trip through the UI.
 */
// `collectKennelWeekdays` / `collectKennelFrequencies` moved to
// `@/lib/schedule-season` (canonical home, co-located with ScheduleSlot +
// SCHEDULE_RULES_SELECT). Re-exported here so existing imports don't break.
export { collectKennelWeekdays, collectKennelFrequencies } from "@/lib/schedule-season";

/** English ordinal suffix: 1 → "1st", 22 → "22nd", 113 → "113th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Build Instagram profile URL from handle, stripping leading @ if present. */
export function instagramUrl(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, "")}`;
}

/** Build X/Twitter profile URL from handle, stripping leading @ if present. */
export function twitterUrl(handle: string): string {
  return `https://x.com/${handle.replace(/^@/, "")}`;
}

// ── Strava / activity helpers ──

/** Format distance in meters to miles. e.g. 5000 → "3.1 mi" */
export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

/** Format duration in seconds to compact string. e.g. 3900 → "1h 5m", 300 → "5m" */
export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Format Strava sport type for display. "TrailRun" → "Trail Run" */
export function formatSportType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ── Relative time formatting ──

/**
 * Format a Date or ISO string as a relative time label.
 * e.g. "just now", "5m ago", "2h ago", "3d ago", "Feb 18"
 */
export function formatRelativeTime(input: Date | string): string {
  const then = typeof input === "string" ? new Date(input).getTime() : input.getTime();
  const diffMs = Date.now() - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Text cleanup helpers ──

/** Strip Markdown formatting for plain-text display. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*{3,}/g, "\n\n")                    // *** separators → visual break
    .replace(/\*\*(.+?)\*\*/g, "$1")              // **bold** → bold
    .replace(/\*(.+?)\*/g, "$1")                  // *italic* → italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // [text](url) → text
    .replace(/^#{1,6}\s+/gm, "")                  // # heading → heading
    .replace(/^>\s+/gm, "")                       // > quote → quote
    .replace(/^[-*+]\s+/gm, "")                   // - list → list
    .replace(/\n{3,}/g, "\n\n")                    // collapse excess blank lines
    .trim();
}

/** Strip URLs from display text (preserves surrounding words). */
export function stripUrlsFromText(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
}

// ── URL / domain helpers ──

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
