import {
  parseMotherHashBlock,
  parseMotherHashDate,
  parseMotherHashGps,
  parseMotherHashStartTime,
  splitMotherHashBlocks,
} from "./mother-hash";

const SAMPLE_TEXT = `
Run #: 4250
Date: 06-Apr-2026
Run start: 6pm
Hare: Henry Chia
Run site: Broga
GPS: 2.941198, 101.903586
Type of run: Normal run
Bomoh duty: Siew Kah Soon
Scribe duty: Paul Bergmann
Google maps: https://maps.app.goo.gl/J94Z7Yu1Yjqua1pF6
Waze: https://waze.com/ul/hw282wz7gv

And the next one:

Run #: 4251
Date: 13-Apr-2026
Run start: 6pm
Hare: Siew Kah Soon
Run site: Bukit Tinggi
GPS: tbc
Type of run: Normal run
Bomoh duty: Kanagaratnam (Little Kana)
Scribe duty: Henry Chia
Google maps: tbc
Waze: tbc
`;

describe("parseMotherHashDate", () => {
  it("parses 06-Apr-2026", () => {
    expect(parseMotherHashDate("06-Apr-2026")).toBe("2026-04-06");
  });
  it("parses 6-Apr-26 (2-digit year)", () => {
    expect(parseMotherHashDate("6-Apr-26")).toBe("2026-04-06");
  });
  it("rejects garbage", () => {
    expect(parseMotherHashDate("tbc")).toBeNull();
    expect(parseMotherHashDate("06/Xyz/2026")).toBeNull();
  });
});

describe("parseMotherHashStartTime", () => {
  it("parses 6pm", () => {
    expect(parseMotherHashStartTime("6pm")).toBe("18:00");
  });
  it("parses 6:30 pm", () => {
    expect(parseMotherHashStartTime("6:30 pm")).toBe("18:30");
  });
  it("parses 12am", () => {
    expect(parseMotherHashStartTime("12am")).toBe("00:00");
  });
});

describe("parseMotherHashGps", () => {
  it("parses a valid coord pair", () => {
    expect(parseMotherHashGps("2.941198, 101.903586")).toEqual({
      latitude: 2.941198,
      longitude: 101.903586,
    });
  });
  it("returns empty for tbc", () => {
    expect(parseMotherHashGps("tbc")).toEqual({});
  });
  it("returns empty for undefined", () => {
    expect(parseMotherHashGps(undefined)).toEqual({});
  });
});

describe("splitMotherHashBlocks", () => {
  it("splits on Run #: anchors", () => {
    const blocks = splitMotherHashBlocks(SAMPLE_TEXT);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("4250");
    expect(blocks[1]).toContain("4251");
  });
  it("returns empty array when no anchors", () => {
    expect(splitMotherHashBlocks("nothing here")).toEqual([]);
  });
});

describe("parseMotherHashBlock", () => {
  const blocks = splitMotherHashBlocks(SAMPLE_TEXT);

  it("parses the first run with full fields", () => {
    const event = parseMotherHashBlock(blocks[0], "https://www.motherhash.org");
    expect(event).not.toBeNull();
    expect(event?.runNumber).toBe(4250);
    expect(event?.date).toBe("2026-04-06");
    expect(event?.startTime).toBe("18:00");
    expect(event?.hares).toBe("Henry Chia");
    expect(event?.location).toBe("Broga");
    expect(event?.latitude).toBeCloseTo(2.941198);
    expect(event?.longitude).toBeCloseTo(101.903586);
    expect(event?.locationUrl).toBe("https://maps.app.goo.gl/J94Z7Yu1Yjqua1pF6");
    expect(event?.externalLinks?.[0]).toEqual({
      url: "https://waze.com/ul/hw282wz7gv",
      label: "Waze",
    });
    expect(event?.kennelTags[0]).toBe("motherh3");
    expect(event?.sourceUrl).toBe("https://www.motherhash.org");
  });

  it("parses the second run without coords or maps URL", () => {
    const event = parseMotherHashBlock(blocks[1], "https://www.motherhash.org");
    expect(event).not.toBeNull();
    expect(event?.runNumber).toBe(4251);
    expect(event?.date).toBe("2026-04-13");
    expect(event?.hares).toBe("Siew Kah Soon");
    expect(event?.location).toBe("Bukit Tinggi");
    expect(event?.latitude).toBeUndefined();
    expect(event?.longitude).toBeUndefined();
    expect(event?.locationUrl).toBeUndefined();
    expect(event?.externalLinks).toBeUndefined();
  });

  it("returns null without a run number", () => {
    expect(parseMotherHashBlock("Date: 06-Apr-2026\nHare: nope", "x")).toBeNull();
  });

  it("returns null without a parseable date", () => {
    expect(parseMotherHashBlock("Run #: 4250\nDate: tbc\nHare: x", "y")).toBeNull();
  });
});
