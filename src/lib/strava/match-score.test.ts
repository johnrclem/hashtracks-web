import { scoreMatch, findBestMatchIndex } from "./match-score";

describe("scoreMatch", () => {
  it("scores higher when activity name matches kennel name", () => {
    const highMatch = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    const lowMatch = scoreMatch(
      { activityName: "Morning Run", stravaSportType: "Run", stravaTimeLocal: null },
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

  it("scores low for generic activity names (filtered by threshold in suggestions)", () => {
    const score = scoreMatch(
      { activityName: "Morning Run", stravaSportType: "Run", stravaTimeLocal: null },
      "BH3",
      null,
    );
    // Generic names still score (for findBestMatchIndex) but below suggestion threshold (2.0)
    expect(score.total).toBeLessThan(2.0);
    expect(score.total).toBeGreaterThan(0);
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
