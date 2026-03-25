// ---------------------------------------------------------------------------
// Location preference — persists the user's last-used location filter so the
// hareline and kennel directory can pre-apply it on fresh visits.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hashtracks:locationPref";

// ---- Types ----------------------------------------------------------------

export type LocationPref =
  | { type: "nearMe"; distance: number }
  | { type: "region"; name: string };

export type LocationDefault = {
  regions?: string[];
  nearMeDistance?: number;
} | null;

// ---- localStorage helpers (SSR-safe, try/catch for Safari Private) --------

export function getLocationPref(): LocationPref | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate shape before returning
    if (
      parsed &&
      typeof parsed === "object" &&
      ((parsed.type === "nearMe" && typeof parsed.distance === "number") ||
        (parsed.type === "region" && typeof parsed.name === "string"))
    ) {
      return parsed as LocationPref;
    }
    return null;
  } catch {
    // Invalid JSON or localStorage unavailable
    return null;
  }
}

export function setLocationPref(pref: LocationPref): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Persistence is best-effort (Safari Private Browsing, quota exceeded)
  }
}

export function clearLocationPref(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort
  }
}

// ---- Pure resolution logic ------------------------------------------------

/**
 * URL filter param names that indicate the user has explicitly set filters.
 * When any of these are present, the stored preference is ignored so URL
 * params always win.
 */
export const FILTER_PARAMS = ["regions", "dist", "days", "kennels", "q", "country"];

/**
 * Resolves what location default (if any) should be applied given the current
 * URL params and stored preference. Pure function — no side effects.
 *
 * Returns null when URL already has explicit filters or no pref is stored.
 */
export function resolveLocationDefault(
  urlParams: URLSearchParams,
  storedPref: LocationPref | null,
): LocationDefault {
  // If the URL contains any filter param, the user has explicitly navigated
  // with filters — don't override.
  for (const param of FILTER_PARAMS) {
    if (urlParams.has(param)) return null;
  }

  if (!storedPref) return null;

  if (storedPref.type === "region") {
    return { regions: [storedPref.name] };
  }

  if (storedPref.type === "nearMe") {
    return { nearMeDistance: storedPref.distance };
  }

  return null;
}
