import isSafeRegex from "safe-regex2";
import { isValidTimezone } from "@/lib/timezone";
import { FB_PAGE_HANDLE_RE, isReservedFacebookHandle } from "@/adapters/facebook-hosted-events/constants";

/** Returns true if the string is a valid, ReDoS-safe regex. Shared by config validation and AI suggestion filtering. */
export function isSafeRegexString(p: unknown): boolean {
  if (typeof p !== "string") return false;
  try {
    // nosemgrep: detect-non-literal-regexp — intentional: validating user/AI-supplied regex, protected by isSafeRegex()
    const re = new RegExp(p); // NOSONAR
    return isSafeRegex(re);
  } catch {
    return false;
  }
}

/** Types that require a non-empty config object */
const TYPES_REQUIRING_CONFIG = new Set([
  "GOOGLE_SHEETS",
  "MEETUP",
  "RSS_FEED",
  "STATIC_SCHEDULE",
  "FACEBOOK_HOSTED_EVENTS",
]);

/** Validate a single regex pattern for syntax and ReDoS safety */
function validateRegex(
  pattern: string,
  label: string,
  errors: string[],
): void {
  try {
    // nosemgrep: detect-non-literal-regexp — intentional: validating user-supplied regex, protected by isSafeRegex()
    const re = new RegExp(pattern, "i"); // NOSONAR
    if (!isSafeRegex(re)) {
      errors.push(
        `${label}: regex "${pattern}" may cause catastrophic backtracking (ReDoS)`,
      );
    }
  } catch (e) {
    errors.push(
      `${label}: invalid regex "${pattern}" — ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
}

/**
 * Source types whose adapters consume the multi-kennel array tag form
 * via the central `matchKennelPatterns` helper (#1023 step 4). Every other
 * adapter is still string-only and would silently emit malformed kennelTags
 * if given an array value, so the validator gates the broader grammar to
 * just these types.
 *
 * Add to this set when migrating an adapter to `matchKennelPatterns`.
 */
const TYPES_SUPPORTING_MULTI_KENNEL_PATTERNS = new Set(["GOOGLE_CALENDAR"]);

/** Per-entry tag-value validation for `validateKennelPatterns`. Extracted to
 *  keep the parent function's cognitive complexity below SonarCloud's
 *  threshold. Returns true when the value is well-formed enough to fall
 *  through to regex validation; false on hard rejection. */
function validateKennelPatternTagValue(
  i: number,
  tagValue: unknown,
  type: string,
  errors: string[],
): boolean {
  const allowMultiKennel = TYPES_SUPPORTING_MULTI_KENNEL_PATTERNS.has(type);
  if (typeof tagValue === "string") {
    if (!tagValue.trim()) {
      errors.push(`kennelPatterns[${i}]: kennel tag cannot be empty`);
    }
    return true;
  }
  if (Array.isArray(tagValue)) {
    if (!allowMultiKennel) {
      errors.push(
        `kennelPatterns[${i}]: multi-kennel array tags are not supported for source type ${type} ` +
          `— migrate the adapter to matchKennelPatterns first (#1023). Allowed: ${[...TYPES_SUPPORTING_MULTI_KENNEL_PATTERNS].join(", ")}.`,
      );
      return false;
    }
    if (tagValue.length === 0) {
      errors.push(`kennelPatterns[${i}]: multi-kennel tag array cannot be empty`);
    }
    for (const [j, tag] of tagValue.entries()) {
      if (typeof tag !== "string" || !tag.trim()) {
        errors.push(`kennelPatterns[${i}][${j}]: each multi-kennel tag must be a non-empty string`);
      }
    }
    return true;
  }
  errors.push(`kennelPatterns[${i}]: tag must be a string${allowMultiKennel ? " or string[]" : ""}`);
  return false;
}

/** Validate kennelPatterns: each entry is [regex, tag] or [regex, tag[]] (#1023 step 4). */
function validateKennelPatterns(type: string, obj: Record<string, unknown>, errors: string[]): void {
  if (!("kennelPatterns" in obj) || obj.kennelPatterns === undefined) return;

  if (!Array.isArray(obj.kennelPatterns)) {
    errors.push("kennelPatterns must be an array of [regex, tag] pairs");
    return;
  }
  for (const [i, pair] of obj.kennelPatterns.entries()) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      errors.push(`kennelPatterns[${i}]: must be a [regex, tag] pair`);
      continue;
    }
    const [pattern, tagValue] = pair;
    if (typeof pattern !== "string") {
      errors.push(`kennelPatterns[${i}]: regex must be a string`);
      continue;
    }
    if (!validateKennelPatternTagValue(i, tagValue, type, errors)) continue;
    validateRegex(pattern, `kennelPatterns[${i}]`, errors);
  }
}

/**
 * Reject patterns that match the empty string or a single space — those are
 * the universal regexes (`^.*$`, `^.+$`, `.*`, etc.) that would silently
 * drop every location cell from a source. Real placeholders always contain
 * literal text. Only enforced for `locationOmitIfMatches` because the other
 * pattern arrays (skip/hare/runNumber/cost) operate as substring matchers
 * over multi-line text where broad anchors are sometimes legitimate.
 */
export function isPatternTooBroad(pattern: string): boolean {
  try {
    // nosemgrep: detect-non-literal-regexp — intentional: validating user/AI-supplied regex, protected by isSafeRegex()
    const re = new RegExp(pattern, "i"); // NOSONAR
    return re.test("") || re.test(" ");
  } catch {
    return true;
  }
}

/** Validate a named string[] config field where each entry must be a valid regex. */
function validatePatternArray(
  obj: Record<string, unknown>,
  fieldName: string,
  errors: string[],
  opts: { rejectBroad?: boolean } = {},
): void {
  if (!(fieldName in obj) || obj[fieldName] === undefined) return;

  if (!Array.isArray(obj[fieldName])) {
    errors.push(`${fieldName} must be an array of regex strings`);
    return;
  }
  for (const [i, pattern] of (obj[fieldName] as unknown[]).entries()) {
    if (typeof pattern !== "string") {
      errors.push(`${fieldName}[${i}]: must be a string`);
      continue;
    }
    validateRegex(pattern, `${fieldName}[${i}]`, errors);
    if (opts.rejectBroad && isPatternTooBroad(pattern)) {
      errors.push(
        `${fieldName}[${i}]: regex "${pattern}" matches empty/whitespace input — too broad, would drop legitimate values`,
      );
    }
  }
}

/** Validate Google Sheets required fields. */
function validateGoogleSheetsConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (!obj.sheetId || typeof obj.sheetId !== "string") {
    errors.push("Google Sheets config requires sheetId");
  }
  if (!obj.columns || typeof obj.columns !== "object" || Array.isArray(obj.columns)) {
    errors.push("Google Sheets config requires columns mapping");
  }
  if (
    !obj.kennelTagRules ||
    typeof obj.kennelTagRules !== "object" ||
    !(obj.kennelTagRules as Record<string, unknown>).default
  ) {
    errors.push("Google Sheets config requires kennelTagRules with a default tag");
  }
}

/** Validate Meetup required fields. */
function validateMeetupConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (typeof obj.groupUrlname !== "string" || !obj.groupUrlname.trim()) {
    errors.push("Meetup config requires a non-empty groupUrlname");
  }
  if (typeof obj.kennelTag !== "string" || !obj.kennelTag.trim()) {
    errors.push("Meetup config requires a non-empty kennelTag");
  }
}

/** Validate RSS Feed required fields. */
function validateRssFeedConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (typeof obj.kennelTag !== "string" || !obj.kennelTag.trim()) {
    errors.push("RSS Feed config requires a non-empty kennelTag");
  }
}

/** Validate FACEBOOK_HOSTED_EVENTS required fields. The handle regex is
 *  imported from `src/adapters/facebook-hosted-events/constants.ts` so admin
 *  and cron reject the same malformed handles. */
function validateFacebookHostedEventsConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (typeof obj.kennelTag !== "string" || !obj.kennelTag.trim()) {
    errors.push("Facebook hosted_events config requires a non-empty kennelTag");
  }
  if (typeof obj.pageHandle !== "string" || !obj.pageHandle.trim()) {
    errors.push("Facebook hosted_events config requires a non-empty pageHandle");
  } else if (!FB_PAGE_HANDLE_RE.test(obj.pageHandle)) {
    errors.push(
      `Facebook hosted_events pageHandle "${obj.pageHandle}" must be 2–80 chars of A–Z, a–z, 0–9, dot, underscore, or dash`,
    );
  } else if (isReservedFacebookHandle(obj.pageHandle)) {
    // Defense-in-depth against the URL-helper bypass: a pasted URL like
    // `facebook.com/events/{id}/` would have its first segment ("events")
    // returned as the handle. The shape regex above accepts it. Reject
    // explicitly so the admin sees a meaningful error instead of an
    // unscrapable saved config. Codex review pass-1 finding on PR #1292.
    errors.push(
      `Facebook hosted_events pageHandle "${obj.pageHandle}" is a Facebook structural namespace, not a Page handle — paste the kennel's Page URL or handle (e.g. \`GrandStrandHashing\`)`,
    );
  }
  if (typeof obj.timezone !== "string" || !obj.timezone.trim()) {
    errors.push('Facebook hosted_events config requires a non-empty timezone (IANA, e.g. "America/New_York")');
  } else if (!isValidTimezone(obj.timezone)) {
    errors.push(`Facebook hosted_events timezone "${obj.timezone}" is not a recognized IANA timezone`);
  }
  // Server-side invariant: `/upcoming_hosted_events` is a partial-enumeration
  // feed (past events drop off). Without `upcomingOnly: true` the reconcile
  // pipeline would interpret missing past events as cancellations. Reject
  // any save path (panel, raw JSON, API) that drops or unsets this bit.
  // Codex pass-2 finding.
  if (obj.upcomingOnly !== true) {
    errors.push(
      'Facebook hosted_events config requires `upcomingOnly: true` (the /upcoming_hosted_events feed drops past events; reconcile must not cancel them)',
    );
  }
}

/** RRULE-style two-letter weekday codes (RFC 5545 §3.3.10). */
const LUNAR_WEEKDAYS = new Set(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
const LUNAR_ANCHOR_RULES = new Set(["nearest", "on-or-after", "on-or-before"]);

/**
 * Validate the lunar config block (when set). Mirror of `validateRruleLunarXor`
 * in the adapter — kept in sync so admin-side and cron-side rejection messages
 * read consistently.
 */
function validateLunarConfig(lunar: Record<string, unknown>, errors: string[]): void {
  if (lunar.phase !== "full" && lunar.phase !== "new") {
    errors.push('Static Schedule lunar.phase must be "full" or "new"');
  }
  if (typeof lunar.timezone !== "string" || !lunar.timezone.trim()) {
    errors.push('Static Schedule lunar.timezone is required (IANA timezone, e.g. "America/Los_Angeles")');
  } else if (!isValidTimezone(lunar.timezone)) {
    errors.push(`Static Schedule lunar.timezone "${lunar.timezone}" is not a recognized IANA timezone`);
  }
  const weekday = lunar.anchorWeekday;
  const rule = lunar.anchorRule;
  const hasWeekday = weekday !== undefined && weekday !== null;
  const hasRule = rule !== undefined && rule !== null;
  if (hasWeekday !== hasRule) {
    errors.push("Static Schedule lunar.anchorWeekday and lunar.anchorRule must be set together (or both omitted)");
    return;
  }
  if (hasWeekday) {
    if (typeof weekday !== "string" || !LUNAR_WEEKDAYS.has(weekday)) {
      errors.push("Static Schedule lunar.anchorWeekday must be one of SU/MO/TU/WE/TH/FR/SA");
    }
    if (typeof rule !== "string" || !LUNAR_ANCHOR_RULES.has(rule)) {
      errors.push('Static Schedule lunar.anchorRule must be one of "nearest", "on-or-after", "on-or-before"');
    }
  }
}

/**
 * Validate STATIC_SCHEDULE required fields.
 *
 * XOR contract: exactly one of `rrule | lunar` must be present.
 *  - RRULE mode: traditional calendar recurrence (FREQ=WEEKLY;BYDAY=SA, etc.)
 *  - Lunar mode: phase-anchored ("full" / "new") with optional weekday anchor
 *    for kennels like DCFMH3 ("Fri/Sat near full moon").
 */
/** Validate the recurrence XOR (rrule | lunar). Pulled out so the parent
 *  stays under SonarCloud's cognitive-complexity cap. */
function validateRecurrenceBlock(obj: Record<string, unknown>, errors: string[]): void {
  const hasRrule = typeof obj.rrule === "string" && obj.rrule.trim().length > 0;
  const hasLunar = obj.lunar !== undefined && obj.lunar !== null;
  if (!hasRrule && !hasLunar) {
    errors.push("Static Schedule config requires either rrule or lunar (exactly one)");
    return;
  }
  if (hasRrule && hasLunar) {
    errors.push("Static Schedule config cannot specify both rrule and lunar (XOR)");
    return;
  }
  if (hasRrule) {
    const rrule = obj.rrule as string;
    if (!/^FREQ=/i.test(rrule.trim())) {
      errors.push("Static Schedule rrule must start with FREQ= (e.g. FREQ=WEEKLY;BYDAY=SA)");
    }
    return;
  }
  if (typeof obj.lunar !== "object" || Array.isArray(obj.lunar)) {
    errors.push("Static Schedule lunar must be an object");
    return;
  }
  validateLunarConfig(obj.lunar as Record<string, unknown>, errors);
}

/** Validate optional `startTime` field. */
function validateStartTimeField(obj: Record<string, unknown>, errors: string[]): void {
  if (obj.startTime === undefined) return;
  if (typeof obj.startTime !== "string") {
    errors.push("Static Schedule config startTime must be a string");
  } else if (!TIME_HHMM_RE.test(obj.startTime)) {
    errors.push('Static Schedule config startTime must be HH:MM format (e.g. "10:17", "19:00")');
  }
}

/** Validate optional `anchorDate` field. */
function validateAnchorDateField(obj: Record<string, unknown>, errors: string[]): void {
  if (obj.anchorDate === undefined) return;
  if (typeof obj.anchorDate !== "string") {
    errors.push("Static Schedule config anchorDate must be a string");
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.anchorDate)) {
    errors.push('Static Schedule config anchorDate must be YYYY-MM-DD format (e.g. "2026-01-03")');
  }
}

function validateStaticScheduleConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (typeof obj.kennelTag !== "string" || !obj.kennelTag.trim()) {
    errors.push("Static Schedule config requires a non-empty kennelTag");
  }
  validateRecurrenceBlock(obj, errors);
  validateStartTimeField(obj, errors);
  validateAnchorDateField(obj, errors);
}

/** Dangerous patterns blocked in CSS selectors (XSS prevention). */
const DANGEROUS_SELECTOR_PATTERN = /<script|javascript:|on\w+\s*=/i;

/** Validate a CSS selector string: non-empty and free of dangerous content. */
function validateSelector(name: string, value: unknown, errors: string[]): void {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`Generic HTML config requires a non-empty ${name}`);
  } else if (DANGEROUS_SELECTOR_PATTERN.test(value)) {
    errors.push(`${name} contains blocked content (script/event handlers)`);
  }
}

/** Validate column selectors object: require date, block dangerous content. */
function validateColumnSelectors(columns: unknown, errors: string[]): void {
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) {
    errors.push("Generic HTML config requires a columns object");
    return;
  }
  const cols = columns as Record<string, unknown>;
  if (typeof cols.date !== "string" || !cols.date.trim()) {
    errors.push("Generic HTML config requires columns.date selector");
  }
  for (const [key, val] of Object.entries(cols)) {
    if (typeof val === "string" && DANGEROUS_SELECTOR_PATTERN.test(val)) {
      errors.push(`columns.${key} contains blocked content (script/event handlers)`);
    }
  }
}

/** Allowed HH:MM (24h) time format for default start times. */
const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate `defaultStartTimeByKennel` is a flat string→"HH:MM" map. */
function validateDefaultStartTimeByKennel(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("Generic HTML config defaultStartTimeByKennel must be an object mapping kennelTag → \"HH:MM\"");
    return;
  }
  for (const [tag, time] of Object.entries(value as Record<string, unknown>)) {
    if (!tag.trim()) {
      errors.push("defaultStartTimeByKennel keys (kennelTag) must be non-empty strings");
      continue;
    }
    if (typeof time !== "string" || !TIME_HHMM_RE.test(time)) {
      errors.push(`defaultStartTimeByKennel.${tag}: time must be HH:MM (e.g. "07:00", "19:15")`);
    }
  }
}

/** Validate Generic HTML Scraper config (containerSelector, rowSelector, columns). */
function validateGenericHtmlConfig(obj: Record<string, unknown>, errors: string[]): void {
  // Only validate if this looks like a generic HTML config
  if (!("containerSelector" in obj) && !("rowSelector" in obj)) return;

  validateSelector("containerSelector", obj.containerSelector, errors);
  validateSelector("rowSelector", obj.rowSelector, errors);
  validateColumnSelectors(obj.columns, errors);

  if (typeof obj.defaultKennelTag !== "string" || !obj.defaultKennelTag.trim()) {
    errors.push("Generic HTML config requires a non-empty defaultKennelTag");
  }

  if (obj.dateLocale !== undefined && obj.dateLocale !== "en-US" && obj.dateLocale !== "en-GB") {
    errors.push('Generic HTML config dateLocale must be "en-US" or "en-GB"');
  }

  if (obj.defaultStartTime !== undefined) {
    if (typeof obj.defaultStartTime !== "string" || !TIME_HHMM_RE.test(obj.defaultStartTime)) {
      errors.push('Generic HTML config defaultStartTime must be HH:MM (e.g. "19:00")');
    }
  }

  validateDefaultStartTimeByKennel(obj.defaultStartTimeByKennel, errors);
}

/**
 * Validate Google Calendar source config. Currently only validates the
 * optional `timezone` field (IANA name); other GCal fields are validated
 * via the shared regex / pattern paths in `validateSourceConfig`.
 */
function validateGoogleCalendarConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (obj.timezone === undefined) return;
  if (typeof obj.timezone !== "string" || !obj.timezone.trim()) {
    errors.push("Google Calendar config timezone must be a non-empty IANA name (e.g. \"America/Chicago\")");
    return;
  }
  if (!isValidTimezone(obj.timezone)) {
    errors.push(`Google Calendar config timezone "${obj.timezone}" is not a recognized IANA timezone`);
  }
}

/** Run type-specific validation for a source config. */
function runTypeValidator(type: string, obj: Record<string, unknown>, errors: string[]): void {
  if (type === "GOOGLE_SHEETS") validateGoogleSheetsConfig(obj, errors);
  else if (type === "GOOGLE_CALENDAR") validateGoogleCalendarConfig(obj, errors);
  else if (type === "MEETUP") validateMeetupConfig(obj, errors);
  else if (type === "RSS_FEED") validateRssFeedConfig(obj, errors);
  else if (type === "STATIC_SCHEDULE") validateStaticScheduleConfig(obj, errors);
  else if (type === "FACEBOOK_HOSTED_EVENTS") validateFacebookHostedEventsConfig(obj, errors);

  // Generic HTML validation runs for any HTML_SCRAPER with selector config
  if (type === "HTML_SCRAPER") validateGenericHtmlConfig(obj, errors);
}

/**
 * Validate source config based on type. Returns error messages or empty array.
 * Validates regex patterns for syntax + ReDoS safety, and checks required fields.
 */
export function validateSourceConfig(
  type: string,
  config: unknown,
): string[] {
  if (config === null || config === undefined) {
    if (TYPES_REQUIRING_CONFIG.has(type)) {
      return [`${type} requires a config object`];
    }
    return [];
  }

  if (typeof config !== "object" || Array.isArray(config)) {
    return ["Config must be a JSON object"];
  }

  const errors: string[] = [];
  const obj = config as Record<string, unknown>;

  // Common pattern validation
  validateKennelPatterns(type, obj, errors);
  validatePatternArray(obj, "skipPatterns", errors);
  validatePatternArray(obj, "harePatterns", errors);
  validatePatternArray(obj, "runNumberPatterns", errors);
  validatePatternArray(obj, "locationPatterns", errors);
  validatePatternArray(obj, "costPatterns", errors);
  validatePatternArray(obj, "titleStripPatterns", errors);
  validatePatternArray(obj, "locationOmitIfMatches", errors, { rejectBroad: true });

  // Single-pattern validation (titleHarePattern is a string, not an array)
  if ("titleHarePattern" in obj && obj.titleHarePattern !== undefined) {
    if (typeof obj.titleHarePattern !== "string") {
      errors.push("titleHarePattern must be a string");
    } else {
      validateRegex(obj.titleHarePattern, "titleHarePattern", errors);
    }
  }

  // Type-specific validation
  runTypeValidator(type, obj, errors);

  return errors;
}
