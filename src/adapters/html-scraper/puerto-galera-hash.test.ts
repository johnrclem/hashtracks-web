import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanHares, parseUpcomingRuns, resolveHeadingDate, runListRowToEvent } from "./puerto-galera-hash";

// The live "Upcoming Regular Runs" accordion from pgh3.org (2026-11-05).
const UPCOMING = readFileSync(path.join(__dirname, "fixtures/puerto-galera-hash-upcoming-2026-11-05.html.fixture"), "utf-8");
const NOW = new Date("2026-11-05T12:00:00Z");

describe("helpers", () => {
  it("resolves year-less headings to the nearest year", () => {
    expect(resolveHeadingDate("Saturday November 7th", NOW)).toBe("2026-11-07");
    expect(resolveHeadingDate("Saturday January 2nd", new Date("2026-12-20T00:00:00Z"))).toBe("2027-01-02");
    expect(resolveHeadingDate("Saturday Smarch 2nd", NOW)).toBeNull();
  });
  it("treats no-hare placeholders as explicit clears", () => {
    expect(cleanHares("Hare Needed!")).toBeNull();
    expect(cleanHares("Walang Hare!")).toBeNull();
    expect(cleanHares("Siggy Wiggy Wanker, Dopey Gummy Bear")).toBe("Dopey Gummy Bear, Siggy Wiggy Wanker");
  });
});

describe("parseUpcomingRuns", () => {
  it("parses each accordion run", () => {
    const { events, accordionFound } = parseUpcomingRuns(UPCOMING, NOW);
    expect(accordionFound).toBe(true);
    expect(events.map((e) => [e.runNumber, e.date, e.startTime])).toEqual([
      [1905, "2026-11-07", "15:00"],
      [1906, "2026-11-14", "15:00"],
      [1907, "2026-11-21", "15:00"],
      [1908, "2026-11-28", "14:30"],
      [1909, "2026-12-05", "14:30"],
    ]);
    expect(events[0]).toMatchObject({ kennelTags: ["pgh3"], hares: "Free Sex", location: "Away to home", description: undefined });
    expect(events[3]).toMatchObject({ hares: null, location: null });
    expect(events.every((e) => e.title === undefined)).toBe(true);
  });
  it("reports a missing accordion", () => {
    expect(parseUpcomingRuns("<p>Not Acceptable!</p>", NOW).accordionFound).toBe(false);
  });
});

describe("runListRowToEvent", () => {
  it("maps an archive JSON row", () => {
    expect(
      runListRowToEvent({
        Run: "<a href = 'https://www.pgh3.org/run-runners.html?run=1904' title='Details for run 1904' target='_blank'>1904</a>",
        Date: "2026-10-31",
        Hares: "Ike the Dyke, Phone Phucker, Siggy Wiggy Wanker",
        Location: "Balatero",
        OnOn: "Hangout Bar",
        Comments: null,
      }),
    ).toEqual({
      date: "2026-10-31",
      kennelTags: ["pgh3"],
      runNumber: 1904,
      hares: "Ike the Dyke, Phone Phucker, Siggy Wiggy Wanker",
      location: "Balatero",
      description: "On On: Hangout Bar",
      sourceUrl: "https://www.pgh3.org/run-runners.html?run=1904",
    });
  });
  it("rejects rows without a run number or ISO date", () => {
    expect(runListRowToEvent({ Run: "n/a", Date: "2026-10-31" })).toBeNull();
    expect(runListRowToEvent({ Run: "<a>1904</a>", Date: "31/10/2026" })).toBeNull();
  });
});
