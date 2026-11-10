/**
 * Approximate visitor location from Vercel's request geolocation headers.
 *
 * Vercel adds `x-vercel-ip-latitude`, `x-vercel-ip-longitude` and
 * `x-vercel-ip-city` (URL-encoded) to every request it serves. They are an
 * IP-based guess — no browser prompt, nothing stored — and are absent on
 * localhost, where callers fall back to non-local content.
 */

export interface VisitorArea {
  latitude: number;
  longitude: number;
  /** City name for display, or null when Vercel didn't provide one. */
  city: string | null;
}

function parseCoordinate(raw: string | null, limit: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return value;
}

function decodeCity(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const city = decodeURIComponent(raw).trim();
    return city === "" ? null : city;
  } catch {
    return null;
  }
}

/** Read the visitor's approximate area from request headers, or null when unavailable. */
export function parseVisitorArea(headers: Pick<Headers, "get">): VisitorArea | null {
  const latitude = parseCoordinate(headers.get("x-vercel-ip-latitude"), 90);
  const longitude = parseCoordinate(headers.get("x-vercel-ip-longitude"), 180);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude, city: decodeCity(headers.get("x-vercel-ip-city")) };
}
