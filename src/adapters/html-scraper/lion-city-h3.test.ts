import {
  buildLionCityEvent,
  extractThemedTitle,
  parseLionCityBody,
  parseLionCityTitle,
  trimLocationNavText,
} from "./lion-city-h3";

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

describe("extractThemedTitle (#1168)", () => {
  it("returns the first short quoted string", () => {
    expect(extractThemedTitle('Date: ...   "Thank God it is Good Friday"\nHare(s)...'))
      .toBe("Thank God it is Good Friday");
  });
  it("supports curly quotes", () => {
    expect(extractThemedTitle('blah “Hello World” foo')).toBe("Hello World");
  });
  it("returns undefined when no quoted text", () => {
    expect(extractThemedTitle("plain post body without quotes")).toBeUndefined();
  });
  it("skips quoted text that contains a colon (caption-like)", () => {
    // "Bus: 67, 71" is a caption, not a themed title.
    expect(extractThemedTitle('something "Bus: 67, 71"')).toBeUndefined();
  });
  it("rejects too-short quoted text", () => {
    expect(extractThemedTitle('a "b" c')).toBeUndefined();
  });
});

describe("trimLocationNavText (#1169)", () => {
  it("truncates at '. Note:'", () => {
    expect(
      trimLocationNavText("corner of Path 6 and 7. Note: Don't use Google Directions"),
    ).toBe("corner of Path 6 and 7");
  });
  it("truncates at '. NB:'", () => {
    expect(trimLocationNavText("Place X. NB: bring water")).toBe("Place X");
  });
  it("truncates at '. Tip:'", () => {
    expect(trimLocationNavText("Place Y. Tip: park behind")).toBe("Place Y");
  });
  it("returns input unchanged when no nav block follows", () => {
    expect(trimLocationNavText("Just an address, somewhere")).toBe(
      "Just an address, somewhere",
    );
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

  it("captures themed title from quoted body text (#1168)", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp. "Thank God it is Good Friday"
Hare(s): Lap Dog
Map – Run Location: Somewhere</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.themeTitle).toBe("Thank God it is Good Friday");
  });

  it("captures themed title with curly quotes (#1168)", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp. “The Jurong Innovation District Run”
Hare(s): Lap Dog</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.themeTitle).toBe("The Jurong Innovation District Run");
  });

  it("leaves themeTitle undefined when no quoted line is present (#1168)", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp.
Hare(s): Lap Dog
Map – Run Location: Somewhere</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.themeTitle).toBeUndefined();
  });

  it("truncates location at trailing nav-instructions (#1169)", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp.
Hare(s): Lap Dog
Map – Run Location: corner of Christian Cemetery Path 6 and 7. Note: Don't use Google Directions. Use your own brain and a map (which could be Google Maps), Singapore</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.location).toBe("corner of Christian Cemetery Path 6 and 7");
  });

  it("does not leak the next-paragraph link label into hares when fields live in sibling <p> elements (#583)", () => {
    // On posts where the hare names and the Map link sit in separate
    // <p> elements, the prior $("body").text() flattened the boundary
    // into a space and the hare regex captured the next paragraph's
    // link text "🏃‍♂️ Map – Run" as part of the hares.
    const html = `<p>Date: Friday, 03 April, 6 pm sharp.</p>
<p>Hare(s): Sex Pit, Big Head and Infamous Pasi</p>
<p>🏃‍♂️ <a href="https://maps.google.com/?q=xyz">Map – Run</a> Location: J0132 off-street car park – Jln Penjara</p>
<p>🍻 Map – On On: The usual spot</p>`;
    const out = parseLionCityBody(html, ref);
    expect(out.hares).toBe("Sex Pit, Big Head and Infamous Pasi");
    expect(out.location).toBe("J0132 off-street car park – Jln Penjara");
    expect(out.onAfter).toBe("The usual spot");
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
      kennelTags: ["lch3"],
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

  it("uses themed body title when present, overrides generic Hash Run #N (#1168)", () => {
    const html = `<p>Date: Friday, 03 April, 6 pm sharp. "Thank God it is Good Friday"
Hare(s): Lap Dog
Map – Run Location: Somewhere</p>`;
    const event = buildLionCityEvent(
      "Hash Run #2,193",
      html,
      "https://x",
      new Date("2026-03-31T00:00:00Z"),
    );
    expect(event?.title).toBe("Thank God it is Good Friday");
    // Run number still extracted from the post title.
    expect(event?.runNumber).toBe(2193);
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
