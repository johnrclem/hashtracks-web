import { describe, it, expect } from "vitest";
import {
  REASON_WARN_AT,
  counterClassName,
  deriveReasonState,
  reasonHelperText,
} from "./CancellationOverrideDialog.utils";
import {
  CANCELLATION_REASON_MIN,
  CANCELLATION_REASON_MAX,
} from "@/app/admin/events/constants";

describe("deriveReasonState", () => {
  it("flags an empty input as invalid + tooShort", () => {
    const state = deriveReasonState("", false);
    expect(state).toMatchObject({
      trimmed: "",
      length: 0,
      tooShort: true,
      tooLong: false,
      isValid: false,
      showShortError: false, // not touched yet
      nearLimit: false,
    });
  });

  it("trims whitespace before counting", () => {
    const state = deriveReasonState("   ab   ", true);
    expect(state.trimmed).toBe("ab");
    expect(state.length).toBe(2);
    expect(state.tooShort).toBe(true);
    expect(state.showShortError).toBe(true); // touched + tooShort
  });

  it("treats a whitespace-only input as length 0", () => {
    const state = deriveReasonState("       ", true);
    expect(state.length).toBe(0);
    expect(state.isValid).toBe(false);
  });

  it("accepts the boundary at exactly CANCELLATION_REASON_MIN", () => {
    const reason = "x".repeat(CANCELLATION_REASON_MIN);
    const state = deriveReasonState(reason, true);
    expect(state.length).toBe(CANCELLATION_REASON_MIN);
    expect(state.tooShort).toBe(false);
    expect(state.isValid).toBe(true);
    expect(state.showShortError).toBe(false);
  });

  it("accepts the boundary at exactly CANCELLATION_REASON_MAX", () => {
    const reason = "x".repeat(CANCELLATION_REASON_MAX);
    const state = deriveReasonState(reason, true);
    expect(state.length).toBe(CANCELLATION_REASON_MAX);
    expect(state.tooLong).toBe(false);
    expect(state.isValid).toBe(true);
    expect(state.nearLimit).toBe(true); // exactly at the cap is "near"
  });

  it("flags lengths above MAX as tooLong + invalid", () => {
    const state = deriveReasonState("x".repeat(CANCELLATION_REASON_MAX + 1), true);
    expect(state.tooLong).toBe(true);
    expect(state.isValid).toBe(false);
  });

  it("does NOT show the short-error before touched", () => {
    const state = deriveReasonState("ab", false);
    expect(state.tooShort).toBe(true);
    expect(state.showShortError).toBe(false);
  });

  it("flags nearLimit in the [REASON_WARN_AT, MAX] band", () => {
    const at = deriveReasonState("x".repeat(REASON_WARN_AT), true);
    expect(at.nearLimit).toBe(true);

    const below = deriveReasonState("x".repeat(REASON_WARN_AT - 1), true);
    expect(below.nearLimit).toBe(false);

    const above = deriveReasonState("x".repeat(CANCELLATION_REASON_MAX + 1), true);
    expect(above.nearLimit).toBe(false); // out-of-bounds is not "near", it's "too long"
  });
});

describe("counterClassName", () => {
  it("returns destructive for tooLong (highest precedence)", () => {
    expect(counterClassName({ tooLong: true, nearLimit: true, showShortError: true })).toBe(
      "text-destructive",
    );
  });

  it("returns amber for nearLimit when not tooLong", () => {
    expect(counterClassName({ tooLong: false, nearLimit: true, showShortError: false })).toBe(
      "text-amber-600 dark:text-amber-500",
    );
  });

  it("returns destructive for showShortError when neither tooLong nor nearLimit", () => {
    expect(counterClassName({ tooLong: false, nearLimit: false, showShortError: true })).toBe(
      "text-destructive",
    );
  });

  it("returns muted for the default state", () => {
    expect(counterClassName({ tooLong: false, nearLimit: false, showShortError: false })).toBe(
      "text-muted-foreground",
    );
  });

  it("nearLimit takes precedence over showShortError (both can fire if min < warn-at)", () => {
    expect(counterClassName({ tooLong: false, nearLimit: true, showShortError: true })).toBe(
      "text-amber-600 dark:text-amber-500",
    );
  });
});

describe("reasonHelperText", () => {
  it("shows the minimum-chars message when too short and touched", () => {
    expect(reasonHelperText({ showShortError: true, tooLong: false })).toBe(
      `Minimum ${CANCELLATION_REASON_MIN} characters.`,
    );
  });

  it("shows the maximum-chars message when too long", () => {
    expect(reasonHelperText({ showShortError: false, tooLong: true })).toBe(
      `Maximum ${CANCELLATION_REASON_MAX} characters.`,
    );
  });

  it("shows the audit-log default message when valid", () => {
    expect(reasonHelperText({ showShortError: false, tooLong: false })).toBe(
      "Captured in the audit log; visible to admins on the row hover.",
    );
  });

  it("prefers the short-error message over the audit-log default when both flags fire", () => {
    expect(reasonHelperText({ showShortError: true, tooLong: false })).not.toBe(
      "Captured in the audit log; visible to admins on the row hover.",
    );
  });
});
