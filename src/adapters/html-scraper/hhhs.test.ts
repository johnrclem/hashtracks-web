import {
  parseHHHSDate,
  parseHHHSRow,
  buildColumnMap,
  buildTitle,
  HHHSAdapter,
} from "./hhhs";
import type { Source } from "@/generated/prisma/client";

vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn().mockResolvedValue("<html><body></body></html>"),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-18T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// Representative table from the HHHS Wix Table Master iframe (issue #1474).
// Columns: Run#, Date, Hares, Location, Notes — verbatim row text from the
// hareline screenshot.
const FIXTURE_HTML = `
<html>
  <body>
    <table>
      <thead>
        <tr>
          <th>Run#</th>
          <th>Date</th>
          <th>Hares</th>
          <th>Location</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>3289</td>
          <td>9 February 2026</td>
          <td>Committee</td>
          <td>Kranji War Memorial</td>
          <td>AGM and Gisbert Memorial Run - T-Shirts</td>
        </tr>
        <tr>
          <td>3290</td>
          <td>16 February 2026</td>
          <td>Pasi</td>
          <td>42 Ridout Road - Pasi's place</td>
          <td>Pizza on site</td>
        </tr>
        <tr>
          <td>3293</td>
          <td>9 March 2026</td>
          <td>Meinte &amp; Tony</td>
          <td>Toa Payoh E</td>
          <td>Woodleigh Wack &amp; Wail run</td>
        </tr>
        <tr>
          <td>3295</td>
          <td>23 March 2026</td>
          <td>Larry &amp; Stan</td>
          <td>118 Depot Lane</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

describe("HHHSAdapter", () => {
  describe("parseHHHSDate", () => {
    it.each([
      ["29 December 2025", "2025-12-29"],
      ["5 January 2026", "2026-01-05"],
      ["9 February 2026", "2026-02-09"],
      ["16 February 2026", "2026-02-16"],
      ["1 May 2027", "2027-05-01"],
    ])("parses %s", (input, expected) => {
      expect(parseHHHSDate(input)).toBe(expected);
    });

    it.each([
      ["", "empty"],
      ["February 16 2026", "month-first"],
      ["16/02/2026", "slash format"],
      ["16 Foo 2026", "invalid month"],
      ["32 March 2026", "invalid day"],
      ["16 Feb 26", "abbreviated month + 2-digit year"],
    ])("returns null for %s (%s)", (input) => {
      expect(parseHHHSDate(input)).toBeNull();
    });
  });

  describe("buildColumnMap", () => {
    it("maps the canonical HHHS headers", () => {
      const headers = ["Run#", "Date", "Hares", "Location", "Notes"];
      const map = buildColumnMap(headers);
      expect(map.get("runNumber")).toBe(0);
      expect(map.get("date")).toBe(1);
      expect(map.get("hares")).toBe(2);
      expect(map.get("location")).toBe(3);
      expect(map.get("notes")).toBe(4);
    });

    it.each([
      ["Run #", "runNumber"],
      ["RUN#", "runNumber"],
      ["run number", "runNumber"],
      ["Hare", "hares"],
      ["Venue", "location"],
      ["Note", "notes"],
      ["Theme", "notes"],
    ])("normalizes header %s → %s", (header, key) => {
      const map = buildColumnMap([header]);
      expect(map.get(key)).toBe(0);
    });
  });

  describe("buildTitle", () => {
    it("synthesizes 'HHHS Trail #<run>' when a run number is present", () => {
      expect(buildTitle({ date: "2026-02-16", runNumber: 3290 })).toBe(
        "HHHS Trail #3290",
      );
    });

    it("falls back to 'HHHS Run' when the run number is missing", () => {
      expect(buildTitle({ date: "2026-02-16" })).toBe("HHHS Run");
    });

    it("ignores notes — title is always synthesized, not promoted", () => {
      // Codex flagged the earlier code that mapped Notes -> title. Both
      // logistics blurbs and real-event-name shapes must collapse to the
      // synthesized title; Notes belongs in description.
      expect(
        buildTitle({ date: "2026-02-16", runNumber: 3290, notes: "Pizza on site" }),
      ).toBe("HHHS Trail #3290");
      expect(
        buildTitle({
          date: "2026-03-16",
          runNumber: 3294,
          notes: "St Patrick's Day Run",
        }),
      ).toBe("HHHS Trail #3294");
    });
  });

  describe("parseHHHSRow", () => {
    const headers = ["Run#", "Date", "Hares", "Location", "Notes"];
    const columnMap = buildColumnMap(headers);

    it("extracts all five columns for a full row", () => {
      const cells = [
        "3290",
        "16 February 2026",
        "Pasi",
        "42 Ridout Road - Pasi's place",
        "Pizza on site",
      ];
      expect(parseHHHSRow(cells, columnMap)).toEqual({
        date: "2026-02-16",
        runNumber: 3290,
        hares: "Pasi",
        location: "42 Ridout Road - Pasi's place",
        notes: "Pizza on site",
      });
    });

    it("leaves notes undefined when the cell is blank", () => {
      const cells = ["3295", "23 March 2026", "Larry & Stan", "118 Depot Lane", ""];
      const parsed = parseHHHSRow(cells, columnMap);
      expect(parsed?.date).toBe("2026-03-23");
      expect(parsed?.notes).toBeUndefined();
    });

    it("returns null when the date column is unparseable", () => {
      const cells = ["3290", "TBA", "Pasi", "42 Ridout Road", "Pizza on site"];
      expect(parseHHHSRow(cells, columnMap)).toBeNull();
    });

    it("returns null when the date column is empty", () => {
      const cells = ["3290", "", "Pasi", "42 Ridout Road", "Pizza on site"];
      expect(parseHHHSRow(cells, columnMap)).toBeNull();
    });
  });

  describe("fetch()", () => {
    const source = {
      id: "src-hhhs",
      url: "https://www.hhhs.org.sg/hareline",
      type: "HTML_SCRAPER",
    } as unknown as Source;

    it("parses the hareline table end-to-end", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValueOnce(FIXTURE_HTML);

      const result = await new HHHSAdapter().fetch(source);

      expect(result.events).toHaveLength(4);
      expect(result.errors).toEqual([]);
      expect(result.diagnosticContext).toMatchObject({
        fetchMethod: "browser-render",
        adapter: "HHHSAdapter",
        totalEvents: 4,
      });

      const ridout = result.events.find((e) => e.runNumber === 3290);
      expect(ridout).toMatchObject({
        date: "2026-02-16",
        kennelTags: ["hhhs"],
        runNumber: 3290,
        title: "HHHS Trail #3290",
        description: "Pizza on site",
        hares: "Pasi",
        location: "42 Ridout Road - Pasi's place",
        startTime: "18:00",
        sourceUrl: "https://www.hhhs.org.sg/hareline",
      });
    });

    it("synthesizes title and leaves description undefined when Notes is blank", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValueOnce(FIXTURE_HTML);

      const result = await new HHHSAdapter().fetch(source);

      const depotLane = result.events.find((e) => e.runNumber === 3295);
      expect(depotLane?.title).toBe("HHHS Trail #3295");
      expect(depotLane?.description).toBeUndefined();
      expect(depotLane?.location).toBe("118 Depot Lane");
    });

    it("synthesizes title for an event-name-shaped Notes row (still not promoted)", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValueOnce(FIXTURE_HTML);

      const result = await new HHHSAdapter().fetch(source);

      const agm = result.events.find((e) => e.runNumber === 3289);
      expect(agm?.title).toBe("HHHS Trail #3289");
      expect(agm?.description).toBe("AGM and Gisbert Memorial Run - T-Shirts");
    });

    it("filters events outside the date window", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockResolvedValueOnce(FIXTURE_HTML);

      // Narrow window: 10 days from 2026-05-18 → only events between
      // 2026-05-08 and 2026-05-28 would pass. None of the fixture rows
      // (all Feb/Mar 2026) fall in that window.
      const result = await new HHHSAdapter().fetch(source, { days: 10 });
      expect(result.events).toHaveLength(0);
    });

    it("surfaces a fetch error when browser-render throws", async () => {
      const { browserRender } = await import("@/lib/browser-render");
      vi.mocked(browserRender).mockRejectedValueOnce(new Error("frame not found"));

      const result = await new HHHSAdapter().fetch(source);
      expect(result.events).toEqual([]);
      expect(result.errors[0]).toMatch(/Browser render failed/);
    });
  });
});
