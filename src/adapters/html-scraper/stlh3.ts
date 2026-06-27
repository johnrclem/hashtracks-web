/**
 * St. Louis Hash House Harriers (STLH3) Substack Scraper
 *
 * Fetches event posts from stlh3.com, which is a Substack publication.
 *
 * Listing endpoint: /api/v1/archive?sort=new&limit=50
 * Detail endpoint: /api/v1/posts/{slug}
 *
 * Post structure:
 *   - title: "Upcumming Hash: Sunday Mar 29th 2026" -> parse date with chrono-node
 *   - subtitle: "Meet @ 5PM" -> parse start time
 *   - body_html (detail only): contains Google Maps links with venue
 *
 * Location is extracted from Google Maps URLs:
 *   google.com/maps/dir//VenueName+Address/@lat,lng
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { safeFetch } from "../safe-fetch";
import { applyDateWindow, chronoParseDate } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";

/** Shape of a post from the Substack archive API listing */
interface SubstackArchivePost {
  title: string;
  subtitle: string | null;
  slug: string;
  post_date: string;
  canonical_url: string;
  body_html?: string | null;
}

/** Shape of a post detail from the Substack posts API */
interface SubstackPostDetail {
  title: string;
  subtitle: string | null;
  slug: string;
  body_html: string | null;
  canonical_url: string;
}

/**
 * Parse a start time from a subtitle string.
 * Formats: "Meet @ 5PM", "Meet @ 2pm", "Meet @ 11AM", "2:00 PM"
 * Returns "HH:MM" or "17:00" as default.
 */
export function parseSubtitleTime(subtitle?: string | null): string {
  if (!subtitle) return "17:00";

  const match = /(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(subtitle);
  if (!match) return "17:00";

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] || "00";
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

// Google-owned shortlink hosts whose venue can only be recovered by following
// the redirect (#2338). `goo.gl`/`maps.app.goo.gl` are Maps short URLs;
// `share.google` is Google's share shim that lands on a `google.*/search?q=`.
const MAPS_SHORTLINK_HOSTS = new Set(["share.google", "goo.gl", "maps.app.goo.gl"]);
// Any `google.<tld>` host (google.com, www.google.com, maps.google.com,
// google.co.uk, …) — the direct `/maps/...` + resolved `/search?q=` surfaces.
const GOOGLE_HOST_RE = /^(?:[a-z0-9-]+\.)*google(?:\.[a-z]{2,})+$/;
const MAPS_DIR_RE = /\/maps\/dir\/\/([^/@?]+)/i;
const MAPS_PLACE_RE = /\/maps\/place\/([^/@?]+)/i;
// A coordinate-only / numeric query value ("38.6,-90.2") that is not a venue.
const COORDS_ONLY_RE = /^[-\d.,\s]+$/;
// Generic map anchor labels that carry no venue ("Google Map", "Directions").
const GENERIC_MAP_LABEL_RE = /^(?:google\s*map|view\s*map|map|directions?|location)s?$/i;

/**
 * The validated lowercase hostname of an http(s) URL, or undefined when the
 * href is unparseable / non-HTTP. Used to gate maps-link detection on the
 * actual HOST rather than a substring match — a hostile body link like
 * `https://evil.example/?next=share.google/x` must NOT be treated as a maps
 * link, persisted as `locationUrl`, or followed as a shortlink (Codex review).
 */
function httpHost(href: string): string | undefined {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  return u.hostname.toLowerCase();
}

/** A trustworthy Google Maps / share host (allowlisted by hostname). */
function isMapsHost(href: string): boolean {
  const host = httpHost(href);
  if (!host) return false;
  return MAPS_SHORTLINK_HOSTS.has(host) || GOOGLE_HOST_RE.test(host);
}

/** A Google shortlink host whose venue can only be recovered by following the redirect. */
function isMapsShortlink(href: string): boolean {
  const host = httpHost(href);
  return host !== undefined && MAPS_SHORTLINK_HOSTS.has(host);
}

/** Decode a `+`-delimited Google Maps path/param segment to plain text. */
function decodeMapsSegment(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " ")).trim();
  } catch {
    return s.replace(/\+/g, " ").trim();
  }
}

/** Venue from the path forms `/maps/dir//VENUE` or `/maps/place/VENUE`. */
function parseVenueFromMapsPath(url: string): string | undefined {
  const dir = MAPS_DIR_RE.exec(url);
  if (dir) return decodeMapsSegment(dir[1]);
  const place = MAPS_PLACE_RE.exec(url);
  if (place) return decodeMapsSegment(place[1]);
  return undefined;
}

/** Venue from the query forms `?daddr=…`, `?q=…`, or `?destination=…`. */
function parseVenueFromMapsQuery(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const raw =
    u.searchParams.get("daddr") ??
    u.searchParams.get("q") ??
    u.searchParams.get("destination");
  if (!raw) return undefined;
  const v = decodeMapsSegment(raw);
  // Reject coordinate-only or too-short values ("x", "38.6,-90.2").
  if (v.length <= 3 || COORDS_ONLY_RE.test(v)) return undefined;
  return v;
}

/** A descriptive anchor label, rejecting generic "Google Map" / "Directions" text. */
function realLinkText(text: string): string | undefined {
  const t = text.trim();
  if (t.length <= 3) return undefined;
  if (GENERIC_MAP_LABEL_RE.test(t)) return undefined;
  return t;
}

/**
 * The first anchor whose HOST is an allowlisted Google Maps / share host, with
 * its href + visible text. Host-gated (not substring-matched) so untrusted post
 * HTML can't smuggle a hostile href through a `share.google` query fragment.
 */
export function findMapsLink(bodyHtml: string): { href: string; text: string } | undefined {
  const $ = cheerio.load(bodyHtml);
  const a = $("a[href]")
    .filter((_i, el) => isMapsHost($(el).attr("href") ?? ""))
    .first();
  if (!a.length) return undefined;
  return { href: a.attr("href") ?? "", text: a.text().trim() };
}

/**
 * Extract a venue/location string from the first Google-Maps link in body HTML.
 *
 * Precedence: structured path (`/dir//`, `/place/`) → descriptive link text →
 * query param (`daddr`/`q`/`destination`). Shortlinks (`share.google`,
 * `goo.gl`, `maps.app.goo.gl`) carry no inline venue and need the async
 * `fetch()` path's redirect resolution — this sync helper returns undefined for
 * them (the adapter then resolves + re-parses). #2338.
 */
export function extractLocationFromMapsUrl(
  bodyHtml: string,
): string | undefined {
  const link = findMapsLink(bodyHtml);
  if (!link) return undefined;
  return (
    parseVenueFromMapsPath(link.href) ??
    realLinkText(link.text) ??
    parseVenueFromMapsQuery(link.href)
  );
}

/**
 * Follow a Google Maps shortlink (share.google / goo.gl / maps.app.goo.gl) to
 * its resolved destination URL. `safeFetch` follows redirects manually with
 * per-hop SSRF re-validation; the final response's `.url` is the resolved
 * target (e.g. `google.com/search?q=Whitecliff+Park`). Returns undefined on any
 * failure so a dead shortlink never breaks the scrape.
 */
async function resolveMapsShortlink(url: string): Promise<string | undefined> {
  try {
    const res = await safeFetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
    });
    const finalUrl = res.url;
    return finalUrl && finalUrl !== url ? finalUrl : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse a date from a Substack post title.
 * Format: "Upcumming Hash: Sunday Mar 29th 2026"
 * The date part is after the colon.
 */
export function parseTitleDate(title: string): string | null {
  // Try parsing after colon first (e.g., "Upcumming Hash: Sunday Mar 29th 2026")
  const colonIdx = title.indexOf(":");
  if (colonIdx !== -1) {
    const afterColon = title.slice(colonIdx + 1).trim();
    const date = chronoParseDate(afterColon, "en-US", undefined, {
      forwardDate: true,
    });
    if (date) return date;
  }

  // Fallback: parse entire title
  return chronoParseDate(title, "en-US", undefined, { forwardDate: true });
}

/**
 * Strip the Substack post date suffix from the title. Format is
 * "{label}: {date}" (e.g. "Upcumming Hash: Sunday Apr 19th 2026"). The date
 * is redundant on hareline cards since we already parse it separately. #808.
 */
// Three independent shapes for "absolute" calendar dates, anchored so the
// *entire* post-colon suffix must be date-shaped before we strip it. Month is
// matched as generic `[a-z]+` (not an alternation of 13 names) — chrono still
// validates the name downstream, and this keeps the regex under both
// SonarCloud's complexity budget (S5843) and Codacy's non-literal-RegExp rule.
const WEEKDAY_PREFIX_RE =
  /^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat),?\s+/i;
const MONTH_DAY_YEAR_RE =
  /^[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*\d{4}$/i;
const ISO_DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const SLASH_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

function isDateOnlySuffix(s: string): boolean {
  const stripped = s.trim().replace(WEEKDAY_PREFIX_RE, "");
  return (
    MONTH_DAY_YEAR_RE.test(stripped) ||
    ISO_DATE_RE.test(stripped) ||
    SLASH_DATE_RE.test(stripped)
  );
}

export function cleanPostTitle(title: string): string {
  // Split on the *last* colon so multi-colon titles like
  // "A: B: Sunday Apr 19 2026" strip only the trailing date segment.
  const colonIdx = title.lastIndexOf(":");
  if (colonIdx === -1) return title;
  const afterColon = title.slice(colonIdx + 1).trim();
  // Require the *whole* suffix to be date-shaped (optionally weekday-prefixed).
  // Prevents over-stripping "Apr 19 2026 Halloween Edition" where a date token
  // exists inside a larger meaningful suffix. #808.
  if (!isDateOnlySuffix(afterColon)) return title;
  const parsedDate = chronoParseDate(afterColon, "en-US", undefined, {
    forwardDate: true,
  });
  if (!parsedDate) return title;
  return title.slice(0, colonIdx).trim();
}

/**
 * STL H3 Substack Scraper
 *
 * Fetches the Substack archive listing, then fetches detail pages for each
 * post to get body_html with Google Maps links for location extraction.
 */
export class StlH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = (source.url || "https://www.stlh3.com").replace(
      /\/+$/,
      "",
    );
    // Honor source.scrapeDays via options.days (default 365)
    const days = options?.days ?? source.scrapeDays ?? 365;
    const archiveUrl = `${baseUrl}/api/v1/archive?sort=new&limit=50`;
    const fetchStart = Date.now();

    // Fetch archive listing
    let archivePosts: SubstackArchivePost[];
    try {
      const response = await safeFetch(archiveUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "HashTracks/1.0 (event aggregator; +https://hashtracks.com)",
        },
      });
      if (!response.ok) {
        const message = `Substack archive HTTP ${response.status}: ${response.statusText}`;
        return {
          events: [],
          errors: [message],
          errorDetails: {
            fetch: [{ url: archiveUrl, status: response.status, message }],
          },
        };
      }
      archivePosts = (await response.json()) as SubstackArchivePost[];
    } catch (err) {
      const message = `Substack archive fetch failed: ${err}`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: archiveUrl, message }] },
      };
    }

    if (!Array.isArray(archivePosts)) {
      return {
        events: [],
        errors: ["Substack archive returned non-array response"],
      };
    }

    // Filter to "Upcumming Hash" posts (event announcements)
    const eventPosts = archivePosts.filter((p) =>
      /upcumming|hash/i.test(p.title),
    );

    const events: RawEventData[] = [];
    const errors: string[] = [];
    let detailsFetched = 0;

    for (const post of eventPosts) {
      try {
        const date = parseTitleDate(post.title);
        if (!date) continue;

        const startTime = parseSubtitleTime(post.subtitle);

        // Fetch detail page for body_html (location extraction)
        let location: string | undefined;
        let bodyHtml: string | null = post.body_html ?? null;

        if (!bodyHtml) {
          try {
            const detailUrl = `${baseUrl}/api/v1/posts/${post.slug}`;
            const detailResponse = await safeFetch(detailUrl, {
              headers: {
                Accept: "application/json",
                "User-Agent":
                  "HashTracks/1.0 (event aggregator; +https://hashtracks.com)",
              },
            });
            if (detailResponse.ok) {
              const detail =
                (await detailResponse.json()) as SubstackPostDetail;
              bodyHtml = detail.body_html;
              detailsFetched++;
            }
          } catch {
            // Detail fetch failed — continue without location
          }
        }

        let locationUrl: string | undefined;
        if (bodyHtml) {
          const link = findMapsLink(bodyHtml);
          if (link) {
            locationUrl = link.href;
            location = parseVenueFromMapsPath(link.href);
            // Shortlinks (share.google etc.) hide the venue behind a redirect —
            // resolve once and re-parse the destination URL (#2338).
            if (!location && isMapsShortlink(link.href)) {
              const resolved = await resolveMapsShortlink(link.href);
              if (resolved) {
                location =
                  parseVenueFromMapsPath(resolved) ?? parseVenueFromMapsQuery(resolved);
              }
            }
            location ??= realLinkText(link.text) ?? parseVenueFromMapsQuery(link.href);
          }
        }

        events.push({
          date,
          kennelTags: ["stlh3"],
          title: cleanPostTitle(post.title),
          location,
          locationUrl,
          startTime,
          sourceUrl: post.canonical_url || `${baseUrl}/p/${post.slug}`,
        });
      } catch (err) {
        errors.push(`Error processing post "${post.slug}": ${err}`);
      }
    }

    // Generate structure hash from concatenated titles
    const structureInput = eventPosts
      .map((p) => p.title)
      .join("\n");
    const structureHash = generateStructureHash(structureInput);

    return applyDateWindow({
      events,
      errors,
      structureHash,
      diagnosticContext: {
        fetchMethod: "substack-api",
        archivePostsFound: archivePosts.length,
        eventPostsFiltered: eventPosts.length,
        detailsFetched,
        fetchDurationMs: Date.now() - fetchStart,
      },
    }, days);
  }
}
