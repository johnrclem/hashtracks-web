import { vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  JamaicaHashAdapter,
  isCancelledCell,
  parseJamaicaDate,
  parseJamaicaHareline,
  splitHares,
} from "./jamaica-hash";

vi.mock("@/lib/browser-render", () => ({ browserRender: vi.fn() }));
import { browserRender } from "@/lib/browser-render";

// Trimmed from the live https://www.jah3.com/kbean/hareline.php (2026-11-05):
// empty forward table + a sample of "Receding Hare Line" rows.
const LIVE_FIXTURE = `
<table class="hareline">
        <tbody><tr>
            <th>Run</th>
            <th>Date</th>
            <th>Location</th>
            <th>Hares</th>
        </tr>
                            <tr><td colspan="4">Sorry, nothing in the calendar yet.</td></tr>            </tbody></table>
<h2>Receding Hare Line</h2>
<table class="hareline">
        <tbody><tr>
            <th>Run</th>
            <th>Date</th>
            <th>Location</th>
            <th>Hares</th>
        </tr>
<tr><td><a href="runtemplatetwo.php?runnum=646" rel="external" class="ui-link">646</a></td><td>Sunday, 1 Nov, 2026</td><td>Redlight, St Andrews</td><td>Clueless Sherlock, Never Screams</td></tr>
<tr><td><a href="runtemplatetwo.php?runnum=645" rel="external" class="ui-link">645</a></td><td>Saturday, 17 Oct, 2026</td><td>Frenchman's, Treasure Beach, St Elizabeth - 
Sat 17th October, Hash Olympics
and
Hash, Sunday 18 Oct 2026</td><td>Clueless Sherlock, Never Screams</td></tr>
<tr><td><a href="runtemplatetwo.php?runnum=644" rel="external" class="ui-link">644</a></td><td>Sunday, 4 Oct, 2026</td><td>Crossroads store, Trinityville, St Thomas</td><td>Clueless Sherlock, Never Screams, Helping Hands</td></tr>
<tr><td><a href="runtemplatetwo.php?runnum=621" rel="external" class="ui-link">621</a></td><td>Sunday, 30 Mar, 2025</td><td>CANCELLED</td><td>CANCELLED</td></tr>
<tr><td><a href="runtemplate.php?runnum=477a" rel="external" class="ui-link">477a</a></td><td>Saturday, 15 Oct, 2016</td><td>Hash Olympics 2016, Golden Sands apartment complex, Treasure Beach.</td><td>HashMaster</td></tr>
<tr><td><a href="runtemplate.php?runnum=477" rel="external" class="ui-link">477</a></td><td>Sunday, 2 Oct, 2016</td><td>CANCELLED - Devon's Pen, (just past Friendship Gap) St Mary</td><td>Helping Hands &amp; Clueless Sherlock</td></tr>
</tbody></table>
`;

// Same markup with a posted forward run (the shape the forward table takes ~6
// days before a run).
const FORWARD_ROW_FIXTURE = LIVE_FIXTURE.replace(
  '<tr><td colspan="4">Sorry, nothing in the calendar yet.</td></tr>',
  '<tr><td><a href="nextrun.php" class="ui-link">647</a></td><td>Sunday, 15 Nov, 2026</td><td>Craig Hill, above Gordon Town, St Andrew</td><td>Never Screams &amp; Clueless Sherlock</td></tr>',
);

const source = { url: "https://www.jah3.com/kbean/hareline.php", scrapeDays: 90 } as Source;

describe("parseJamaicaDate", () => {
  it.each([
    ["Sunday, 1 Nov, 2026", "2026-11-01"],
    ["Saturday, 17 Oct, 2026", "2026-10-17"],
    ["Friday, 13 Feb, 1998", "1998-02-13"],
  ])("%s → %s", (input, expected) => {
    expect(parseJamaicaDate(input)).toBe(expected);
  });
  it("rejects malformed dates", () => {
    expect(parseJamaicaDate("Sunday, 31 Feb, 2026")).toBeNull();
    expect(parseJamaicaDate("TBA")).toBeNull();
  });
});

describe("helpers", () => {
  it("detects every cancel format", () => {
    expect(isCancelledCell("CANCELLED")).toBe(true);
    expect(isCancelledCell("CANCELLED - Devon's Pen")).toBe(true);
    expect(isCancelledCell("*** CANCELLED *** Historic Folly ruins")).toBe(true);
    expect(isCancelledCell("All seasons resort Greenwood, St. James (cancelled)")).toBe(true);
    expect(isCancelledCell("Goodwill Farms, Guys Hill, St Catherine - POSTPONED")).toBe(true);
    expect(isCancelledCell("Redlight, St Andrews")).toBe(false);
  });
  it("splits and sorts hares", () => {
    expect(splitHares("Never Screams & Clueless Sherlock")).toBe("Clueless Sherlock, Never Screams");
    expect(splitHares("Fareleak, Helping Hands and Krystal C")).toBe("Fareleak, Helping Hands, Krystal C");
    expect(splitHares("  ")).toBeUndefined();
  });
});

describe("parseJamaicaHareline", () => {
  it("parses the receding table, skipping header, sentinel and cancelled rows", () => {
    const { events, tables, parseErrors } = parseJamaicaHareline(LIVE_FIXTURE);
    expect(tables).toBe(2);
    expect(parseErrors).toEqual([]);
    expect(events.map((e) => e.runNumber)).toEqual([646, 645, 644, undefined]);
    expect(events[0]).toEqual({
      date: "2026-11-01",
      kennelTags: ["jah3"],
      runNumber: 646,
      location: "Redlight, St Andrews",
      hares: "Clueless Sherlock, Never Screams",
      sourceUrl: "https://www.jah3.com/kbean/hareline.php",
    });
    expect(events[1].location).toContain("Treasure Beach");
    // "477a" special keeps no runNumber (shares #477 with the cancelled regular run).
    expect(events[3]).toMatchObject({ date: "2016-10-15", runNumber: undefined, hares: "HashMaster" });
    expect(events.every((e) => e.title === undefined)).toBe(true);
  });

  it("parses a posted forward run", () => {
    const { events } = parseJamaicaHareline(FORWARD_ROW_FIXTURE);
    expect(events[0]).toMatchObject({
      date: "2026-11-15",
      runNumber: 647,
      hares: "Clueless Sherlock, Never Screams",
    });
  });

  it("records a parse error for a numbered row with a bad date", () => {
    const html = LIVE_FIXTURE.replace("Sunday, 1 Nov, 2026", "Sometime soon");
    const { parseErrors } = parseJamaicaHareline(html);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].error).toContain("646");
  });
});

describe("JamaicaHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("windows the union of both tables", async () => {
    vi.mocked(browserRender).mockResolvedValue(FORWARD_ROW_FIXTURE);
    const result = await new JamaicaHashAdapter().fetch(source, { days: 90 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([647, 646, 645, 644]);
  });

  it("treats an empty forward table as a normal result", async () => {
    vi.mocked(browserRender).mockResolvedValue(LIVE_FIXTURE);
    const result = await new JamaicaHashAdapter().fetch(source, { days: 7 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([646]);
  });

  it("fails loud when the hareline tables are gone", async () => {
    vi.mocked(browserRender).mockResolvedValue("<html><body>Just a moment...</body></html>");
    const result = await new JamaicaHashAdapter().fetch(source, { days: 90 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("no hareline tables");
  });

  it("surfaces a render failure as an error", async () => {
    vi.mocked(browserRender).mockRejectedValue(new Error("Render failed: timeout"));
    const result = await new JamaicaHashAdapter().fetch(source, { days: 90 });
    expect(result.errors[0]).toContain("render failed");
  });
});
