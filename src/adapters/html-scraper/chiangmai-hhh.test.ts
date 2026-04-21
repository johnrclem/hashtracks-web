import { parseChiangMaiLine } from "./chiangmai-hhh";

const SOURCE_URL = "http://www.chiangmaihhh.com/ch3-hareline/";

describe("parseChiangMaiLine", () => {
  it("parses CH3 format: 'Monday 6th April CH3 Run # 1631 Suckit'", () => {
    const event = parseChiangMaiLine(
      "Monday 6th April CH3  Run # 1631 Suckit",
      "ch3-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-06");
    expect(event!.kennelTag).toBe("ch3-cm");
    expect(event!.runNumber).toBe(1631);
    expect(event!.hares).toBe("Suckit");
  });

  it("parses CH4 format with en-dash: 'Thursday 2 April – CH4 Run # 1098 – ABB & Anal Vice'", () => {
    const event = parseChiangMaiLine(
      "Thursday 2 April \u2013 CH4 Run # 1098 \u2013  ABB & Anal Vice",
      "ch4-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-02");
    expect(event!.runNumber).toBe(1098);
    expect(event!.hares).toContain("ABB");
  });

  it("parses CSH3 format: 'Saturday April 4 – CSH3 – Run #1805 – Head Hacker'", () => {
    const event = parseChiangMaiLine(
      "Saturday April 4 \u2013 CSH3 \u2013 Run #1805 \u2013 Head Hacker",
      "csh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-04");
    expect(event!.runNumber).toBe(1805);
    expect(event!.hares).toBe("Head Hacker");
  });

  it("parses CGH3 format: 'Monday 6 April – CGH3 Run #255 – Emma Royde'", () => {
    const event = parseChiangMaiLine(
      "Monday 6 April \u2013 CGH3 Run #255 \u2013 Emma Royde",
      "cgh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-06");
    expect(event!.runNumber).toBe(255);
    expect(event!.hares).toBe("Emma Royde");
  });

  it("strips CGH3 'Hare.' label prefix (#814)", () => {
    const event = parseChiangMaiLine(
      "Monday 20 April \u2013 CGH3 Run #256 \u2013 Hare. HRA",
      "cgh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("HRA");
  });

  it("parses CBH3 format: 'Sunday 26 April – CBH3 – Run # 281 – Misfortune and Bare Bum'", () => {
    const event = parseChiangMaiLine(
      "Sunday 26 April \u2013 CBH3 \u2013 Run # 281 \u2013 Misfortune and Bare Bum",
      "cbh3-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-26");
    expect(event!.runNumber).toBe(281);
    expect(event!.hares).toContain("Bare Bum");
    expect(event!.hares).toContain("Misfortune");
  });

  it("skips HARE NEEDED entries", () => {
    const event = parseChiangMaiLine(
      "Monday 18 May \u2013 CGH3 Run #258 \u2013 HARE NEEDED",
      "cgh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
  });

  it("skips lines without Run keyword", () => {
    const event = parseChiangMaiLine("April 2026", "ch3-cm", SOURCE_URL);
    expect(event).toBeNull();
  });

  it("skips lines with placeholder run numbers like 16xx", () => {
    // The regex won't match "16xx" since it requires digits
    const event = parseChiangMaiLine(
      "Monday 1st June CH3  Run # 16xx Hare Needed",
      "ch3-cm",
      SOURCE_URL,
    );
    expect(event).toBeNull();
  });

  it("handles multi-hare with 'and'", () => {
    const event = parseChiangMaiLine(
      "Saturday May 2 \u2013 CSH3 \u2013 Run #1810 \u2013 Jersey Whore and Va Jay Jay Boom",
      "csh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toContain("Jersey Whore");
    expect(event!.hares).toContain("Va Jay Jay Boom");
  });

  it("handles multi-hare with '&'", () => {
    const event = parseChiangMaiLine(
      "Thursday 14 May \u2013 CH4 Run # 1104 \u2013 Anal Vice & ABB",
      "ch4-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toContain("ABB");
    expect(event!.hares).toContain("Anal Vice");
  });
});
