import {
  parseMerseyNextRunBlock,
  parseMerseyNextRuns,
  parseMerseyPastRunLine,
  splitByYearMarkers,
  MerseyThirstdaysAdapter,
} from "./mersey-thirstdays";
import type { Source } from "@/generated/prisma/client";

// Freeze time so chrono-node date inference is deterministic
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MerseyThirstdaysAdapter", () => {
  describe("parseMerseyNextRunBlock", () => {
    it("parses a complete run block with all fields", () => {
      const block = [
        "16th April",
        "Run 600",
        "Hare: Snoozeanne",
        "On Inn: The Augustus John Peach St, Liverpool L3 5TX",
        "Nearest station: Liverpool Lime Street is 20 minutes walk away",
      ].join("\n");

      const run = parseMerseyNextRunBlock(block);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-04-16");
      expect(run!.runNumber).toBe(600);
      expect(run!.hares).toBe("Snoozeanne");
      expect(run!.location).toContain("Augustus John");
      expect(run!.location).toContain("L3 5TX");
      expect(run!.locationUrl).toContain("google.com/maps");
      expect(run!.nearestStation).toContain("Liverpool Lime Street");
      expect(run!.startTime).toBe("19:00");
    });

    it("handles TBC hares", () => {
      const block = [
        "30th April",
        "Run 599",
        "Hare: TBC",
      ].join("\n");

      const run = parseMerseyNextRunBlock(block);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-04-30");
      expect(run!.runNumber).toBe(599);
      expect(run!.hares).toBeUndefined();
    });

    it("parses A-to-B runs with Starting from field", () => {
      const block = [
        "28th May",
        "Run 602",
        "Hare: FCUK",
        "Starting from: Black Cat Parr Street, 25 Parr St, Liverpool L1 4JN",
        "Nearest station: Liverpool Central",
        "A to B run.",
      ].join("\n");

      const run = parseMerseyNextRunBlock(block);
      expect(run).not.toBeNull();
      expect(run!.location).toContain("Black Cat");
      expect(run!.location).toContain("L1 4JN");
      expect(run!.hares).toBe("FCUK");
    });

    it("parses multiple hares", () => {
      const block = [
        "18th June",
        "Run 604",
        "Hares: Snoozeanne and Mad Hatter",
      ].join("\n");

      const run = parseMerseyNextRunBlock(block);
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Snoozeanne and Mad Hatter");
    });

    it("handles special event without run number", () => {
      const block = [
        "9th May",
        "MTH3 600th Celebration Beatles Cruise",
        "Meet for 19:30 departure from Seacombe Ferry, Wallasey CH44 6PH",
      ].join("\n");

      const run = parseMerseyNextRunBlock(block);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-05-09");
      expect(run!.runNumber).toBeUndefined();
      expect(run!.location).toContain("CH44 6PH");
    });

    it("returns null for empty block", () => {
      expect(parseMerseyNextRunBlock("")).toBeNull();
      expect(parseMerseyNextRunBlock("  \n  ")).toBeNull();
    });

    it("returns null for block with no date", () => {
      expect(parseMerseyNextRunBlock("Some random text without dates")).toBeNull();
    });
  });

  describe("parseMerseyNextRuns", () => {
    it("splits on dash separators and parses each block", () => {
      const text = [
        "Instructions: meet at the On Inn",
        "-------------------------------------------------",
        "2nd April",
        "Run 598",
        "Hare: FCUK",
        "-------------------------------------------------",
        "16th April",
        "Run 600",
        "Hare: Snoozeanne",
      ].join("\n");

      const runs = parseMerseyNextRuns(text);
      expect(runs.length).toBe(2);
      expect(runs[0].runNumber).toBe(598);
      expect(runs[1].runNumber).toBe(600);
    });

    it("returns empty for text with no dash separators and no dates", () => {
      expect(parseMerseyNextRuns("Just some random text")).toEqual([]);
    });
  });

  describe("splitByYearMarkers", () => {
    it("splits text by year markers", () => {
      const text = [
        "597 19th March Hare 10 Seconds. Ring O' Bells, West Kirby",
        "596 5th March Hares Wigan Pier. The Royal Alfred",
        " ▲  2025  ▲",
        "590 11th December Hare PJ. The Bouverie, Chester",
        "589 27th November Hare FCUK. The George, Liverpool",
        " ▲  2024  ▲",
        "546 7 March Hare ET, The Aigburth Arms, Liverpool",
      ].join("\n");

      const sections = splitByYearMarkers(text);
      expect(sections.has(2026)).toBe(true);
      expect(sections.has(2025)).toBe(true);
      expect(sections.has(2024)).toBe(true);

      // Entries before first ▲ 2025 ▲ belong to 2026
      const y2026 = sections.get(2026)!;
      expect(y2026.length).toBe(2);
      expect(y2026[0]).toContain("597");

      const y2025 = sections.get(2025)!;
      expect(y2025.length).toBe(2);
      expect(y2025[0]).toContain("590");
    });

    it("handles variable whitespace in markers", () => {
      const text = [
        "100 1st Jan Hare Test. Pub, City",
        "▲ 2024 ▲",
        "99 15 Dec Hare Test2. Pub2, City2",
      ].join("\n");

      const sections = splitByYearMarkers(text);
      expect(sections.has(2025)).toBe(true);
      expect(sections.has(2024)).toBe(true);
    });
  });

  describe("parseMerseyPastRunLine", () => {
    it("parses modern format (2025+): period separator", () => {
      const run = parseMerseyPastRunLine(
        "597 19th March Hare 10 Seconds. Ring O' Bells, West Kirby",
        2026,
      );
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(597);
      expect(run!.date).toBe("2026-03-19");
      expect(run!.hares).toBe("10 Seconds");
      expect(run!.location).toContain("Ring O' Bells");
    });

    it("parses modern format with multiple hares", () => {
      const run = parseMerseyPastRunLine(
        "596 5th March Hares Wigan Pier and Now & Then. The Royal Alfred, St Helens",
        2026,
      );
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Wigan Pier and Now & Then");
      expect(run!.location).toContain("Royal Alfred");
    });

    it("parses mid format (2022-2023): colon after Hare", () => {
      const run = parseMerseyPastRunLine(
        "488 6 Jan Hare: ET, The Railway, Tithebarn St, Liverpool",
        2023,
      );
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(488);
      expect(run!.date).toBe("2023-01-06");
      expect(run!.hares).toBe("ET");
      expect(run!.location).toContain("Railway");
    });

    it("parses old format (2006-2021): location before hare", () => {
      const run = parseMerseyPastRunLine(
        "139 17 Dec Yuet Ben, Liverpool Hare: go On go On",
        2015,
      );
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(139);
      expect(run!.hares).toBe("go On go On");
      expect(run!.location).toContain("Yuet Ben");
      expect(run!.location).toContain("Liverpool");
    });

    it("parses old format with station location", () => {
      const run = parseMerseyPastRunLine(
        "20 21 Sep Conway Park Station Hare: Peter Pan & Miss Shiggy",
        2006,
      );
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(20);
      expect(run!.hares).toBe("Peter Pan & Miss Shiggy");
      expect(run!.location).toContain("Conway Park");
    });

    it("handles letter-suffix run numbers", () => {
      const run = parseMerseyPastRunLine(
        "395a 21 Feb Augustus John/Liverpool Beer Festival Hare: Victim",
        2020,
      );
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(395);
      expect(run!.runNumberRaw).toBe("395a");
    });

    it("handles entry with no hare", () => {
      const run = parseMerseyPastRunLine(
        "544 15 February Liverpool CAMRA Beer Festival",
        2025,
      );
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(544);
      expect(run!.hares).toBeUndefined();
    });

    it("handles abbreviated months", () => {
      const run = parseMerseyPastRunLine(
        "482 30 Sept Hare: Sticky Rice, The Wirral 100, Noctorum",
        2022,
      );
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2022-09-30");
    });

    it("returns null for empty text", () => {
      expect(parseMerseyPastRunLine("", 2026)).toBeNull();
    });

    it("returns null for non-run text", () => {
      expect(parseMerseyPastRunLine("Virtual Runs", 2021)).toBeNull();
    });
  });

  describe("adapter integration", () => {
    it("has correct type", () => {
      const adapter = new MerseyThirstdaysAdapter();
      expect(adapter.type).toBe("HTML_SCRAPER");
    });

    it("parses realistic next-runs HTML fixture", async () => {
      const mockNextRunsHtml = `<html><body>
        <div id="content_area">
          <div id="matrix_95499">
            <div class="n module-type-text diyfeLiveArea">
              <div dir="auto">
                <div style="font-size:15.4px;">Instructions: meet at the On Inn location at 7pm</div>
                <div style="font-size:15.4px;">-------------------------------------------------</div>
                <div style="font-size:15.4px;">16th April</div>
                <div style="font-size:15.4px;"><strong>Run 600</strong></div>
                <div style="font-size:15.4px;">Hare: Snoozeanne</div>
                <div style="font-size:15.4px;">On Inn: The Augustus John Peach St, Liverpool L3 5TX</div>
                <div style="font-size:15.4px;">Nearest station: Liverpool Lime Street</div>
                <div style="font-size:15.4px;">-------------------------------------------------</div>
                <div style="font-size:15.4px;">30th April</div>
                <div style="font-size:15.4px;">Run 599</div>
                <div style="font-size:15.4px;">Hare: TBC</div>
              </div>
            </div>
          </div>
        </div>
      </body></html>`;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockNextRunsHtml),
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const adapter = new MerseyThirstdaysAdapter();
      const source = {
        id: "test",
        url: "https://www.merseythirstdayshash.com/next-run-s/",
        config: {},
      } as unknown as Source;

      const result = await adapter.fetch(source, { days: 365 });
      expect(result.events.length).toBeGreaterThanOrEqual(1);

      const run600 = result.events.find((e) => e.runNumber === 600);
      expect(run600).toBeDefined();
      expect(run600!.date).toBe("2026-04-16");
      expect(run600!.hares).toBe("Snoozeanne");
      expect(run600!.location).toContain("Augustus John");
      expect(run600!.kennelTag).toBe("MTH3");
      expect(run600!.startTime).toBe("19:00");
    });

    it("fetches both pages and deduplicates by run number", async () => {
      const mockNextHtml = `<html><body>
        <div class="n module-type-text diyfeLiveArea">
          <div>-------------------------------------------------</div>
          <div>16th April</div>
          <div><strong>Run 600</strong></div>
          <div>Hare: Snoozeanne</div>
          <div>On Inn: The Augustus John Peach St, Liverpool L3 5TX</div>
        </div>
      </body></html>`;

      const mockPastHtml = `<html><body>
        <div class="n module-type-text diyfeLiveArea">
          <div>600 16th April Hare Snoozeanne. The Augustus John, Liverpool</div>
          <div>▲  2025  ▲</div>
          <div>580 11 December Hare FCUK. The Bouverie, Chester</div>
        </div>
      </body></html>`;

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        const html = callCount === 1 ? mockNextHtml : mockPastHtml;
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(html),
          status: 200,
          statusText: "OK",
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const adapter = new MerseyThirstdaysAdapter();
      const source = {
        id: "test",
        url: "https://www.merseythirstdayshash.com/next-run-s/",
        config: {
          pastRunsUrl: "https://www.merseythirstdayshash.com/past-runs/",
        },
      } as unknown as Source;

      const result = await adapter.fetch(source, { days: 7300 });

      // Run 600 should appear once (from next-runs, deduped from past)
      const run600s = result.events.filter((e) => e.runNumber === 600);
      expect(run600s.length).toBe(1);
      expect(run600s[0].sourceUrl).toContain("next-run-s"); // From next-runs page

      // Run 580 should appear from past-runs
      const run580 = result.events.find((e) => e.runNumber === 580);
      expect(run580).toBeDefined();
      expect(run580!.date).toBe("2025-12-11");
      expect(run580!.hares).toBe("FCUK");
    });
  });
});
