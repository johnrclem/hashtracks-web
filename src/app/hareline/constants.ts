/**
 * Hareline constants shared between the server action layer (`actions.ts`)
 * and the client component (`HarelineView.tsx`).
 *
 * Lives in a plain module — `actions.ts` is `"use server"`, which may only
 * export async functions, so a shared numeric constant can't live there
 * without breaking the build. Keeping it here lets both sides agree on the
 * past-page size with no magic-number drift.
 */

/**
 * Past events fetched per page. Doubles as (1) the server-side cap on the
 * first past payload (`fetchSlimEventsCached`) and (2) the cursor page size
 * for `loadMorePastEvents`. The server compares the RAW (pre-dedup) row count
 * against this limit to compute the `hasMore` flag it returns to the client —
 * the client never re-derives fullness from its (possibly dedup-shrunk)
 * event array length.
 */
export const PAST_EVENTS_LIMIT = 200;
