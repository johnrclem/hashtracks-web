import {
  parsePattayaRow,
  parsePattayaRunReportRow,
  parsePattayaRunReports,
} from "./pattaya-h3";

const SOURCE_URL = "https://www.pattayah3.com/PH3/php/HareLine/HareLine.php";
const RUN_REPORT_HREF =
  "https://www.pattayah3.com/PH3/php/RunReports/RunReportLkup.php?run_num=2153";

describe("parsePattayaRow", () => {
  it("parses a row with full details", () => {
    const left = "13 Apr 2026 - Run 2146";
    const right = "Hares: Lady Squeeze My Tube, Many Drinks, Never Come\nTheme: Songkran\nOn On Bar: New Plaza Sports Bar\nA-Site: Hwy 331 - across from Asian Uni. (12.83775, 101.018, ID: 73)";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-13");
    expect(event!.kennelTags[0]).toBe("pattaya-h3");
    expect(event!.runNumber).toBe(2146);
    expect(event!.hares).toContain("Lady Squeeze My Tube");
    expect(event!.hares).toContain("Many Drinks");
    expect(event!.title).toContain("Songkran");
    expect(event!.locationUrl).toContain("12.83775");
    expect(event!.startTime).toBe("15:00");
    // #1926: post-run "On On Bar" folds into description (no dedicated column).
    expect(event!.description).toBe("On On Bar: New Plaza Sports Bar");
  });

  it("leaves description undefined when no On On Bar field is present", () => {
    const left = "1 Jun 2026 - Run 2153";
    const right = "Hares: Something Stupid\nA-Site: Somewhere (13.020197, 101.017503, ID: 6)";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.description).toBeUndefined();
  });

  it("parses a row with minimal details", () => {
    const left = "20 Apr 2026 - Run 2147";
    const right = "Hares: The Wizard, Shit Lips\nTheme: St. George's Day Run\nOn On Bar: Kubla Bar";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-20");
    expect(event!.runNumber).toBe(2147);
    expect(event!.hares).toContain("The Wizard");
  });

  it("handles 'Hares Required' as no hares", () => {
    const left = "27 Apr 2026 - Run 2148";
    const right = "Hares: Hares Required\nOn On Bar: Crackers Bar";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
    expect(event!.runNumber).toBe(2148);
  });

  it("returns null for unparseable date", () => {
    const event = parsePattayaRow("No date here", "Hares: Someone", SOURCE_URL);
    expect(event).toBeNull();
  });

  it("parses GPS coordinates into locationUrl", () => {
    const left = "1 Jun 2026 - Run 2153";
    const right = "Hares: Something Stupid\nA-Site: Somewhere (13.020197, 101.017503, ID: 6)";
    const event = parsePattayaRow(left, right, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.locationUrl).toBe("https://www.google.com/maps/search/?api=1&query=13.020197,101.017503");
  });
});

describe("parsePattayaRunReportRow (#1927 historical backfill)", () => {
  it("parses a recent row with hares, runners, and A-Site GPS", () => {
    const left = "1 June\nRun #2153";
    const right =
      "Hares: Any Cock'll Do, Something Kinder, Something Stupid\nBetty Boop Run\nRunners: 88\nA-Site: Rompho Resort Jomthien (12.898872, 100.874805, ID: 51)";
    const event = parsePattayaRunReportRow(left, right, RUN_REPORT_HREF, 2026);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-06-01");
    expect(event!.runNumber).toBe(2153);
    expect(event!.kennelTags[0]).toBe("pattaya-h3");
    expect(event!.hares).toContain("Any Cock'll Do");
    // Hares are deduped + sorted by normalizeHaresField (stable fingerprints).
    expect(event!.hares).toBe("Any Cock'll Do, Something Kinder, Something Stupid");
    // No "Theme:" label in the archive → title synthesized downstream.
    expect(event!.title).toBeUndefined();
    expect(event!.location).toBe("Rompho Resort Jomthien");
    expect(event!.locationUrl).toContain("12.898872");
    expect(event!.description).toBe("Runners: 88");
    expect(event!.startTime).toBe("15:00");
    expect(event!.sourceUrl).toBe(RUN_REPORT_HREF);
  });

  it("parses an early row (1984) with no A-Site, taking the year from the heading", () => {
    const left = "7 January\nRun #1";
    const right = "Hares: Hans Kirgis, Mattress\nRunners: 12";
    const event = parsePattayaRunReportRow(left, right, undefined, 1984);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("1984-01-07");
    expect(event!.runNumber).toBe(1); // falls back to the text run number
    expect(event!.location).toBeUndefined();
    expect(event!.locationUrl).toBeUndefined();
    expect(event!.description).toBe("Runners: 12");
  });

  it("returns null for an unparseable date line", () => {
    const event = parsePattayaRunReportRow("No date", "Hares: Someone", RUN_REPORT_HREF, 2024);
    expect(event).toBeNull();
  });

  it("walks a multi-year run-reports page", () => {
    const html = `
      <div class="run_report_background">
        <table class="table"><thead><tr><th colspan="2">Run Reports For 2026</th></tr></thead>
          <tr class="border_bottom">
            <td class="text-nowrap">1 June<br><a href="${RUN_REPORT_HREF}">Run #2153</a></td>
            <td><strong>Hares: </strong>Something Stupid<br><strong>Runners: </strong>88<br><strong>A-Site: </strong>Rompho (12.898872, 100.874805, ID: 51)</td>
          </tr>
        </table>
      </div>
      <div class="run_report_background">
        <table class="table"><thead><tr><th colspan="2">Run Reports For 1984</th></tr></thead>
          <tr class="border_bottom">
            <td class="text-nowrap">7 January<br><a href="https://www.pattayah3.com/PH3/php/RunReports/RunReportLkup.php?run_num=1">Run #1</a></td>
            <td><strong>Hares: </strong>Hans Kirgis, Mattress<br><strong>Runners: </strong>12</td>
          </tr>
        </table>
      </div>`;
    const events = parsePattayaRunReports(html);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2153]);
    const run1 = events.find((e) => e.runNumber === 1)!;
    expect(run1.date).toBe("1984-01-07");
    const run2153 = events.find((e) => e.runNumber === 2153)!;
    expect(run2153.date).toBe("2026-06-01");
    expect(run2153.locationUrl).toContain("12.898872");
  });
});
