import { parseCah3Title, parseCah3Body, parseCah3Post } from "./cah3";

describe("parseCah3Title", () => {
  it("parses run number and date from a typical title", () => {
    const result = parseCah3Title(
      "Run 533 Saturday 8th March 2025",
      "2025-03-01T00:00:00",
    );
    expect(result.runNumber).toBe(533);
    expect(result.date).toBe("2025-03-08");
  });

  it("parses colon-separated title", () => {
    const result = parseCah3Title(
      "Run 534: Songkran Outstation APR 10 & 11",
      "2025-04-01T00:00:00",
    );
    expect(result.runNumber).toBe(534);
    // Should at least get the first date
    expect(result.date).toBe("2025-04-10");
  });

  it("parses title with month name and year", () => {
    const result = parseCah3Title(
      "Run 532 Saturday February 8 2025",
      "2025-01-15T00:00:00",
    );
    expect(result.runNumber).toBe(532);
    expect(result.date).toBe("2025-02-08");
  });

  it("returns undefined date when no date in title", () => {
    const result = parseCah3Title(
      "Run 530 Special Event",
      "2025-01-01T00:00:00",
    );
    expect(result.runNumber).toBe(530);
    expect(result.date).toBeUndefined();
  });
});

describe("parseCah3Body", () => {
  it("extracts labeled fields from body HTML", () => {
    const body = `
<p>Hare: Rusty Nail</p>
<p>Location: Cha-Am Beach Park</p>
<p>Time: 4:00 PM</p>
`;
    const result = parseCah3Body(body);
    expect(result.hares).toBe("Rusty Nail");
    expect(result.location).toBe("Cha-Am Beach Park");
    expect(result.startTime).toBe("16:00");
  });

  it("returns undefined for missing fields", () => {
    const body = "<p>Just some random post content</p>";
    const result = parseCah3Body(body);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.startTime).toBeUndefined();
  });
});

describe("parseCah3Post", () => {
  it("parses a complete post", () => {
    const result = parseCah3Post({
      title: "Run 533 Saturday 8th March 2025",
      content: "<p>Hare: Rusty Nail</p><p>Location: Cha-Am Beach</p>",
      url: "https://cah3.net/?p=123",
      date: "2025-03-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.date).toBe("2025-03-08");
      expect(result.event.kennelTag).toBe("cah3");
      expect(result.event.runNumber).toBe(533);
      expect(result.event.hares).toBe("Rusty Nail");
      expect(result.event.location).toBe("Cha-Am Beach");
      expect(result.event.sourceUrl).toBe("https://cah3.net/?p=123");
    }
  });

  it("filters non-run posts", () => {
    const result = parseCah3Post({
      title: "Welcome to Cha-Am H3",
      content: "<p>About us</p>",
      url: "https://cah3.net/?p=1",
      date: "2025-01-01T00:00:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-run-post");
  });

  it("returns no-date when title and body both lack a parseable date", () => {
    const result = parseCah3Post({
      title: "Run 533: Saurkrap's Cat Sanctuary Run",
      content: "<p>Some directions without a date</p>",
      url: "https://cah3.net/?p=456",
      date: "2026-03-16T12:40:57",
    });
    // Do NOT fall back to the WordPress publish date — it's the
    // announcement date and may be days before the actual Saturday run.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-date");
  });

  it("uses default start time when body has no time", () => {
    const result = parseCah3Post({
      title: "Run 533 Saturday 8th March 2025",
      content: "<p>Hare: Rusty Nail</p>",
      url: "https://cah3.net/?p=123",
      date: "2025-03-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.event.startTime).toBe("16:00");
  });
});
