import { describe, it, expect } from "vitest";
import { parseICalText, parseRssItems, extractTrailNumber } from "./soh4";

describe("parseICalText", () => {
  it("parses a complete iCal event", () => {
    const ical = [
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/New_York:20260316T180900",
      "SUMMARY:Trail #821 - St. Patrick's Day Hash",
      "DESCRIPTION:Come join us for a festive\\nSt. Paddy's day hash!\\nHash Cash: $5",
      "LOCATION:Dinosaur Bar-B-Que\\, 246 W Willow St\\, Syracuse\\, NY 13204",
      "CATEGORIES:Trail",
      "END:VEVENT",
    ].join("\r\n");

    const result = parseICalText(ical);
    expect(result.date).toBe("2026-03-16");
    expect(result.startTime).toBe("18:09");
    expect(result.title).toBe("Trail #821 - St. Patrick's Day Hash");
    expect(result.description).toContain("Come join us for a festive");
    expect(result.description).toContain("St. Paddy's day hash!");
    expect(result.location).toBe("Dinosaur Bar-B-Que, 246 W Willow St, Syracuse, NY 13204");
  });

  it("handles date-only DTSTART", () => {
    const ical = "DTSTART:20260401\r\nSUMMARY:April Fools Hash";
    const result = parseICalText(ical);
    expect(result.date).toBe("2026-04-01");
    expect(result.startTime).toBeUndefined();
    expect(result.title).toBe("April Fools Hash");
  });

  it("handles UTC DTSTART", () => {
    const ical = "DTSTART:20260501T230000Z\r\nSUMMARY:May Day";
    const result = parseICalText(ical);
    expect(result.date).toBe("2026-05-01");
    expect(result.startTime).toBe("23:00");
  });

  it("unescapes iCal special characters", () => {
    const ical = [
      "DESCRIPTION:First line\\nSecond line\\, with comma\\; and semicolon",
      "LOCATION:Bar\\, 123 Main St\\, Syracuse",
    ].join("\r\n");

    const result = parseICalText(ical);
    expect(result.description).toBe("First line\nSecond line, with comma; and semicolon");
    expect(result.location).toBe("Bar, 123 Main St, Syracuse");
  });

  it("handles folded lines", () => {
    const ical = "SUMMARY:This is a very long\r\n  title that spans\r\n  multiple lines\r\nDTSTART:20260601T180000";
    const result = parseICalText(ical);
    expect(result.title).toBe("This is a very long title that spans multiple lines");
    expect(result.date).toBe("2026-06-01");
  });

  it("returns undefined fields when missing", () => {
    const ical = "BEGIN:VEVENT\r\nEND:VEVENT";
    const result = parseICalText(ical);
    expect(result.date).toBeUndefined();
    expect(result.startTime).toBeUndefined();
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it("extracts Location from DESCRIPTION field", () => {
    const ical = [
      "BEGIN:VEVENT",
      "SUMMARY:Trail #822",
      "DTSTART;TZID=America/New_York:20260321T140900",
      "DESCRIPTION:Hares: Strawberry\\, Zero and Hose\\nLocation: Behind Marshalls in Fairmount\\nStart Time: 1:69PM (AKA 2:09 pm)\\nhttps://maps.app.goo.gl/ZLrp543fnTDXZ4WS7\\nHash Cash: $5",
      "END:VEVENT",
    ].join("\n");
    const result = parseICalText(ical);
    expect(result.location).toBe("Behind Marshalls in Fairmount");
  });

  it("extracts Hares from DESCRIPTION field", () => {
    const ical = [
      "BEGIN:VEVENT",
      "SUMMARY:Trail #822",
      "DTSTART;TZID=America/New_York:20260321T140900",
      "DESCRIPTION:Hares: Strawberry\\, Zero and Hose\\nLocation: Behind Marshalls in Fairmount",
      "END:VEVENT",
    ].join("\n");
    const result = parseICalText(ical);
    expect(result.hares).toBe("Strawberry, Zero and Hose");
  });

  it("prefers LOCATION property over description-extracted location", () => {
    const ical = [
      "BEGIN:VEVENT",
      "SUMMARY:Trail #821",
      "DTSTART;TZID=America/New_York:20260316T180900",
      "LOCATION:Dinosaur Bar-B-Que\\, 246 W Willow St\\, Syracuse\\, NY 13204",
      "DESCRIPTION:Location: Some other place\\nHares: Test Hare",
      "END:VEVENT",
    ].join("\n");
    const result = parseICalText(ical);
    expect(result.location).toBe("Dinosaur Bar-B-Que, 246 W Willow St, Syracuse, NY 13204");
  });

  it("strips Google Maps URLs from description", () => {
    const ical = [
      "BEGIN:VEVENT",
      "SUMMARY:Trail #822",
      "DTSTART;TZID=America/New_York:20260321T140900",
      "DESCRIPTION:Come run with us!\\nhttps://maps.app.goo.gl/ZLrp543fnTDXZ4WS7\\nHash Cash: $5",
      "END:VEVENT",
    ].join("\n");
    const result = parseICalText(ical);
    expect(result.description).not.toContain("maps.app.goo.gl");
  });

  it("strips WordPress template boilerplate from description", () => {
    const ical = [
      "BEGIN:VEVENT",
      "SUMMARY:Trail #822",
      "DTSTART;TZID=America/New_York:20260321T140900",
      "DESCRIPTION:Please include hash name and date of trail in description.\\nHares: Strawberry\\, Zero and Hose\\nLocation: Behind Marshalls in Fairmount",
      "END:VEVENT",
    ].join("\n");
    const result = parseICalText(ical);
    expect(result.description).not.toContain("Please include hash name");
    expect(result.hares).toBe("Strawberry, Zero and Hose");
    expect(result.location).toBe("Behind Marshalls in Fairmount");
  });

  it("preserves non-map URLs in description (rego/ticket links)", () => {
    const ical = [
      "BEGIN:VEVENT",
      "SUMMARY:Trail #823",
      "DTSTART;TZID=America/New_York:20260328T140900",
      "DESCRIPTION:Sign up: https://hashrego.com/events/soh4-823\\nhttps://maps.app.goo.gl/abc123\\nHash Cash: $5",
      "END:VEVENT",
    ].join("\n");
    const result = parseICalText(ical);
    expect(result.description).toContain("https://hashrego.com/events/soh4-823");
    expect(result.description).not.toContain("maps.app.goo.gl");
  });
});

describe("parseRssItems", () => {
  it("extracts items from RSS XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SOH4 Trails</title>
    <item>
      <title>Trail #825 – Summer Kick-Off</title>
      <link>https://www.soh4.com/trails/825/</link>
    </item>
    <item>
      <title>Trail #824 – Memorial Day Hash</title>
      <link>https://www.soh4.com/trails/824/</link>
    </item>
  </channel>
</rss>`;

    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe("https://www.soh4.com/trails/825/");
    expect(items[0].title).toBe("Trail #825 – Summer Kick-Off");
    expect(items[1].url).toBe("https://www.soh4.com/trails/824/");
  });

  it("skips items without links", () => {
    const xml = `<rss><channel><item><title>No Link</title></item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(0);
  });
});

describe("extractTrailNumber", () => {
  it("extracts number from standard trail URL", () => {
    expect(extractTrailNumber("https://www.soh4.com/trails/821/")).toBe(821);
  });

  it("extracts number without trailing slash", () => {
    expect(extractTrailNumber("https://www.soh4.com/trails/825")).toBe(825);
  });

  it("returns undefined for non-trail URL", () => {
    expect(extractTrailNumber("https://www.soh4.com/about/")).toBeUndefined();
  });
});
