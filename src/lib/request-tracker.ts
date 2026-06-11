/**
 * Tiny last-write-wins request tracker for optimistic UI updates.
 *
 * Each `begin()` mints a monotonically increasing id and records it as the
 * latest in-flight intent. A completion (success or failure) can then ask
 * `isLatest(id)` to decide whether it still represents the user's most recent
 * choice — letting a stale, late-resolving request skip its rollback so it
 * can't clobber a newer confirmed value. See #1139.
 */
export interface RequestTracker {
  /** Mark a new request as the latest intent; returns its id. */
  begin(): number;
  /** True only if `id` is still the most recently started request. */
  isLatest(id: number): boolean;
}

export function createRequestTracker(): RequestTracker {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (id: number) => id === latest,
  };
}
