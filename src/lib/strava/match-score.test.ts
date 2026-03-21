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
    expect(highMatch).toBeGreaterThan(lowMatch);
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
    expect(closeTime).toBeGreaterThan(farTime);
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
    expect(run).toBeGreaterThan(walk);
  });

  it("handles null times gracefully", () => {
    const score = scoreMatch(
      { activityName: "Brooklyn H3", stravaSportType: "Run", stravaTimeLocal: null },
      "Brooklyn H3",
      null,
    );
    expect(score).toBeGreaterThan(0);
  });

  it("returns 0 for generic activity names (nameScore gate)", () => {
    const score = scoreMatch(
      { activityName: "Morning Run", stravaSportType: "Run", stravaTimeLocal: null },
      "BH3",
      null,
    );
    expect(score).toBe(0);
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
