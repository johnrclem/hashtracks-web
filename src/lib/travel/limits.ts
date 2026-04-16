/**
 * Domain caps shared between the validation boundary, the URL boundary,
 * and the search engine. Lives here (not in `actions.ts`) so non-action
 * modules can import it without crossing the `"use server"` boundary.
 */

/** Hard cap on a saved or searched trip radius. */
export const MAX_RADIUS_KM = 250;
