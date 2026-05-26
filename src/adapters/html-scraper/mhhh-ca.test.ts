import { describe, it, expect } from "vitest";
import { parseDateCost, parseMhhhHomepage } from "./mhhh-ca";

/**
 * Representative slice of https://mhhh.ca/ — three of the May 2026 run blocks.
 * Captured 2026-05-26. Mirrors the FrontPage-generated `<tr>` shape literally
 * (whitespace, &nbsp;, html comments) so we exercise the parser against the
 * real markup, not a normalized version.
 */
const FIXTURE_HOMEPAGE = `
<table border="0" width=695 cellspacing="0" cellpadding="0">
  <tr><td colspan="4"><b>&nbsp;May 2026&nbsp;</b></td></tr>
  <tbody>
    <tr>
      <td style="width: 142px;">&nbsp;</td>
      <td style="width: 96px;"><b> RUN #1684</b></td>
      <td style="width: 448px;"><!--RunTitle--></td>
      <td style="width: 9px;">&nbsp;</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Date/Cost:</td>
      <td>May 3, 2026&nbsp;13h00 $13</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Hare(s):</td>
      <td>Broken Thong</td>
      <td></td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Location:</td>
      <td>Sainte-Marie <a target="_blank" href="https://www.meetup.com/montreal-hash-house-harriers/events/314379548">Click for directions</a></td>
      <td></td>
    </tr>
    <tr>
      <td style="width: 142px;">&nbsp;</td>
      <td style="width: 96px;"><b> RUN #1685</b></td>
      <td style="width: 448px;"><!--RunTitle--></td>
      <td style="width: 9px;">&nbsp;</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Date/Cost:</td>
      <td>May 10, 2026&nbsp;13h00 $13</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Hare(s):</td>
      <td>Alice; Wonderland; Just Raia</td>
      <td></td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Location:</td>
      <td>Plateau Mont-Royal <a target="_blank" href="https://www.meetup.com/montreal-hash-house-harriers/events/314543769">Click for directions</a></td>
      <td></td>
    </tr>
    <tr>
      <td style="width: 142px;">&nbsp;</td>
      <td style="width: 96px;"><b> RUN #1688</b></td>
      <td style="width: 448px;"><!--RunTitle--></td>
      <td style="width: 9px;">&nbsp;</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Date/Cost:</td>
      <td>May 31, 2026&nbsp;13h00 $13</td>
      <td>&nbsp;</td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Hare(s):</td>
      <td>Mystery Hare</td>
      <td></td>
    </tr>
    <tr>
      <td>&nbsp;</td>
      <td>Location:</td>
      <td>Le Plateau</td>
      <td></td>
    </tr>
  </tbody>
</table>
`;

describe("parseDateCost", () => {
  it("parses month-day-year + 24h time + cost from real MH3 string", () => {
    const out = parseDateCost("May 3, 2026 13h00 $13");
    expect(out).toEqual({ day: 3, month: 5, year: 2026, time: "13:00", cost: "$13" });
  });

  it("normalizes nbsp + extra whitespace", () => {
    const out = parseDateCost("May 3, 2026 13h00 $13");
    expect(out?.day).toBe(3);
    expect(out?.time).toBe("13:00");
    expect(out?.cost).toBe("$13");
  });

  it("returns null when the value has no recognizable date", () => {
    expect(parseDateCost("TBA")).toBeNull();
    expect(parseDateCost("")).toBeNull();
  });

  it("omits year when the string lacks one (relies on header for context)", () => {
    const out = parseDateCost("May 3");
    expect(out).toEqual({ day: 3, month: 5, year: undefined, time: undefined, cost: undefined });
  });
});

describe("parseMhhhHomepage", () => {
  const runs = parseMhhhHomepage(FIXTURE_HOMEPAGE);

  it("extracts every run block in the fixture", () => {
    expect(runs).toHaveLength(3);
  });

  it("extracts run #, date, time, cost, hares, location, and url for the first block", () => {
    expect(runs[0]).toEqual({
      runNumber: 1684,
      day: 3,
      month: 5,
      year: 2026,
      startTime: "13:00",
      cost: "$13",
      hares: "Broken Thong",
      location: "Sainte-Marie",
      locationUrl: "https://www.meetup.com/montreal-hash-house-harriers/events/314379548",
    });
  });

  it("handles multi-hare semicolon-separated list", () => {
    expect(runs[1].hares).toBe("Alice; Wonderland; Just Raia");
    expect(runs[1].runNumber).toBe(1685);
  });

  it("handles a Location: row without a directions link", () => {
    expect(runs[2].locationUrl).toBeUndefined();
    expect(runs[2].location).toBe("Le Plateau");
  });

  it("returns an empty array on completely unrelated HTML", () => {
    expect(parseMhhhHomepage("<html><body><p>nothing here</p></body></html>")).toEqual([]);
  });
});
