/**
 * Shared adapter utilities — deduplicates common parsing logic across adapters.
 */

/**
 * Month name → 1-indexed month number (for YYYY-MM-DD string formatting).
 * Used by: london-hash, city-hash, west-london-hash, bfm, hashphilly
 */
export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Month name → 0-indexed month number (for Date.UTC() calls).
 * Used by: hashnyc
 */
export const MONTHS_ZERO: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Parse a 12-hour time string into 24-hour "HH:MM" format.
 * Matches: "4:00 pm", "7:15 PM", "12:00 am"
 * Returns undefined if no match found.
 */
export function parse12HourTime(text: string): string | undefined {
  const match = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return undefined;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Generate a Google Maps search URL from a location string.
 */
export function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Validate a source config object from the database.
 * Returns the validated config or throws a descriptive error.
 *
 * Usage:
 *   const config = validateSourceConfig<MyConfig>(source.config, "MyAdapter", {
 *     sheetId: "string",
 *     columns: "object",
 *   });
 */
export function validateSourceConfig<T>(
  raw: unknown,
  adapterName: string,
  requiredFields: Record<string, "string" | "object" | "array">,
): T {
  if (raw === null || raw === undefined) {
    throw new Error(`${adapterName}: source.config is ${raw} — expected a config object`);
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${adapterName}: source.config must be an object, got ${typeof raw}`);
  }

  const obj = raw as Record<string, unknown>;
  for (const [field, expectedType] of Object.entries(requiredFields)) {
    const value = obj[field];
    if (value === undefined || value === null) {
      throw new Error(`${adapterName}: missing required config field "${field}"`);
    }
    if (expectedType === "array" && !Array.isArray(value)) {
      throw new Error(`${adapterName}: config.${field} must be an array, got ${typeof value}`);
    } else if (expectedType === "object" && (typeof value !== "object" || Array.isArray(value))) {
      throw new Error(`${adapterName}: config.${field} must be an object, got ${typeof value}`);
    } else if (expectedType === "string" && typeof value !== "string") {
      throw new Error(`${adapterName}: config.${field} must be a string, got ${typeof value}`);
    }
  }

  return raw as T;
}

/**
 * Extract UK postcode from a text string.
 * UK postcodes: "SE11 5JA", "SW18 2SS", "N1 9AA", "EC1A 1BB"
 */
export function extractUkPostcode(text: string): string | null {
  const match = text.match(/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i);
  return match ? match[0].toUpperCase() : null;
}
