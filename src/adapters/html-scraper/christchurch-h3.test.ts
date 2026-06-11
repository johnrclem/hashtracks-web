import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cheerio from "cheerio";
import { GenericHtmlAdapter } from "./generic";
import type { GenericHtmlConfig } from "./generic";
import type { Source } from "@/generated/prisma/client";

// CHH3 (christchurch-h3) routes to the config-driven GenericHtmlAdapter — no
// bespoke adapter. This test pins the "Receding Hareline" homepage <table>
// shape (#1533) so a future markup change surfaces as a failing test rather
// than silent data loss. The clock is frozen because the source dates are
// year-less (DD/MM) and resolve relative to "now" — without a fixed clock the
// fixture would age out of the window and the suite would go red on a date.

vi.mock("../utils", async () => {
  const actual = await vi.importActual("../utils");
  return { ...actual, fetchHTMLPage: vi.fn() };
});

import { fetchHTMLPage } from "../utils";
const mockFetchHTMLPage = vi.mocked(fetchHTMLPage);

// Verbatim from christchurchhash.net.nz/ (the only <table> on the page). The
// header row, the two "Hare Needed" placeholder hares, and the "Winter Camp"
// / "TBA" placeholder addresses are all real source shapes the config must
// handle. The current-run free-text <p> block above this table is
// deliberately NOT scraped (free-text parse would be flaky — see #1533).
const RECEDING_HARELINE_HTML = `
<html><body>
<p><strong>Receding Hareline (Upcumming Runs)</strong></p>
<figure class="wp-block-table alignleft"><table><tbody>
<tr><td><strong>Run #</strong></td><td><strong>Date:</strong></td><td><strong>Hare:</strong></td><td><strong>Address:</strong></td></tr>
<tr><td>2634</td><td>15/06</td><td>Lone Ranger/GNK</td><td>TBA</td></tr>
<tr><td>2635</td><td>22/06</td><td><em>Hare Needed</em></td><td></td></tr>
<tr><td>2636</td><td>29/06</td><td><em>Hare Needed</em></td><td></td></tr>
<tr><td>2637</td><td>06/07</td><td><em>Hare Needed</em></td><td></td></tr>
<tr><td>2638</td><td>11/07</td><td>Committee</td><td>Winter Camp</td></tr>
</tbody></table></figure>
</body></html>
`;

// Mirrors the "Christchurch H3 Website Hareline" source config in
// prisma/seed-data/sources.ts. NOTE: the seed config also sets
// `upcomingOnly: true`, but that is a Source-level / scrape.ts pipeline-boundary
// flag (not a GenericHtmlConfig field), so it is intentionally absent here.
// Deliberately NO `forwardDate` — see the "stale site" test below.
const CHH3_CONFIG: GenericHtmlConfig = {
  containerSelector: "table",
  rowSelector: "tr",
  columns: {
    runNumber: "td:nth-child(1)",
    date: "td:nth-child(2)",
    hares: "td:nth-child(3)",
    location: "td:nth-child(4)",
  },
  defaultKennelTag: "christchurch-h3",
  dateLocale: "en-GB",
  maxPastDays: 7,
  defaultStartTime: "18:30",
  locationOmitIfMatches: ["^TBA$", "Winter Camp"],
};

const source = {
  id: "chh3-hareline",
  url: "https://christchurchhash.net.nz/",
  config: CHH3_CONFIG,
} as unknown as Source;

function mockPage() {
  const $ = cheerio.load(RECEDING_HARELINE_HTML);
  mockFetchHTMLPage.mockResolvedValue({
    ok: true,
    html: RECEDING_HARELINE_HTML,
    $,
    structureHash: "chh3hash",
    fetchDurationMs: 10,
  });
}

describe("CHH3 receding hareline (GenericHtmlAdapter)", () => {
  const adapter = new GenericHtmlAdapter();

  // Freeze the clock inside the hareline's active window so the year-less
  // DD/MM rows resolve to deterministic 2026 dates.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
    vi.mocked(fetchHTMLPage).mockReset();
    mockPage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts the 5 hareline rows and skips the header row", async () => {
    const result = await adapter.fetch(source);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(5); // header "Date:" → chrono null → skipped
    // Order is preserved from the source table (it.each below asserts identity).
    expect(result.events.map((e) => e.runNumber)).toEqual([
      2634, 2635, 2636, 2637, 2638,
    ]);
  });

  it.each([
    { run: 2634, date: "2026-06-15", hares: "Lone Ranger/GNK" },
    { run: 2635, date: "2026-06-22", hares: "Hare Needed" },
    { run: 2636, date: "2026-06-29", hares: "Hare Needed" },
    { run: 2637, date: "2026-07-06", hares: "Hare Needed" },
    { run: 2638, date: "2026-07-11", hares: "Committee" },
  ])("parses run #$run → $date with verbatim hare", async ({ run, date, hares }) => {
    const result = await adapter.fetch(source);
    const event = result.events.find((e) => e.runNumber === run);
    expect(event).toBeDefined();
    expect(event!.date).toBe(date); // en-GB DD/MM → current-year UTC-noon date
    expect(event!.hares).toBe(hares); // "Hare Needed" passes through verbatim
    expect(event!.startTime).toBe("18:30");
    expect(event!.kennelTags).toEqual(["christchurch-h3"]);
  });

  it("drops placeholder/camp addresses (TBA, Winter Camp) and empty cells", async () => {
    const result = await adapter.fetch(source);
    // Every address in the fixture is either TBA, empty, or "Winter Camp" —
    // none is a geocodable venue, so location should be cleared on all rows.
    for (const event of result.events) {
      expect(event.location).toBeFalsy();
    }
  });

  it("does NOT roll stale rows into next-year phantoms once they pass", async () => {
    // Regression for the forwardDate phantom (#1533 review): freeze the clock
    // AFTER the last listed row. With no forwardDate, the passed DD/MM rows
    // resolve to current-year past dates and maxPastDays drops them — they must
    // NOT reappear as 2027 future events.
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    mockPage();
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.events.some((e) => e.date.startsWith("2027"))).toBe(false);
  });
});
