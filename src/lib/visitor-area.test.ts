import { parseVisitorArea } from "./visitor-area";

describe("parseVisitorArea", () => {
  it("reads coordinates and decodes the city", () => {
    expect(
      parseVisitorArea(
        new Headers({
          "x-vercel-ip-latitude": "29.9511",
          "x-vercel-ip-longitude": "-90.0715",
          "x-vercel-ip-city": "New%20Orleans",
        }),
      ),
    ).toEqual({ latitude: 29.9511, longitude: -90.0715, city: "New Orleans", timezone: null });
  });

  it("keeps a valid time zone and drops an invalid one", () => {
    const base = { "x-vercel-ip-latitude": "29.95", "x-vercel-ip-longitude": "-90.07" };
    expect(
      parseVisitorArea(new Headers({ ...base, "x-vercel-ip-timezone": "America/Chicago" }))?.timezone,
    ).toBe("America/Chicago");
    expect(parseVisitorArea(new Headers({ ...base, "x-vercel-ip-timezone": "Not/AZone" }))?.timezone).toBeNull();
    expect(parseVisitorArea(new Headers({ ...base, "x-vercel-ip-timezone": "CST" }))?.timezone).toBeNull();
  });

  it("decodes non-ASCII city names", () => {
    const area = parseVisitorArea(
      new Headers({ "x-vercel-ip-latitude": "48.1", "x-vercel-ip-longitude": "11.6", "x-vercel-ip-city": "M%C3%BCnchen" }),
    );
    expect(area?.city).toBe("München");
  });

  it("keeps the coordinates when the city is missing or badly encoded", () => {
    expect(parseVisitorArea(new Headers({ "x-vercel-ip-latitude": "1", "x-vercel-ip-longitude": "2" }))?.city).toBeNull();
    expect(
      parseVisitorArea(
        new Headers({ "x-vercel-ip-latitude": "1", "x-vercel-ip-longitude": "2", "x-vercel-ip-city": "%E0%A4%A" }),
      )?.city,
    ).toBeNull();
  });

  it("returns null without usable coordinates (local dev, bad values)", () => {
    expect(parseVisitorArea(new Headers())).toBeNull();
    expect(parseVisitorArea(new Headers({ "x-vercel-ip-latitude": "abc", "x-vercel-ip-longitude": "2" }))).toBeNull();
    expect(parseVisitorArea(new Headers({ "x-vercel-ip-latitude": "91", "x-vercel-ip-longitude": "2" }))).toBeNull();
    expect(parseVisitorArea(new Headers({ "x-vercel-ip-latitude": "1", "x-vercel-ip-longitude": "" }))).toBeNull();
  });
});
