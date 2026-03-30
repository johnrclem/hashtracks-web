import {
  parseSamuraiDate,
  parseSamuraiRow,
  buildColumnMap,
  SamuraiH3Adapter,
} from "./samurai-h3";
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

describe("SamuraiH3Adapter", () => {
  describe("parseSamuraiDate", () => {
    it("parses '28-Mar'", () => {
      expect(parseSamuraiDate("28-Mar")).toBe("2026-03-28");
    });

    it("parses '4-April'", () => {
      expect(parseSamuraiDate("4-April")).toBe("2026-04-04");
    });

    it("parses '11-April'", () => {
      expect(parseSamuraiDate("11-April")).toBe("2026-04-11");
    });

    it("parses '1-Jan' as next year when more than 3 months ago", () => {
      // Current date is 2026-03-01, Jan 1 2026 is only 2 months ago — same year
      expect(parseSamuraiDate("1-Jan")).toBe("2026-01-01");
    });

    it("parses '1-Nov' as same year when in the future", () => {
      expect(parseSamuraiDate("1-Nov")).toBe("2026-11-01");
    });

    it("wraps to next year when date is far in the past", () => {
      // Set time to December — a June date would be 6 months ago
      vi.setSystemTime(new Date("2026-12-01T12:00:00.000Z"));
      expect(parseSamuraiDate("1-Jun")).toBe("2027-06-01");
    });

    it("returns null for invalid month", () => {
      expect(parseSamuraiDate("28-Foo")).toBeNull();
    });

    it("returns null for invalid day", () => {
      expect(parseSamuraiDate("32-Mar")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseSamuraiDate("")).toBeNull();
    });

    it("returns null for text without dash", () => {
      expect(parseSamuraiDate("March 28")).toBeNull();
    });
  });

  describe("buildColumnMap", () => {
    it("maps all Samurai table headers", () => {
      const headers = ["Date", "Time", "Venue", "Train", "Hare", "Sweep", "Fee", "Note", "#"];
      const map = buildColumnMap(headers);
      expect(map.get("date")).toBe(0);
      expect(map.get("time")).toBe(1);
      expect(map.get("venue")).toBe(2);
      expect(map.get("train")).toBe(3);
      expect(map.get("hare")).toBe(4);
      expect(map.get("sweep")).toBe(5);
      expect(map.get("fee")).toBe(6);
      expect(map.get("note")).toBe(7);
      expect(map.get("runNumber")).toBe(8);
    });
  });

  describe("parseSamuraiRow", () => {
    const columnMap = buildColumnMap([
      "Date", "Time", "Venue", "Train", "Hare", "Sweep", "Fee", "Note", "#",
    ]);

    it("parses a complete row", () => {
      const cells = [
        "28-Mar",
        "14:00",
        "Shibuya Station",
        "Yamanote Line",
        "Hashimoto",
        "Sake Bomb",
        "1500 yen",
        "Spring run",
        "123",
      ];
      const run = parseSamuraiRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-03-28");
      expect(run!.startTime).toBe("14:00");
      expect(run!.location).toBe("Shibuya Station");
      expect(run!.hares).toBe("Hashimoto; Sweep: Sake Bomb");
      expect(run!.runNumber).toBe(123);
      expect(run!.fee).toBe("1500 yen");
      expect(run!.note).toBe("Spring run");
      expect(run!.train).toBe("Yamanote Line");
    });

    it("handles row with TBC fields", () => {
      const cells = [
        "4-April",
        "13:00",
        "TBC",
        "TBC",
        "TBC",
        "TBC",
        "TBC",
        "",
        "124",
      ];
      const run = parseSamuraiRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-04-04");
      expect(run!.startTime).toBe("13:00");
      expect(run!.location).toBeUndefined();
      expect(run!.hares).toBeUndefined();
      expect(run!.runNumber).toBe(124);
    });

    it("returns null for invalid date", () => {
      const cells = [
        "invalid",
        "14:00",
        "Venue",
        "Train",
        "Hare",
        "Sweep",
        "Fee",
        "Note",
        "125",
      ];
      const run = parseSamuraiRow(cells, columnMap);
      expect(run).toBeNull();
    });

    it("handles missing run number", () => {
      const cells = [
        "28-Mar",
        "14:00",
        "Shibuya",
        "",
        "Hashimoto",
        "",
        "",
        "",
        "",
      ];
      const run = parseSamuraiRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBeUndefined();
    });
  });

  describe("adapter integration", () => {
    it("has correct type", () => {
      const adapter = new SamuraiH3Adapter();
      expect(adapter.type).toBe("HTML_SCRAPER");
    });

    it("parses mock table HTML with correct kennelTag", async () => {
      const mockHtml = `<!DOCTYPE html><html><body>
        <table>
          <thead>
            <tr><th>Date</th><th>Time</th><th>Venue</th><th>Train</th><th>Hare</th><th>Sweep</th><th>Fee</th><th>Note</th><th>#</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>28-Mar</td>
              <td>14:00</td>
              <td>Shibuya Station</td>
              <td>Yamanote Line</td>
              <td>Hashimoto</td>
              <td>Sake Bomb</td>
              <td>1500 yen</td>
              <td>Spring run</td>
              <td>123</td>
            </tr>
            <tr>
              <td>4-April</td>
              <td>13:00</td>
              <td>Shinjuku Park</td>
              <td>Chuo Line</td>
              <td>Sushi Roll</td>
              <td></td>
              <td>1500 yen</td>
              <td></td>
              <td>124</td>
            </tr>
          </tbody>
        </table>
      </body></html>`;

      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue(mockHtml);

      const adapter = new SamuraiH3Adapter();
      const source = {
        id: "test",
        url: "https://samuraihash2017.wixsite.com/samurai/hare-line",
        config: {},
      } as unknown as Source;

      const result = await adapter.fetch(source, { days: 365 });

      expect(result.events.length).toBe(2);

      const run123 = result.events.find((e) => e.runNumber === 123);
      expect(run123).toBeDefined();
      expect(run123!.date).toBe("2026-03-28");
      expect(run123!.startTime).toBe("14:00");
      expect(run123!.title).toBe("Samurai H3 #123");
      expect(run123!.kennelTag).toBe("samurai-h3");
      expect(run123!.hares).toBe("Hashimoto; Sweep: Sake Bomb");

      const run124 = result.events.find((e) => e.runNumber === 124);
      expect(run124).toBeDefined();
      expect(run124!.date).toBe("2026-04-04");
      expect(run124!.kennelTag).toBe("samurai-h3");
    });

    it("verifies browserRender is called with frameUrl option", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue("<html><body></body></html>");

      const adapter = new SamuraiH3Adapter();
      const source = {
        id: "test",
        url: "https://samuraihash2017.wixsite.com/samurai/hare-line",
        config: {},
      } as unknown as Source;

      await adapter.fetch(source, { days: 365 });

      expect(browserRender).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://samuraihash2017.wixsite.com/samurai/hare-line",
          frameUrl: "wix-visual-data.appspot.com",
          waitFor: "iframe[title='Table Master']",
        }),
      );
    });
  });
});
