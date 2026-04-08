import { parseLionCityTitle, parseLionCityBody, buildLionCityEvent } from "./lion-city-h3";

describe("parseLionCityTitle", () => {
  it("parses run number with comma", () => {
    expect(parseLionCityTitle("Hash Run #2,193")).toEqual({
      runNumber: 2193,
      title: "Hash Run #2193",
    });
  });
  it("parses run number without comma", () => {
    expect(parseLionCityTitle("Hash Run #589")).toEqual({
      runNumber: 589,
      title: "Hash Run #589",
    });
  });
  it("returns title-only when no run number", () => {
    expect(parseLionCityTitle("Lion City HHH AGM 2026")).toEqual({
      title: "Lion City HHH AGM 2026",
    });
  });
  it("decodes HTML entities", () => {
    expect(parseLionCityTitle("Hash Run #2,193 &#8211; Special")).toEqual({
      runNumber: 2193,
      title: "Hash Run #2193",
    });
  });
});

describe("parseLionCityBody", () => {
  const ref = new Date("2026-03-31T00:00:00Z");

  it("parses date / time / hare / location / on-on with emoji prefixes", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp. "Thank God it is Good Friday"
🐰 Hare(s): Lap Dog, Big Head, Cherry Picker
🏃‍♂️ Map – Run Location: Swiss Club Rd, dead end old Turf City
🚇 Nearest MRT: King Albert Park
🚌 Bus: 67, 71, 74, 151
🍻 Map – On On: Red Lantern, opposite</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.date).toBe("2026-04-03");
    expect(out.startTime).toBe("18:00");
    expect(out.hares).toBe("Lap Dog, Big Head, Cherry Picker");
    expect(out.location).toBe("Swiss Club Rd, dead end old Turf City");
    expect(out.onAfter).toBe("Red Lantern, opposite");
  });

  it("handles 'O n On' with extra spaces", () => {
    const html = `<p>Date: Friday, 10 April, 6 pm sharp.
🍻 Map – O n On: Beer place</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.onAfter).toBe("Beer place");
  });

  it("infers next year for December → January wraparound", () => {
    const ref = new Date("2025-12-28T00:00:00Z");
    const html = "<p>Date: Friday, 02 January, 6 pm sharp.</p>";
    const out = parseLionCityBody(html, ref);
    expect(out.date).toBe("2026-01-02");
  });
});

describe("buildLionCityEvent", () => {
  it("composes a RawEventData from a typical post", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp.
Hare(s): Lap Dog
Map – Run Location: Somewhere
Map – On On: A bar</p>`;
    const event = buildLionCityEvent(
      "Hash Run #2,193",
      html,
      "https://lioncityhhh.com/2026/03/31/hash-run-2193/",
      new Date("2026-03-31T00:00:00Z"),
    );
    expect(event).toMatchObject({
      date: "2026-04-03",
      startTime: "18:00",
      kennelTag: "lch3",
      runNumber: 2193,
      title: "Hash Run #2193",
      hares: "Lap Dog",
      location: "Somewhere",
      description: "On-On: A bar",
      sourceUrl: "https://lioncityhhh.com/2026/03/31/hash-run-2193/",
    });
  });

  it("returns null when body has no parseable date", () => {
    const event = buildLionCityEvent("Hash Run #999", "<p>No date here</p>", "https://x", new Date());
    expect(event).toBeNull();
  });

  it("leaves description undefined when there is no on-on block", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp.
Hare(s): Lap Dog
Map – Run Location: Somewhere</p>`;
    const event = buildLionCityEvent(
      "Hash Run #2,193",
      html,
      "https://x",
      new Date("2026-03-31T00:00:00Z"),
    );
    expect(event?.description).toBeUndefined();
  });
});
