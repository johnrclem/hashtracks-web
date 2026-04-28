import { parsePattayaRow } from "./pattaya-h3";

const SOURCE_URL = "https://www.pattayah3.com/PH3/php/HareLine/HareLine.php";

describe("parsePattayaRow", () => {
  it("parses a row with full details", () => {
    const left = "13 Apr 2026 - Run 2146";
    const right = "Hares: Lady Squeeze My Tube, Many Drinks, Never Come\nTheme: Songkran\nOn On Bar: New Plaza Sports Bar\nA-Site: Hwy 331 - across from Asian Uni. (12.83775, 101.018, ID: 73)";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-13");
    expect(event!.kennelTags[0]).toBe("pattaya-h3");
    expect(event!.runNumber).toBe(2146);
    expect(event!.hares).toContain("Lady Squeeze My Tube");
    expect(event!.hares).toContain("Many Drinks");
    expect(event!.title).toContain("Songkran");
    expect(event!.locationUrl).toContain("12.83775");
    expect(event!.startTime).toBe("15:00");
  });

  it("parses a row with minimal details", () => {
    const left = "20 Apr 2026 - Run 2147";
    const right = "Hares: The Wizard, Shit Lips\nTheme: St. George's Day Run\nOn On Bar: Kubla Bar";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-20");
    expect(event!.runNumber).toBe(2147);
    expect(event!.hares).toContain("The Wizard");
  });

  it("handles 'Hares Required' as no hares", () => {
    const left = "27 Apr 2026 - Run 2148";
    const right = "Hares: Hares Required\nOn On Bar: Crackers Bar";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
    expect(event!.runNumber).toBe(2148);
  });

  it("returns null for unparseable date", () => {
    const event = parsePattayaRow("No date here", "Hares: Someone", SOURCE_URL);
    expect(event).toBeNull();
  });

  it("parses GPS coordinates into locationUrl", () => {
    const left = "1 Jun 2026 - Run 2153";
    const right = "Hares: Something Stupid\nA-Site: Somewhere (13.020197, 101.017503, ID: 6)";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.locationUrl).toBe("https://www.google.com/maps/search/?api=1&query=13.020197,101.017503");
  });
});
