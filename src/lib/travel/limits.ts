/**
 * Domain caps shared between the validation boundary, the URL boundary,
 * and the search engine. Lives here (not in `actions.ts`) so non-action
 * modules can import it without crossing the `"use server"` boundary.
 */

/** Hard cap on a saved or searched trip radius. */
export const MAX_RADIUS_KM = 250;

/**
 * Closed enum of radii the search form pill selector exposes. Matches
 * RADIUS_OPTIONS in TravelSearchForm.tsx (which adds UI labels). Kept
 * primitive here so server-side parsers (page.tsx) can snap a crafted
 * `?r=200` URL onto a tier value before SSR, mirroring the client-side
 * snap so the ROUTING REVISED hero treatment fires consistently.
 */
export const RADIUS_TIERS = [10, 25, 50, 100] as const;

/**
 * Snap an arbitrary radius to the nearest supported tier. Returns the
 * input unchanged when it's already a tier value.
 */
export function snapRadiusToTier(value: number): number {
  if ((RADIUS_TIERS as readonly number[]).includes(value)) return value;
  return RADIUS_TIERS.reduce((nearest, tier) =>
    Math.abs(tier - value) < Math.abs(nearest - value) ? tier : nearest,
  );
}
