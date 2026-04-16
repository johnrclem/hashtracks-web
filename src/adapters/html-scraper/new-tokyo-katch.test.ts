import {
  parseNtkDate,
  parseNtkRow,
  buildColumnMap,
  overseasCountryOverride,
  NewTokyoKatchAdapter,
} from "./new-tokyo-katch";
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

describe("NewTokyoKatchAdapter", () => {
  describe("parseNtkDate", () => {
    it("parses '31-Jan-2026'", () => {
      expect(parseNtkDate("31-Jan-2026")).toBe("2026-01-31");
    });

    it("parses '17-Apr-2026'", () => {
      expect(parseNtkDate("17-Apr-2026")).toBe("2026-04-17");
    });

    it("parses '1-May-2026' (single-digit day)", () => {
      expect(parseNtkDate("1-May-2026")).toBe("2026-05-01");
    });

    it("parses full month name '15-March-2026'", () => {
      expect(parseNtkDate("15-March-2026")).toBe("2026-03-15");
    });

    it("returns null for invalid month", () => {
      expect(parseNtkDate("15-Foo-2026")).toBeNull();
    });

    it("returns null for invalid day", () => {
      expect(parseNtkDate("32-Jan-2026")).toBeNull();
    });

    it("returns null for Feb 30", () => {
      expect(parseNtkDate("30-Feb-2026")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseNtkDate("")).toBeNull();
    });

    it("returns null for missing year", () => {
      expect(parseNtkDate("31-Jan")).toBeNull();
    });

    it("returns null for text without dashes", () => {
      expect(parseNtkDate("January 31 2026")).toBeNull();
    });
  });

  describe("buildColumnMap", () => {
    it("maps all NTK table headers", () => {
      const headers = ["DATE", "RUN", "VENUE", "LINE", "HARE", "SWEEP", "REMARK"];
      const map = buildColumnMap(headers);
      expect(map.get("date")).toBe(0);
      expect(map.get("run")).toBe(1);
      expect(map.get("venue")).toBe(2);
      expect(map.get("line")).toBe(3);
      expect(map.get("hare")).toBe(4);
      expect(map.get("sweep")).toBe(5);
      expect(map.get("remark")).toBe(6);
    });
  });

  describe("parseNtkRow", () => {
    const columnMap = buildColumnMap([
      "DATE", "RUN", "VENUE", "LINE", "HARE", "SWEEP", "REMARK",
    ]);

    it("parses a complete row", () => {
      const cells = [
        "17-Apr-2026",
        "456",
        "Roppongi Station",
        "Hibiya Line",
        "Tokyo Runner",
        "Noodle King",
        "Cherry blossom run",
      ];
      const run = parseNtkRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-04-17");
      expect(run!.runNumber).toBe(456);
      expect(run!.location).toBe("Roppongi Station");
      expect(run!.line).toBe("Hibiya Line");
      expect(run!.hares).toBe("Tokyo Runner; Sweep: Noodle King");
      expect(run!.remark).toBe("Cherry blossom run");
    });

    it("handles row with TBC fields", () => {
      const cells = [
        "31-Jan-2026",
        "457",
        "TBC",
        "TBC",
        "TBC",
        "TBC",
        "",
      ];
      const run = parseNtkRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-01-31");
      expect(run!.runNumber).toBe(457);
      expect(run!.location).toBeUndefined();
      expect(run!.hares).toBeUndefined();
    });

    it("returns null for invalid date", () => {
      const cells = [
        "invalid-date",
        "458",
        "Venue",
        "Line",
        "Hare",
        "Sweep",
        "Remark",
      ];
      const run = parseNtkRow(cells, columnMap);
      expect(run).toBeNull();
    });

    it("handles missing run number", () => {
      const cells = [
        "17-Apr-2026",
        "",
        "Shibuya",
        "",
        "Runner",
        "",
        "",
      ];
      const run = parseNtkRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.runNumber).toBeUndefined();
      expect(run!.hares).toBe("Runner");
    });

    it("handles hare only (no sweep)", () => {
      const cells = [
        "17-Apr-2026",
        "459",
        "Akihabara",
        "Chuo Line",
        "Hash Master",
        "",
        "",
      ];
      const run = parseNtkRow(cells, columnMap);
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Hash Master");
    });
  });

  describe("overseasCountryOverride", () => {
    it("returns '' (no-bias sentinel) for REMARK containing 'Overseas' (#741)", () => {
      expect(overseasCountryOverride("Annual Overseas Run")).toBe("");
      expect(overseasCountryOverride("OVERSEAS trip")).toBe("");
    });

    it("returns undefined for domestic REMARK", () => {
      expect(overseasCountryOverride("Bring rain gear")).toBeUndefined();
      expect(overseasCountryOverride("Cherry blossom run")).toBeUndefined();
    });

    it("matches 'overseas' only as a whole word", () => {
      // Word-boundary anchors avoid matching 'overseasoned' or similar substrings.
      expect(overseasCountryOverride("overseasoned")).toBeUndefined();
    });

    it("returns undefined for empty or missing remark", () => {
      expect(overseasCountryOverride(undefined)).toBeUndefined();
      expect(overseasCountryOverride("")).toBeUndefined();
    });
  });

  describe("overseas row propagates countryOverride", () => {
    it("emits countryOverride='' in RawEventData for an overseas row", async () => {
      const mockHtml = `<!DOCTYPE html><html><body>
        <table>
          <thead>
            <tr><th>DATE</th><th>RUN</th><th>VENUE</th><th>LINE</th><th>HARE</th><th>SWEEP</th><th>REMARK</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>17-Apr-2026</td><td>70</td><td>Taoyuan</td><td>TBC</td><td>TBC</td><td>TBC</td><td>Annual Overseas Run</td>
            </tr>
            <tr>
              <td>24-Apr-2026</td><td>71</td><td>Shibuya</td><td>Ginza Line</td><td>Sushi Roll</td><td></td><td>Bring rain gear</td>
            </tr>
          </tbody>
        </table>
      </body></html>`;
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue(mockHtml);
      const adapter = new NewTokyoKatchAdapter();
      const result = await adapter.fetch({
        id: "test",
        url: "https://newtokyohash.wixsite.com/newtokyokatchhash/hareline",
        config: {},
      } as unknown as Source, { days: 365 });
      const overseas = result.events.find((e) => e.runNumber === 70);
      const domestic = result.events.find((e) => e.runNumber === 71);
      expect(overseas?.countryOverride).toBe("");
      expect(domestic?.countryOverride).toBeUndefined();
    });
  });

  describe("adapter integration", () => {
    it("has correct type", () => {
      const adapter = new NewTokyoKatchAdapter();
      expect(adapter.type).toBe("HTML_SCRAPER");
    });

    it("parses mock table HTML with correct kennelTag", async () => {
      const mockHtml = `<!DOCTYPE html><html><body>
        <table>
          <thead>
            <tr><th>DATE</th><th>RUN</th><th>VENUE</th><th>LINE</th><th>HARE</th><th>SWEEP</th><th>REMARK</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>31-Jan-2026</td>
              <td>456</td>
              <td>Roppongi Station</td>
              <td>Hibiya Line</td>
              <td>Tokyo Runner</td>
              <td>Noodle King</td>
              <td>New Year run</td>
            </tr>
            <tr>
              <td>17-Apr-2026</td>
              <td>457</td>
              <td>Shinjuku Park</td>
              <td>Marunouchi Line</td>
              <td>Sushi Roll</td>
              <td></td>
              <td>Cherry blossom</td>
            </tr>
          </tbody>
        </table>
      </body></html>`;

      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue(mockHtml);

      const adapter = new NewTokyoKatchAdapter();
      const source = {
        id: "test",
        url: "https://newtokyohash.wixsite.com/newtokyokatchhash/hareline",
        config: {},
      } as unknown as Source;

      const result = await adapter.fetch(source, { days: 365 });

      expect(result.events.length).toBe(2);

      const run456 = result.events.find((e) => e.runNumber === 456);
      expect(run456).toBeDefined();
      expect(run456!.date).toBe("2026-01-31");
      expect(run456!.title).toBe("New Tokyo Katch #456");
      expect(run456!.kennelTag).toBe("new-tokyo-katch");
      expect(run456!.hares).toBe("Tokyo Runner; Sweep: Noodle King");

      const run457 = result.events.find((e) => e.runNumber === 457);
      expect(run457).toBeDefined();
      expect(run457!.date).toBe("2026-04-17");
      expect(run457!.kennelTag).toBe("new-tokyo-katch");
    });

    it("verifies browserRender is called with frameUrl option", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValue("<html><body></body></html>");

      const adapter = new NewTokyoKatchAdapter();
      const source = {
        id: "test",
        url: "https://newtokyohash.wixsite.com/newtokyokatchhash/hareline",
        config: {},
      } as unknown as Source;

      await adapter.fetch(source, { days: 365 });

      expect(browserRender).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://newtokyohash.wixsite.com/newtokyokatchhash/hareline",
          frameUrl: "comp-lg062cu2",
          waitFor: "iframe[title='Table Master']",
        }),
      );
    });
  });
});
