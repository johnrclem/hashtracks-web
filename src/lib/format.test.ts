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
  formatDateShort,
  formatSchedule,
  instagramUrl,
  twitterUrl,
  displayDomain,
  getLabelForUrl,
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

describe("formatDateShort", () => {
  it("formats UTC noon date to short display", () => {
    expect(formatDateShort("2026-02-18T12:00:00.000Z")).toBe("Wed, Feb 18");
  });
  it("handles different months", () => {
    expect(formatDateShort("2026-07-04T12:00:00.000Z")).toBe("Sat, Jul 4");
  });
  it("uses UTC to avoid date shift", () => {
    // A date stored as UTC noon should not shift to previous day
    expect(formatDateShort("2026-01-01T12:00:00.000Z")).toBe("Thu, Jan 1");
  });
});

describe("formatSchedule", () => {
  it("returns null when no fields populated", () => {
    expect(formatSchedule({})).toBeNull();
  });
  it("returns null when all fields are null", () => {
    expect(formatSchedule({ scheduleDayOfWeek: null, scheduleTime: null, scheduleFrequency: null })).toBeNull();
  });
  it("formats all three fields", () => {
    expect(formatSchedule({
      scheduleDayOfWeek: "Wednesday",
      scheduleTime: "7:00 PM",
      scheduleFrequency: "Weekly",
    })).toBe("Wednesdays at 7:00 PM · Weekly");
  });
  it("formats day + time only", () => {
    expect(formatSchedule({
      scheduleDayOfWeek: "Saturday",
      scheduleTime: "2:00 PM",
    })).toBe("Saturdays at 2:00 PM");
  });
  it("formats day + frequency only", () => {
    expect(formatSchedule({
      scheduleDayOfWeek: "Saturday",
      scheduleFrequency: "Biweekly",
    })).toBe("Saturdays · Biweekly");
  });
  it("formats frequency only", () => {
    expect(formatSchedule({ scheduleFrequency: "Monthly" })).toBe("Monthly");
  });
  it("formats time only", () => {
    expect(formatSchedule({ scheduleTime: "7:00 PM" })).toBe("7:00 PM");
  });
  it("pluralizes all seven day names correctly", () => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    for (const day of days) {
      expect(formatSchedule({ scheduleDayOfWeek: day })).toBe(day + "s");
    }
  });
});

describe("instagramUrl", () => {
  it("builds URL from handle without @", () => {
    expect(instagramUrl("londonhash")).toBe("https://instagram.com/londonhash");
  });
  it("strips leading @ from handle", () => {
    expect(instagramUrl("@londonhash")).toBe("https://instagram.com/londonhash");
  });
});

describe("twitterUrl", () => {
  it("builds URL from handle without @", () => {
    expect(twitterUrl("sfh3")).toBe("https://x.com/sfh3");
  });
  it("strips leading @ from handle", () => {
    expect(twitterUrl("@sfh3")).toBe("https://x.com/sfh3");
  });
});

describe("displayDomain", () => {
  it("extracts hostname from URL", () => {
    expect(displayDomain("https://hashnyc.com/events")).toBe("hashnyc.com");
  });
  it("strips www prefix", () => {
    expect(displayDomain("https://www.facebook.com/groups/nychash")).toBe("facebook.com");
  });
  it("returns raw string on invalid URL", () => {
    expect(displayDomain("not-a-url")).toBe("not-a-url");
  });
});

describe("getLabelForUrl", () => {
  it("returns 'Google Calendar' for calendar.google.com URLs", () => {
    expect(getLabelForUrl("https://calendar.google.com/calendar/event?eid=abc123")).toBe("Google Calendar");
  });
  it("returns 'Google Calendar' for google.com/calendar URLs", () => {
    expect(getLabelForUrl("https://www.google.com/calendar/event?eid=abc123")).toBe("Google Calendar");
  });
  it("does not treat google.com non-calendar paths as Google Calendar", () => {
    expect(getLabelForUrl("https://www.google.com/search?q=hash")).toBe("google.com");
  });
  it("returns 'Facebook' for facebook.com URLs", () => {
    expect(getLabelForUrl("https://www.facebook.com/profile.php?id=100063637060523")).toBe("Facebook");
  });
  it("returns 'Hash Rego' for hashrego.com URLs", () => {
    expect(getLabelForUrl("https://hashrego.com/events/bfmh3-agm-2026")).toBe("Hash Rego");
  });
  it("returns 'Meetup' for meetup.com URLs", () => {
    expect(getLabelForUrl("https://www.meetup.com/some-hash/events/123")).toBe("Meetup");
  });
  it("returns 'Google Sheets' for docs.google.com URLs", () => {
    expect(getLabelForUrl("https://docs.google.com/spreadsheets/d/abc/edit")).toBe("Google Sheets");
  });
  it("returns 'Blogspot' for blogspot.com URLs", () => {
    expect(getLabelForUrl("https://somehash.blogspot.com/2026/03/run-42.html")).toBe("Blogspot");
  });
  it("returns 'DigitalPress' for digitalpress.blog URLs", () => {
    expect(getLabelForUrl("https://hangoverhash.digitalpress.blog/214/")).toBe("DigitalPress");
  });
  it("falls back to bare hostname for unknown domains", () => {
    expect(getLabelForUrl("https://hashnyc.com/events")).toBe("hashnyc.com");
  });
  it("strips www. from fallback hostname", () => {
    expect(getLabelForUrl("https://www.ewh3.com/2026/02/trail-1506/")).toBe("ewh3.com");
  });
  it("returns 'Source' for unparseable URLs", () => {
    expect(getLabelForUrl("not-a-url")).toBe("Source");
  });
  it("preserves existing descriptive label", () => {
    expect(getLabelForUrl("https://hashrego.com/events/foo", "Hash Rego")).toBe("Hash Rego");
  });
  it("overrides generic 'Source' label with derived label", () => {
    expect(getLabelForUrl("https://www.facebook.com/groups/h3", "Source")).toBe("Facebook");
  });
  it("derives label when existing label is null or undefined", () => {
    expect(getLabelForUrl("https://meetup.com/hash/events/1", null)).toBe("Meetup");
    expect(getLabelForUrl("https://meetup.com/hash/events/1", undefined)).toBe("Meetup");
  });
});
