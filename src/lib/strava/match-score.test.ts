import { scoreMatch, findBestMatchIndex, parseStravaTimezone, getTimezoneOffsetMinutes, timeToMinutes } from "./match-score";

describe("scoreMatch", () => {
  it("scores higher when activity name matches kennel name", () => {
    const highMatch = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    const lowMatch = scoreMatch(
      { activityName: "Central Park Loop", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    expect(highMatch.total).toBeGreaterThan(lowMatch.total);
  });

  it("scores higher when activity time is closer to event time", () => {
    const closeTime = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: "19:00" },
      "Brooklyn H3",
      "18:30",
    );
    const farTime = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: "08:00" },
      "Brooklyn H3",
      "18:30",
    );
    expect(closeTime.total).toBeGreaterThan(farTime.total);
  });

  it("gives bonus to run sport types", () => {
    const run = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    const walk = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Walk", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    expect(run.total).toBeGreaterThan(walk.total);
  });

  it("handles null times gracefully", () => {
    const score = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    expect(score.total).toBeGreaterThan(0);
  });

  it("zeros nameScore for generic activity names", () => {
    const generic = scoreMatch(
      { activityName: "Morning Run", stravaSportType: "Run", stravaTimeLocal: null },
      "BH3",
      null,
    );
    expect(generic.nameScore).toBe(0);

    const afternoon = scoreMatch(
      { activityName: "Afternoon Walk", stravaSportType: "Walk", stravaTimeLocal: null },
      "NYCH3",
      null,
    );
    expect(afternoon.nameScore).toBe(0);

    // Non-generic name still scores normally
    const specific = scoreMatch(
      { activityName: "NYC H3", stravaSportType: "Run", stravaTimeLocal: null },
      "NYCH3",
      null,
    );
    expect(specific.nameScore).toBeGreaterThan(0);
  });

  it("includes hasGeoSignal in breakdown", () => {
    const noGeo = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    expect(noGeo.hasGeoSignal).toBe(false);

    const withGeo = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null, startLat: 40.7, startLng: -74.0 },
      "Brooklyn H3",
      null,
      40.7, -74.0,
    );
    expect(withGeo.hasGeoSignal).toBe(true);
  });

  it("returns breakdown with geoKm when coords provided", () => {
    const score = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null, startLat: 40.7, startLng: -74.0 },
      "Brooklyn H3",
      null,
      40.7,
      -74.0,
    );
    expect(score.geoKm).not.toBeNull();
    expect(score.geoScore).toBe(1.0);
  });

  it("returns null geoKm when coords missing", () => {
    const score = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    expect(score.geoKm).toBeNull();
  });

  it("applies small geo penalty when activity has coords but event does not", () => {
    const withPenalty = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null, startLat: 40.7, startLng: -74.0 },
      "Brooklyn H3",
      null,
      null, // event has no coords
      null,
    );
    const noPenalty = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    // Penalty reduces score but not so aggressively that a moderate name+time match is killed
    expect(withPenalty.geoScore).toBe(-0.25);
    expect(withPenalty.total).toBeLessThan(noPenalty.total);
    // A strong name match should still clear the 2.0 suggestion threshold despite the penalty
    expect(withPenalty.total).toBeGreaterThan(2.0);
  });

  it("applies same geo penalty when event has coords but activity does not", () => {
    const score = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
      40.7, // event has coords
      -74.0,
    );
    // Activity lacks GPS, event has coords — same penalty as the reverse case
    expect(score.geoScore).toBe(-0.25);
    expect(score.hasGeoSignal).toBe(true);
  });
});

describe("findBestMatchIndex", () => {
  it("returns 0 for empty array", () => {
    expect(findBestMatchIndex([], "BH3", null)).toBe(0);
  });

  it("returns index of best matching activity", () => {
    const activities = [
      { activityName: "Morning Run", stravaSportType: "Run", stravaTimeLocal: "08:00" },
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: "19:00" },
      { activityName: "Evening Walk", stravaSportType: "Walk", stravaTimeLocal: "20:00" },
    ];
    const idx = findBestMatchIndex(activities, "Brooklyn H3", "19:00");
    expect(idx).toBe(1); // "Brooklyn H3" matches the kennel name best
  });

  it("returns single element index for single-item array", () => {
    const activities = [
      { activityName: "Run", stravaSportType: "Run", stravaTimeLocal: null },
    ];
    expect(findBestMatchIndex(activities, "BH3", null)).toBe(0);
  });
});

describe("parseStravaTimezone", () => {
  it("extracts IANA timezone from Strava format", () => {
    expect(parseStravaTimezone("(GMT-05:00) America/New_York")).toBe("America/New_York");
    expect(parseStravaTimezone("(GMT-08:00) America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(parseStravaTimezone("(GMT+00:00) Europe/London")).toBe("Europe/London");
  });

  it("returns null for null/undefined/empty input", () => {
    expect(parseStravaTimezone(null)).toBeNull();
    expect(parseStravaTimezone(undefined)).toBeNull();
    expect(parseStravaTimezone("")).toBeNull();
  });

  it("returns null for strings without the expected format", () => {
    expect(parseStravaTimezone("America/New_York")).toBeNull();
    expect(parseStravaTimezone("EST")).toBeNull();
  });
});

describe("getTimezoneOffsetMinutes", () => {
  it("returns different offsets for EST and PST", () => {
    const estOffset = getTimezoneOffsetMinutes("America/New_York");
    const pstOffset = getTimezoneOffsetMinutes("America/Los_Angeles");
    // EST is UTC-4 (summer) / UTC-5 (winter), PST is UTC-7 (summer) / UTC-8 (winter)
    // The reference date is June 15, so summer time: EDT=-240, PDT=-420
    expect(estOffset).toBe(-240);
    expect(pstOffset).toBe(-420);
    expect(estOffset - pstOffset).toBe(180); // 3 hours difference
  });

  it("returns 0 for UTC", () => {
    expect(getTimezoneOffsetMinutes("UTC")).toBe(0);
  });

  it("returns 0 for invalid timezone", () => {
    expect(getTimezoneOffsetMinutes("Not/A/Timezone")).toBe(0);
  });
});

describe("timezone-aware scoring", () => {
  it("compares times as raw HH:MM when both are in the same timezone", () => {
    const score = scoreMatch(
      {
        activityName: "Brooklyn H3",
        stravaSportType: "Run",
        stravaTimeLocal: "18:25",
        timezone: "(GMT-05:00) America/New_York",
      },
      "Brooklyn H3",
      "18:30",
      null,
      null,
      "America/New_York",
    );
    // 5 min apart → timeScore ≈ 0.958
    expect(score.timeScore).toBeGreaterThan(0.9);
  });

  it("detects cross-timezone mismatch when times look close but are in different zones", () => {
    // Activity at 18:25 PST and event at 18:30 EST
    // In UTC: activity = 18:25 + 7h = 01:25 next day, event = 18:30 + 5h = 23:30
    // Difference ≈ ~2 hours
    const crossTz = scoreMatch(
      {
        activityName: "Brooklyn H3",
        stravaSportType: "Run",
        stravaTimeLocal: "18:25",
        timezone: "(GMT-08:00) America/Los_Angeles",
      },
      "Brooklyn H3",
      "18:30",
      null,
      null,
      "America/New_York",
    );

    // Same times, same timezone (naive comparison)
    const sameTz = scoreMatch(
      {
        activityName: "Brooklyn H3",
        stravaSportType: "Run",
        stravaTimeLocal: "18:25",
        timezone: "(GMT-05:00) America/New_York",
      },
      "Brooklyn H3",
      "18:30",
      null,
      null,
      "America/New_York",
    );

    // Cross-timezone should score much lower on time than same-timezone
    expect(sameTz.timeScore).toBeGreaterThan(crossTz.timeScore);
    // The 3-hour real difference should produce a low time score
    expect(crossTz.timeScore).toBeLessThan(0.1);
  });

  it("falls back to raw comparison when no timezone info available", () => {
    const noTz = scoreMatch(
      {
        activityName: "Brooklyn H3",
        stravaSportType: "Run",
        stravaTimeLocal: "18:25",
      },
      "Brooklyn H3",
      "18:30",
    );
    // Without timezone info, raw comparison: 5 min apart
    expect(noTz.timeScore).toBeGreaterThan(0.9);
  });

  it("falls back to raw comparison when activity has timezone but event does not", () => {
    const partialTz = scoreMatch(
      {
        activityName: "Brooklyn H3",
        stravaSportType: "Run",
        stravaTimeLocal: "18:25",
        timezone: "(GMT-05:00) America/New_York",
      },
      "Brooklyn H3",
      "18:30",
      null,
      null,
      null, // no event timezone
    );
    // Should fall back to raw comparison: 5 min apart
    expect(partialTz.timeScore).toBeGreaterThan(0.9);
  });

  it("falls back to raw comparison when event has timezone but activity does not", () => {
    const partialTz = scoreMatch(
      {
        activityName: "Brooklyn H3",
        stravaSportType: "Run",
        stravaTimeLocal: "18:25",
        // no activity timezone
      },
      "Brooklyn H3",
      "18:30",
      null,
      null,
      "America/New_York",
    );
    // Should fall back to raw comparison: 5 min apart
    expect(partialTz.timeScore).toBeGreaterThan(0.9);
  });
});
