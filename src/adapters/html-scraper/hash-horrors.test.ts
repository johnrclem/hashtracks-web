import {
  parseHashHorrorsRunLine,
  parseHashHorrorsHareline,
  parseHashHorrorsUpcoming,
} from "./hash-horrors";

describe("parseHashHorrorsRunLine", () => {
  it("parses a complete line with run/date/hares/location", () => {
    const out = parseHashHorrorsRunLine("1012 – March 22 – Jacobs Family – Pearl Hill");
    expect(out).toEqual({
      runNumber: 1012,
      monthIdx: 3,
      day: 22,
      hares: "Jacobs Family",
      location: "Pearl Hill",
    });
  });

  it("parses a line with hares but no location", () => {
    const out = parseHashHorrorsRunLine("1015 – May 3 – Baudoux, Guthrie and Poyner Families");
    expect(out).toMatchObject({
      runNumber: 1015,
      hares: "Baudoux, Guthrie and Poyner Families",
      location: undefined,
    });
  });

  it("keeps the full hare list when '&' joins two families (#1253 1016)", () => {
    const out = parseHashHorrorsRunLine("1016 – May 17 – Wade & Child Families");
    expect(out).toMatchObject({
      runNumber: 1016,
      hares: "Wade & Child Families",
      location: undefined,
    });
  });

  it("keeps hyphenated family names intact (#1253 1017)", () => {
    const out = parseHashHorrorsRunLine("1017 – May 31 – Fanjul-Lemaistre Family");
    expect(out).toMatchObject({
      runNumber: 1017,
      hares: "Fanjul-Lemaistre Family",
      location: undefined,
    });
  });

  it("flags BREAK markers with isBreak (#1253 1018)", () => {
    const out = parseHashHorrorsRunLine("1018 – June 14 – Hash Committee BREAK");
    expect(out).toMatchObject({ runNumber: 1018, isBreak: true });
    expect(out?.hares).toBeUndefined();
  });

  it("treats 'Hares Needed' as no hares", () => {
    const out = parseHashHorrorsRunLine("1014 – April 19 – Hares Needed");
    expect(out?.hares).toBeUndefined();
    expect(out?.runNumber).toBe(1014);
  });

  it("treats '*Hares Needed*' (asterisk-wrapped) as no hares (#1253 1019)", () => {
    const out = parseHashHorrorsRunLine("1019 – August 9 – *Hares Needed*");
    expect(out?.hares).toBeUndefined();
    expect(out?.runNumber).toBe(1019);
  });

  it("treats '***Hares Needed***' (triple-asterisk) as no hares", () => {
    const out = parseHashHorrorsRunLine("1020 – August 23 – ***Hares Needed***");
    expect(out?.hares).toBeUndefined();
    expect(out?.runNumber).toBe(1020);
  });

  it("preserves multi-family hare lists with internal em dashes by splitting on the LAST one", () => {
    const out = parseHashHorrorsRunLine(
      "1010 – February 22 – Leo (Fearless Fawn), Suzuki (Gyah Lion! & Wallet Space) and Notfors (Wild Glider) Families – Pearl Hill & Chinatown",
    );
    expect(out?.hares).toBe(
      "Leo (Fearless Fawn), Suzuki (Gyah Lion! & Wallet Space) and Notfors (Wild Glider) Families",
    );
    expect(out?.location).toBe("Pearl Hill & Chinatown");
  });

  it("tolerates ordinal day suffixes used in the pre-2018 archive", () => {
    const out = parseHashHorrorsRunLine("890 – September 23rd – Fire Tornado & Liu Family – Dempsey Road");
    expect(out).toMatchObject({
      runNumber: 890,
      monthIdx: 9,
      day: 23,
      hares: "Fire Tornado & Liu Family",
      location: "Dempsey Road",
    });
  });

  it("parses day-first format with ordinal suffix used in the 2018-2019 rewrite", () => {
    const out = parseHashHorrorsRunLine("952 – 9th April – Merette Family – Bukit Timah MTB Trail");
    expect(out).toMatchObject({
      runNumber: 952,
      monthIdx: 4,
      day: 9,
      hares: "Merette Family",
      location: "Bukit Timah MTB Trail",
    });
  });

  it("parses day-first format with inline year + ordinal", () => {
    const out = parseHashHorrorsRunLine("897 – 13th January – Jonas Family – Old Holland and Blakemore Dr. 2018");
    expect(out).toMatchObject({
      runNumber: 897,
      monthIdx: 1,
      day: 13,
      hares: "Jonas Family",
    });
    // Trailing year inside location text stays in the location field (no
    // procedural strip after the tail).
    expect(out?.location).toContain("Old Holland");
  });

  it("captures parenthetical themed-run titles after the day", () => {
    const out = parseHashHorrorsRunLine(
      "985 – December 15 (Christmas Hash) – Poyner Family – Gillman Barracks",
    );
    expect(out).toMatchObject({
      runNumber: 985,
      monthIdx: 12,
      day: 15,
      theme: "Christmas Hash",
      hares: "Poyner Family",
      location: "Gillman Barracks",
    });
  });

  it("tolerates a missing space before the leading dash (legacy archive rows)", () => {
    const out = parseHashHorrorsRunLine("881 -May 20th – Harvie Family – Seah Im");
    expect(out).toMatchObject({
      runNumber: 881,
      monthIdx: 5,
      day: 20,
      hares: "Harvie Family",
      location: "Seah Im",
    });
  });

  it("returns null on unparseable input", () => {
    expect(parseHashHorrorsRunLine("nothing useful here")).toBeNull();
  });
});

describe("parseHashHorrorsHareline (year-grouped archive)", () => {
  it("walks year sections and emits one event per run line with the correct year", () => {
    const text =
      "2026 1016 – May 17 – Wade Family 1015 – May 3 – Baudoux Family 2025 1006 – December 14 – Dew Family – Bukit Batok";
    const { events } = parseHashHorrorsHareline(text);
    const map = new Map(events.map((e) => [e.runNumber, e]));
    expect(map.get(1016)?.date).toBe("2026-05-17");
    expect(map.get(1015)?.date).toBe("2026-05-03");
    expect(map.get(1006)?.date).toBe("2025-12-14");
    expect(map.get(1006)?.location).toBe("Bukit Batok");
  });

  it("tags every event with kennelTag 'hhhorrors' and default startTime", () => {
    const text = "2026 1016 – May 17 – Wade Family";
    const { events } = parseHashHorrorsHareline(text);
    expect(events[0].kennelTags[0]).toBe("hhhorrors");
    expect(events[0].startTime).toBe("16:30");
  });

  it("ignores run lines that appear before any year heading", () => {
    const text = "1016 – May 17 – Wade Family 2026 1015 – May 3 – Baudoux Family";
    const { events } = parseHashHorrorsHareline(text);
    expect(events.find((e) => e.runNumber === 1016)).toBeUndefined();
    expect(events.find((e) => e.runNumber === 1015)?.date).toBe("2026-05-03");
  });

  it("counts BREAK rows as skippedMarkers, not skippedLines (no parse-error alert)", () => {
    const text = "2026 1018 – June 14 – Hash Committee BREAK 1017 – May 31 – Fanjul-Lemaistre Family";
    const out = parseHashHorrorsHareline(text);
    expect(out.events.find((e) => e.runNumber === 1018)).toBeUndefined();
    expect(out.events.find((e) => e.runNumber === 1017)?.hares).toBe("Fanjul-Lemaistre Family");
    expect(out.skippedLines).toBe(0);
    expect(out.skippedMarkers).toBe(1);
  });

  it("appends themed-run titles to the default kennel title", () => {
    const text = "2015 985 – December 15 (Christmas Hash) – Poyner Family – Gillman Barracks";
    const { events } = parseHashHorrorsHareline(text);
    expect(events[0]).toMatchObject({
      runNumber: 985,
      title: "Hash Horrors 985 — Christmas Hash",
    });
  });
});

describe("parseHashHorrorsUpcoming (no year heading, current-year default)", () => {
  // Live /hareline-2/ snapshot (2026-05-05): exercises every #1253 case in one fixture.
  const liveFixture =
    "1015 – May 3 – Baudoux, Guthrie and Poyner Families " +
    "1016 – May 17 – Wade & Child Families " +
    "1017 – May 31 – Fanjul-Lemaistre Family " +
    "1018 – June 14 – Hash Committee BREAK " +
    "1019 – August 9 – *Hares Needed*";

  it("emits an event per upcoming run with the provided year", () => {
    // Scrape on 2026-05-05 → currentYear=2026, currentMonth=5.
    const { events } = parseHashHorrorsUpcoming(liveFixture, 2026, 5);
    const map = new Map(events.map((e) => [e.runNumber, e]));
    expect(map.get(1015)).toMatchObject({
      date: "2026-05-03",
      hares: "Baudoux, Guthrie and Poyner Families",
    });
    expect(map.get(1016)).toMatchObject({
      date: "2026-05-17",
      hares: "Wade & Child Families",
    });
    expect(map.get(1017)).toMatchObject({
      date: "2026-05-31",
      hares: "Fanjul-Lemaistre Family",
    });
    // BREAK row is intentionally not emitted as a calendar event.
    expect(map.get(1018)).toBeUndefined();
    // *Hares Needed* normalises to no hares but the event still ships.
    expect(map.get(1019)).toMatchObject({ date: "2026-08-09" });
    expect(map.get(1019)?.hares).toBeUndefined();
  });

  it("counts BREAK as a marker, not a parse error", () => {
    const out = parseHashHorrorsUpcoming(liveFixture, 2026, 5);
    expect(out.skippedLines).toBe(0);
    expect(out.skippedMarkers).toBe(1);
  });

  it("rolls the year forward when the calendar date wraps backwards", () => {
    // Hypothetical December-into-January transition (Dec scrape).
    const text = "1020 – December 6 – A Family 1021 – January 3 – B Family";
    const { events } = parseHashHorrorsUpcoming(text, 2026, 12);
    const map = new Map(events.map((e) => [e.runNumber, e]));
    expect(map.get(1020)?.date).toBe("2026-12-06");
    expect(map.get(1021)?.date).toBe("2027-01-03");
  });

  it("keeps rollover detection in sync when a BREAK row falls between calendar months", () => {
    // BREAK in the middle of the sequence must still update prev-month state so a
    // downstream Jan row after a Dec BREAK rolls the year.
    const text =
      "1020 – December 6 – A Family 1021 – December 20 – Committee BREAK 1022 – January 3 – B Family";
    const { events } = parseHashHorrorsUpcoming(text, 2026, 12);
    expect(events.find((e) => e.runNumber === 1021)).toBeUndefined();
    expect(events.find((e) => e.runNumber === 1022)?.date).toBe("2027-01-03");
  });

  it("seeds the first run to next year when its month is earlier than today's month", () => {
    // Late-December scrape with an upcoming page that's already pivoted to
    // January runs — gemini-code-assist review on PR #1536. Without seeding
    // currentMonth, January rows would be dated to the wrong year.
    const text = "1021 – January 3 – B Family 1022 – January 17 – C Family";
    const { events } = parseHashHorrorsUpcoming(text, 2026, 12);
    expect(events.find((e) => e.runNumber === 1021)?.date).toBe("2027-01-03");
    expect(events.find((e) => e.runNumber === 1022)?.date).toBe("2027-01-17");
  });

  it("keeps the first run in the current year when its month is the current month", () => {
    // Same-month scrape — no rollover needed.
    const text = "1015 – May 3 – A Family 1016 – May 17 – B Family";
    const { events } = parseHashHorrorsUpcoming(text, 2026, 5);
    expect(events.find((e) => e.runNumber === 1015)?.date).toBe("2026-05-03");
    expect(events.find((e) => e.runNumber === 1016)?.date).toBe("2026-05-17");
  });
});
