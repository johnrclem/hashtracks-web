/**
 * Verification status derivation for attendance records.
 * Pure function — no DB or auth dependencies.
 *
 * Compares misman-recorded (KennelAttendance) vs user self-checked-in (Attendance)
 * records for linked users to determine verification status per event.
 */

export type VerificationStatus = "verified" | "misman-only" | "user-only" | "none";

export interface VerificationInput {
  /** Whether a KennelAttendance record exists (misman recorded) */
  hasKennelAttendance: boolean;
  /** Whether an Attendance record exists (user self-checked in) */
  hasUserAttendance: boolean;
}

/**
 * Derive verification status from the presence of both record types.
 */
export function deriveVerificationStatus(
  input: VerificationInput,
): VerificationStatus {
  if (input.hasKennelAttendance && input.hasUserAttendance) return "verified";
  if (input.hasKennelAttendance) return "misman-only";
  if (input.hasUserAttendance) return "user-only";
  return "none";
}

/**
 * Compute verification statuses for a set of events.
 * Given event IDs where either a KennelAttendance or Attendance exists,
 * returns the derived status for each.
 */
export function computeVerificationStatuses(
  kennelAttendanceEventIds: Set<string>,
  userAttendanceEventIds: Set<string>,
  allEventIds: string[],
): Map<string, VerificationStatus> {
  const result = new Map<string, VerificationStatus>();
  for (const eventId of allEventIds) {
    result.set(
      eventId,
      deriveVerificationStatus({
        hasKennelAttendance: kennelAttendanceEventIds.has(eventId),
        hasUserAttendance: userAttendanceEventIds.has(eventId),
      }),
    );
  }
  return result;
}
