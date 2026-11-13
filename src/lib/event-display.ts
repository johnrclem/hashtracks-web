/** Shared display helpers for event cards (server + client safe). */

export interface DisplayTitleEvent {
  title: string | null;
  runNumber: number | null;
  kennel: { shortName: string; fullName: string };
}

/** Display title for events with missing, parenthetical, or kennel-name-only titles. */
export function getDisplayTitle(event: DisplayTitleEvent): { title: string; isFallback: boolean } {
  const title = event.title?.trim() ?? "";
  const fallback = event.runNumber
    ? `${event.kennel.shortName} \u2014 Run #${event.runNumber}`
    : event.kennel.shortName;
  if (!title || /^\(.*\)$/.test(title)) return { title: fallback, isFallback: true };
  // Suppress titles that are just a run number (e.g., "Run #42", "Run 123")
  if (/^run\s*#?\d+$/i.test(title)) return { title: fallback, isFallback: true };
  // Suppress titles that just repeat the kennel name (e.g., "SPH3", "O2H3 Hash", "St Pete H3")
  const norm = title.toLowerCase()
    .replace(/\s+hash\s+house\s+harriers$/i, "")
    .replace(/\s+hash$/i, "")
    .replace(/\s+h3$/i, "")
    .trim();
  const kennelNorm = event.kennel.shortName.toLowerCase().trim();
  const fullNorm = (event.kennel.fullName ?? "").toLowerCase()
    .replace(/\s+hash\s+house\s+harriers$/i, "")
    .replace(/\s+hash$/i, "")
    .replace(/\s+h3$/i, "")
    .trim();
  if (norm === kennelNorm || (fullNorm && norm === fullNorm)) return { title: fallback, isFallback: true };
  return { title, isFallback: false };
}

export interface LocationDisplayEvent {
  locationName: string | null;
  locationCity: string | null;
}

export interface FullLocationDisplayEvent extends LocationDisplayEvent {
  locationStreet?: string | null;
}

function cleanLocationName(name: string | null | undefined): string | null {
  return name?.replace(/https?:\/\/\S+/g, "").trim() || null;
}

/** Comparison key: "St. Cloud" and "St Cloud, FL" share the words "st cloud". */
function wordKey(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/** Build location display string with city context. Strip URLs defensively. */
export function getLocationDisplay(event: LocationDisplayEvent): string | null {
  const name = cleanLocationName(event.locationName);
  const city = event.locationCity;
  if (name && city) {
    // Don't append city if it's already embedded in the location name (word-boundary match)
    const cityEscaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${cityEscaped}\\b`, "i").test(name)) return name;
    // Also check just the city name (before comma) — "Boston" in name vs "Boston, MA" as city
    const cityName = city.split(",")[0].trim();
    if (cityName) {
      const cityNameEscaped = cityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${cityNameEscaped}\\b`, "i").test(name)) return name;
    }
    // Don't append city when location already has a complete US address (ends with state + optional zip)
    if (/, [A-Za-z]{2}(?:\s+\d{5}(?:-\d{4})?)?\s*$/.test(name)) return name;
    // Four or more comma-separated parts is already a full address: a reverse-geocoded
    // district after the country reads backwards ("…, Philippines, Mabolo", #2815).
    if (name.split(",").length >= 4) return name;
    return `${name}, ${city}`;
  }
  return city || name || null;
}

/**
 * Full location for the event detail page: the venue followed by its street address.
 * Many sources store the venue only in locationName and the address without it in
 * locationStreet ("Fox and Duck" + "Therfield, SG8 9PN", #2859), so the street line
 * alone would drop the pub.
 */
export function getFullLocationDisplay(event: FullLocationDisplayEvent): string | null {
  const street = event.locationStreet?.trim();
  if (!street) return getLocationDisplay(event);
  const name = cleanLocationName(event.locationName);
  // A name that is itself an address ("850 Garfield Ave, …") would repeat the street line.
  if (!name || /^\d/.test(name)) return street;
  const nameKey = wordKey(name);
  const streetKey = wordKey(street);
  // Keys are space-padded, so this is a whole-word match; an all-punctuation key is "  ".
  if (nameKey === "  " || streetKey.includes(nameKey)) return street;
  if (streetKey === "  " || nameKey.includes(streetKey)) return getLocationDisplay(event);
  return `${name}, ${street}`;
}
