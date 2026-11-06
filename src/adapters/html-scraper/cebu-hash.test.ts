import { readFileSync } from "node:fs";
import path from "node:path";
import { haresFromDescription, parseCebuWhen, parseCebuWidget } from "./cebu-hash";

// The live Jetpack "Upcumming Events" widget from cebuhash.wordpress.com (2026-11-05).
const WIDGET = readFileSync(path.join(__dirname, "fixtures/cebu-hash-upcoming-events-2026-11-05.html.fixture"), "utf-8");

describe("parseCebuWhen", () => {
  it("parses date with a time range", () => {
    expect(parseCebuWhen("8th Nov 2026 at 3:00 pm – 5:00 pm")).toEqual({ date: "2026-11-08", startTime: "15:00", endTime: "17:00" });
  });
  it("parses a date-only cell", () => {
    expect(parseCebuWhen("22nd Nov 2026")).toEqual({ date: "2026-11-22", startTime: undefined, endTime: undefined });
  });
  it("rejects malformed dates", () => {
    expect(parseCebuWhen("31st Feb 2027").date).toBeNull();
    expect(parseCebuWhen("Sunday").date).toBeNull();
  });
});

describe("haresFromDescription", () => {
  it("reads 'Hare is' / 'Hares are'", () => {
    expect(haresFromDescription("Food is available. Hare is Tiger Ass.")).toBe("Tiger Ass");
    expect(haresFromDescription("Hares are Busted & Screwdriver.")).toBe("Busted, Screwdriver");
    expect(haresFromDescription("Be there at 3pm.")).toBeUndefined();
  });
});

describe("parseCebuWidget", () => {
  it("keeps Hash #N runs and skips committee meetings", () => {
    const { events, widgetFound, parseErrors } = parseCebuWidget(WIDGET);
    expect(widgetFound).toBe(true);
    expect(parseErrors).toEqual([]);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [1564, "2026-11-08"],
      [1565, "2026-11-15"],
      [1566, "2026-11-22"],
    ]);
    expect(events[0]).toMatchObject({
      kennelTags: ["cebu-h3"],
      startTime: "15:00",
      endTime: "17:00",
      location: "Turning Wheels Craft Brewery, P. Almendras St, Cebu City, 6000 Cebu, Philippines",
      hares: "Tiger Ass",
    });
    expect(events.every((e) => e.title === undefined)).toBe(true);
    expect(events[1]).toMatchObject({ location: undefined, hares: undefined, startTime: undefined });
  });

  it("reports a missing widget", () => {
    expect(parseCebuWidget("<html><body>nothing</body></html>").widgetFound).toBe(false);
  });
});
