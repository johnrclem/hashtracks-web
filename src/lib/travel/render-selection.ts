import { ROWLESS_EMPTY_STATES, type EmptyStateKind } from "./search";

/**
 * Pick the result set the Travel page renders for a search's empty state.
 * Returns null when there is no list to show (the rowless empty states), so
 * the page shows the EmptyStates banner alone.
 *
 * - `none` and `no_confirmed`: the primary rows (`none` with zero rows means
 *   filters hid every row, and TravelResults says so).
 * - single-stop `no_nearby`: the broader-ring rows from `broaderResults`.
 * - multi-stop: the flat arrays, which already merge every stop's broader
 *   rows (`serializeTravelResults({ mergeBroader: true })`), so no swap.
 */
export function selectResultsToRender<T extends {
  broaderResults?: { confirmed: T["confirmed"]; likely: T["likely"]; possible: T["possible"] };
  confirmed: unknown;
  likely: unknown;
  possible: unknown;
}>(
  emptyState: EmptyStateKind,
  serialized: T,
  isMultiStop: boolean,
): T | null {
  if (ROWLESS_EMPTY_STATES.has(emptyState)) return null;
  if (isMultiStop) return serialized;
  if (emptyState === "no_nearby") {
    return serialized.broaderResults
      ? {
          ...serialized,
          confirmed: serialized.broaderResults.confirmed,
          likely: serialized.broaderResults.likely,
          possible: serialized.broaderResults.possible,
        }
      : null;
  }
  return serialized;
}
