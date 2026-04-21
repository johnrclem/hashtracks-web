/**
 * Shared formatting helpers for Travel Mode components.
 */

/**
 * Format a YYYY-MM-DD string as "Apr 14" by default, or "Mon, Apr 14" with
 * `withWeekday: true`. UTC tz keeps the DOW consistent with the UTC-noon
 * convention used throughout Travel Mode — travelers should see the
 * destination's day, not their client's localized day.
 *
 * The leading .slice(0, 10) is defensive: some callers (TravelResultFilters
 * chip tooltips) pass ISO-8601 timestamps like "2026-04-14T12:00:00.000Z".
 * Without the slice, the helper appends "T12:00:00Z" again and produces
 * Invalid Date. Slicing is idempotent for plain YYYY-MM-DD input.
 */
export function formatDateCompact(
  dateStr: string,
  opts: { withWeekday?: boolean } = {},
): string {
  return new Date(dateStr.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    ...(opts.withWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * UTC start-of-day. Used by trip-window date math (e.g. "is the trip past?",
 * "does the trip start within 7 days?") so noon-stored dates compare cleanly
 * against today regardless of the server's local clock.
 */
export function startOfUtcDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Count days between two YYYY-MM-DD strings. Returns at least 1. */
export function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T12:00:00Z");
  const e = new Date(end + "T12:00:00Z");
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * Signed day delta between two YYYY-MM-DD strings: `(end - start)` in days.
 * Returns 0 for same day, positive for end-after-start, negative otherwise.
 * Distinct from `daysBetween` which clamps to 1+ for trip-duration use.
 */
export function daysBetweenIsoDates(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  return Math.round((e - s) / (24 * 60 * 60 * 1000));
}

/**
 * Long-form day header used as a divider inside distance-tier sections:
 * "Tuesday, April 14". Input is an ISO YYYY-MM-DD or ISO timestamp;
 * defensive .slice(0, 10) accepts both. Rendered in UTC to match the
 * UTC-noon date convention travel uses throughout.
 *
 * Deliberately omits the year (cf. `formatDateLong` in `src/lib/format.ts`,
 * which renders "Tuesday, April 14, 2026"). Trip-bounded views always have
 * a year established in the trip-summary stripe above; repeating it on
 * every day header is noise.
 */
export function formatDayHeader(dateStr: string): string {
  return new Date(dateStr.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Humanize a distance with a walking- or driving-time approximation.
 * Uses 5 km/h for the pedestrian leg and 80 km/h for the driving leg —
 * no routing service required, so the estimate is deterministic and
 * offline-safe.
 *
 *   walkMin ≤ 30                   → "X km · ~Y min walk"
 *   walkMin ≤ 90 (≤7.5 km)         → "X km · ~Z h walk"
 *   distanceKm < 25                → "X km · short drive"
 *   distanceKm ≥ 25                → "X km · ~Y min drive" or "~Nh Mm drive"
 */
/** "<1 km" below 1, otherwise "X.X km". Terser than formatDistanceWithWalk. */
export function formatDistanceShort(distanceKm: number): string {
  return distanceKm < 1 ? "<1 km" : `${distanceKm.toFixed(1)} km`;
}

export function formatDistanceWithWalk(distanceKm: number): string {
  const kmLabel = formatDistanceShort(distanceKm);
  const walkMin = Math.round((distanceKm / 5) * 60);
  if (walkMin <= 30) return `${kmLabel} · ~${Math.max(1, walkMin)} min walk`;
  if (walkMin <= 90) {
    const h = Math.round(walkMin / 60);
    return `${kmLabel} · ~${h} h walk`;
  }
  if (distanceKm < 25) return `${kmLabel} · short drive`;
  return `${kmLabel} · ${formatDriveTime(distanceKm)}`;
}

/**
 * Render an estimated drive-time from a distance in km. Assumes 80 km/h
 * average, rounded to the nearest 5 min so the output feels like an
 * estimate rather than false precision. <60 min → "~X min drive",
 * ≥60 min → "~Nh Mm drive" (minute component omitted when it's 0).
 *
 * Caller is responsible for deciding whether the distance warrants a
 * drive-time label at all — see `formatDistanceWithWalk` for the
 * walk/short-drive/drive ladder.
 */
export function formatDriveTime(distanceKm: number): string {
  const rawMin = (distanceKm / 80) * 60;
  const totalMin = Math.max(5, Math.round(rawMin / 5) * 5);
  if (totalMin < 60) return `~${totalMin} min drive`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `~${h}h drive` : `~${h}h ${m}m drive`;
}

/** Extract 1-2 character initials from a kennel name for the insignia badge. */
export function getKennelInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Real IATA airport codes for the cities travelers most commonly land in.
 * Keyed on lowercased city name matched against the first comma-separated
 * segment of the destination label (e.g. "London, UK" → "london").
 *
 * Intentionally small — the long tail of cities falls back to a
 * deterministic pseudo-IATA (first three consonants, uppercase) so every
 * destination still gets a three-letter stamp on the boarding-pass
 * header. This matches the fake-IATA pattern already in use on kennel
 * cards elsewhere in the app.
 */
const CITY_IATA: Record<string, string> = {
  // Europe
  london: "LHR",
  paris: "CDG",
  berlin: "BER",
  munich: "MUC",
  frankfurt: "FRA",
  stuttgart: "STR",
  amsterdam: "AMS",
  brussels: "BRU",
  madrid: "MAD",
  barcelona: "BCN",
  rome: "FCO",
  milan: "MXP",
  zurich: "ZRH",
  vienna: "VIE",
  copenhagen: "CPH",
  stockholm: "ARN",
  oslo: "OSL",
  helsinki: "HEL",
  dublin: "DUB",
  edinburgh: "EDI",
  glasgow: "GLA",
  manchester: "MAN",
  lisbon: "LIS",
  athens: "ATH",
  istanbul: "IST",
  prague: "PRG",
  warsaw: "WAW",
  // North America
  "new york": "JFK",
  "new york city": "JFK",
  boston: "BOS",
  chicago: "ORD",
  atlanta: "ATL",
  "los angeles": "LAX",
  "san francisco": "SFO",
  "san diego": "SAN",
  seattle: "SEA",
  denver: "DEN",
  dallas: "DFW",
  houston: "IAH",
  austin: "AUS",
  miami: "MIA",
  philadelphia: "PHL",
  "washington, d.c.": "DCA",
  washington: "DCA",
  baltimore: "BWI",
  pittsburgh: "PIT",
  charlotte: "CLT",
  phoenix: "PHX",
  "las vegas": "LAS",
  minneapolis: "MSP",
  detroit: "DTW",
  orlando: "MCO",
  toronto: "YYZ",
  montreal: "YUL",
  vancouver: "YVR",
  "mexico city": "MEX",
  // Asia
  tokyo: "HND",
  osaka: "KIX",
  kyoto: "KIX",
  "hong kong": "HKG",
  singapore: "SIN",
  seoul: "ICN",
  bangkok: "BKK",
  "kuala lumpur": "KUL",
  "ho chi minh": "SGN",
  hanoi: "HAN",
  mumbai: "BOM",
  delhi: "DEL",
  bangalore: "BLR",
  // Oceania
  sydney: "SYD",
  melbourne: "MEL",
  brisbane: "BNE",
  perth: "PER",
  adelaide: "ADL",
  auckland: "AKL",
  // Middle East / Africa
  dubai: "DXB",
  "abu dhabi": "AUH",
  doha: "DOH",
  "tel aviv": "TLV",
  "cape town": "CPT",
  johannesburg: "JNB",
  cairo: "CAI",
  nairobi: "NBO",
  // South America
  "buenos aires": "EZE",
  "são paulo": "GRU",
  "sao paulo": "GRU",
  "rio de janeiro": "GIG",
  lima: "LIM",
  bogotá: "BOG",
  bogota: "BOG",
  santiago: "SCL",
};

/**
 * Resolve a destination label to a three-letter code for the boarding-pass
 * route stamp (LHR → CDG → BER). Prefers real IATA airport codes for known
 * cities; falls back to the first three consonants of the city name. Always
 * returns exactly three uppercase letters so trip-summary arrows line up.
 *
 * Matching is case-insensitive on the first comma-separated segment, so
 * "London, UK" and "london" both resolve to LHR. Non-alphabetic characters
 * are stripped before the consonant fallback, so "São Paulo" → "SPL"
 * (instead of, say, "PLO") after the accented S survives the lowercasing.
 */
export function cityToIata(label: string): string {
  const firstSegment = label.split(",")[0]?.trim().toLowerCase() ?? "";
  const hit = CITY_IATA[firstSegment];
  if (hit) return hit;

  // Fallback: first three consonants of the first segment, uppercase.
  // If fewer than three consonants exist (e.g. "Ai"), pad with the first
  // vowels to guarantee a three-letter stamp.
  const letters = firstSegment.replace(/[^a-z]/g, "");
  const consonants = letters.replace(/[aeiou]/g, "");
  const candidate = (consonants + letters).toUpperCase();
  return candidate.slice(0, 3).padEnd(3, "X");
}
