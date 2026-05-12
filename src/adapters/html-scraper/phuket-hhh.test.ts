import { parsePhuketDateCell, parsePhuketRow } from "./phuket-hhh";

const DEFAULT_KENNEL_MAP: Record<string, string> = {
  saturday: "phhh",
  pooying: "phuket-pooying",
  tinmen: "phuket-tinmen",
  ironpussy: "iron-pussy",
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
    expect(event!.kennelTags[0]).toBe("phhh");
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
    expect(event!.kennelTags[0]).toBe("phuket-pooying");
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
    expect(event!.kennelTags[0]).toBe("phuket-tinmen");
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
    expect(event!.kennelTags[0]).toBe("iron-pussy");
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

  // ── #1327: Iron Pussy H3 — multi-row location cell mashing ──
  it("(#1327) splits multi-row Iron Pussy location cell on <br> boundaries", () => {
    // The location cell from the issue body — <br> boundaries pre-converted to \n
    // by the cell extractor.
    const cells = [
      "10 May 2026 @ 16:00 PM",
      "Iron Pussy",
      "265",
      // 3 hares, one per <br>:
      "BUNNYKEN PIS\nLA LASAGNA\nDOMINO CUNT",
      [
        "Southern Phuket",
        "OnOn at Shakers",
        "Theme: Bangkok city: Jeans + Thai traditional dress. There is a prize for the best dress.",
        "Bus: Kamala 13:30 Patong 14:00 Kathu 14:30 Chalong opposite PTT 14:50 Rawai 15:05 Rawai 15:20",
      ].join("\n"),
    ];

    const event = parsePhuketRow(cells, "ironpussy", DEFAULT_KENNEL_MAP, sourceUrl);

    expect(event).not.toBeNull();
    expect(event!.kennelTags[0]).toBe("iron-pussy");
    // Venue only — first <br>-delimited segment.
    expect(event!.location).toBe("Southern Phuket");
    // Description contains the OnOn / Theme / Bus blocks joined by \n.
    expect(event!.description).toContain("OnOn at Shakers");
    expect(event!.description).toContain("Theme: Bangkok city");
    expect(event!.description).toContain("Bus: Kamala 13:30");
    // Description does NOT leak back into location.
    expect(event!.location).not.toContain("OnOn");
    expect(event!.location).not.toContain("Theme");
    expect(event!.location).not.toContain("Bus");
    // 3 hare names separated by `, ` (sorted ascending for stable fingerprint).
    expect(event!.hares).toBe("BUNNYKEN PIS, DOMINO CUNT, LA LASAGNA");
  });

  it("(#1327) single-row hare/venue cells still parse cleanly", () => {
    // Same shape as the existing PHHH Saturday test but routed through the
    // new <br>-split path; confirms no regression on the happy single-line case.
    const cells = [
      "18 Apr 2026 @ 16:00 PM",
      "PHHH",
      "2062",
      "FUNGUS",
      "kathu - Lucky Lek's Chinese family cemetery",
    ];
    const event = parsePhuketRow(cells, "saturday", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.location).toBe("kathu - Lucky Lek's Chinese family cemetery");
    expect(event!.description).toBeUndefined();
    expect(event!.hares).toBe("FUNGUS");
  });
});
