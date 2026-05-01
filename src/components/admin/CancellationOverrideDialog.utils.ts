/**
 * Pure derivation logic for CancellationOverrideDialog. Extracted into its
 * own module so it's testable without a React-component-rendering stack
 * (the project ships vitest without jsdom; existing component tests target
 * pure exports only — see EventTable.test.ts as the prior-art pattern).
 *
 * Server-side validation lives in `adminCancelEvent` in
 * `src/app/admin/events/actions.ts` and uses the same bounds via
 * `@/app/admin/events/constants`. Client and server stay in sync because both
 * import from there; this util mirrors the rules for UI feedback only.
 */

import {
  CANCELLATION_REASON_MIN,
  CANCELLATION_REASON_MAX,
} from "@/app/admin/events/constants";

/** Buffer below the maximum at which the counter shifts to the warning color. */
export const REASON_WARN_AT = CANCELLATION_REASON_MAX - 50;

/** A summary of the reason-textarea state used for the counter, helper text,
 *  and Confirm-button gate. Pure function of (reason, touched). */
export interface ReasonState {
  /** Trimmed text (whitespace-only inputs collapse to ""). */
  trimmed: string;
  /** Length of the trimmed text. */
  length: number;
  /** True iff length < CANCELLATION_REASON_MIN. */
  tooShort: boolean;
  /** True iff length > CANCELLATION_REASON_MAX. */
  tooLong: boolean;
  /** True iff length is within bounds. Confirm button is disabled unless this is true. */
  isValid: boolean;
  /** True iff the textarea has been touched (blurred) AND the reason is too short. */
  showShortError: boolean;
  /** True iff length is in the [REASON_WARN_AT, MAX] band — counter shifts to warning color. */
  nearLimit: boolean;
}

/** Pure derivation of textarea state from raw input + touched flag. */
export function deriveReasonState(reason: string, touched: boolean): ReasonState {
  const trimmed = reason.trim();
  const length = trimmed.length;
  const tooShort = length < CANCELLATION_REASON_MIN;
  const tooLong = length > CANCELLATION_REASON_MAX;
  return {
    trimmed,
    length,
    tooShort,
    tooLong,
    isValid: !tooShort && !tooLong,
    showShortError: touched && tooShort,
    nearLimit: length >= REASON_WARN_AT && length <= CANCELLATION_REASON_MAX,
  };
}

/** Counter-color decision for the live char counter. Returns a Tailwind class
 *  string; precedence is `tooLong > nearLimit > showShortError > default`. */
export function counterClassName(state: Pick<ReasonState, "tooLong" | "nearLimit" | "showShortError">): string {
  if (state.tooLong) return "text-destructive";
  if (state.nearLimit) return "text-amber-600 dark:text-amber-500";
  if (state.showShortError) return "text-destructive";
  return "text-muted-foreground";
}

/** Helper-text content below the textarea. Mirrors the server-side error
 *  messages so the admin sees the same wording client-side and server-side. */
export function reasonHelperText(state: Pick<ReasonState, "showShortError" | "tooLong">): string {
  if (state.showShortError) {
    return `Minimum ${CANCELLATION_REASON_MIN} characters.`;
  }
  if (state.tooLong) {
    return `Maximum ${CANCELLATION_REASON_MAX} characters.`;
  }
  return "Captured in the audit log; visible to admins on the row hover.";
}
