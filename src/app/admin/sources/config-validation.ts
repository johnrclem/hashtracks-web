import isSafeRegex from "safe-regex2";

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
const TYPES_REQUIRING_CONFIG = new Set(["GOOGLE_SHEETS", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE"]);

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

/** Validate kennelPatterns: each entry is [regex, tag] or [regex, tag[]] (#1023 step 4). */
function validateKennelPatterns(type: string, obj: Record<string, unknown>, errors: string[]): void {
  if (!("kennelPatterns" in obj) || obj.kennelPatterns === undefined) return;

  if (!Array.isArray(obj.kennelPatterns)) {
    errors.push("kennelPatterns must be an array of [regex, tag] pairs");
    return;
  }
  const allowMultiKennel = TYPES_SUPPORTING_MULTI_KENNEL_PATTERNS.has(type);
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
    if (typeof tagValue === "string") {
      if (!tagValue.trim()) {
        errors.push(`kennelPatterns[${i}]: kennel tag cannot be empty`);
      }
    } else if (Array.isArray(tagValue)) {
      if (!allowMultiKennel) {
        errors.push(
          `kennelPatterns[${i}]: multi-kennel array tags are not supported for source type ${type} ` +
            `— migrate the adapter to matchKennelPatterns first (#1023). Allowed: ${[...TYPES_SUPPORTING_MULTI_KENNEL_PATTERNS].join(", ")}.`,
        );
        continue;
      }
      if (tagValue.length === 0) {
        errors.push(`kennelPatterns[${i}]: multi-kennel tag array cannot be empty`);
      }
      for (const [j, tag] of tagValue.entries()) {
        if (typeof tag !== "string" || !tag.trim()) {
          errors.push(`kennelPatterns[${i}][${j}]: each multi-kennel tag must be a non-empty string`);
        }
      }
    } else {
      errors.push(`kennelPatterns[${i}]: tag must be a string${allowMultiKennel ? " or string[]" : ""}`);
    }
    validateRegex(pattern, `kennelPatterns[${i}]`, errors);
  }
}

/** Validate a named string[] config field where each entry must be a valid regex. */
function validatePatternArray(obj: Record<string, unknown>, fieldName: string, errors: string[]): void {
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

/** Validate STATIC_SCHEDULE required fields. */
function validateStaticScheduleConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (typeof obj.kennelTag !== "string" || !obj.kennelTag.trim()) {
    errors.push("Static Schedule config requires a non-empty kennelTag");
  }
  if (typeof obj.rrule !== "string" || !obj.rrule.trim()) {
    errors.push("Static Schedule config requires a non-empty rrule");
  } else if (!/^FREQ=/i.test(obj.rrule.trim())) {
    errors.push("Static Schedule rrule must start with FREQ= (e.g. FREQ=WEEKLY;BYDAY=SA)");
  }
  if (obj.startTime !== undefined) {
    if (typeof obj.startTime !== "string") {
      errors.push("Static Schedule config startTime must be a string");
    } else if (!/^\d{2}:\d{2}$/.test(obj.startTime)) {
      errors.push('Static Schedule config startTime must be HH:MM format (e.g. "10:17", "19:00")');
    }
  }
  if (obj.anchorDate !== undefined) {
    if (typeof obj.anchorDate !== "string") {
      errors.push("Static Schedule config anchorDate must be a string");
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(obj.anchorDate)) {
      errors.push('Static Schedule config anchorDate must be YYYY-MM-DD format (e.g. "2026-01-03")');
    }
  }
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
}

/** Run type-specific validation for a source config. */
function runTypeValidator(type: string, obj: Record<string, unknown>, errors: string[]): void {
  if (type === "GOOGLE_SHEETS") validateGoogleSheetsConfig(obj, errors);
  else if (type === "MEETUP") validateMeetupConfig(obj, errors);
  else if (type === "RSS_FEED") validateRssFeedConfig(obj, errors);
  else if (type === "STATIC_SCHEDULE") validateStaticScheduleConfig(obj, errors);

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
