import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  signatureForIntent,
  stashSaveIntent,
  consumeSaveIntent,
  type SaveIntentParams,
} from "./save-intent";

const EXAMPLE: SaveIntentParams = {
  label: "Boston, MA, USA",
  startDate: "2026-04-14",
  endDate: "2026-04-20",
  latitude: 42.3554,
  longitude: -71.0566,
  radiusKm: 50,
  timezone: "America/New_York",
};

// Node test env has sessionStorage when jsdom is configured, but the travel
// tests don't set up DOM. Minimal polyfill so the intent helper works in
// isolation — keeps tests focused on the logic, not the environment.
function installSessionStorage() {
  const store = new Map<string, string>();
  // Storage methods are typed `: void`. The earlier `(k, v) => void store.set(...)`
  // form silenced any "unused return value" lint by syntactically discarding
  // the Map's chainable return. Braced shorthand achieves the same shape
  // without the void operator that SonarCloud flags.
  const ss = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    value: ss,
    configurable: true,
    writable: true,
  });
  return store;
}

describe("signatureForIntent", () => {
  it("produces the same signature for identical params", () => {
    expect(signatureForIntent(EXAMPLE)).toBe(signatureForIntent({ ...EXAMPLE }));
  });

  it("differs when any field changes", () => {
    const base = signatureForIntent(EXAMPLE);
    expect(signatureForIntent({ ...EXAMPLE, label: "Chicago, IL" })).not.toBe(base);
    expect(signatureForIntent({ ...EXAMPLE, startDate: "2026-04-15" })).not.toBe(base);
    expect(signatureForIntent({ ...EXAMPLE, endDate: "2026-04-21" })).not.toBe(base);
    expect(signatureForIntent({ ...EXAMPLE, radiusKm: 25 })).not.toBe(base);
    expect(signatureForIntent({ ...EXAMPLE, timezone: "America/Chicago" })).not.toBe(base);
  });

  it("treats missing timezone as empty string", () => {
    // Discard `timezone` via rest spread; the `_` prefix matches
    // @typescript-eslint/no-unused-vars' ignore pattern.
    const { timezone: _, ...noTz } = EXAMPLE;
    expect(signatureForIntent(noTz)).toBe(signatureForIntent({ ...noTz, timezone: undefined }));
  });

  it("rounds coordinates to 6 decimals so minor float diffs don't break matches", () => {
    const base = signatureForIntent(EXAMPLE);
    // Same when rounded to 6 places — a 1e-7 drift on lat/lng still matches.
    expect(
      signatureForIntent({ ...EXAMPLE, latitude: EXAMPLE.latitude + 1e-8 }),
    ).toBe(base);
  });
});

describe("stashSaveIntent + consumeSaveIntent", () => {
  beforeEach(() => {
    installSessionStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trip returns true when params match", () => {
    stashSaveIntent(EXAMPLE);
    expect(consumeSaveIntent(EXAMPLE)).toBe(true);
  });

  it("consume returns false when no intent was stashed", () => {
    expect(consumeSaveIntent(EXAMPLE)).toBe(false);
  });

  it("consume returns false when signatures don't match", () => {
    stashSaveIntent(EXAMPLE);
    expect(consumeSaveIntent({ ...EXAMPLE, label: "Chicago" })).toBe(false);
  });

  it("consume returns false when the intent is older than the TTL", () => {
    stashSaveIntent(EXAMPLE);
    vi.advanceTimersByTime(11 * 60 * 1000); // 11 min > 10 min TTL
    expect(consumeSaveIntent(EXAMPLE)).toBe(false);
  });

  it("consume always clears the storage slot (even on mismatch)", () => {
    const store = installSessionStorage();
    stashSaveIntent(EXAMPLE);
    expect(store.size).toBe(1);
    consumeSaveIntent({ ...EXAMPLE, label: "Chicago" });
    expect(store.size).toBe(0);
  });

  it("consume is one-shot — a second call returns false", () => {
    stashSaveIntent(EXAMPLE);
    expect(consumeSaveIntent(EXAMPLE)).toBe(true);
    expect(consumeSaveIntent(EXAMPLE)).toBe(false);
  });

  it("rejects payloads with non-numeric timestamp (shape validation)", () => {
    // CodeRabbit flagged JSON.parse(raw) as StoredIntent as an unchecked
    // cast. Without runtime validation, a corrupted/tampered value with
    // string timestamp would pass through (and fail TTL via NaN > X
    // = false). isStoredIntent catches it explicitly.
    const store = installSessionStorage();
    store.set("hashtracks:travel-save-intent", JSON.stringify({
      signature: signatureForIntent(EXAMPLE),
      timestamp: "not a number",
    }));
    expect(consumeSaveIntent(EXAMPLE)).toBe(false);
  });

  it("rejects payloads missing the signature field", () => {
    const store = installSessionStorage();
    store.set("hashtracks:travel-save-intent", JSON.stringify({
      timestamp: Date.now(),
    }));
    expect(consumeSaveIntent(EXAMPLE)).toBe(false);
  });

  it("rejects non-object JSON values", () => {
    const store = installSessionStorage();
    store.set("hashtracks:travel-save-intent", JSON.stringify("plain string"));
    expect(consumeSaveIntent(EXAMPLE)).toBe(false);
  });
});
