import { parseCrh3Title, parseCrh3Body, parseCrh3Post } from "./crh3";

describe("parseCrh3Title", () => {
  it("parses run number and date from title with date", () => {
    const result = parseCrh3Title(
      "CRH3 #218 Saturday 15th February 2025",
      "2025-02-01T00:00:00",
    );
    expect(result.runNumber).toBe(218);
    expect(result.date).toBe("2025-02-15");
  });

  it("parses run number from compact title (no date)", () => {
    const result = parseCrh3Title(
      "CRH3#220",
      "2025-04-01T00:00:00",
    );
    expect(result.runNumber).toBe(220);
    // No date parseable from title alone
    expect(result.date).toBeUndefined();
  });

  it("parses run number from title with event name", () => {
    const result = parseCrh3Title(
      "CRH3#217 HAPPY NEW YEAR RUN",
      "2025-01-01T00:00:00",
    );
    expect(result.runNumber).toBe(217);
  });

  it("infers year from publish date with timezone offset (utcRef regression)", () => {
    // Real Blogger publish dates carry an offset like "+07:00".
    // An earlier utcRef helper appended "Z" unconditionally, producing
    // an Invalid Date; chrono then fell back to the system clock and
    // forwardDate=true mis-resolved every year-less title to null.
    // This test pins the format so future helper changes can't reintroduce
    // the regression.
    const result = parseCrh3Title(
      "CRH3#220 Saturday 26 March",
      "2026-03-22T18:07:00+07:00",
    );
    expect(result.runNumber).toBe(220);
    expect(result.date).toBe("2026-03-26");
  });
});

describe("parseCrh3Body", () => {
  it("extracts hare and location from labeled body text", () => {
    const body = `
<p>Hare: Iron Chef</p>
<p>Location: Mae Fah Luang Garden</p>
<p>Time to assemble: 3:30 PM</p>
`;
    const result = parseCrh3Body(body, "2025-02-01T00:00:00");
    expect(result.hares).toBe("Iron Chef");
    expect(result.location).toBe("Mae Fah Luang Garden");
  });

  it("returns undefined for freeform text without labels", () => {
    const body = "<p>Come join us for a great hash!</p>";
    const result = parseCrh3Body(body, "2025-02-01T00:00:00");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });
});

describe("parseCrh3Post", () => {
  it("parses a complete post with date in title", () => {
    const result = parseCrh3Post({
      title: "CRH3 #218 Saturday 15th February 2025",
      content: "<p>Hare: Iron Chef</p><p>Location: Mae Fah Luang</p>",
      url: "https://chiangraihhh.blogspot.com/2025/02/crh3-218.html",
      published: "2025-02-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.date).toBe("2025-02-15");
      expect(result.event.kennelTags[0]).toBe("crh3");
      expect(result.event.runNumber).toBe(218);
      expect(result.event.hares).toBe("Iron Chef");
      expect(result.event.location).toBe("Mae Fah Luang");
      expect(result.event.startTime).toBe("15:00");
    }
  });

  it("filters non-run posts", () => {
    const result = parseCrh3Post({
      title: "Happy Birthday to our GM!",
      content: "<p>Cheers!</p>",
      url: "https://chiangraihhh.blogspot.com/2025/01/happy.html",
      published: "2025-01-01T00:00:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-run-post");
  });

  it("returns no-date when no date can be parsed", () => {
    const result = parseCrh3Post({
      title: "CRH3#220",
      content: "<p>Details to follow...</p>",
      url: "https://chiangraihhh.blogspot.com/2025/04/crh3-220.html",
      published: "2025-04-01T00:00:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-date");
  });
});
