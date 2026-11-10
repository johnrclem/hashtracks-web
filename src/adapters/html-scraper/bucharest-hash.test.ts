import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  BucharestHashAdapter,
  parseBucharestDate,
  parseBucharestDateCell,
  parseBucharestRow,
  parseBucharestSheet,
  parseBucharestTime,
  parseHareCell,
  parseTrailCell,
  repairYear,
  splitHares,
} from "./bucharest-hash";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "../safe-fetch";

// The full live "BHHH Hareline" CSV export (2026-11-10).
const LIVE_CSV = readFileSync(
  path.join(__dirname, "fixtures/bucharest-hash-hareline-2026-11-10.csv.fixture"),
  "utf-8",
);

describe("parseBucharestDate / parseBucharestDateCell", () => {
  it.each([
    ["26/2/2023", "2023-02-26"],
    ["14/2/25", "2025-02-14"],
    ["31.10.2026", "2026-10-31"],
    ["03/10/2026 (Sat)", "2026-10-03"],
    ["25-27/10/2024 Transylvanian Hash", "2024-10-25"],
  ])("%s → %s", (input, expected) => {
    expect(parseBucharestDate(input)).toBe(expected);
  });

  it("rejects undated cells", () => {
    expect(parseBucharestDate("HALLOWEEN HASH WEEKEND!!!!")).toBeNull();
    expect(parseBucharestDate("31/2/2026")).toBeNull();
  });

  it("keeps the run name written after the date, minus a leading weekday (#2845)", () => {
    expect(parseBucharestDateCell("30/09/2023 Oktoberfest Saturday Run")?.theme).toBe("Oktoberfest Saturday Run");
    expect(parseBucharestDateCell("18/11/2023 Saturday Special Graffiti Run")?.theme).toBe("Special Graffiti Run");
    expect(parseBucharestDateCell('10/02/2024 Saturday "V" day')?.theme).toBe('"V" day');
    expect(parseBucharestDateCell("17/5/25 - Homebrew Fest")?.theme).toBe("Homebrew Fest");
    expect(parseBucharestDateCell("18/3/2023 SATURDAY!!!")?.theme).toBeUndefined();
    expect(parseBucharestDateCell("26/09/2026 (Sat)")?.theme).toBeUndefined();
    expect(parseBucharestDateCell("21/04/2024 -")?.theme).toBeUndefined();
  });

  it("reads a day range as the weekend's end date", () => {
    expect(parseBucharestDateCell("25-27/10/2024 Transylvanian Hash")).toEqual({
      date: "2024-10-25",
      endDate: "2024-10-27",
      theme: "Transylvanian Hash",
    });
  });
});

describe("parseBucharestTime", () => {
  it.each([
    ["2:00 PM", "14:00"],
    ["2PM start", "14:00"],
    ["3.00 pm start. Optional on after", "15:00"],
    ["4:00:00 PM Hash Club House", "16:00"],
    ["Gathering at 18:45 hash sharp", "18:45"],
    ["2:00", "14:00"],
    ["5pm start at hop hooligans , 6:30 pm chalk talk", "17:00"],
  ])("%s → %s", (input, expected) => {
    expect(parseBucharestTime(input)).toBe(expected);
  });
  it("ignores text without a time", () => {
    expect(parseBucharestTime("Circle at clubhouse")).toBeUndefined();
    expect(parseBucharestTime("Halloween 2026")).toBeUndefined();
  });
});

describe("splitHares / parseHareCell (#2844)", () => {
  it("splits and sorts", () => {
    expect(splitHares("Ich Been Laiden, PAB, Nice Cans")).toBe("Ich Been Laiden, Nice Cans, PAB");
    expect(splitHares("Can't Stay Up + Toothfairy")).toBe("Can't Stay Up, Toothfairy");
    expect(splitHares("Homo and Heejaa")).toBe("Heejaa, Homo");
    expect(splitHares("")).toBeUndefined();
  });

  it("keeps a name's parenthetical but hoists a (+co-hare)", () => {
    expect(splitHares("Ich Been Laiden (IBL) & Speedy Whorezales")).toBe("Ich Been Laiden (IBL), Speedy Whorezales");
    expect(splitHares("Just Steffi and Just Jan (+IBL)")).toBe("IBL, Just Jan, Just Steffi");
  });

  it("strips Hare: / Co Hare: labels and placeholder marks", () => {
    expect(splitHares("Hare: Just Eli Co Hare: Punk Ass Bitch ")).toBe("Just Eli, Punk Ass Bitch");
    expect(splitHares("??")).toBeUndefined();
  });

  it("drops a trailing date and keeps the note after it as a theme", () => {
    expect(parseHareCell("Roofie and Cocktrails 2/3/2024 - Texas Independence Day run) ")).toEqual({
      hares: "Cocktrails, Roofie",
      theme: "Texas Independence Day run",
      noTrail: false,
    });
  });

  it("reads a one-phrase sentence as a theme with an optional leading hare", () => {
    expect(parseHareCell("Homo special run")).toMatchObject({ hares: "Homo", theme: "Homo special run" });
    expect(parseHareCell("Tooth fairy run at 2pm")).toMatchObject({ hares: "Tooth fairy" });
    expect(parseHareCell("Homo takes us somewhere new! ")).toMatchObject({ hares: "Homo" });
    expect(parseHareCell("Bach party for McDickhead!")).toMatchObject({ hares: null, theme: "Bach party for McDickhead!" });
  });

  it("flags a No trail row (#2846)", () => {
    expect(parseHareCell("No trail ").noTrail).toBe(true);
    expect(parseBucharestRow(["#1170", "31/03/2024", "No trail ", "", ""])).toBeNull();
  });
});

describe("parseTrailCell (#2842)", () => {
  it.each([
    ["A-A Piata Sudului Metro", { trailType: "A to A", venues: ["Piata Sudului Metro"], title: undefined }],
    ["A-Aish Cotroceni, Eroilor Metro 1", { trailType: "A to A", venues: ["Cotroceni", "Eroilor Metro 1"] }],
    ['A-A "lockdown" trail', { trailType: "A to A", venues: [], title: '"lockdown" trail' }],
    ["A- B Run Strada Clucerului 60", { trailType: "A to B", venues: ["Strada Clucerului 60"], title: undefined }],
    ["A to B ", { trailType: "A to B", venues: [], title: undefined }],
    ["End at Anagram ", { venues: [], title: undefined, notes: ["End at Anagram"] }],
    ["Otopeni ", { venues: ["Otopeni"], title: undefined }],
    ['"Cotroceni"', { venues: ["Cotroceni"] }],
    ["Yule / Xmas Hash / Location: Strada Finlanda 13", { venues: ["Strada Finlanda 13"], title: "Yule / Xmas Hash" }],
    ["Shit Stops :)", { venues: [], title: "Shit Stops :)" }],
    ["Roofies Pre Birthday Run A-B starting at iancului metro stop", { venues: ["iancului metro stop"], title: "Roofies Pre Birthday Run" }],
    ["Kilted Run!  Parcul Drumul Taberei Metro", { venues: ["Parcul Drumul Taberei Metro"], title: "Kilted Run!" }],
    ["Worm Moon Parcul Păsărari", { venues: ["Parcul Păsărari"], title: "Worm Moon" }],
    ["Hunter's Moon - Piata Romana", { venues: ["Piata Romana"], title: "Hunter's Moon" }],
    ["Easter- Bunny run? ", { venues: [], title: "Easter- Bunny run?" }],
    ["Ștefan cel Mare @ 2pm ", { venues: ["Ștefan cel Mare"] }],
    ["Titan Park Trail", { venues: ["Titan Park"], title: undefined }],
    ["103-105 Calea Victoriei", { venues: ["103-105 Calea Victoriei"] }],
  ])("%s", (cell, expected) => {
    expect({ title: undefined, ...parseTrailCell(cell) }).toMatchObject(expected);
  });

  it("keeps the theme, venue and end note apart", () => {
    expect(parseTrailCell("Texas Independence Day A to B start at Parcul Timpuri Noi end at Restaurant ")).toMatchObject({
      trailType: "A to B",
      venues: ["Parcul Timpuri Noi"],
      title: "Texas Independence Day",
      notes: ["end at Restaurant"],
    });
    expect(parseTrailCell("A to B, end at restaurant, start at Mihai Bravu - HALT ")).toMatchObject({
      venues: ["Mihai Bravu"],
      title: "HALT",
    });
  });

  it("drops a theme-less run word and cuts the venue at a time", () => {
    const cell = "Sunday trail - Homo will set the run for us this Sunday!\nA-B run starting at the Eroilor Metro station at 2pm!";
    expect(parseTrailCell(cell)).toMatchObject({
      venues: ["Eroilor Metro station"],
      title: "Homo will set the run for us this Sunday!",
    });
  });

  it("reads a meeting place from the Extra column (#2840, #2843)", () => {
    expect(parseTrailCell("Gathering at 18:45 hash sharp at Metro Aurel Vlaicu").venues).toEqual(["Metro Aurel Vlaicu"]);
    expect(parseTrailCell("Gara de Nord 1 (M1) Metro").venues).toEqual(["Gara de Nord 1 (M1) Metro"]);
    expect(parseTrailCell("Start: Piatra Romana, End: Chez IBL").venues).toEqual(["Piatra Romana"]);
    expect(parseTrailCell("“Grădina Zoologică” bus stop").venues).toEqual(["“Grădina Zoologică” bus stop"]);
    expect(parseTrailCell("1 Mai Metro Station Stop C - 2pm start").venues).toEqual(["1 Mai Metro Station Stop C"]);
    expect(parseTrailCell("2 pm / București Băneasa Station").venues).toEqual(["București Băneasa Station"]);
    expect(parseTrailCell("Circle at clubhouse").venues).toEqual([]);
    expect(parseTrailCell("Start time at 2pm. On after at Mumbai food.").venues).toEqual([]);
  });
});

describe("repairYear (#2841)", () => {
  it("moves a year typo next to its neighbouring runs", () => {
    expect(repairYear("2022-05-27", "2023-05-21", "2023-06-11", 6)).toBe("2023-05-27");
    expect(repairYear("2025-06-07", "2026-05-31", "2026-06-14")).toBe("2026-06-07");
  });
  it("refuses when the weekday or the neighbours disagree", () => {
    expect(repairYear("2022-05-27", "2023-05-21", "2023-06-11", 0)).toBeNull(); // cell says Sunday
    expect(repairYear("2025-06-07", "2026-05-31", "2026-06-01")).toBeNull(); // next run is earlier
    expect(repairYear("2022-12-27", "2023-05-21", undefined)).toBeNull(); // > 60 days out
  });
});

describe("parseBucharestSheet (live sheet, 2026-11-10)", () => {
  const { events, skippedOutOfOrder, repairedDates } = parseBucharestSheet(LIVE_CSV);
  const bh3 = (n: number) => events.find((e) => e.kennelTags[0] === "bh3-ro" && e.runNumber === n);
  const fm = (n: number) => events.find((e) => e.kennelTags[0] === "bfmh3-ro" && e.runNumber === n);

  it("keeps every numbered, dated run except No trail", () => {
    expect(events.filter((e) => e.kennelTags[0] === "bh3-ro")).toHaveLength(169); // #1132–#1302 minus #1157, #1170
    expect(events.filter((e) => e.kennelTags[0] === "bfmh3-ro")).toHaveLength(23);
    expect(bh3(1157)).toBeUndefined(); // undated: "HALLOWEEN HASH WEEKEND!!!!"
    expect(bh3(1170)).toBeUndefined();
  });

  it("repairs the two year typos from run order (#2841)", () => {
    expect(skippedOutOfOrder).toBe(0);
    expect(repairedDates).toEqual(["#1141 2022-05-27 → 2023-05-27", "#1276 2025-06-07 → 2026-06-07"]);
    expect(bh3(1141)).toMatchObject({ date: "2023-05-27", title: "Fancy ladies Frau's Birthday Hash", hares: "Frau Funbags, Muffy" });
    expect(bh3(1276)).toMatchObject({ date: "2026-06-07", title: "Almost / Camus Birthday", hares: "Nice Cans" });
  });

  it("splits trail type, venue and theme (#2842)", () => {
    expect(bh3(1145)).toMatchObject({ title: undefined, trailType: "A to A", location: "Hash Club House", startTime: "16:00" });
    expect(bh3(1151)).toMatchObject({ title: undefined, location: null, description: "End at Anagram" });
    expect(bh3(1168)).toMatchObject({ title: undefined, location: "Otopeni" });
    expect(bh3(1179)).toMatchObject({ location: "clubhouse", trailType: "A to A" });
    expect(bh3(1214)).toMatchObject({ title: "Shit Stops :)", location: null });
    expect(bh3(1176)).toMatchObject({ title: "Hash Home Brew Fest", location: null, description: "Short Run followed by BREWS @ clubhouse" });
    expect(bh3(1206)).toMatchObject({ title: "Texas Independence Day", location: "Parcul Timpuri Noi" });
    expect(bh3(1229)).toMatchObject({ title: "Boat Race to Island", location: "Aviatorilor Metro" });
    expect(bh3(1132)).toMatchObject({ location: "Piata Sudului Metro", title: undefined, startTime: "14:00", description: "Circle at clubhouse" });
    expect(bh3(1194)).toMatchObject({ location: "Parcul Casa Alba (Baneasa)", startTime: "14:00" });
  });

  it("takes the meeting place from the Extra column and drops it from the description (#2840, #2843)", () => {
    expect(fm(1)).toMatchObject({ location: "Metro Aurel Vlaicu", startTime: "18:45" });
    expect(fm(3)).toMatchObject({ title: "Pink Moon", location: "Gara de Nord 1 (M1) Metro", description: null });
    expect(fm(5)).toMatchObject({ location: "Piatra Romana" });
    expect(fm(7)).toMatchObject({ location: "Piața Victoriei", description: null });
    expect(fm(10)).toMatchObject({ location: "Piata Iancului Metro" });
    expect(bh3(1205)).toMatchObject({ location: "Piata Victorei", description: null });
    expect(bh3(1234)).toMatchObject({ location: "1 Mai Metro Station Stop C", startTime: "14:00" });
    expect(bh3(1238)).toMatchObject({ location: "Strada Wolfgang Amadeus Mozart 12" });
    expect(bh3(1288)).toMatchObject({ location: "București Băneasa Station" });
  });

  it("uses the Date cell's run name when the trail cell has none (#2845)", () => {
    expect(bh3(1153)?.title).toBe("Oktoberfest Saturday Run");
    expect(bh3(1159)).toMatchObject({ title: "Special Graffiti Run", trailType: "A to B" });
    expect(bh3(1190)).toMatchObject({ title: "Transylvanian Hash", date: "2024-10-25", endDate: "2024-10-27" });
    expect(bh3(1196)).toMatchObject({ title: "Xmas lights and Christmas market trail!", description: "National Day Trail!!" });
  });

  it("cleans hare lists (#2844)", () => {
    expect(bh3(1222)?.hares).toBe("IBL, Just Jan, Just Steffi");
    expect(bh3(1166)).toMatchObject({ hares: "Cocktrails, Roofie", title: "Texas Independence Day run" });
    expect(bh3(1210)?.hares).toBe("Just Eli, Punk Ass Bitch");
    expect(bh3(1138)).toMatchObject({ hares: "Tooth fairy", title: "Never Know with TF..." });
    expect(bh3(1198)).toMatchObject({ hares: null, title: "Bach party for McDickhead!" });
    expect(bh3(1187)?.hares).toBeNull(); // "??"
  });

  it("emits explicit nulls for empty cells, since the sheet is the only source", () => {
    expect(bh3(1300)).toMatchObject({ hares: null, location: null, description: null, trailType: null, title: undefined });
  });
});

describe("BucharestHashAdapter.fetch", () => {
  const source = { url: "https://docs.google.com/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ/export?format=csv&gid=0" } as Source;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("windows the sheet and reports repaired dates", async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(LIVE_CSV, { status: 200 }));
    const result = await new BucharestHashAdapter().fetch(source, { days: 14 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([1298, 22, 1299, 1300, 1301]);
    expect(result.diagnosticContext?.repairedDates).toHaveLength(2);
  });

  it("fails loud on a non-CSV body", async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response("<html>Sign in</html>", { status: 200 }));
    const result = await new BucharestHashAdapter().fetch(source, { days: 60 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("unexpected sheet export");
  });
});
