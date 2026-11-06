import { readFileSync } from "node:fs";
import path from "node:path";
import { parseNicosiaDate, parseNicosiaHareline, splitHares } from "./nicosia-hash";

// Trimmed from the live nh4.com.cy "Upcoming Hares" table (2026-11-05).
const LIVE_HTML = readFileSync(
  path.join(__dirname, "fixtures/nicosia-hash-upcoming-hares-2026-11-05.html.fixture"),
  "utf-8",
);
const NOW = new Date("2026-11-05T12:00:00Z");

describe("parseNicosiaDate", () => {
  it("picks the year nearest to now", () => {
    expect(parseNicosiaDate("25-Aug", NOW)).toBe("2026-08-25");
    expect(parseNicosiaDate("24-Nov", NOW)).toBe("2026-11-24");
    expect(parseNicosiaDate("05-Jan", NOW)).toBe("2027-01-05");
    expect(parseNicosiaDate("15-Dec", new Date("2027-01-10T12:00:00Z"))).toBe("2026-12-15");
  });
  it("rejects malformed dates", () => {
    expect(parseNicosiaDate("31-Sep", NOW)).toBeNull();
    expect(parseNicosiaDate("TBA", NOW)).toBeNull();
  });
});

describe("splitHares", () => {
  it("splits on & and / and sorts", () => {
    expect(splitHares("Lunchbox/Insatiable Thirst")).toBe("Insatiable Thirst, Lunchbox");
    expect(splitHares("Lymp Dick &amp; Hala Madrid".replace("&amp;", "&"))).toBe("Hala Madrid, Lymp Dick");
    expect(splitHares(" ")).toBeNull();
  });
});

describe("parseNicosiaHareline", () => {
  it("parses run rows with a 19:15 start and null hares for open slots", () => {
    const { events, parseErrors } = parseNicosiaHareline(LIVE_HTML, undefined, NOW);
    expect(parseErrors).toEqual([]);
    expect(events.map((e) => [e.runNumber, e.date, e.hares])).toEqual([
      [1974, "2026-08-25", "Insatiable Thirst, Lunchbox"],
      [1976, "2026-09-08", "Hala Madrid, Lymp Dick"],
      [1980, "2026-10-06", "Zivana - Segway"],
      [1981, "2026-10-13", null],
      [1987, "2026-11-24", null],
    ]);
    expect(events.every((e) => e.startTime === "19:15" && e.title === undefined)).toBe(true);
    expect(events[0].kennelTags).toEqual(["nh4-cy"]);
  });

  it("records a parse error for a bad date", () => {
    const { parseErrors } = parseNicosiaHareline(LIVE_HTML.replace("25-Aug", "Aug 25"), undefined, NOW);
    expect(parseErrors[0].error).toContain("1974");
  });
});
