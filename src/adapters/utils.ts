/**
 * Shared adapter utilities — deduplicates common parsing logic across adapters.
 *
 * NOTE: This module is imported by client components (via
 * html-scraper/generic.ts → SourceOnboardingWizard). It must not pull in
 * Node built-ins like `node:dns`. DNS-based SSRF validation lives in
 * `./ssrf-dns.ts` (server-only).
 */

import * as cheerio from "cheerio";
import * as chrono from "chrono-node";
import he from "he";
import { buildUrlVariantCandidates } from "@/adapters/url-variants";
import { safeFetch } from "./safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";
import type { ErrorDetails, ScrapeResult } from "./types";

/**
 * Decode all HTML entities (named, hex, decimal) in a string.
 * Wraps the `he` library for consistent usage across adapters.
 * Normalizes non-breaking spaces (\u00A0 from &nbsp;) to regular spaces.
 */
export function decodeEntities(text: string): string {
  return he.decode(text).replace(/\u00A0/g, " ");
}

/**
 * Strip HTML tags from a string, converting `<br>` and closing block-level
 * tags to the specified separator. Removes `<script>` and `<style>` blocks
 * entirely, then strips remaining tags.
 */
export function stripHtmlTags(
  text: string,
  separator = " ",
): string {
  const withBr = text.replace(/<br\s*\/?>/gi, separator);
  // Insert replacement before closing block-level tags so paragraph boundaries survive .text()
  const withBlocks = withBr.replace(/<\/(?:p|div|li|tr|blockquote|h[1-6])\s*>/gi, separator);
  const $ = cheerio.load(withBlocks);
  $("script, style").remove();
  return $.text()
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/**
 * Compile an array of regex pattern strings into RegExp objects.
 * Malformed patterns are silently skipped. Used by adapters to pre-compile
 * config-driven patterns once per scrape instead of per event.
 *
 * @see validatePatternArray in src/app/admin/sources/config-validation.ts
 *      — patterns are validated for syntax + ReDoS safety (via safe-regex2)
 *      before storage, so all inputs here have already passed validation.
 */
export function compilePatterns(patterns: string[], flags = "im"): RegExp[] {
  const compiled: RegExp[] = [];
  for (const p of patterns) {
    try {
      // nosemgrep: detect-non-literal-regexp — patterns are pre-validated via safe-regex2 (see config-validation.ts)
      compiled.push(new RegExp(p, flags)); // NOSONAR
    } catch {
      // Skip malformed patterns from source config
    }
  }
  return compiled;
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
 * Exported for reuse by `./ssrf-dns.ts` (DNS-based rebinding protection).
 */
export function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  return (
    a === 127 ||                                  // loopback 127.0.0.0/8
    a === 10 ||                                   // private  10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) ||          // private  172.16.0.0/12
    (a === 192 && b === 168) ||                   // private  192.168.0.0/16
    (a === 169 && b === 254) ||                   // link-local 169.254.0.0/16
    (a === 0 && b === 0 && c === 0 && d === 0) || // 0.0.0.0
    (a === 100 && b >= 64 && b <= 127) ||         // CGNAT    100.64.0.0/10
    (a >= 224 && a <= 239) ||                     // multicast 224.0.0.0/4
    a >= 240                                      // reserved  240.0.0.0/4 (incl broadcast)
  );
}

/** Resolve IPv4-mapped IPv6 addresses to their IPv4 equivalent. */
export function resolveIPv4Mapped(bare: string): string {
  const v4MappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(bare);
  if (v4MappedDotted) return v4MappedDotted[1];

  const v4MappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(bare);
  if (v4MappedHex) {
    const hi = Number.parseInt(v4MappedHex[1], 16);
    const lo = Number.parseInt(v4MappedHex[2], 16);
    return `${(hi >> 8) & 0xFF}.${hi & 0xFF}.${(lo >> 8) & 0xFF}.${lo & 0xFF}`;
  }

  return bare;
}

/** Check if a single-integer IP (decimal or hex) maps to a private IPv4 range. */
function checkIntegerIP(ip: string): void {
  if (!/^(?:0x[\da-f]+|\d+)$/i.test(ip)) return;
  const num = Number(ip);
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

/** Check if an IPv6 address is in a private/reserved range. */
export function checkIPv6Private(bare: string): void {
  if (!bare.includes(":")) return;
  if (
    bare === "::1" || bare === "::0" || bare === "::" ||
    bare.startsWith("fc") || bare.startsWith("fd") ||  // unique-local
    bare.startsWith("fe80")                              // link-local
  ) {
    throw new Error("Blocked URL: private/reserved IP");
  }
}

/**
 * Block ambiguous dotted-IPv4 notations that bypass the standard
 * `(\d{1,3}).(\d{1,3}).(\d{1,3}).(\d{1,3})` regex. Specifically: octets
 * with leading zeros (interpreted as octal by `getaddrinfo`) and octets
 * longer than 3 digits. `getaddrinfo` — and therefore Node's
 * `dns.lookup` — will silently interpret `0177.0.0.1` as `127.0.0.1`,
 * so we reject these forms outright before any DNS is involved.
 */
function checkAmbiguousDottedQuad(ip: string): void {
  const parts = ip.split(".");
  if (parts.length !== 4) return;
  if (!parts.every((p) => /^[0-9a-f]+$/i.test(p))) return;
  if (parts.some((p) => /^0\d/.test(p) || p.length > 3)) {
    throw new Error("Blocked URL: ambiguous IPv4 notation");
  }
}

/**
 * Validate a source URL is safe for server-side fetching (SSRF prevention).
 * Blocks non-HTTP protocols, localhost, private IPs (including alternate
 * representations like decimal, hex, octal, IPv4-mapped IPv6), and cloud
 * metadata endpoints.
 *
 * NOTE: This is the synchronous fast-path check that only validates the
 * hostname string. It does NOT resolve DNS and therefore does NOT protect
 * against DNS rebinding or domains that resolve directly to private IPs.
 * Callers that issue an outbound request should use
 * `validateSourceUrlWithDns()` from `./ssrf-dns` instead.
 */
export function validateSourceUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Blocked URL: non-HTTP protocol");
  }
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === "localhost" || hostname === "metadata.google.internal") {
    throw new Error("Blocked URL: internal hostname");
  }

  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");
  const ipToCheck = resolveIPv4Mapped(bare);

  // Reject ambiguous dotted-quad (octal / padded) before the strict regex.
  checkAmbiguousDottedQuad(ipToCheck);

  // Check dotted IPv4 (standard notation)
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipToCheck);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (isPrivateIPv4(a, b, c, d)) {
      throw new Error("Blocked URL: private/reserved IP");
    }
    return;
  }

  checkIntegerIP(ipToCheck);
  checkIPv6Private(bare);
}

export { buildUrlVariantCandidates };

/**
 * Parse a 12-hour time string into 24-hour "HH:MM" format.
 * Matches: "4:00 pm", "7:15 PM", "12:00 am"
 * Returns undefined if no match found.
 */
/**
 * Convert an already-extracted (hour, minute, am/pm) tuple into a 24-hour
 * "HH:MM" string. Used by adapters that match their own surrounding-context
 * regex (e.g. "Run starts 5:30PM" or "Friday, 03 April, 6 pm sharp") and just
 * need the conversion + zero-padding.
 */
export function formatAmPmTime(hour: number, minute: number, ampm: string): string {
  let h = hour;
  const lower = ampm.toLowerCase();
  if (lower === "pm" && h !== 12) h += 12;
  if (lower === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parse12HourTime(text: string): string | undefined {
  const match = /(\d{1,2}):(\d{2,3})\s*(am|pm)/i.exec(text);
  if (!match) return undefined;

  let hours = Number.parseInt(match[1], 10);
  let mins = Number.parseInt(match[2], 10);
  const ampm = match[3].toLowerCase();

  // Convert 12-hour to 24-hour first
  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  // Normalize overflow minutes after AM/PM conversion (hash humor: "1:69 PM" = "2:09 PM")
  if (mins >= 60) {
    hours += Math.floor(mins / 60);
    mins = mins % 60;
  }
  hours = hours % 24; // wrap past midnight

  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
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
 * Normalize a hares field for stable RawEvent fingerprints. Splits
 * comma-separated names, trims, dedupes, sorts alphabetically, and
 * rejoins. When a source API returns participants in nondeterministic
 * order, unsorted joins produce fresh fingerprints on every scrape and
 * break idempotency — see `feedback_fingerprint_stability` memory and
 * `seletar-h3.ts` for the precedent. Returns `undefined` if the input
 * is nullish/empty.
 */
export function normalizeHaresField(hares: string | null | undefined): string | undefined {
  if (!hares) return undefined;
  const parts = hares
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return undefined;
  const unique = Array.from(new Set(parts));
  unique.sort((a, b) => a.localeCompare(b));
  return unique.join(", ");
}

/**
 * Filter events to those within `±days` of now. Honors the adapter
 * contract that fetch() should respect `options.days` (which is itself
 * sourced from `source.scrapeDays`). Events are keyed by their
 * `"YYYY-MM-DD"` date string; the window is inclusive at both ends.
 */
export function filterEventsByWindow<T extends { date: string }>(
  events: T[],
  days: number,
): T[] {
  const { minDate, maxDate } = buildDateWindow(days);
  return events.filter((e) => {
    const d = new Date(`${e.date}T12:00:00Z`);
    return d >= minDate && d <= maxDate;
  });
}

/**
 * Apply the date window to a ScrapeResult-shaped object, replacing
 * `events` with the filtered array and updating diagnosticContext so
 * `eventsParsed` reflects the post-filter count and `totalBeforeFilter`
 * captures the pre-filter total. Use this instead of spreading +
 * overriding `events` alone — otherwise the diagnostic counts lie about
 * what the merge pipeline actually receives.
 */
export function applyDateWindow<
  R extends { events: { date: string }[]; diagnosticContext?: Record<string, unknown> },
>(result: R, days: number): R {
  const before = result.events.length;
  const filtered = filterEventsByWindow(result.events, days);
  return {
    ...result,
    events: filtered,
    diagnosticContext: {
      ...(result.diagnosticContext ?? {}),
      eventsParsed: filtered.length,
      totalBeforeFilter: before,
    },
  } as R;
}

/**
 * Extract UK postcode from a text string.
 * UK postcodes: "SE11 5JA", "SW18 2SS", "N1 9AA", "EC1A 1BB"
 */
export function extractUkPostcode(text: string): string | null {
  const match = /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.exec(text);
  return match ? match[0].toUpperCase() : null;
}

export type DateLocale = "en-US" | "en-GB";

/**
 * Parse a natural-language date string into "YYYY-MM-DD" format using chrono-node.
 *
 * @param text - Date text (e.g., "18th March 2026", "March 14, 2026", "21/02/2026")
 * @param locale - "en-US" for MM/DD interpretation, "en-GB" for DD/MM interpretation
 * @param referenceDate - Optional reference date for year inference when year is omitted
 * @param options - Optional parsing options (forwardDate: prefer next future occurrence)
 * @returns "YYYY-MM-DD" string, or null if parsing fails
 */
export function chronoParseDate(
  text: string,
  locale: DateLocale = "en-US",
  referenceDate?: Date,
  options?: { forwardDate?: boolean },
): string | null {
  // Normalize hyphenated M-D dates (e.g., "3-7", "10-31: HALLOWEEN") → "M/D"
  // before parsing. Chrono can't parse "3-7" but handles "3/7" natively.
  // Negative lookahead excludes M-D-YY patterns (e.g., "3-7-26").
  const normalized = text.replace(/^(\d{1,2})-(\d{1,2})(?![\d-])/, "$1/$2");

  const parser = locale === "en-GB" ? chrono.en.GB : chrono.en;
  const ref: chrono.ParsingReference | undefined = referenceDate
    ? { instant: referenceDate }
    : undefined;
  const results = parser.parse(normalized, ref, {
    forwardDate: options?.forwardDate ?? false,
  });

  if (results.length === 0) return null;

  const parsed = results[0].start;
  const year = parsed.get("year");
  const month = parsed.get("month");
  const day = parsed.get("day");

  if (year == null || month == null || day == null) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Shared HTML fetch helper — eliminates boilerplate across HTML scrapers
// ---------------------------------------------------------------------------

export type FetchHTMLSuccess = {
  ok: true;
  html: string;
  $: cheerio.CheerioAPI;
  structureHash: string;
  fetchDurationMs: number;
};

type FetchHTMLError = { ok: false; result: ScrapeResult };

export type FetchHTMLResult = FetchHTMLSuccess | FetchHTMLError;

/**
 * Fetch a URL, validate via safeFetch, compute structureHash, and load Cheerio.
 * Returns a discriminated union: check `result.ok` before accessing fields.
 */
export async function fetchHTMLPage(url: string): Promise<FetchHTMLResult> {
  const fetchStart = Date.now();
  try {
    const response = await safeFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${response.statusText}`;
      const errorDetails: ErrorDetails = {
        fetch: [{ url, status: response.status, message }],
      };
      return { ok: false, result: { events: [], errors: [message], errorDetails } };
    }
    const html = await response.text();
    return {
      ok: true,
      html,
      $: cheerio.load(html),
      structureHash: generateStructureHash(html),
      fetchDurationMs: Date.now() - fetchStart,
    };
  } catch (err) {
    const message = `Fetch failed: ${err}`;
    const errorDetails: ErrorDetails = { fetch: [{ url, message }] };
    return { ok: false, result: { events: [], errors: [message], errorDetails } };
  }
}

// ---------------------------------------------------------------------------
// Hare boilerplate detection — shared across adapters + pipeline
// ---------------------------------------------------------------------------

/**
 * Regex matching boilerplate markers that indicate description text leaked into
 * the hares field. Used by both adapter-level extractHares() and pipeline-level
 * sanitizeHares() to truncate at the first marker.
 *
 * The pipeline's sanitizeHares() is the authoritative safety net; adapter-level
 * usage is best-effort early cleanup.
 */
export const HARE_BOILERPLATE_RE = /\s*\b(?:WHAT TIME|WHAT TO WEAR|WHERE|Location|HASH CASH|Cost|Price|Length|Distance|Directions|Trail Type|Trail is|Start|Meet at|Registration|WHAT IS THE COST|On-On|On On|Hares?\s+Needed|Question|Call\s|Lost\?)[:\s].*|\s*\(\d{3}\)\s*\d{3}.*/i;

/**
 * Embedded CTA phrases like "Hares needed for Friday evening." Used by both the
 * pipeline audit (`checkTitleQuality`) and the Google Calendar adapter to filter
 * placeholder recruitment events out of ingestion. See #755, #758, #759.
 */
export const CTA_EMBEDDED_PATTERNS = [
  /\bhares?\s+(?:needed|wanted|required|volunteer\w*)\b/i,
  /\bneed(?:ed)?\s+(?:a\s+)?hares?\b/i,
  /\blooking\s+for\s+(?:a\s+)?hares?\b/i,
] as const;

// ---------------------------------------------------------------------------
// Non-English country name normalization
// ---------------------------------------------------------------------------

/**
 * Trailing non-English country name patterns. Strips ", États-Unis" and similar
 * suffixes that leak in when a GCal calendar owner's locale is non-English, or
 * when the geocoder returns localized country names despite `language=en`.
 * Currently only covers US country names (French, German, Spanish variants).
 */
const NON_ENGLISH_COUNTRY_SUFFIX_RE = /,\s*(?:États[ -]Unis|Vereinigte Staaten|Estados Unidos|Etats[ -]Unis)\s*$/i;

/**
 * Strip trailing non-English country names from a location string.
 * e.g. "Rochester, NY 14609, États-Unis" → "Rochester, NY 14609"
 */
export function stripNonEnglishCountry(location: string): string {
  return location.replace(NON_ENGLISH_COUNTRY_SUFFIX_RE, "").trim();
}

// ---------------------------------------------------------------------------
// Placeholder detection — shared across adapters for TBD/TBA/TBC cleanup
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE =
  /^(?:tbd|tba|tbc|n\/a|none|null|needed|required|registration|sign[\s\-_]*up!?|volunteer|\?{1,3}|hares?\s+needed\b[\s\S]*|needs?\s+(?:a\s+)?hares?\b[\s\S]*)$/i;

/**
 * Field labels that frequently appear next to a colon in event descriptions
 * (Hash Cash, Where, When, What, etc.). Used to truncate hare extraction when
 * HTML stripping has collapsed multiple fields onto one line.
 *
 * The regex is intentionally case-sensitive (no /i flag): labels must be capitalized.
 * This matches the collapsed-field case "AmazonWhat:" (capital W is the boundary signal)
 * while avoiding false positives on words like "Somewhere:" (lowercase w would match an
 * insensitive regex). A `\b` word-boundary doesn't help here because "AmazonWhat" has
 * no word break — both characters are word chars.
 *
 * All-caps variants live in {@link EVENT_FIELD_LABEL_UPPERCASE_RE} so each regex stays
 * under SonarCloud's complexity budget and callers can apply both passes.
 *
 * Single source of truth used by both google-calendar and html-scraper adapters.
 */
export const EVENT_FIELD_LABEL_RE =
  /(?:What|Where|When|Why|How|Time|Start|Location|Hash\s*Cash|Cost|Price|Registration|On[\s-]After|Directions|Pack\s*Meet|Circle|Chalk\s*Talk)\s*:.*$/;

/** All-caps counterpart of {@link EVENT_FIELD_LABEL_RE} for BJH3/BMPH3-style descriptions. */
export const EVENT_FIELD_LABEL_UPPERCASE_RE =
  /(?:WHAT|WHERE|WHEN|WHY|HOW|WHO|TIME|START|LOCATION|HASH\s*CASH|COST|PRICE)\s*:.*$/;

/**
 * Check if a value is a common placeholder (TBD, TBA, TBC, N/A, ?, ??, needed, required).
 * Fully anchored + case-insensitive. Trims input before matching.
 */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value.trim());
}

/**
 * Return the value if it's non-empty and not a placeholder, otherwise undefined.
 * Convenience wrapper: `stripPlaceholder(cell) ?? fallback`
 */
export function stripPlaceholder(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_RE.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Append a static suffix to an event description.
 * Used by adapters that support `descriptionSuffix` config (e.g., Facebook page note).
 * Returns the original description if no suffix is provided.
 */
export function appendDescriptionSuffix(
  description: string | undefined,
  suffix: string | undefined,
): string | undefined {
  const trimmedSuffix = suffix?.trim();
  if (!trimmedSuffix) return description;
  return description ? `${description}\n\n${trimmedSuffix}` : trimmedSuffix;
}

/**
 * Extract a street address from a text blob using Gemini.
 * Returns the extracted address string, or null if none found.
 * Intended as a fallback when deterministic parsing fails on long text.
 */
export async function extractAddressWithAi(text: string): Promise<string | null> {
  if (!text || text.length < 20) return null;

  try {
    const { callGemini } = await import("@/lib/ai/gemini");
    const prompt = `Extract the street address or venue location from this text. Return ONLY a JSON object with a single "address" field containing the address. If no clear address is found, return {"address": null}.

Text: "${text.slice(0, 500)}"`;

    const response = await callGemini({ prompt, temperature: 0.1, maxOutputTokens: 256 });
    if (!response.text) return null;
    const parsed = JSON.parse(response.text);
    const addr = parsed?.address;
    if (typeof addr === "string" && addr.trim().length > 0 && addr.length < 200) {
      return addr.trim();
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Browser-rendered HTML fetch helper — for Wix, Google Sites, SPAs
// ---------------------------------------------------------------------------

/**
 * Fetch a URL via the NAS headless browser rendering service, compute
 * structureHash, and load Cheerio. Same discriminated union pattern as
 * fetchHTMLPage() so adapters can use `page.ok` / `page.$` identically.
 *
 * Use this for JS-rendered sites (Wix, Google Sites, SPAs) where standard
 * HTTP fetch returns empty containers.
 */
export async function fetchBrowserRenderedPage(
  url: string,
  options?: { waitFor?: string; selector?: string; frameUrl?: string; timeout?: number },
): Promise<FetchHTMLResult> {
  const fetchStart = Date.now();
  try {
    const { browserRender } = await import("@/lib/browser-render");
    const html = await browserRender({ url, ...options });
    return {
      ok: true,
      html,
      $: cheerio.load(html),
      structureHash: generateStructureHash(html),
      fetchDurationMs: Date.now() - fetchStart,
    };
  } catch (err) {
    const message = `Browser render failed: ${err}`;
    const errorDetails: ErrorDetails = { fetch: [{ url, message }] };
    return { ok: false, result: { events: [], errors: [message], errorDetails } };
  }
}
