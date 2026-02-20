import isSafeRegex from "safe-regex2";

/** Types that require a non-empty config object */
const TYPES_REQUIRING_CONFIG = new Set(["GOOGLE_SHEETS", "HASHREGO"]);

/**
 * Validate source config based on type. Returns error messages or empty array.
 * Validates regex patterns for syntax + ReDoS safety, and checks required fields.
 */
export function validateSourceConfig(
  type: string,
  config: unknown,
): string[] {
  // Null/undefined config: only an error for types that require config
  if (config === null || config === undefined) {
    if (TYPES_REQUIRING_CONFIG.has(type)) {
      return [`${type} requires a config object`];
    }
    return [];
  }

  // Non-object config (arrays, strings, numbers) is always invalid
  if (typeof config !== "object" || Array.isArray(config)) {
    return ["Config must be a JSON object"];
  }

  const errors: string[] = [];
  const obj = config as Record<string, unknown>;

  // Validate kennelPatterns (used by GOOGLE_CALENDAR, ICAL_FEED, HTML_SCRAPER)
  if ("kennelPatterns" in obj && obj.kennelPatterns !== undefined) {
    if (!Array.isArray(obj.kennelPatterns)) {
      errors.push("kennelPatterns must be an array of [regex, tag] pairs");
    } else {
      for (const [i, pair] of obj.kennelPatterns.entries()) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          errors.push(`kennelPatterns[${i}]: must be a [regex, tag] pair`);
          continue;
        }
        const [pattern, tag] = pair;
        if (typeof pattern !== "string" || typeof tag !== "string") {
          errors.push(
            `kennelPatterns[${i}]: both regex and tag must be strings`,
          );
          continue;
        }
        if (!tag.trim()) {
          errors.push(`kennelPatterns[${i}]: kennel tag cannot be empty`);
        }
        validateRegex(pattern, `kennelPatterns[${i}]`, errors);
      }
    }
  }

  // Validate skipPatterns (used by ICAL_FEED, HTML_SCRAPER)
  if ("skipPatterns" in obj && obj.skipPatterns !== undefined) {
    if (!Array.isArray(obj.skipPatterns)) {
      errors.push("skipPatterns must be an array of regex strings");
    } else {
      for (const [i, pattern] of obj.skipPatterns.entries()) {
        if (typeof pattern !== "string") {
          errors.push(`skipPatterns[${i}]: must be a string`);
          continue;
        }
        validateRegex(pattern, `skipPatterns[${i}]`, errors);
      }
    }
  }

  // Type-specific required fields
  if (type === "GOOGLE_SHEETS") {
    if (!obj.sheetId || typeof obj.sheetId !== "string") {
      errors.push("Google Sheets config requires sheetId");
    }
    if (!obj.columns || typeof obj.columns !== "object") {
      errors.push("Google Sheets config requires columns mapping");
    }
    if (
      !obj.kennelTagRules ||
      typeof obj.kennelTagRules !== "object" ||
      !(obj.kennelTagRules as Record<string, unknown>).default
    ) {
      errors.push(
        "Google Sheets config requires kennelTagRules with a default tag",
      );
    }
  }

  if (type === "HASHREGO") {
    if (
      !obj.kennelSlugs ||
      !Array.isArray(obj.kennelSlugs) ||
      obj.kennelSlugs.length === 0
    ) {
      errors.push("Hash Rego config requires at least one kennelSlug");
    }
  }

  return errors;
}

/** Validate a single regex pattern for syntax and ReDoS safety */
function validateRegex(
  pattern: string,
  label: string,
  errors: string[],
): void {
  try {
    const re = new RegExp(pattern, "i");
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
