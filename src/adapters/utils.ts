/**
 * Shared adapter utilities — deduplicates common parsing logic across adapters.
 */

import * as cheerio from "cheerio";
import he from "he";

/**
 * Decode all HTML entities (named, hex, decimal) in a string.
 * Wraps the `he` library for consistent usage across adapters.
 * Normalizes non-breaking spaces (\u00A0 from &nbsp;) to regular spaces.
 */
export function decodeEntities(text: string): string {
  return he.decode(text).replace(/\u00A0/g, " ");
}

/**
 * Strip HTML tags from a string, converting `<br>` to the specified separator.
 * Removes `<script>` and `<style>` blocks entirely, then strips remaining tags.
 */
export function stripHtmlTags(
  text: string,
  brReplacement = " ",
): string {
  const withBr = text.replace(/<br\s*\/?>/gi, brReplacement);
  const $ = cheerio.load(withBr);
  $("script, style").remove();
  return $.text()
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

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
 * Check if an IPv4 address (as 4 octets) falls within private/reserved ranges.
 */
function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  return (
    a === 127 ||                                  // loopback 127.0.0.0/8
    a === 10 ||                                   // private  10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) ||          // private  172.16.0.0/12
    (a === 192 && b === 168) ||                   // private  192.168.0.0/16
    (a === 169 && b === 254) ||                   // link-local 169.254.0.0/16
    (a === 0 && b === 0 && c === 0 && d === 0)    // 0.0.0.0
  );
}

/**
 * Validate a source URL is safe for server-side fetching (SSRF prevention).
 * Blocks non-HTTP protocols, localhost, private IPs (including alternate
 * representations like decimal, hex, octal, IPv4-mapped IPv6), and cloud
 * metadata endpoints.
 */
export function validateSourceUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Blocked URL: non-HTTP protocol");
  }
  const hostname = parsed.hostname.toLowerCase();

  // Block known internal hostnames
  if (hostname === "localhost" || hostname === "metadata.google.internal") {
    throw new Error("Blocked URL: internal hostname");
  }

  // Strip IPv6 brackets for analysis
  const bare = hostname.replace(/^\[|\]$/g, "");

  // Handle IPv4-mapped IPv6 — dotted quad form (::ffff:127.0.0.1)
  const v4MappedDotted = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  // Handle IPv4-mapped IPv6 — hex form (::ffff:7f00:1, as normalized by URL parser)
  const v4MappedHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  let ipToCheck = bare;
  if (v4MappedDotted) {
    ipToCheck = v4MappedDotted[1];
  } else if (v4MappedHex) {
    const hi = parseInt(v4MappedHex[1], 16);
    const lo = parseInt(v4MappedHex[2], 16);
    ipToCheck = `${(hi >> 8) & 0xFF}.${hi & 0xFF}.${(lo >> 8) & 0xFF}.${lo & 0xFF}`;
  }

  // Check dotted IPv4 (standard notation)
  const ipv4Match = ipToCheck.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (isPrivateIPv4(a, b, c, d)) {
      throw new Error("Blocked URL: private/reserved IP");
    }
    return; // Valid public IPv4
  }

  // Check single-integer IP (e.g., 2130706433 = 127.0.0.1, 0x7f000001)
  if (/^(?:0x[\da-f]+|\d+)$/i.test(ipToCheck)) {
    const num = Number(ipToCheck);
    if (num >= 0 && num <= 0xFFFFFFFF) {
      const a = (num >>> 24) & 0xFF;
      const b = (num >>> 16) & 0xFF;
      const c = (num >>> 8) & 0xFF;
      const d = num & 0xFF;
      if (isPrivateIPv4(a, b, c, d)) {
        throw new Error("Blocked URL: private/reserved IP");
      }
    }
  }

  // Check IPv6 private ranges
  if (bare.includes(":")) {
    if (
      bare === "::1" || bare === "::0" || bare === "::" ||
      bare.startsWith("fc") || bare.startsWith("fd") ||  // unique-local
      bare.startsWith("fe80")                              // link-local
    ) {
      throw new Error("Blocked URL: private/reserved IP");
    }
  }
}

/**
 * Build canonical + fallback URL base variants for host/protocol edge-routing issues.
 * Order: original, host variant (www/non-www), protocol variant (http/https), protocol+host variant.
 */
export function buildUrlVariantCandidates(baseUrl: string): string[] {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const candidates = [normalizedBase];

  try {
    const parsed = new URL(normalizedBase);

    const hostVariant = new URL(parsed.toString());
    if (hostVariant.hostname.startsWith("www.")) {
      hostVariant.hostname = hostVariant.hostname.slice(4);
    } else {
      hostVariant.hostname = `www.${hostVariant.hostname}`;
    }
    candidates.push(hostVariant.toString().replace(/\/+$/, ""));

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const protocolVariant = new URL(parsed.toString());
      protocolVariant.protocol = parsed.protocol === "https:" ? "http:" : "https:";
      candidates.push(protocolVariant.toString().replace(/\/+$/, ""));

      const protocolAndHostVariant = new URL(protocolVariant.toString());
      if (protocolAndHostVariant.hostname.startsWith("www.")) {
        protocolAndHostVariant.hostname = protocolAndHostVariant.hostname.slice(4);
      } else {
        protocolAndHostVariant.hostname = `www.${protocolAndHostVariant.hostname}`;
      }
      candidates.push(protocolAndHostVariant.toString().replace(/\/+$/, ""));
    }
  } catch {
    // URL validation happens upstream.
  }

  return [...new Set(candidates)];
}

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
 * Compute a date window centered on "now" for event filtering.
 * Returns minDate (days ago) and maxDate (days ahead).
 */
export function buildDateWindow(days = 90): { minDate: Date; maxDate: Date } {
  const now = new Date();
  const ms = days * 24 * 60 * 60 * 1000;
  return {
    minDate: new Date(now.getTime() - ms),
    maxDate: new Date(now.getTime() + ms),
  };
}

/**
 * Extract UK postcode from a text string.
 * UK postcodes: "SE11 5JA", "SW18 2SS", "N1 9AA", "EC1A 1BB"
 */
export function extractUkPostcode(text: string): string | null {
  const match = text.match(/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i);
  return match ? match[0].toUpperCase() : null;
}
