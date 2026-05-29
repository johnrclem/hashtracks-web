import { describe, it, expect } from "vitest";
import { isBikeHashTitle } from "./backfill-mel-bike-hash-history";
import { isCityHashTitle } from "./backfill-mel-city-h3-history";
import {
  buildKennelEvents,
  isImportablePlaceholder,
} from "./lib/mel-meetup-history-backfill";

describe("isBikeHashTitle", () => {
  it.each([
    ["Bike hash ride #132", true],
    ["Bike Hash#75 - Coochie Coo in Castlemaine", true],
    ["Bike Ride #88 - Two Fat Ladies hash", true],
    ["Ride #130 New Year, Old Favourites", true],
    ["Ride #102 Poison Ivy plays naughts and crosses", true],
    ["Melbourne New Moon #174- Maggot @ Docklands", false],
    ["Run No. 115", false],
    ["City Hash Run#43 (Race The Tram)", false],
    ["Full Moon Run No. 250", false],
    ["Delinquents HHH No.38", false],
  ])("%s → %s", (title, expected) => {
    expect(isBikeHashTitle(title)).toBe(expected);
  });
});

describe("isCityHashTitle", () => {
  it.each([
    ["City Hash Run#43 (Race The Tram)", true],
    ["Melbourne City Hash 1st Anniversary Run", true],
    ["Beer Run# 26 from Melbourne City Hash", true],
    ["Melbourne City Hash#33 (Run & Beer)", true],
    ["Bike hash ride #132", false],
    ["Run No. 115", false],
    ["Melbourne New Moon #173- Quick Lay", false],
  ])("%s → %s", (title, expected) => {
    expect(isCityHashTitle(title)).toBe(expected);
  });
});

describe("isImportablePlaceholder", () => {
  it.each([
    ["LBH POSTPONED until further notice", true],
    ["Run #50 CANCELLED", true],
    ["Run #51 - NEEDS A HARE", true],
    ["Every Wednesday @ 6:30pm from tbd", true],
    ["Bike hash ride #132", false],
    ["City Hash Run#43", false],
  ])("%s → %s", (title, expected) => {
    expect(isImportablePlaceholder(title)).toBe(expected);
  });
});

describe("buildKennelEvents", () => {
  const rows = [
    { title: "Bike hash ride #132", date: "2026-02-22", startTime: "12:00", location: "Sandringham Station", url: "https://m/1" },
    { title: "Ride #130 New Year, Old Favourites", date: "2026-01-18", startTime: "12:00", location: "Kaiju Beer & Pizza", url: "https://m/2" },
    { title: "City Hash Run#54", date: "2024-02-15", startTime: "18:30", location: "13 Mitford St", url: "https://m/3" },
    { title: "Run No. 115", date: "2021-04-10", startTime: "15:00", location: "Urban Alley", url: "https://m/4" },
    { title: "Bike Hash CANCELLED", date: "2025-01-01", url: "https://m/5" },
    // duplicate URL of row 1 — should collapse
    { title: "Bike hash ride #132", date: "2026-02-22", startTime: "12:00", location: "Sandringham Station", url: "https://m/1" },
  ];

  it("filters to bike-hash, extracts run numbers, dedupes by url, drops placeholders", () => {
    const events = buildKennelEvents(rows, "melbourne-bike-hash", isBikeHashTitle);
    expect(events.map((e) => e.title)).toEqual([
      "Bike hash ride #132",
      "Ride #130 New Year, Old Favourites",
    ]);
    expect(events[0]).toMatchObject({
      date: "2026-02-22",
      kennelTags: ["melbourne-bike-hash"],
      runNumber: 132,
      startTime: "12:00",
      location: "Sandringham Station",
      sourceUrl: "https://m/1",
    });
    expect(events[1].runNumber).toBe(130);
  });

  it("filters to city-h3 independently", () => {
    const events = buildKennelEvents(rows, "melbourne-city-h3", isCityHashTitle);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "City Hash Run#54", runNumber: 54, kennelTags: ["melbourne-city-h3"] });
  });
});
