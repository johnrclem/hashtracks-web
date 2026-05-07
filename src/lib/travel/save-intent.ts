/**
 * Save-intent handshake for the guest → sign-in → auto-save round-trip.
 *
 * Without this, any authed page load of `/travel?...&saved=1` triggers an
 * account write — a crafted or shared link could cause accidental or
 * malicious saves. The intent stash in sessionStorage binds the save
 * specifically to the original Save-button click: TravelAutoSave only
 * fires if it finds a matching, recent intent in the current tab.
 *
 * Same-tab round-trip (the designed flow): intent set → sign-in → consume.
 * Different-tab sign-in: no intent present → auto-save skipped → the user
 * can click the Save button again. Acceptable degraded UX.
 * Stale bookmark / shared URL / crafted link: no intent or signature
 * mismatch → auto-save skipped, URL cleaned up.
 */

// sessionStorage namespace key — not a credential. Trailing NOSONAR
// silences the SonarCloud hardcoded-credential pattern matcher.
const INTENT_KEY = "hashtracks:travel-save-intent"; // NOSONAR
const INTENT_TTL_MS = 10 * 60 * 1000; // 10 minutes — covers typical sign-in flows

export interface SaveIntentParams {
  label: string;
  startDate: string;
  endDate: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  timezone?: string;
  /** Bound into the intent so a tampered redirect URL can't substitute a
   *  different placeId between the guest Save click and the post-sign-in
   *  auto-save — the consume side rejects mismatches. */
  placeId?: string;
}

interface StoredIntent {
  signature: string;
  timestamp: number;
}

/**
 * Stable signature for comparison across the sign-in round-trip.
 * Must produce identical output on both sides (stash + consume).
 */
export function signatureForIntent(p: SaveIntentParams): string {
  return [
    p.label,
    p.startDate,
    p.endDate,
    p.latitude.toFixed(6),
    p.longitude.toFixed(6),
    p.radiusKm,
    p.timezone ?? "",
    p.placeId ?? "",
  ].join("|");
}

/** Call from the guest Save-click handler before redirecting to sign-in. */
export function stashSaveIntent(params: SaveIntentParams): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const intent: StoredIntent = {
      signature: signatureForIntent(params),
      timestamp: Date.now(),
    };
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    // sessionStorage can throw in private-browsing / quota-exceeded; the
    // auto-save round-trip just silently degrades to "click Save again."
  }
}

/**
 * Consume an intent once. Returns true only if a matching, non-expired
 * intent exists. Always clears the storage slot so subsequent reloads
 * can't re-fire, whether the signature matched or not.
 */
export function consumeSaveIntent(params: SaveIntentParams): boolean {
  if (typeof sessionStorage === "undefined") return false;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(INTENT_KEY);
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredIntent(parsed)) return false;
    if (parsed.signature !== signatureForIntent(params)) return false;
    if (Date.now() - parsed.timestamp > INTENT_TTL_MS) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Runtime shape guard for the parsed sessionStorage value. The previous
 * `JSON.parse(raw) as StoredIntent` cast bypassed validation — a stored
 * value with a non-numeric `timestamp` would make `Date.now() - NaN`
 * evaluate to `NaN`, which fails the TTL gate (NaN comparisons are
 * always false), but only by accident. Explicit narrowing makes the
 * defense intentional and rejects malformed payloads up front.
 */
function isStoredIntent(value: unknown): value is StoredIntent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // Number.isFinite excludes NaN/Infinity. JSON.parse can't produce
  // them from valid JSON, but a tampered value or future call site that
  // bypasses the parser shouldn't slip past the TTL gate via NaN
  // arithmetic (Date.now() - NaN = NaN, which is falsy in TTL compare).
  return typeof v.signature === "string"
    && typeof v.timestamp === "number"
    && Number.isFinite(v.timestamp);
}
