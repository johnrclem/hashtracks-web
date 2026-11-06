import { readFileSync } from "node:fs";
import path from "node:path";
import { LAOS_PAGES, announcementLines, parseLaosDate, parseLaosPage } from "./laos-hash";

// The three live hashlaos.com pages via WP REST (2026-11-05), contact lines removed.
const PAGES: Record<string, { modified: string; rendered: string }> = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/laos-hash-pages-2026-11-05.json.fixture"), "utf-8"),
);
const spec = (id: number) => LAOS_PAGES.find((p) => p.id === id)!;
const parse = (id: number) => parseLaosPage(PAGES[id].rendered, new Date(`${PAGES[id].modified}Z`), spec(id));

describe("parseLaosDate", () => {
  const modified = new Date("2026-11-05T03:00:00Z");
  it.each([
    ["This Monday, the 2nd of November, A2B 5:30", "2026-11-02"],
    ["Saturday 07 #, November, Hash-run no. 1569", "2026-11-07"],
    ["November (no 199 ) is postponed ! / shifted to the o5# of December", "2026-12-05"],
  ])("%s → %s", (text, expected) => {
    expect(parseLaosDate(text, modified)).toBe(expected);
  });
  it("rolls into the next year near New Year", () => {
    expect(parseLaosDate("Monday the 4th of January", new Date("2026-12-30T00:00:00Z"))).toBe("2027-01-04");
  });
  it("returns null with no day+month", () => {
    expect(parseLaosDate("No hash this week", modified)).toBeNull();
  });
});

describe("announcementLines", () => {
  it("stops before the fee/FUI/contact blurb", () => {
    const lines = announcementLines(PAGES[22].rendered);
    expect(lines[0]).toContain("Hash-run no. 1569");
    expect(lines.some((l) => l.startsWith("FUI:"))).toBe(false);
  });
});

describe("parseLaosPage", () => {
  it("VH3 Monday page", () => {
    expect(parse(78)).toEqual({
      date: "2026-11-02",
      kennelTags: ["vh3-la"],
      runNumber: 2514,
      startTime: "17:30",
      hares: "Happy Dancer",
      location: "Ban Lao Beer Garden",
      locationUrl: "https://goo.gl/maps/QcLCFDaSSiLbcCx56",
      description: "A to B: Ban Lao Beer Garden → Sticky Fingers",
      sourceUrl: "https://hashlaos.com/monday-map/",
    });
  });
  it("VBH3 Saturday bush page (venue not decided yet)", () => {
    expect(parse(22)).toMatchObject({
      date: "2026-11-07",
      kennelTags: ["vbh3-la"],
      runNumber: 1569,
      startTime: "16:30",
      hares: "NAKED",
      location: undefined,
    });
  });
  it("Bike hash page (postponed to December)", () => {
    expect(parse(26)).toMatchObject({
      date: "2026-12-05",
      kennelTags: ["vbikeh3-la"],
      runNumber: 199,
      startTime: "09:30",
      hares: "SPUD",
      location: "JOMA Cafe near the Nam Phu Fountain",
    });
  });
  it("returns null when no date is stated", () => {
    expect(parseLaosPage("<p>No hash this week, see you next Monday</p>", new Date(), spec(78))).toBeNull();
  });
});
