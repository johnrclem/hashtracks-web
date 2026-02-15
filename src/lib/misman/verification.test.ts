import { describe, it, expect } from "vitest";
import {
  deriveVerificationStatus,
  computeVerificationStatuses,
} from "./verification";

describe("deriveVerificationStatus", () => {
  it("returns 'verified' when both records exist", () => {
    expect(
      deriveVerificationStatus({
        hasKennelAttendance: true,
        hasUserAttendance: true,
      }),
    ).toBe("verified");
  });

  it("returns 'misman-only' when only misman recorded", () => {
    expect(
      deriveVerificationStatus({
        hasKennelAttendance: true,
        hasUserAttendance: false,
      }),
    ).toBe("misman-only");
  });

  it("returns 'user-only' when only user self-checked-in", () => {
    expect(
      deriveVerificationStatus({
        hasKennelAttendance: false,
        hasUserAttendance: true,
      }),
    ).toBe("user-only");
  });

  it("returns 'none' when neither record exists", () => {
    expect(
      deriveVerificationStatus({
        hasKennelAttendance: false,
        hasUserAttendance: false,
      }),
    ).toBe("none");
  });
});

describe("computeVerificationStatuses", () => {
  it("returns correct statuses for a set of events", () => {
    const kennelIds = new Set(["e1", "e2"]);
    const userIds = new Set(["e2", "e3"]);
    const allIds = ["e1", "e2", "e3", "e4"];

    const result = computeVerificationStatuses(kennelIds, userIds, allIds);

    expect(result.get("e1")).toBe("misman-only");
    expect(result.get("e2")).toBe("verified");
    expect(result.get("e3")).toBe("user-only");
    expect(result.get("e4")).toBe("none");
  });

  it("returns empty map for empty input", () => {
    const result = computeVerificationStatuses(
      new Set(),
      new Set(),
      [],
    );
    expect(result.size).toBe(0);
  });
});
