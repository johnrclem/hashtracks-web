import { parseCrh3Title, parseCrh3Body, parseCrh3Post, parseStartTime } from "./crh3";

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
    const result = parseCrh3Title(
      "CRH3#220 Saturday 26 March",
      "2026-03-22T18:07:00+07:00",
    );
    expect(result.runNumber).toBe(220);
    expect(result.date).toBe("2026-03-26");
  });
});

describe("parseStartTime", () => {
  it("returns the run-start time when both arrival and start are present", () => {
    expect(parseStartTime("3 for 3:30 pm start")).toBe("15:30");
  });

  it("handles dotted time format", () => {
    expect(parseStartTime("3.30 for 4.00 pm")).toBe("16:00");
  });

  it("handles single time", () => {
    expect(parseStartTime("4:00 PM")).toBe("16:00");
  });

  it("returns undefined for unparseable input", () => {
    expect(parseStartTime("ASAP")).toBeUndefined();
    expect(parseStartTime(undefined)).toBeUndefined();
  });

  it("handles am times", () => {
    expect(parseStartTime("11 am")).toBe("11:00");
    expect(parseStartTime("12 am")).toBe("00:00");
  });
});

describe("parseCrh3Body", () => {
  // Real body from CRH3 #220 (live-verified 2026-04-30)
  const realBody = `🏃‍♂️Next Run  #220🏃‍♀️
Saturday 28th Mar 26 (This coming Saturday)
▶️Hare: Pussy Rainbow
A to A flat trail - no hazards.
📍Starting Location - https://www.google.com/...
🚗🛵 Parking - Plenty at Tawanwa Restaurant.
🕞EARLY TIME - 3 for 3:30 pm start.
💲Price - All attendees 100 Baht.`;

  it("extracts hares, location, startTime, cost, description from real CRH3 body", () => {
    const result = parseCrh3Body(realBody, "2026-03-22T18:07:00+07:00");
    expect(result.hares).toBe("Pussy Rainbow");
    expect(result.location).toBe("https://www.google.com/...");
    expect(result.startTime).toBe("15:30");
    expect(result.cost).toBe("All attendees 100 Baht.");
    expect(result.description).toBe("A to A flat trail - no hazards.");
  });

  it("prefers body's Saturday-cadence date over the title's day-of-month (#1117)", () => {
    // Title says March 26 (Thursday) — body says March 28 (Saturday). Body wins.
    const result = parseCrh3Body(realBody, "2026-03-22T18:07:00+07:00");
    expect(result.date).toBe("2026-03-28");
  });

  it("returns undefined for freeform text without labels", () => {
    const body = "<p>Come join us for a great hash!</p>";
    const result = parseCrh3Body(body, "2025-02-01T00:00:00");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.startTime).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });

  it("handles plural Hares: with multi-word value", () => {
    const body = "▶️Hares: Defunctive Cuntstable and sons\n📍Starting Location - test";
    const result = parseCrh3Body(body, "2025-02-01T00:00:00");
    expect(result.hares).toBe("Defunctive Cuntstable and sons");
  });
});

describe("parseCrh3Post", () => {
  it("uses the post title verbatim as Event.title (#1119)", () => {
    const result = parseCrh3Post({
      title: "CRH3 #218 Saturday 15th February 2025",
      content: "<p>Hare: Iron Chef</p><p>Location: Mae Fah Luang</p>",
      url: "https://chiangraihhh.blogspot.com/2025/02/crh3-218.html",
      published: "2025-02-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.title).toBe("CRH3 #218 Saturday 15th February 2025");
      expect(result.event.runNumber).toBe(218);
    }
  });

  it("populates description, cost, startTime from emoji-bulleted body (#1118)", () => {
    const result = parseCrh3Post({
      title: "CRH3#220 Saturday 26 March",
      content: `🏃‍♂️Next Run #220🏃‍♀️
Saturday 28th Mar 26
▶️Hare: Pussy Rainbow
A to A flat trail - no hazards.
🕞EARLY TIME - 3 for 3:30 pm start.
💲Price - All attendees 100 Baht.`,
      url: "https://chiangraihhh.blogspot.com/2026/03/crh3220-saturday-26-march.html",
      published: "2026-03-22T18:07:00+07:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.title).toBe("CRH3#220 Saturday 26 March");
      expect(result.event.description).toBe("A to A flat trail - no hazards.");
      expect(result.event.startTime).toBe("15:30");
      expect(result.event.cost).toBe("All attendees 100 Baht.");
      expect(result.event.hares).toBe("Pussy Rainbow");
    }
  });

  it("resolves title-vs-body day conflict in favor of body (#1117)", () => {
    // Title: "Saturday 26 March" but March 26, 2026 is a Thursday.
    // Body: "Saturday 28th Mar 26" — actually a Saturday. Body wins.
    const result = parseCrh3Post({
      title: "CRH3#220 Saturday 26 March",
      content: `🏃‍♂️Next Run #220🏃‍♀️
Saturday 28th Mar 26 (This coming Saturday)
▶️Hare: Pussy Rainbow`,
      url: "https://chiangraihhh.blogspot.com/2026/03/crh3220-saturday-26-march.html",
      published: "2026-03-22T18:07:00+07:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.date).toBe("2026-03-28");
    }
  });

  it("falls back to default startTime when body has no time line", () => {
    const result = parseCrh3Post({
      title: "CRH3 #218 Saturday 15th February 2025",
      content: "<p>Hare: Iron Chef</p>",
      url: "https://chiangraihhh.blogspot.com/2025/02/crh3-218.html",
      published: "2025-02-01T00:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
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

  it("filters run-report posts that share an announcement's run number", () => {
    // "Memories of CRH3 #186" matches RUN_TITLE_RE but is a recap, not an
    // announcement. Skipping these prevents per-scrape parse errors when
    // the announcement is already in seenRuns.
    const result = parseCrh3Post({
      title: "Memories of CRH3 #186 Hared by Karl and attended by 20",
      content: "<p>What a great trail!</p>",
      url: "https://chiangraihhh.blogspot.com/2022/08/memories.html",
      published: "2022-08-26T00:00:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-run-post");
  });

  it("does NOT filter announcements that happen to contain words like 'Photo' or 'Memory'", () => {
    // The recap filter is anchored to the start of the title and
    // requires a recap phrase like "Photos of" / "Memories of" — so
    // "CRH3 #230 Photo Run" is a real announcement, not a recap.
    const result = parseCrh3Post({
      title: "CRH3 #230 Photo Run Saturday 18 July 2026",
      content: "<p>Saturday 18th July 2026</p><p>Hare: Test</p>",
      url: "https://chiangraihhh.blogspot.com/2026/07/photo-run.html",
      published: "2026-07-10T00:00:00+07:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.runNumber).toBe(230);
      expect(result.event.title).toBe("CRH3 #230 Photo Run Saturday 18 July 2026");
    }
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
