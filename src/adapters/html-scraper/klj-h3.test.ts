import { cleanKljTitle, parseKljBody, parseKljTitleDate } from "./klj-h3";

describe("cleanKljTitle", () => {
  it("strips Run # + date prefix", () => {
    expect(cleanKljTitle("Run # 532, 6th December 2026 – Christmas Party")).toBe(
      "Christmas Party",
    );
  });
  it("decodes HTML entities", () => {
    expect(cleanKljTitle("Run # 531, 1st November &#8211; Halloween @ TBD")).toBe(
      "Halloween @ TBD",
    );
  });
  it("strips inline font tags", () => {
    expect(
      cleanKljTitle('<font color="red">Run # 532, 6th December 2026 – Christmas Party</font>'),
    ).toBe("Christmas Party");
  });
  it("leaves titles without a run prefix alone", () => {
    expect(cleanKljTitle("Welcome to KLJ H3")).toBe("Welcome to KLJ H3");
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

  it("handles empty body", () => {
    expect(parseKljBody("")).toEqual({});
  });
});
