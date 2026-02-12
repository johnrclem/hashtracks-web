import { describe, it, expect } from "vitest";
import {
  formatTime,
  formatTimeCompact,
  participationLevelLabel,
  participationLevelAbbrev,
  parseParticipationLevel,
  PARTICIPATION_LEVELS,
  regionAbbrev,
  regionColorClasses,
} from "./format";

describe("formatTime", () => {
  it("converts 24h to 12h AM", () => {
    expect(formatTime("09:00")).toBe("9:00 AM");
  });
  it("converts 24h to 12h PM", () => {
    expect(formatTime("14:30")).toBe("2:30 PM");
  });
  it("handles midnight", () => {
    expect(formatTime("00:00")).toBe("12:00 AM");
  });
  it("handles noon", () => {
    expect(formatTime("12:00")).toBe("12:00 PM");
  });
});

describe("formatTimeCompact", () => {
  it("omits minutes when :00", () => {
    expect(formatTimeCompact("19:00")).toBe("7pm");
  });
  it("includes minutes when non-zero", () => {
    expect(formatTimeCompact("14:30")).toBe("2:30pm");
  });
  it("handles morning", () => {
    expect(formatTimeCompact("09:00")).toBe("9am");
  });
});

describe("participationLevelLabel", () => {
  it("returns display label for known level", () => {
    expect(participationLevelLabel("BAG_HERO")).toBe("Bag Hero");
  });
  it("returns raw value for unknown level", () => {
    expect(participationLevelLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});

describe("participationLevelAbbrev", () => {
  it("returns abbreviation for known level", () => {
    expect(participationLevelAbbrev("DRINK_CHECK")).toBe("DC");
  });
});

describe("parseParticipationLevel", () => {
  it("returns valid level as-is", () => {
    expect(parseParticipationLevel("HARE")).toBe("HARE");
  });
  it("returns RUN for undefined", () => {
    expect(parseParticipationLevel(undefined)).toBe("RUN");
  });
  it("returns RUN for invalid string", () => {
    expect(parseParticipationLevel("INVALID_LEVEL")).toBe("RUN");
  });
  it("returns RUN for empty string", () => {
    expect(parseParticipationLevel("")).toBe("RUN");
  });
  it("accepts all known levels", () => {
    for (const level of PARTICIPATION_LEVELS) {
      expect(parseParticipationLevel(level)).toBe(level);
    }
  });
});

describe("regionAbbrev", () => {
  it("returns abbreviation for known region", () => {
    expect(regionAbbrev("New York City, NY")).toBe("NYC");
  });
  it("returns raw string for unknown region", () => {
    expect(regionAbbrev("Unknown Region")).toBe("Unknown Region");
  });
});

describe("regionColorClasses", () => {
  it("returns classes for known region", () => {
    expect(regionColorClasses("Boston, MA")).toContain("bg-red-200");
  });
  it("returns gray fallback for unknown region", () => {
    expect(regionColorClasses("Unknown")).toContain("bg-gray-200");
  });
});
