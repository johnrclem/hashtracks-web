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
    .trim();
  if (norm === kennelNorm || (fullNorm && norm === fullNorm)) return { title: fallback, isFallback: true };
  return { title, isFallback: false };
}

export interface LocationDisplayEvent {
  locationName: string | null;
  locationCity: string | null;
}

/** Build location display string with city context. Strip URLs defensively. */
export function getLocationDisplay(event: LocationDisplayEvent): string | null {
  const name = event.locationName?.replace(/https?:\/\/\S+/g, "").trim() || null;
  const city = event.locationCity;
  if (name && city) {
    // Don't append city if it's already embedded in the location name
    const nameLower = name.toLowerCase();
    if (nameLower.includes(city.toLowerCase())) return name;
    // Also check just the city name (before comma) — "Boston" in name vs "Boston, MA" as city
    const cityName = city.split(",")[0].trim();
    if (cityName && nameLower.includes(cityName.toLowerCase())) return name;
    return `${name}, ${city}`;
  }
  return city || name || null;
}
