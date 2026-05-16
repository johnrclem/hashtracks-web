import { cleanKljTitle, parseKljBody, parseKljTitleDate } from "./klj-h3";

describe("cleanKljTitle", () => {
  it("strips Run # + date prefix", () => {
    expect(cleanKljTitle("Run # 532, 6th December 2026 – Christmas Party")).toBe(
      "Christmas Party",
    );
  });
  it("strips trailing '@ TBD' placeholder venue (#1442 Shape B)", () => {
    // Source: "Run # 531, 1st November – Halloween @ TBD"
    // Without the strip, the venue placeholder leaks into the title.
    expect(cleanKljTitle("Run # 531, 1st November &#8211; Halloween @ TBD")).toBe(
      "Halloween",
    );
  });
  it.each(["TBD", "TBA", "TBC", "tbd"])(
    "strips trailing '@ %s' regardless of case",
    (placeholder) => {
      expect(
        cleanKljTitle(`Run # 531, 1st November – Halloween @ ${placeholder}`),
      ).toBe("Halloween");
    },
  );
  it("strips inline font tags", () => {
    expect(
      cleanKljTitle('<font color="red">Run # 532, 6th December 2026 – Christmas Party</font>'),
    ).toBe("Christmas Party");
  });
  it("leaves titles without a run prefix alone", () => {
    expect(cleanKljTitle("Welcome to KLJ H3")).toBe("Welcome to KLJ H3");
  });
  it("returns undefined when trailer is just '@ <venue>' (#1442 Shape A)", () => {
    // The merge pipeline treats "Run #N" as a stale-default placeholder, so
    // returning it just makes the kennel page show "KLJ H3 — Run #N". Return
    // undefined instead — merge synthesizes a friendly default with location.
    expect(cleanKljTitle("Run # 526, 7th June @ Nambee estate, near Rasa")).toBeUndefined();
  });
  it("returns undefined when trailer is '@ TBD' (Shape A with placeholder venue)", () => {
    expect(cleanKljTitle("Run # 527, 5th July @ TBD")).toBeUndefined();
  });
  it("returns undefined when trailer is just a venue (no @ separator)", () => {
    expect(cleanKljTitle("Run # 527, 5th July near KL")).toBeUndefined();
  });
  it("returns undefined when title is bare run number without trailer", () => {
    expect(cleanKljTitle("Run # 528")).toBeUndefined();
  });
  it("preserves themed titles that legitimately start with 'near' (PR #1236 review)", () => {
    // "near" alone isn't a venue marker — only "near <CapitalizedPlace>" is.
    expect(cleanKljTitle("Run # 530, 6th October – Near Death Experience")).toBe(
      "Near Death Experience",
    );
  });
});

describe("parseKljTitleDate", () => {
  it("infers year from publish date when title omits it", () => {
    expect(
      parseKljTitleDate("Run # 531, 1st November – Halloween @ TBD", "2026-01-15T00:00:00Z"),
    ).toBe("2026-11-01");
  });
  it("respects an explicit year in the title", () => {
    expect(
      parseKljTitleDate("Run # 532, 6th December 2026 – Christmas Party", "2025-12-08T00:00:00Z"),
    ).toBe("2026-12-06");
  });
  it("returns null without a date token", () => {
    expect(parseKljTitleDate("Welcome to KLJ", "2026-01-01T00:00:00Z")).toBeNull();
  });
});

describe("parseKljBody", () => {
  const body = `
    <p>Fun times ahead!</p>
    <p>Run-site: Somewhere Nice</p>
    <p>Travel Time: about an hour</p>
    <p>Date: Sunday 1st November, 2026</p>
    <p>Hares: Alice &amp; Bob</p>
    <p>Co-Hares: Charlie</p>
    <p>Registration: 1:20 onwards</p>
    <p>Run Starts at: 2:00 pm</p>
  `;
  it("extracts all labeled fields", () => {
    const parsed = parseKljBody(body);
    expect(parsed.runSite).toBe("Somewhere Nice");
    expect(parsed.travelTime).toBe("about an hour");
    expect(parsed.date).toBe("2026-11-01");
    expect(parsed.hares).toBe("Alice & Bob");
    expect(parsed.coHares).toBe("Charlie");
    expect(parsed.registration).toBe("1:20 onwards");
    expect(parsed.startTime).toBe("14:00");
  });

  it("drops placeholder fields (TBD)", () => {
    const tbd = `<p>Run-site: TBD</p><p>Hares: TBD</p><p>Date: Sunday 1st November, 2026</p>`;
    const parsed = parseKljBody(tbd);
    expect(parsed.runSite).toBeUndefined();
    expect(parsed.hares).toBeUndefined();
    expect(parsed.date).toBe("2026-11-01");
  });

  it("strips leading 'probably' qualifier from runSite + flags as tentative (#1213)", () => {
    const html = `<p>Run-site: probably Nambee estate</p>
<p>Date: Sunday 1st November, 2026</p>`;
    const parsed = parseKljBody(html);
    expect(parsed.runSite).toBe("Nambee estate");
    expect(parsed.runSiteTentative).toBe(true);
  });

  it("does not flag tentative when runSite has no 'probably' prefix", () => {
    const html = `<p>Run-site: Nambee estate</p>
<p>Date: Sunday 1st November, 2026</p>`;
    const parsed = parseKljBody(html);
    expect(parsed.runSite).toBe("Nambee estate");
    expect(parsed.runSiteTentative).toBe(false);
  });

  it("leaves runSiteTentative undefined when runSite is missing", () => {
    const parsed = parseKljBody(`<p>Date: Sunday 1st November, 2026</p>`);
    expect(parsed.runSite).toBeUndefined();
    expect(parsed.runSiteTentative).toBeUndefined();
  });

  it("handles empty body", () => {
    expect(parseKljBody("")).toEqual({});
  });
});
