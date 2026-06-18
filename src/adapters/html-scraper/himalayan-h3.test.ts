import * as cheerio from "cheerio";
import {
  parseHimalayanPage,
  parseHarelineRow,
  parseRecedingDate,
  parseRecedingTime,
  extractW3wUrl,
  parseDetailBlock,
} from "./himalayan-h3";

// Verbatim TablePress "Receding Hareline" DOM captured live from
// himalayanhash.run (2026-06-18) + the single featured-run detail block.
//
// NOTE: the live w3w cell anchor is `http://w3w.co/...`; the fixture uses the
// `https` form to avoid SonarCloud's clear-text-URL hotspot on the test literal.
// `extractW3wUrl` validates by host only (scheme-agnostic), so this is faithful.
const FIXTURE = `<!DOCTYPE html><html><head>
<meta property="og:description" content="HASH 2521 Click here for GOOGLE MAP From the south-western part of the valley..."/>
</head><body>
<table id="tablepress-5" class="tablepress tablepress-id-5">
<thead>
<tr class="row-1 odd">
<th class="column-1"><strong>Hash#</strong></th>
<th class="column-2"><strong>Date</strong></th>
<th class="column-3"><strong>Time</strong></th>
<th class="column-4"><strong>On-In</strong></th>
<th class="column-5"><strong>Hares</strong></th>
<th class="column-6"><strong>What3Words</strong></th>
</tr>
</thead>
<tbody class="row-hover">
<tr class="row-2 even">
<td class="column-1">Run 2521</td>
<td class="column-2">13th June</td>
<td class="column-3">1500 Hrs</td>
<td class="column-4"><strong>Chobhar</strong><br /><em>Adinath School</em></td>
<td class="column-5"><strong>Call Boy</strong></td>
<td class="column-6"><a href="https://w3w.co/shed.code.squirted" target="_blank" rel="noopener noreferrer"><img decoding="async" src="https://what3words.com/calls/embed/text/shed.code.squirted/dark" height="20"></a></td>
</tr>
<tr class="row-3 odd">
<td class="column-1">Run 2522</td>
<td class="column-2">20th June</td>
<td class="column-3">1500 Hrs</td>
<td class="column-4">Undecided</td>
<td class="column-5">Needed</td>
<td class="column-6">Check.Back.Later</td>
</tr>
<tr class="row-4 even">
<td class="column-1">Run 2523</td>
<td class="column-2">27th June</td>
<td class="column-3">1500 Hrs</td>
<td class="column-4">Undecided</td>
<td class="column-5">Needed</td>
<td class="column-6">Check.Back.Later</td>
</tr>
</tbody>
</table>
<div class="fusion-title"><h3><span data-fusion-font="true">HASH 2521</span></h3></div>
<div class="fusion-column-wrapper">
<script type="text/javascript">
jQuery('#fusion_map_x').fusion_maps({
  addresses: [{"address":"27.666559, 85.293534","infobox_content":"","coordinates":true,"latitude":"27.666559","longitude":" 85.293534","cache":false}],
});
</script>
<div class="fusion-align-block">
<a class="fusion-button" target="_blank" rel="noopener noreferrer" href="https://maps.app.goo.gl/7RzxmvHsTLVr3jTE8"><span class="fusion-button-text">Click here for GOOGLE MAP</span></a>
</div>
</div>
</body></html>`;

const NOW = new Date("2026-06-18T12:00:00Z");
const MAPS_URL = "https://maps.app.goo.gl/7RzxmvHsTLVr3jTE8";

describe("parseHimalayanPage", () => {
  const { events, parseErrors, rowsFound } = parseHimalayanPage(
    FIXTURE,
    NOW,
    "https://himalayanhash.run/",
  );

  it("parses all 3 rows with no parse errors", () => {
    expect(parseErrors).toHaveLength(0);
    expect(rowsFound).toBe(3);
    expect(events).toHaveLength(3);
  });

  it("emits UTC-noon dates in ascending order", () => {
    expect(events.map((e) => e.date)).toEqual([
      "2026-06-13",
      "2026-06-20",
      "2026-06-27",
    ]);
  });

  it("parses run numbers and a fixed 15:00 start time", () => {
    expect(events.map((e) => e.runNumber)).toEqual([2521, 2522, 2523]);
    expect(events.every((e) => e.startTime === "15:00")).toBe(true);
  });

  it("leaves title undefined so merge synthesizes the default", () => {
    expect(events.every((e) => e.title === undefined)).toBe(true);
  });

  it("uses the kennelCode tag", () => {
    expect(events.every((e) => e.kennelTags[0] === "himalayan-h3")).toBe(true);
  });

  it("enriches the featured run with venue, hares, Maps link, and coords", () => {
    const run2521 = events.find((e) => e.runNumber === 2521)!;
    expect(run2521.location).toBe("Chobhar / Adinath School");
    expect(run2521.hares).toBe("Call Boy");
    // Maps link wins over the row's w3w fallback.
    expect(run2521.locationUrl).toBe(MAPS_URL);
    expect(run2521.latitude).toBeCloseTo(27.666559, 5);
    expect(run2521.longitude).toBeCloseTo(85.293534, 5);
  });

  it("clears placeholder hares to null and drops 'Undecided' venues", () => {
    for (const run of events.filter((e) => e.runNumber !== 2521)) {
      expect(run.location).toBeUndefined();
      expect(run.hares).toBeNull();
      expect(run.locationUrl).toBeUndefined();
      expect(run.latitude).toBeUndefined();
      expect(run.longitude).toBeUndefined();
    }
  });
});

describe("parseHimalayanPage (stale-table fail-closed)", () => {
  it("drops frozen rows once the source is abandoned (no phantom future runs)", () => {
    // Same fixture scraped the FOLLOWING spring: the year-less June rows resolve
    // to ~2.5 months out — beyond the near-term horizon — so nothing is emitted
    // and fetch() will fail loud instead of publishing last year's runs.
    const nextSpring = new Date("2027-04-01T12:00:00Z");
    const { events } = parseHimalayanPage(
      FIXTURE,
      nextSpring,
      "https://himalayanhash.run/",
    );
    expect(events).toHaveLength(0);
  });
});

describe("parseHarelineRow (row-level w3w fallback)", () => {
  it("captures the w3w link as locationUrl before the detail-block merge", () => {
    const $ = cheerio.load(FIXTURE);
    const firstRow = $("table.tablepress tbody tr").get(0)!;
    const event = parseHarelineRow($, firstRow, NOW);
    expect(event?.locationUrl).toBe("https://w3w.co/shed.code.squirted");
  });
});

describe("parseRecedingDate", () => {
  it("parses a year-less ordinal date to UTC-noon", () => {
    expect(parseRecedingDate("13th June", NOW)).toBe("2026-06-13");
  });

  it("rolls a far-past month forward to next year", () => {
    expect(parseRecedingDate("5th January", NOW)).toBe("2027-01-05");
  });

  it("returns null for an unparseable cell", () => {
    expect(parseRecedingDate("Undecided", NOW)).toBeNull();
  });
});

describe("parseRecedingTime", () => {
  it("parses 24-hour 'Hrs' times", () => {
    expect(parseRecedingTime("1500 Hrs")).toBe("15:00");
    expect(parseRecedingTime("0930 Hrs")).toBe("09:30");
  });

  it("returns undefined when no time is present", () => {
    expect(parseRecedingTime("Undecided")).toBeUndefined();
  });
});

describe("extractW3wUrl", () => {
  it("returns w3w/what3words hosts", () => {
    expect(extractW3wUrl("https://w3w.co/shed.code.squirted")).toBe(
      "https://w3w.co/shed.code.squirted",
    );
  });

  it("rejects non-w3w hosts and missing hrefs", () => {
    expect(extractW3wUrl("https://example.com/x")).toBeUndefined();
    expect(extractW3wUrl(undefined)).toBeUndefined();
  });
});

describe("parseDetailBlock", () => {
  it("extracts the featured run number, Maps link, and Fusion-map coords", () => {
    const $ = cheerio.load(FIXTURE);
    const block = parseDetailBlock($, FIXTURE);
    expect(block.runNumber).toBe(2521);
    expect(block.locationUrl).toBe(MAPS_URL);
    expect(block.latitude).toBeCloseTo(27.666559, 5);
    expect(block.longitude).toBeCloseTo(85.293534, 5);
  });
});
