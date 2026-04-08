import {
  parseKjHarimauBody,
  parseKjHarimauDate,
  parseKjHarimauTitle,
} from "./kj-harimau";

describe("parseKjHarimauDate", () => {
  it("parses DD/MM/YYYY (Malaysian order)", () => {
    expect(parseKjHarimauDate("14/04/2026")).toBe("2026-04-14");
  });
  it("parses DD/MM/YY", () => {
    expect(parseKjHarimauDate("14/04/26")).toBe("2026-04-14");
  });
  it("parses DD-MM-YYYY", () => {
    expect(parseKjHarimauDate("14-04-2026")).toBe("2026-04-14");
  });
  it("rejects non-numeric date text", () => {
    expect(parseKjHarimauDate("April 14")).toBeNull();
    expect(parseKjHarimauDate("TBD")).toBeNull();
  });
});

describe("parseKjHarimauTitle", () => {
  it("extracts run number and date from the title", () => {
    const fields = parseKjHarimauTitle(
      "Run#:1548, 14/04/2026, Hare: Silver Hai Ho, Runsite: Radio Cafe, Botanic Klang",
    );
    expect(fields.runNumber).toBe(1548);
    expect(fields.date).toBe("2026-04-14");
    expect(fields.hare).toBe("Silver Hai Ho");
    expect(fields.runsite).toBe("Radio Cafe, Botanic Klang");
  });

  it("handles titles without Hare/Runsite labels", () => {
    const fields = parseKjHarimauTitle("Run#:1544, 17/03/26");
    expect(fields.runNumber).toBe(1544);
    expect(fields.date).toBe("2026-03-17");
    expect(fields.hare).toBeUndefined();
  });
});

describe("parseKjHarimauBody", () => {
  const body = `
*Kelab Hash House Harimau Kelana Jaya*
Run#: 1548
Date: 14/04/26,
Time: 6:00 pm
Hare: Silver Hai Ho - https://shorturl.at/9SSG7
Runsite: Radio Cafe, Botanic Klang
GPS: 2.9874534,101.4512081
Maps: https://maps.app.goo.gl/4z3La8RTDfd4MPbo8
Waze: https://waze.com/ul/hw280uxu68
Guest Fee: RM 60
Details at khhhkj.blogspot.com
`;

  it("extracts all labeled fields", () => {
    const fields = parseKjHarimauBody(body);
    expect(fields.runNumber).toBe(1548);
    expect(fields.date).toBe("2026-04-14");
    expect(fields.startTime).toBe("18:00");
    expect(fields.hare).toBe("Silver Hai Ho");
    expect(fields.runsite).toBe("Radio Cafe, Botanic Klang");
    expect(fields.latitude).toBeCloseTo(2.9874534);
    expect(fields.longitude).toBeCloseTo(101.4512081);
    expect(fields.mapsUrl).toBe("https://maps.app.goo.gl/4z3La8RTDfd4MPbo8");
    expect(fields.wazeUrl).toBe("https://waze.com/ul/hw280uxu68");
    expect(fields.guestFee).toBe("RM 60");
  });

  it("handles empty body gracefully", () => {
    expect(parseKjHarimauBody("")).toEqual({});
  });
});
