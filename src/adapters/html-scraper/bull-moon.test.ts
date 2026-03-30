import {
  classifyBullMoonEvent,
  parseBmDate,
  parseBullMoonRow,
  buildColumnMap,
  BullMoonAdapter,
} from "./bull-moon";
import type { Source } from "@/generated/prisma/client";

vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn().mockResolvedValue("<html><body></body></html>"),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("BullMoonAdapter", () => {
  describe("classifyBullMoonEvent", () => {
    it("classifies Bull Moon run with emoji", () => {
      const result = classifyBullMoonEvent("🐂 Run 124; 🐣🐰Easter");
      expect(result.series).toBe("bull-moon");
      expect(result.runNumber).toBe(124);
      expect(result.cleanTitle).not.toContain("🐂");
    });

    it("classifies T3 run", () => {
      const result = classifyBullMoonEvent("T3 Run 201");
      expect(result.series).toBe("t3");
      expect(result.runNumber).toBe(201);
    });

    it("classifies T3 run with theme", () => {
      const result = classifyBullMoonEvent("T3 Run 202; 🧀Cheese Night");
      expect(result.series).toBe("t3");
      expect(result.runNumber).toBe(202);
    });

    it("classifies T3 Social", () => {
      const result = classifyBullMoonEvent("🍻T3 Social");
      expect(result.series).toBe("social");
      expect(result.runNumber).toBeUndefined();
    });

    it("classifies special event", () => {
      const result = classifyBullMoonEvent("Peaky Blinders 12");
      expect(result.series).toBe("special");
      expect(result.runNumber).toBeUndefined();
    });

    it("classifies Bull Moon run without emoji", () => {
      const result = classifyBullMoonEvent("Run 130");
      expect(result.series).toBe("bull-moon");
      expect(result.runNumber).toBe(130);
    });

    it("classifies Bull Moon with Blue Moon theme", () => {
      const result = classifyBullMoonEvent("🐂 Run 125; 🌕 Blue Moon");
      expect(result.series).toBe("bull-moon");
      expect(result.runNumber).toBe(125);
    });
  });

  describe("parseBmDate", () => {
    it("parses 'Thu, 2 Apr 26'", () => {
      expect(parseBmDate("Thu, 2 Apr 26")).toBe("2026-04-02");
    });

    it("parses 'Sat, 20 Feb 16'", () => {
      expect(parseBmDate("Sat, 20 Feb 16")).toBe("2016-02-20");
    });

    it("parses 'Sat, 15 Nov 25'", () => {
      expect(parseBmDate("Sat, 15 Nov 25")).toBe("2025-11-15");
    });

    it("parses date without comma", () => {
      expect(parseBmDate("Thu 2 Apr 26")).toBe("2026-04-02");
    });

    it("rejects invalid day for month", () => {
      expect(parseBmDate("Thu, 31 Apr 26")).toBeNull();
    });

    it("returns null for invalid text", () => {
      expect(parseBmDate("not a date")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseBmDate("")).toBeNull();
    });
  });

  describe("buildColumnMap", () => {
    it("maps upcoming runs headers", () => {
      const headers = ["Date", "Time", "Event", "Hares", "Venue", "Nearest Station"];
      const map = buildColumnMap(headers);
      expect(map.get("date")).toBe(0);
      expect(map.get("time")).toBe(1);
      expect(map.get("event")).toBe(2);
      expect(map.get("hares")).toBe(3);
      expect(map.get("venue")).toBe(4);
      expect(map.get("nearest station")).toBe(5);
    });

    it("maps receding hareline headers (no Time or Station)", () => {
      const headers = ["Date", "Event", "Hares", "Venue"];
      const map = buildColumnMap(headers);
      expect(map.get("date")).toBe(0);
      expect(map.get("event")).toBe(1);
      expect(map.get("hares")).toBe(2);
      expect(map.get("venue")).toBe(3);
      expect(map.has("time")).toBe(false);
    });
  });

  describe("parseBullMoonRow", () => {
    const upcomingColumns = buildColumnMap([
      "Date", "Time", "Event", "Hares", "Venue", "Nearest Station",
    ]);

    it("parses a T3 run row", () => {
      const cells = [
        "Thu, 2 Apr 26",
        "6:45 pm",
        "T3 Run 201",
        "Wriggle",
        "Seven Stars, Rugby, CV21 2SH",
        "Jewellery Quarter (5 mins)",
      ];
      const run = parseBullMoonRow(cells, upcomingColumns);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-04-02");
      expect(run!.startTime).toBe("18:45");
      expect(run!.series).toBe("t3");
      expect(run!.runNumber).toBe(201);
      expect(run!.hares).toBe("Wriggle");
      expect(run!.location).toContain("Seven Stars");
      expect(run!.location).toContain("CV21 2SH");
      expect(run!.locationUrl).toContain("google.com/maps");
      expect(run!.nearestStation).toContain("Jewellery Quarter");
    });

    it("parses a Bull Moon run row", () => {
      const cells = [
        "Sat, 12 Apr 26",
        "12:00 pm",
        "🐂 Run 124; 🐣🐰Easter",
        "Mr Sheep & Fill My Cavity",
        "Duke Inn, 12 Duke Street, Sutton Coldfield, B73 1RJ",
        "n/a",
      ];
      const run = parseBullMoonRow(cells, upcomingColumns);
      expect(run).not.toBeNull();
      expect(run!.series).toBe("bull-moon");
      expect(run!.runNumber).toBe(124);
      expect(run!.startTime).toBe("12:00");
      expect(run!.hares).toBe("Mr Sheep & Fill My Cavity");
      expect(run!.location).toContain("Duke Inn");
      expect(run!.nearestStation).toBeUndefined();
    });

    it("handles TBC time with series default", () => {
      const cells = [
        "Sat, 10 May 26",
        "Tbc",
        "🐂 Run 125",
        "TBC",
        "TBC",
        "n/a",
      ];
      const run = parseBullMoonRow(cells, upcomingColumns);
      expect(run).not.toBeNull();
      expect(run!.startTime).toBe("12:00");
      expect(run!.hares).toBeUndefined();
      expect(run!.location).toBeUndefined();
    });

    it("strips emojis and CAZ from venue", () => {
      const cells = [
        "Thu, 3 Apr 26",
        "6:45 pm",
        "T3 Run 202",
        "Clueless",
        "Jewellers Arms 🍺, 23 Hockley Street, B18 6BW🚗 within CAZ",
        "Jewellery Quarter",
      ];
      const run = parseBullMoonRow(cells, upcomingColumns);
      expect(run).not.toBeNull();
      expect(run!.location).not.toContain("🍺");
      expect(run!.location).not.toContain("CAZ");
      expect(run!.location).toContain("B18 6BW");
    });

    it("parses receding hareline row (no Time/Station columns)", () => {
      const recedingColumns = buildColumnMap(["Date", "Event", "Hares", "Venue"]);
      const cells = [
        "Thu, 26 Mar 26",
        "T3 Run 200",
        "Clueless & Dangerless",
        "Duke Inn, 12 Duke Street, Sutton Coldfield, B73 1RJ",
      ];
      const run = parseBullMoonRow(cells, recedingColumns);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-03-26");
      expect(run!.series).toBe("t3");
      expect(run!.startTime).toBe("18:45");
      expect(run!.hares).toBe("Clueless & Dangerless");
    });
  });

  describe("adapter integration", () => {
    it("has correct type", () => {
      const adapter = new BullMoonAdapter();
      expect(adapter.type).toBe("HTML_SCRAPER");
    });

    it("parses mock table HTML with correct kennelTag", async () => {
      const mockHtml = `<!DOCTYPE html><html><body>
        <table>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Event</th><th>Hares</th><th>Venue</th><th>Nearest Station</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Thu, 2 Apr 26</td>
              <td>6:45 pm</td>
              <td>T3 Run 201</td>
              <td>Wriggle</td>
              <td>Seven Stars, Rugby, CV21 2SH</td>
              <td>Jewellery Quarter</td>
            </tr>
            <tr>
              <td>Sat, 12 Apr 26</td>
              <td>12:00 pm</td>
              <td>🐂 Run 124</td>
              <td>Mr Sheep</td>
              <td>Duke Inn, B73 1RJ</td>
              <td>n/a</td>
            </tr>
            <tr>
              <td>Thu, 9 Apr 26</td>
              <td>6:45 pm</td>
              <td>🍻T3 Social</td>
              <td>n/a</td>
              <td>The Victoria, B1 1BD</td>
              <td>New Street</td>
            </tr>
          </tbody>
        </table>
      </body></html>`;

      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue(mockHtml);

      const adapter = new BullMoonAdapter();
      const source = {
        id: "test",
        url: "https://www.bullmoonh3.co.uk/upcoming-runs",
        config: {},
      } as unknown as Source;

      const result = await adapter.fetch(source, { days: 365 });

      expect(result.events.length).toBe(3);

      const t3Run = result.events.find((e) => e.runNumber === 201);
      expect(t3Run).toBeDefined();
      expect(t3Run!.date).toBe("2026-04-02");
      expect(t3Run!.startTime).toBe("18:45");
      expect(t3Run!.title).toBe("T3 #201");
      expect(t3Run!.kennelTag).toBe("bullmoon");

      const bmRun = result.events.find((e) => e.runNumber === 124);
      expect(bmRun).toBeDefined();
      expect(bmRun!.startTime).toBe("12:00");
      expect(bmRun!.title).toBe("Bull Moon #124");
      expect(bmRun!.kennelTag).toBe("bullmoon");

      const social = result.events.find((e) => !e.runNumber);
      expect(social).toBeDefined();
      expect(social!.kennelTag).toBe("bullmoon");
    });

    it("verifies browserRender is called with frameUrl option", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue("<html><body></body></html>");

      const adapter = new BullMoonAdapter();
      const source = {
        id: "test",
        url: "https://www.bullmoonh3.co.uk/upcoming-runs",
        config: {
          upcomingCompId: "comp-abc123",
        },
      } as unknown as Source;

      await adapter.fetch(source, { days: 30 });

      expect(browserRender).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://www.bullmoonh3.co.uk/upcoming-runs",
          frameUrl: "comp-abc123",
          waitFor: "iframe[title='Table Master']",
        }),
      );
    });
  });
});
