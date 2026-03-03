/**
 * Parse the Hash Rego /kennels/ directory page.
 *
 * The page uses Google Maps with kennel data embedded in procedural JavaScript.
 * Each location is declared with a numbered variable pattern (loc1, loc2, etc.)
 * containing coordinates, location title, and an HTML info window with kennel links.
 */

import * as cheerio from "cheerio";

export interface DiscoveredKennel {
  slug: string;        // "EWH3" from /kennels/EWH3/ link
  name: string;        // "Everyday Is Wednesday H3"
  location: string;    // "Washington, DC, USA"
  latitude: number;
  longitude: number;
  schedule?: string;   // "Weekly, Wednesdays"
  url: string;         // "https://hashrego.com/kennels/EWH3/"
}

// Regex patterns keyed by loc{N} variable names
const LAT_LNG_RE = /var\s+(loc\d+)Pos\s*=\s*new\s+google\.maps\.LatLng\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g;
const TITLE_RE = /var\s+(loc\d+)Marker\s*=\s*new\s+google\.maps\.Marker\(\{[^}]*title:\s*'([^']*)'/g;
const INFO_WINDOW_RE = /addListener\(\s*(loc\d+)Marker\s*,\s*'click'\s*,\s*function\s*\(\)\s*\{[^}]*setContent\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g;

interface LocationData {
  latitude: number;
  longitude: number;
  title: string;
  infoHtml: string;
}

/**
 * Parse the Hash Rego /kennels/ page source to extract kennel directory data.
 * Returns an array of discovered kennels with coordinates, names, and schedules.
 */
export function parseKennelDirectory(pageSource: string): DiscoveredKennel[] {
  const locations = new Map<string, Partial<LocationData>>();

  // Helper to get or create a location entry
  const getOrCreate = (key: string) => {
    if (!locations.has(key)) locations.set(key, {});
    return locations.get(key)!;
  };

  // Pass 1: Extract LatLng coordinates
  for (const match of pageSource.matchAll(LAT_LNG_RE)) {
    const loc = getOrCreate(match[1]);
    loc.latitude = Number.parseFloat(match[2]);
    loc.longitude = Number.parseFloat(match[3]);
  }

  // Pass 2: Extract location titles from Marker constructors
  for (const match of pageSource.matchAll(TITLE_RE)) {
    const loc = getOrCreate(match[1]);
    loc.title = match[2];
  }

  // Pass 3: Extract info window HTML
  for (const match of pageSource.matchAll(INFO_WINDOW_RE)) {
    const loc = getOrCreate(match[1]);
    // Unescape JS string escapes (single quotes, backslashes)
    loc.infoHtml = match[2].replaceAll("\\'", "'").replaceAll("\\\\", "\\");
  }

  // Parse each location's HTML to extract individual kennels
  const kennels: DiscoveredKennel[] = [];

  for (const [, data] of locations) {
    if (!data.infoHtml || data.latitude == null || data.longitude == null) continue;

    const locationTitle = data.title || "";
    const $ = cheerio.load(data.infoHtml);

    $("li").each((_i, li) => {
      const anchor = $(li).find("a[href*='/kennels/']").first();
      const href = anchor.attr("href") || "";
      const slugMatch = href.match(/\/kennels\/([^/]+)/);
      if (!slugMatch) return;

      const slug = slugMatch[1];
      const name = $(li).find("h4").text().trim() || anchor.text().trim();
      if (!name) return;

      const scheduleEl = $(li).find("p").first();
      const schedule = scheduleEl.text().trim() || undefined;

      kennels.push({
        slug,
        name,
        location: locationTitle,
        latitude: data.latitude!,
        longitude: data.longitude!,
        schedule,
        url: `https://hashrego.com/kennels/${slug}/`,
      });
    });
  }

  return kennels;
}
