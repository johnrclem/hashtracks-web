/**
 * Owner opt-out from visitor numbers: marks this browser as internal traffic.
 *
 * Visiting any page with `?internal=1` stores a flag in `localStorage`; from
 * then on every page load tags its PostHog events with `internal_user: true`,
 * signed in or not, so the owner's own (and agent-driven) browsing can be
 * filtered out. `?internal=0` clears the flag. The flag holds no identifier.
 */

export const INTERNAL_TRAFFIC_STORAGE_KEY = "ht_internal";
export const INTERNAL_TRAFFIC_PARAM = "internal";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Apply `?internal=1` / `?internal=0` from `search`, then report whether the flag is set. Never throws. */
export function applyAndReadInternalFlag(storage: StorageLike | null | undefined, search: string): boolean {
  if (!storage) return false;
  try {
    const param = new URLSearchParams(search).get(INTERNAL_TRAFFIC_PARAM);
    if (param === "1") storage.setItem(INTERNAL_TRAFFIC_STORAGE_KEY, "1");
    else if (param === "0") storage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY);
    return storage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY) === "1";
  } catch {
    // Storage blocked (privacy settings, sandboxed frames): treat as not internal.
    return false;
  }
}

let cached: boolean | null = null;

/** Whether this browser is marked internal. Read once per page load. */
export function isInternalBrowser(): boolean {
  if (cached === null) {
    if (typeof window === "undefined") return false;
    let storage: StorageLike | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    cached = applyAndReadInternalFlag(storage, window.location?.search ?? "");
  }
  return cached;
}
