import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseEh3EventBlock, parseDate } from "./eh3-edmonton";
import type { Source } from "@/generated/prisma/client";

const EH3_PAGE_HTML = `<p><span style="color: #ff0000;"><strong>EH3 Run # 1845 &#8211; Monday April 6 &#8211; Test Run</strong></span><br />
<strong>Hares</strong>: Spring Loaded and Soggy Bottom<br />
<strong>Location</strong>: Gold Bar School (<a href="https://maps.app.goo.gl/test">Map</a>)<br />
<strong>On on: </strong>Bud&#8217;s Lounge</p>
<p><span style="color: #ff0000;"><strong>EH3 Run # 1846 Monday April 13</strong></span><br />
<strong>Hares</strong>: More Dick Please</p>`;

vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// ── Unit tests for parseDate ──

describe("parseDate", () => {
  it("parses 'Monday April 6'", () => {
    const result = parseDate("Monday April 6");
    expect(result).toMatch(/^\d{4}-04-06$/);
  });

  it("parses 'Saturday Oct 31'", () => {
    const result = parseDate("Saturday Oct 31");
    expect(result).toMatch(/^\d{4}-10-31$/);
  });

  it("parses 'Sunday, March 22, 2026, at 2 PM'", () => {
    expect(parseDate("Sunday, March 22, 2026, at 2 PM")).toBe("2026-03-22");
  });

  it("parses 'Friday April 3, 2026, 7pm'", () => {
    expect(parseDate("Friday April 3, 2026, 7pm")).toBe("2026-04-03");
  });

  it("parses 'Tuesday, Nov 25, 2025, 6:30pm'", () => {
    expect(parseDate("Tuesday, Nov 25, 2025, 6:30pm")).toBe("2025-11-25");
  });

  it("parses 'Tues, March 31, 2026 6:30pm.'", () => {
    expect(parseDate("Tues, March 31, 2026 6:30pm.")).toBe("2026-03-31");
  });

  it("parses 'Friday, March 13, 2026'", () => {
    expect(parseDate("Friday, March 13, 2026")).toBe("2026-03-13");
  });

  it("parses 'Sunday, May 4, 2025, 11 am'", () => {
    expect(parseDate("Sunday, May 4, 2025, 11 am")).toBe("2025-05-04");
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for non-date text", () => {
    expect(parseDate("Some random text")).toBeNull();
  });
});

// ── Unit tests for parseEh3EventBlock ──

describe("parseEh3EventBlock", () => {
  describe("EH3 (eh3-ab)", () => {
    it("parses standard header with title", () => {
      const lines = [
        "EH3 Run # 1845 \u2013 Monday April 6 \u2013 I've got 6, you've got 9",
        "Hares: Spring Loaded and Soggy Bottom",
        "Hash Hold: Cherry Poppins",
        "Location: Gold Bar Elementary School 10524 46 St NW",
        "On on: Bud's Lounge 5804 Terrace Rd NW",
        "Note from hares: Someone say bunny ears?!",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(1845);
      expect(result!.title).toBe("I've got 6, you've got 9");
      expect(result!.date).toMatch(/^\d{4}-04-06$/);
      expect(result!.hares).toBe("Spring Loaded and Soggy Bottom");
      expect(result!.location).toBe("Gold Bar Elementary School 10524 46 St NW");
      expect(result!.startTime).toBe("18:30"); // Monday = summer
      expect(result!.description).toContain("On On: Bud's Lounge");
      expect(result!.description).toContain("Hash Hold: Cherry Poppins");
    });

    it("emits 'EH3 Run #NNNN' title for untitled numbered runs (#1044)", () => {
      const lines = [
        "EH3 Run # 1847 Monday April 20",
        "Hares: Very Saggy Testicles and Inky Dinky",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(1847);
      expect(result!.title).toBe("EH3 Run #1847");
      expect(result!.hares).toBe("Very Saggy Testicles and Inky Dinky");
    });

    it("uses 14:00 start time for Saturday runs", () => {
      const lines = [
        "EH3 Run # 1871 Saturday Oct 3 \u2013 First Saturday Run",
        "Hares: Gobble Me and Free Woody",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.startTime).toBe("14:00");
    });

    it("parses variant with # and no space", () => {
      const lines = [
        "EH3 Run #1854 \u2013 Monday June 8 \u2013 D-Day Run",
        "Hare: Big Rubber",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(1854);
      expect(result!.title).toBe("D-Day Run");
      expect(result!.hares).toBe("Big Rubber");
    });

    it("parses 'EH Run' (abbreviated prefix)", () => {
      const lines = [
        "EH Run #1882 Saturday Dec 19 \u2013 Christmas Hash/White Elephant",
        "Hares: Big Rubber",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(1882);
      expect(result!.startTime).toBe("14:00");
    });

    it("extracts Google Maps URL from location line", () => {
      const lines = [
        "EH3 Run # 1845 \u2013 Monday April 6 \u2013 Test Run",
        "Location: Gold Bar School (https://maps.app.goo.gl/75xjKmVABnt42zin6)",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result!.locationUrl).toBe("https://maps.app.goo.gl/75xjKmVABnt42zin6");
    });

    it("strips trailing '(URL)' from location text (#464)", () => {
      const lines = [
        "EH3 Run # 1845 \u2013 Monday April 6 \u2013 Test Run",
        "Location: Gold Bar Elementary School 10524 46 St NW (https://maps.app.goo.gl/75xjKmVABnt42zin6)",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result!.location).toBe("Gold Bar Elementary School 10524 46 St NW");
      expect(result!.locationUrl).toBe("https://maps.app.goo.gl/75xjKmVABnt42zin6");
    });
  });

  describe("OSH3 (osh3-ab)", () => {
    it("parses header + date on next line", () => {
      const lines = [
        "OSH3 #1061 \u2013 Spring Fling",
        "Sunday, March 22, 2026, at 2 PM",
        "Hares: Somebody",
        "Location: Whyte Ave",
      ];
      const result = parseEh3EventBlock(lines, "osh3-ab", "14:00");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(1061);
      expect(result!.title).toBe("Spring Fling");
      expect(result!.date).toBe("2026-03-22");
      expect(result!.hares).toBe("Somebody");
      expect(result!.startTime).toBe("14:00");
    });
  });

  describe("EFMH3 (efmh3)", () => {
    it("parses date-first header", () => {
      const lines = [
        "Friday April 3, 2026, 7pm: Full Moon Run 352",
        "Hares: Moonshine and Starstruck",
      ];
      const result = parseEh3EventBlock(lines, "efmh3", "19:00");
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-04-03");
      expect(result!.runNumber).toBe(352);
      expect(result!.title).toBe("Full Moon Run 352");
      expect(result!.hares).toBe("Moonshine and Starstruck");
    });
  });

  describe("BASH (bash-eh3)", () => {
    it("parses Bash header + date on next line", () => {
      const lines = [
        "Bash#857 \u2013 Bike Night",
        "Tuesday, Nov 25, 2025, 6:30pm",
        "Hares: Wheel Deal",
      ];
      const result = parseEh3EventBlock(lines, "bash-eh3", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(857);
      expect(result!.title).toBe("Bike Night");
      expect(result!.date).toBe("2025-11-25");
    });
  });

  describe("SNASH (snash-eh3)", () => {
    it("parses SNASH header + date on next line", () => {
      const lines = [
        "SNASH #285 \u2013 Snow Day",
        "Tues, March 31, 2026 6:30pm.",
        "Hares: Frosty",
      ];
      const result = parseEh3EventBlock(lines, "snash-eh3", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(285);
      expect(result!.title).toBe("Snow Day");
      expect(result!.date).toBe("2026-03-31");
    });
  });

  describe("DivaH3 (divah3-eh3)", () => {
    it("parses date-first header without run number", () => {
      const lines = [
        "Friday, March 13, 2026 \u2013 Bad Luck Hash",
        "Hares: Lucky Diva",
        "Location: Downtown",
      ];
      const result = parseEh3EventBlock(lines, "divah3-eh3", "19:00");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBeUndefined();
      expect(result!.title).toBe("Bad Luck Hash");
      expect(result!.date).toBe("2026-03-13");
      expect(result!.hares).toBe("Lucky Diva");
    });
  });

  describe("RASH (rash-eh3)", () => {
    it("parses RASH header + date on next line", () => {
      const lines = [
        "RASH #89 \u2013 Spring Ride",
        "Sunday, May 4, 2025, 11 am",
        "Hares: Roadkill",
        "Start: River Valley Parking Lot",
      ];
      const result = parseEh3EventBlock(lines, "rash-eh3", "13:00");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBe(89);
      expect(result!.title).toBe("Spring Ride");
      expect(result!.date).toBe("2025-05-04");
      expect(result!.location).toBe("River Valley Parking Lot");
    });
  });

  describe("EH3 special events without run number (#1045)", () => {
    it("parses 'AGPU' header with caps day-of-week", () => {
      const lines = ["AGPU (Annual General Piss Up)  SATURDAY AUGUST 29"];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBeUndefined();
      expect(result!.title).toBe("AGPU (Annual General Piss Up)");
      expect(result!.date).toMatch(/^\d{4}-08-29$/);
    });

    it("parses 'Special Event' header with date range", () => {
      const lines = [
        "Special Event: Hash in Grande Cache – May 22-24 – detrails to come",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).not.toBeNull();
      expect(result!.runNumber).toBeUndefined();
      expect(result!.title).toBe("Special Event: Hash in Grande Cache");
      expect(result!.date).toMatch(/^\d{4}-05-22$/);
    });

    it("returns null when no date is parseable", () => {
      const lines = ["Random unrelated paragraph with no date or run header"];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).toBeNull();
    });

    it("returns null for vague intro prose (no certain day)", () => {
      const lines = [
        "Unless otherwise posted, runs from April through September are held Mondays at 6:30 pm and runs from October through March are held Saturdays at 2:00 pm.",
      ];
      const result = parseEh3EventBlock(lines, "eh3-ab", "18:30");
      expect(result).toBeNull();
    });

    it("returns null for incidental dated prose without a special-event marker", () => {
      // A stray sentence with a certain date but no "Special Event:" prefix
      // or ALL-CAPS day-of-week must not be ingested as a phantom event.
      expect(parseEh3EventBlock(["Updated April 2, 2026"], "eh3-ab", "18:30")).toBeNull();
      expect(parseEh3EventBlock(
        ["Email the hares by April 15 to claim a date."],
        "eh3-ab",
        "18:30",
      )).toBeNull();
    });
  });
});

// ── Integration test for full adapter ──

describe("Eh3EdmontonAdapter", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const { safeFetch } = await import("../safe-fetch");
    vi.mocked(safeFetch).mockImplementation((url: string) => {
      const pageMatch = /pages\/(\d+)/.exec(url);
      const pageId = pageMatch ? Number.parseInt(pageMatch[1], 10) : 0;
      if (pageId === 423) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            content: { rendered: EH3_PAGE_HTML },
            modified: "2026-03-31T10:49:47",
          }),
        }) as never;
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          content: { rendered: "<p>No events</p>" },
          modified: "2026-03-01T00:00:00",
        }),
      }) as never;
    });
  });

  it("fetches and parses EH3 page 423 (live JSON fixture)", async () => {
    const { Eh3EdmontonAdapter } = await import("./eh3-edmonton");
    const adapter = new Eh3EdmontonAdapter();
    const source = {
      id: "test",
      url: "https://www.eh3.org/wp-json/wp/v2/pages/423",
      scrapeDays: 365,
    } as Source;

    const result = await adapter.fetch(source);

    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThanOrEqual(2);

    const firstEvent = result.events.find((e) => e.runNumber === 1845);
    expect(firstEvent).toBeDefined();
    expect(firstEvent!.kennelTag).toBe("eh3-ab");
    expect(firstEvent!.title).toBe("Test Run");
    expect(firstEvent!.hares).toBe("Spring Loaded and Soggy Bottom");
    expect(firstEvent!.date).toMatch(/^\d{4}-04-06$/);
    expect(firstEvent!.startTime).toBe("18:30"); // Monday

    const secondEvent = result.events.find((e) => e.runNumber === 1846);
    expect(secondEvent).toBeDefined();
    expect(secondEvent!.hares).toBe("More Dick Please");
  });
});
