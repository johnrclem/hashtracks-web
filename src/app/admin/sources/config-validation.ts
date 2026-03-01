import isSafeRegex from "safe-regex2";

/** Types that require a non-empty config object */
const TYPES_REQUIRING_CONFIG = new Set(["GOOGLE_SHEETS", "HASHREGO", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE"]);

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

/** Validate kennelPatterns array: each entry must be a [regex, tag] pair. */
function validateKennelPatterns(obj: Record<string, unknown>, errors: string[]): void {
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
    const [pattern, tag] = pair;
    if (typeof pattern !== "string" || typeof tag !== "string") {
      errors.push(`kennelPatterns[${i}]: both regex and tag must be strings`);
      continue;
    }
    if (!tag.trim()) {
      errors.push(`kennelPatterns[${i}]: kennel tag cannot be empty`);
    }
    validateRegex(pattern, `kennelPatterns[${i}]`, errors);
  }
}

/** Validate skipPatterns array: each entry must be a regex string. */
function validateSkipPatterns(obj: Record<string, unknown>, errors: string[]): void {
  if (!("skipPatterns" in obj) || obj.skipPatterns === undefined) return;

  if (!Array.isArray(obj.skipPatterns)) {
    errors.push("skipPatterns must be an array of regex strings");
    return;
  }
  for (const [i, pattern] of obj.skipPatterns.entries()) {
    if (typeof pattern !== "string") {
      errors.push(`skipPatterns[${i}]: must be a string`);
      continue;
    }
    validateRegex(pattern, `skipPatterns[${i}]`, errors);
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

/** Validate Hash Rego required fields. */
function validateHashRegoConfig(obj: Record<string, unknown>, errors: string[]): void {
  if (
    !obj.kennelSlugs ||
    !Array.isArray(obj.kennelSlugs) ||
    obj.kennelSlugs.length === 0 ||
    obj.kennelSlugs.some((s: unknown) => typeof s !== "string" || s.trim().length === 0)
  ) {
    errors.push("Hash Rego config requires at least one non-empty kennelSlug");
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

/** Run type-specific validation for a source config. */
function runTypeValidator(type: string, obj: Record<string, unknown>, errors: string[]): void {
  if (type === "GOOGLE_SHEETS") validateGoogleSheetsConfig(obj, errors);
  else if (type === "HASHREGO") validateHashRegoConfig(obj, errors);
  else if (type === "MEETUP") validateMeetupConfig(obj, errors);
  else if (type === "RSS_FEED") validateRssFeedConfig(obj, errors);
  else if (type === "STATIC_SCHEDULE") validateStaticScheduleConfig(obj, errors);
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
  validateKennelPatterns(obj, errors);
  validateSkipPatterns(obj, errors);

  // Type-specific validation
  runTypeValidator(type, obj, errors);

  return errors;
}
