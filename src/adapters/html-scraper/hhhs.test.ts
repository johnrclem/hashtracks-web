import {
  parseHHHSDate,
  parseHHHSRow,
  buildColumnMap,
  buildTitle,
  extractRunName,
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

    it("preserves runNumber: 0 (Number.isFinite, not truthiness)", () => {
      // HHHS in practice is #3300+, but the contract must match
      // parseHHHSRow's `Number.isFinite` guard so a hypothetical 0 still
      // renders as "HHHS Trail #0" rather than falling back.
      expect(buildTitle({ date: "2026-02-16", runNumber: 0 })).toBe("HHHS Trail #0");
    });

    it("promotes a run-name-shaped Notes cell to the title (#2212)", () => {
      // The Notes column is the only place HHHS carries a run name. Promote it
      // when a segment reads like a run name (contains "Run"/"Hash")…
      expect(
        buildTitle({
          date: "2026-03-16",
          runNumber: 3294,
          notes: "St Patrick's Day Run",
        }),
      ).toBe("St Patrick's Day Run");
      // …trimming trailing logistics after the " - " separator.
      expect(
        buildTitle({
          date: "2026-02-09",
          runNumber: 3289,
          notes: "AGM and Gisbert Memorial Run - T-Shirts",
        }),
      ).toBe("AGM and Gisbert Memorial Run");
    });

    it("leaves logistics-only Notes synthesized, not promoted (#2212)", () => {
      // "Pizza on site" / "Indian Delights on site" carry no "Run"/"Hash"
      // token — they stay in description, never the title (the case a prior
      // Codex review flagged when Notes was blindly mapped to title).
      expect(
        buildTitle({ date: "2026-02-16", runNumber: 3290, notes: "Pizza on site" }),
      ).toBe("HHHS Trail #3290");
      expect(
        buildTitle({
          date: "2026-02-02",
          runNumber: 3288,
          notes: "Indian Delights on site",
        }),
      ).toBe("HHHS Trail #3288");
    });

    it("never emits the un-shortened 'Hash House Harriers Singapore' prefix (#2025)", () => {
      // The 'Hash House Harriers Singapore H3 Trail #N' titles in #2025 were
      // stale canonical ghosts, not live adapter output. buildTitle always
      // uses the short 'HHHS' kennelCode prefix, which merge.ts rewrites to
      // 'Singapore H3' via friendlyKennelName — so the banner form can never
      // originate here. (Stuck rows were corrected by
      // scripts/cleanup-hhhs-stale-title.ts.)
      const title = buildTitle({ date: "2026-07-06", runNumber: 3310 });
      expect(title).toBe("HHHS Trail #3310");
      expect(title).not.toContain("Hash House Harriers");
    });
  });

  describe("extractRunName", () => {
    it.each([
      ["The King's Birthday Run", "The King's Birthday Run"],
      ["Memorial Run", "Memorial Run"],
      ["Woodleigh Wack & Wail run", "Woodleigh Wack & Wail run"],
      ["Chong Birthday Run - OnOn - Brewhouse next door", "Chong Birthday Run"],
      ["AGM and Gisbert Memorial Run - T-Shirts", "AGM and Gisbert Memorial Run"],
    ])("promotes run-name notes %s → %s", (notes, expected) => {
      expect(extractRunName(notes)).toBe(expected);
    });

    it.each([
      ["Pizza on site"],
      ["Indian Delights on site"],
      [""],
      [undefined],
    ])("returns undefined for logistics-only / empty notes %s", (notes) => {
      expect(extractRunName(notes)).toBeUndefined();
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

    async function runFetch(opts?: { days?: number; reject?: Error }) {
      const { browserRender } = await import("@/lib/browser-render");
      if (opts?.reject) {
        vi.mocked(browserRender).mockRejectedValueOnce(opts.reject);
      } else {
        vi.mocked(browserRender).mockResolvedValueOnce(FIXTURE_HTML);
      }
      const fetchOpts =
        opts?.days === undefined ? undefined : { days: opts.days };
      return new HHHSAdapter().fetch(source, fetchOpts);
    }

    it("parses the hareline table end-to-end", async () => {
      const result = await runFetch();

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
      const result = await runFetch();

      const depotLane = result.events.find((e) => e.runNumber === 3295);
      expect(depotLane?.title).toBe("HHHS Trail #3295");
      expect(depotLane?.description).toBeUndefined();
      expect(depotLane?.location).toBe("118 Depot Lane");
    });

    it("promotes the run name from an event-name-shaped Notes row to the title (#2212)", async () => {
      const result = await runFetch();

      const agm = result.events.find((e) => e.runNumber === 3289);
      // Run name promoted to title (trailing "- T-Shirts" logistics trimmed);
      // the full Notes text is preserved verbatim in description.
      expect(agm?.title).toBe("AGM and Gisbert Memorial Run");
      expect(agm?.description).toBe("AGM and Gisbert Memorial Run - T-Shirts");
    });

    it("filters events outside the date window", async () => {
      // Narrow window: 10 days from 2026-05-18 — fixture rows are all
      // Feb/Mar 2026 so none survive.
      const result = await runFetch({ days: 10 });
      expect(result.events).toHaveLength(0);
    });

    it("surfaces a fetch error when browser-render throws", async () => {
      const result = await runFetch({ reject: new Error("frame not found") });
      expect(result.events).toEqual([]);
      expect(result.errors[0]).toMatch(/Browser render failed/);
    });
  });
});
