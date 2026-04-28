import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cheerio from "cheerio";
import { parseIH3Date, parseIH3Block } from "./ithaca-h3";

describe("parseIH3Date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set "now" to March 14, 2026
    vi.setSystemTime(new Date(2026, 2, 14));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses Month Day format for upcoming date", () => {
    expect(parseIH3Date("March 15")).toBe("2026-03-15");
  });

  it("parses Month Day format for far future date", () => {
    expect(parseIH3Date("October 4")).toBe("2026-10-04");
  });

  it("bumps to next year when date is >30 days in the past", () => {
    expect(parseIH3Date("January 10")).toBe("2027-01-10");
  });

  it("keeps current year for recent past date (<30 days ago)", () => {
    expect(parseIH3Date("March 1")).toBe("2026-03-01");
  });

  it("returns null for unrecognized text", () => {
    expect(parseIH3Date("not a date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseIH3Date("")).toBeNull();
  });
});

describe("parseIH3Block", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 14));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const sourceUrl = "http://ithacah3.org/hare-line/";

  it("parses a complete event block", () => {
    const html = `<p>
      <strong>#1119: March 15</strong><br>
      <strong>Hares:</strong> Flesh Flaps &amp; Spike<br>
      <span style="font-weight: 600;">Where</span>: <a href="https://www.google.com/maps/place/Flat+Rock/@42.44,-76.50,17z">Flat Rock</a><br>
      <span style="font-weight: 600;">When:</span> 2:00 pm<br>
      <span style="font-weight: 600;">Cost:</span> $5 (first timers free)<br>
      <span style="font-weight: 600;">Details</span>: <a href="http://ithacah3.org/trails/1119/">touch me</a>
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1119);
    expect(result!.date).toBe("2026-03-15");
    expect(result!.kennelTags[0]).toBe("ih3");
    expect(result!.title).toBe("IH3 #1119");
    expect(result!.hares).toBe("Flesh Flaps & Spike");
    expect(result!.startTime).toBe("14:00");
    expect(result!.latitude).toBeCloseTo(42.44, 1);
    expect(result!.longitude).toBeCloseTo(-76.50, 1);
  });

  it("returns null for blocks without trail number", () => {
    const html = `<p><strong>Welcome to IH3!</strong> We run every other Sunday.</p>`;
    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);
    expect(result).toBeNull();
  });

  it("handles block without hares", () => {
    const html = `<p>
      <strong>#1120: March 29</strong><br>
      <span style="font-weight: 600;">Where</span>: Stewart Park<br>
      <span style="font-weight: 600;">When:</span> 3:00 pm<br>
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1120);
    expect(result!.date).toBe("2026-03-29");
    expect(result!.hares).toBeUndefined();
    expect(result!.startTime).toBe("15:00");
  });

  it("extracts detail page URL", () => {
    const html = `<p>
      <strong>#1121: April 12</strong><br>
      <span style="font-weight: 600;">Details</span>: <a href="http://ithacah3.org/trails/1121/">touch me</a>
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.sourceUrl).toBe("http://ithacah3.org/trails/1121/");
  });

  it("splits location from concatenated labels (TBDWhen:)", () => {
    // When <br> tags are missing, labels run together in blockText:
    // "Where: TBDWhen: 2:00 pmCost: $5"
    const html = `<p>
      <strong>#1122: April 26</strong>
      <span style="font-weight: 600;">Where</span>: TBD<span style="font-weight: 600;">When:</span> 2:00 pm<span style="font-weight: 600;">Cost:</span> $5
    </p>`;

    const $ = cheerio.load(html);
    const result = parseIH3Block($("p").first(), $, sourceUrl);

    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(1122);
    expect(result!.date).toBe("2026-04-26");
    // The location should NOT contain "When:" or time data bleeding through
    // "TBDWhen: 2:00 pmCost: $5" should not be used as location
    if (result!.location) {
      expect(result!.location).not.toContain("When:");
      expect(result!.location).not.toContain("2:00");
      expect(result!.location).not.toContain("Cost:");
    }
  });
});
