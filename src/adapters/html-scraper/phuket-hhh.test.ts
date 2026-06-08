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
    // #1410: source-faithful title from name + run columns, no synthesized "Trail".
    expect(event!.title).toBe("PHHH 2062");
  });

  // ── #1410: source-faithful title (kennel name + run number, no "Trail" word) ──
  it.each([
    { rowClass: "ironpussy", name: "Iron Pussy", run: "265", expected: "Iron Pussy 265" },
    { rowClass: "tinmen", name: "Tinmen", run: "451", expected: "Tinmen 451" },
    { rowClass: "pooying", name: "Pooying", run: "414", expected: "Pooying 414" },
  ])(
    "(#1410) emits '$expected' title without a synthesized Trail suffix",
    ({ rowClass, name, run, expected }) => {
      const cells = ["13 May 2026 @ 16:00 PM", name, run, "", ""];
      const event = parsePhuketRow(cells, rowClass, DEFAULT_KENNEL_MAP, sourceUrl);
      expect(event!.title).toBe(expected);
    },
  );

  it("(#1410) leaves title undefined when the name cell is blank", () => {
    const cells = ["13 May 2026 @ 16:00 PM", "", "265", "", ""];
    const event = parsePhuketRow(cells, "ironpussy", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event!.title).toBeUndefined();
  });

  // ── #1411: recruitment CTA in the HARES column → explicit clear (null) ──
  // null (not undefined) so the merge pipeline OVERWRITES stale haresText
  // instead of preserving it (merge.ts: undefined = preserve, null = clear).
  it.each([
    "Want to hare? Contact the Runmaster",
    "want to hare",
    "Hare needed",
    "Looking for a hare",
  ])("(#1411) maps CTA-only hares cell %s → null (explicit clear)", (cta) => {
    const cells = ["10 May 2026 @ 16:00 PM", "Iron Pussy", "265", cta, ""];
    const event = parsePhuketRow(cells, "ironpussy", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event!.hares).toBeNull();
  });

  it("(#1411) a genuinely blank hares cell stays undefined (preserve, not clear)", () => {
    const cells = ["10 May 2026 @ 16:00 PM", "Iron Pussy", "265", "", ""];
    const event = parsePhuketRow(cells, "ironpussy", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event!.hares).toBeUndefined();
  });

  it.each([
    { cell: "FUNGUS, LUCKY LEK, B.C.", expected: "B.C., FUNGUS, LUCKY LEK" },
    { cell: "PAPER", expected: "PAPER" },
    { cell: "Slippery When Wet", expected: "Slippery When Wet" },
    { cell: "BUNNYKEN PIS\nLA LASAGNA", expected: "BUNNYKEN PIS, LA LASAGNA" },
  ])("(#1411) keeps real hare names $cell", ({ cell, expected }) => {
    const cells = ["10 May 2026 @ 16:00 PM", "Iron Pussy", "265", cell, ""];
    const event = parsePhuketRow(cells, "ironpussy", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event!.hares).toBe(expected);
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

  it("handles TBC location (#1240 — explicit clear via cleanLocationName)", () => {
    const cells = [
      "25 Apr 2026 @ 16:00 PM",
      "PHHH",
      "2063",
      "SWOLLEN COLON",
      "Location: Tbc",
    ];
    const event = parsePhuketRow(cells, "saturday", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    // null (not undefined) = explicit clear, so a previously-stored venue is
    // overwritten when the source downgrades to "Location: Tbc".
    expect(event!.location).toBeNull();
  });

  // ── #1240: live run 453/454 shapes (verified 2026-06-08) ──
  it("(#1240) Tin Men run 453: first-line venue + delimited hares; CTA/bus → description", () => {
    // Verbatim from www.phuket-hhh.com/hareline.php (run 453), <br> → \n.
    const cells = [
      "10 Jun 2026 @ 15:00 PM",
      "Tinmen",
      "453",
      "WILMA\nFUNGUS\nINVISIBLE MAN\nTHUMB IN THE BUM (VH)",
      [
        "Patong area",
        "OnOn: Round Tower (Wilma’s), Patong",
        "More information and time schedules on: https://phuketh3.com/index.php",
        "Bus: Bangtao 14:00  Kamala 14:30  Patong expat hotel 15:00",
      ].join("\n"),
    ];
    const event = parsePhuketRow(cells, "tinmen", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.kennelTags[0]).toBe("phuket-tinmen");
    // Venue is just the first segment — no on-on/CTA/bus leakage.
    expect(event!.location).toBe("Patong area");
    expect(event!.location).not.toContain("OnOn");
    expect(event!.location).not.toContain("Bus");
    // Hares are delimited (sorted ascending), not run together.
    expect(event!.hares).toBe("FUNGUS, INVISIBLE MAN, THUMB IN THE BUM (VH), WILMA");
    expect(event!.description).toContain("OnOn: Round Tower");
  });

  it("(#1240) Tin Men run 454: 'Location: Tbc' clears; two hares stay delimited", () => {
    const cells = [
      "01 Jul 2026 @ 15:00 PM",
      "Tinmen",
      "454",
      "B.C.\nBUTT-CYCLE",
      "Location: Tbc",
    ];
    const event = parsePhuketRow(cells, "tinmen", DEFAULT_KENNEL_MAP, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.location).toBeNull();
    expect(event!.hares).toBe("B.C., BUTT-CYCLE");
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
