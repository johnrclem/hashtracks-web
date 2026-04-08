import { parseKampongNextRun } from "./kampong-h3";

describe("parseKampongNextRun", () => {
  it("parses the canonical Next Run block from kampong.hash.org.sg", () => {
    const text = `Next Run Run 296 Date: Saturday, 18 th April 2026 Run starts 5:30PM Hare: Fawlty Towers Run site: T.B.A. The Kampong HHH runs once a month`;
    const out = parseKampongNextRun(text);
    expect(out.runNumber).toBe(296);
    expect(out.date).toBe("2026-04-18");
    expect(out.startTime).toBe("17:30");
    expect(out.hares).toBe("Fawlty Towers");
    expect(out.location).toBeUndefined(); // T.B.A. is filtered
  });

  it("captures a real run site when not TBA", () => {
    const text = `Next Run Run 297 Date: Saturday, 16 May 2026 Run starts 5:30PM Hare: Sloppy Joe Run site: Bukit Timah Nature Reserve The Kampong HHH`;
    const out = parseKampongNextRun(text);
    expect(out.location).toBe("Bukit Timah Nature Reserve");
  });

  it("handles times without colon (e.g. 5PM)", () => {
    const text = `Next Run Run 298 Date: Saturday, 20 June 2026 Run starts 5PM Hare: Streaker`;
    const out = parseKampongNextRun(text);
    expect(out.startTime).toBe("17:00");
  });

  it("handles ordinal suffixes on day numbers", () => {
    expect(parseKampongNextRun("Date: Saturday, 1st January 2027").date).toBe("2027-01-01");
    expect(parseKampongNextRun("Date: Saturday, 22nd March 2026").date).toBe("2026-03-22");
    expect(parseKampongNextRun("Date: Saturday, 23rd April 2026").date).toBe("2026-04-23");
  });

  it("returns empty fields when text is unparseable", () => {
    const out = parseKampongNextRun("Just some random text without any structured fields");
    expect(out.runNumber).toBeUndefined();
    expect(out.date).toBeUndefined();
    expect(out.startTime).toBeUndefined();
  });
});
