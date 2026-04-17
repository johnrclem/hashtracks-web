/**
 * Domain caps shared between the validation boundary, the URL boundary,
 * and the search engine. Lives here (not in `actions.ts`) so non-action
 * modules can import it without crossing the `"use server"` boundary.
 */

/** Hard cap on a saved or searched trip radius. */
export const MAX_RADIUS_KM = 250;

/** Closed enum of radii exposed by the search pill selector. */
export const RADIUS_TIERS = [10, 25, 50, 100] as const;

/** Snap an arbitrary radius to the nearest supported tier. */
export function snapRadiusToTier(value: number): number {
  if ((RADIUS_TIERS as readonly number[]).includes(value)) return value;
  return RADIUS_TIERS.reduce((nearest, tier) =>
    Math.abs(tier - value) < Math.abs(nearest - value) ? tier : nearest,
  );
}
