import { parsePhuketDateCell, parsePhuketRow } from "./phuket-hhh";

const DEFAULT_KENNEL_MAP: Record<string, string> = {
  saturday: "phhh",
  pooying: "phuket-pooying",
  tinmen: "phuket-tinmen",
  ironpussy: "iron-pussy",
  bike: "phuket-bike",
  kamalakoma: "kamala-koma",
};

describe("parsePhuketDateCell", () => {
  it("parses date and 12-hour time with PM", () => {
    const result = parsePhuketDateCell("12 Apr 2026 @ 15:00 PM");
    expect(result.date).toBe("2026-04-12");
    expect(result.startTime).toBe("15:00");
  });

  it("parses date and 4 PM time", () => {
    const result = parsePhuketDateCell("18 Apr 2026 @ 16:00 PM");
    expect(result.date).toBe("2026-04-18");
    expect(result.startTime).toBe("16:00");
  });

  it("returns null for empty string", () => {
    const result = parsePhuketDateCell("");
    expect(result.date).toBeNull();
    expect(result.startTime).toBeNull();
  });
});

describe("parsePhuketRow", () => {
  const sourceUrl = "http://www.phuket-hhh.com/hareline.php";

  it("parses a PHHH Saturday row", () => {
    const cells = [
      "18 Apr 2026 @ 16:00 PM",
      "PHHH",
      "2062",
      "FUNGUS, LUCKY LEK, B.C.",
      "kathu - Lucky Lek's Chinese family cemetery",
    ];
    const event = parsePhuketRow(cells, "saturday", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-18");
    expect(event!.kennelTag).toBe("phhh");
    expect(event!.runNumber).toBe(2062);
    expect(event!.startTime).toBe("16:00");
    expect(event!.hares).toContain("B.C.");
    expect(event!.hares).toContain("FUNGUS");
  });

  it("parses a Pooying row", () => {
    const cells = [
      "12 Apr 2026 @ 15:00 PM",
      "Pooying",
      "414",
      "PAPER",
      "Kathu - Below Papers House",
    ];
    const event = parsePhuketRow(cells, "pooying", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.kennelTag).toBe("phuket-pooying");
    expect(event!.runNumber).toBe(414);
    expect(event!.startTime).toBe("15:00");
  });

  it("parses a Tinmen row", () => {
    const cells = [
      "06 May 2026 @ 15:00 PM",
      "Tinmen",
      "451",
      "",
      "",
    ];
    const event = parsePhuketRow(cells, "tinmen", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.kennelTag).toBe("phuket-tinmen");
    expect(event!.date).toBe("2026-05-06");
  });

  it("parses an Iron Pussy row", () => {
    const cells = [
      "13 May 2026 @ 16:00 PM",
      "Iron Pussy",
      "264",
      "",
      "",
    ];
    const event = parsePhuketRow(cells, "ironpussy", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.kennelTag).toBe("iron-pussy");
  });

  it("skips unknown kennel class", () => {
    const cells = ["12 Apr 2026 @ 15:00 PM", "Unknown", "1", "", ""];
    const event = parsePhuketRow(cells, "unknown", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).toBeNull();
  });

  it("skips row with unparseable date", () => {
    const cells = ["No date here", "PHHH", "2062", "", ""];
    const event = parsePhuketRow(cells, "saturday", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).toBeNull();
  });

  it("handles TBC location", () => {
    const cells = [
      "25 Apr 2026 @ 16:00 PM",
      "PHHH",
      "2063",
      "SWOLLEN COLON",
      "Location: Tbc",
    ];
    const event = parsePhuketRow(cells, "saturday", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
  });
});
