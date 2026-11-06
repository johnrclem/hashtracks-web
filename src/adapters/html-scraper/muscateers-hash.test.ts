import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDiary, parseDottedDate, parseRecedingHareline, splitHares } from "./muscateers-hash";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
// Trimmed from the live muscateersh3.com pages (2026-11-05).
const HARELINE = fixture("muscateers-hash-receding-hareline-2026-11-05.html.fixture");
const DIARY = fixture("muscateers-hash-diary-2026-11-05.html.fixture");

describe("helpers", () => {
  it("parses dotted D.M.YY dates", () => {
    expect(parseDottedDate("11.9.26")).toBe("2026-09-11");
    expect(parseDottedDate("12.04.25")).toBe("2025-04-12");
    expect(parseDottedDate("31.2.26")).toBeNull();
    expect(parseDottedDate("Date")).toBeNull();
  });
  it("splits and sorts hares", () => {
    expect(splitHares("Prozac man, Omar Sharifa")).toBe("Omar Sharifa, Prozac man");
    expect(splitHares("")).toBeUndefined();
  });
});

describe("parseRecedingHareline", () => {
  const { events, droppedTypos } = parseRecedingHareline(HARELINE);

  it("keeps numbered meets with venue, socials with a title, and drops cancelled + year-typo rows", () => {
    expect(events.map((e) => [e.date, e.runNumber])).toEqual([
      ["2026-09-11", 78],
      ["2026-08-14", 76],
      ["2026-06-19", undefined],
      ["2026-05-22", 71],
      ["2026-05-08", 70],
      expect.arrayContaining([2]),
      ["2023-09-01", 1],
    ]);
    // #72 "5.6.25" sits a year away from both #71 and #76.
    expect(droppedTypos).toBe(1);
  });

  it("maps fields", () => {
    expect(events[0]).toMatchObject({
      kennelTags: ["mush3"],
      location: "Al Ansab",
      hares: "Omar Sharifa, Prozac man",
      title: undefined,
    });
    expect(events[1]).toMatchObject({ runNumber: 76, location: undefined, hares: undefined });
    expect(events[2]).toMatchObject({ title: "Qurum Public beach", location: undefined });
  });
});

describe("parseDiary", () => {
  it("reads month headings and meet lines", () => {
    const events = parseDiary(DIARY);
    expect(events.map((e) => e.date)).toEqual([
      "2026-09-25", "2026-10-09", "2026-10-23", "2026-11-06", "2026-11-20", "2026-11-27",
    ]);
    expect(events.at(-1)?.title).toBe("50 years of Hashing in Oman event");
    expect(events[0].title).toBeUndefined();
  });
});
