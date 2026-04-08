import { parseHashHorrorsRunLine, parseHashHorrorsHareline } from "./hash-horrors";

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

  it("treats 'Hares Needed' as no hares", () => {
    const out = parseHashHorrorsRunLine("1014 – April 19 – Hares Needed");
    expect(out?.hares).toBeUndefined();
    expect(out?.runNumber).toBe(1014);
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

  it("returns null on unparseable input", () => {
    expect(parseHashHorrorsRunLine("nothing useful here")).toBeNull();
  });
});

describe("parseHashHorrorsHareline", () => {
  it("walks year sections and emits one event per run line with the correct year", () => {
    const text = "2026 1016 – May 17 – Wade Family 1015 – May 3 – Baudoux Family 2025 1006 – December 14 – Dew Family – Bukit Batok";
    const events = parseHashHorrorsHareline(text).events;
    expect(events.length).toBeGreaterThanOrEqual(3);
    const map = new Map(events.map((e) => [e.runNumber, e]));
    expect(map.get(1016)?.date).toBe("2026-05-17");
    expect(map.get(1015)?.date).toBe("2026-05-03");
    expect(map.get(1006)?.date).toBe("2025-12-14");
    expect(map.get(1006)?.location).toBe("Bukit Batok");
  });

  it("tags every event with kennelTag 'hhhorrors' and default startTime", () => {
    const text = "2026 1016 – May 17 – Wade Family";
    const events = parseHashHorrorsHareline(text).events;
    expect(events[0].kennelTag).toBe("hhhorrors");
    expect(events[0].startTime).toBe("16:30");
  });

  it("ignores run lines that appear before any year heading", () => {
    const text = "1016 – May 17 – Wade Family 2026 1015 – May 3 – Baudoux Family";
    const events = parseHashHorrorsHareline(text).events;
    expect(events.find((e) => e.runNumber === 1016)).toBeUndefined();
    expect(events.find((e) => e.runNumber === 1015)?.date).toBe("2026-05-03");
  });
});
