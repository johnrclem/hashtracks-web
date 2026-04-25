/**
 * Shared `unstable_cache` / `revalidateTag` tag constants.
 *
 * Kept in a plain module (no `"use server"`) so it can be imported from
 * both the cache wrapper and any mutation site — a server-action module
 * may only export async functions, so the tag constant can't live next
 * to `loadEventsForTimeMode`.
 */

/** Invalidates the cached Hareline event list (see `src/app/hareline/actions.ts`). */
export const HARELINE_EVENTS_TAG = "hareline:events";
