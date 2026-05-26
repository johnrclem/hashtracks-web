import { describe, it, expect } from "vitest";
import {
  parseDateTimeCost,
  parseHaresField,
  parseLocationField,
  parseMhhhHareline,
} from "./mhhh-ca";

// Fixture taken verbatim from a live `curl https://mhhh.ca/` capture
// (ISO-8859 source; &nbsp; entities preserved). Five upcoming-event rows.
// Trimmed to just the comment-anchored cells the parser needs; the rest of
// the chrome is dropped since the parser keys on <!--RunNumber--> boundaries.
const LIVE_HARELINE_FIXTURE = String.raw`
<html><body>
<table>
<tr>
  <td>filler row before any events</td>
</tr>
<tr><td><!--RunNumber --><b> RUN #1684</b></td></tr>
<tr><td><!--RunTitle--></td></tr>
<tr><td><!--DateTimeCost -->May 3, 2026&nbsp;13h00 $13</td></tr>
<tr><td><!--HaresList -->Broken Thong</td></tr>
<tr><td><!--Location -->Sainte-Marie <a target="_blank" href="https://www.meetup.com/montreal-hash-house-harriers/events/314379548">Click for directions</a></td></tr>

<tr><td><!--RunNumber --><b> RUN #1685</b></td></tr>
<tr><td><!--RunTitle--></td></tr>
<tr><td><!--DateTimeCost -->May 10, 2026&nbsp;13h00 $13</td></tr>
<tr><td><!--HaresList -->Alice; Wonderland; Just Raia</td></tr>
<tr><td><!--Location -->Plateau Mont-Royal <a target="_blank" href="https://www.meetup.com/montreal-hash-house-harriers/events/314543769">Click for directions</a></td></tr>

<tr><td><!--RunNumber --><b> RUN #1686</b></td></tr>
<tr><td><!--RunTitle--></td></tr>
<tr><td><!--DateTimeCost -->May 17, 2026&nbsp;13h00 $13</td></tr>
<tr><td><!--HaresList -->No Glove No Love</td></tr>
<tr><td><!--Location -->TBD <a target="_blank" href="https://www.meetup.com/montreal-hash-house-harriers/events/314618083">Click for directions</a></td></tr>
</table>
</body></html>
`;

describe("parseDateTimeCost", () => {
  it("parses date + 24h time + cost from the standard hareline cell", () => {
    const out = parseDateTimeCost("May 3, 2026 13h00 $13");
    expect(out).toEqual({ date: "2026-05-03", startTime: "13:00", cost: "$13" });
  });

  it("normalizes &nbsp; between date and time", () => {
    const out = parseDateTimeCost("May 3, 2026&nbsp;13h00 $13");
    expect(out?.date).toBe("2026-05-03");
    expect(out?.startTime).toBe("13:00");
  });

  it("accepts a cost without a time", () => {
    const out = parseDateTimeCost("June 7, 2026 $15");
    expect(out).toEqual({ date: "2026-06-07", startTime: undefined, cost: "$15" });
  });

  it("accepts Québécois suffix-dollar notation (13$ / 13 $)", () => {
    // gemini-code-assist flag on PR #1688: French-Canadian sites commonly
    // place the dollar sign after the amount. Strip both forms so the cost
    // doesn't leak into the date-parse remainder.
    expect(parseDateTimeCost("May 3, 2026 13h00 13$")?.cost).toBe("13$");
    expect(parseDateTimeCost("May 3, 2026 13h00 13 $")?.cost).toBe("13 $");
    expect(parseDateTimeCost("May 3, 2026 13h00 13,50 $")?.cost).toBe("13,50 $");
    // Date still parses cleanly after the cost is stripped.
    expect(parseDateTimeCost("May 3, 2026 13h00 13$")?.date).toBe("2026-05-03");
  });

  it("rejects rows without a parseable date", () => {
    expect(parseDateTimeCost("")).toBeNull();
    expect(parseDateTimeCost("TBD")).toBeNull();
  });

  it("rejects nonsensical times (25h99) by leaving startTime undefined", () => {
    const out = parseDateTimeCost("May 3, 2026 25h99 $13");
    expect(out?.startTime).toBeUndefined();
  });
});

describe("parseHaresField", () => {
  it("returns a single hare verbatim", () => {
    expect(parseHaresField("Broken Thong")).toBe("Broken Thong");
  });

  it("sorts a semicolon-separated list for fingerprint stability", () => {
    // Source order: Alice; Wonderland; Just Raia (J before W lexicographically).
    expect(parseHaresField("Alice; Wonderland; Just Raia")).toBe(
      "Alice, Just Raia, Wonderland",
    );
  });

  it("collapses TBD/TBA/Hares Needed placeholders to undefined", () => {
    expect(parseHaresField("TBD")).toBeUndefined();
    expect(parseHaresField("Hare needed")).toBeUndefined();
    expect(parseHaresField("Hares Required")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseHaresField(undefined)).toBeUndefined();
    expect(parseHaresField("")).toBeUndefined();
    expect(parseHaresField("   ")).toBeUndefined();
  });
});

describe("parseLocationField", () => {
  it("returns the neighborhood text", () => {
    expect(parseLocationField("Sainte-Marie")).toBe("Sainte-Marie");
  });

  it("strips the trailing 'Click for directions' link text", () => {
    expect(parseLocationField("Plateau Mont-Royal Click for directions")).toBe(
      "Plateau Mont-Royal",
    );
  });

  it("omits TBD placeholders so the UI shows 'venue TBD'", () => {
    expect(parseLocationField("TBD")).toBeUndefined();
    expect(parseLocationField("TBA")).toBeUndefined();
    expect(parseLocationField("tbd.")).toBeUndefined();
  });
});

describe("parseMhhhHareline", () => {
  it("emits one RawEvent per <!--RunNumber--> block, with hares and locations", () => {
    const events = parseMhhhHareline(LIVE_HARELINE_FIXTURE, "https://mhhh.ca/");

    expect(events).toHaveLength(3);

    expect(events[0]).toMatchObject({
      date: "2026-05-03",
      kennelTags: ["mh3-ca"],
      runNumber: 1684,
      startTime: "13:00",
      cost: "$13",
      hares: "Broken Thong",
      location: "Sainte-Marie",
      sourceUrl: "https://www.meetup.com/montreal-hash-house-harriers/events/314379548",
    });

    // Sorted hares regardless of source-row order.
    expect(events[1].hares).toBe("Alice, Just Raia, Wonderland");
    expect(events[1].location).toBe("Plateau Mont-Royal");
    expect(events[1].runNumber).toBe(1685);

    // TBD location is dropped to undefined (not stored as literal "TBD").
    expect(events[2].runNumber).toBe(1686);
    expect(events[2].location).toBeUndefined();
    expect(events[2].hares).toBe("No Glove No Love");
  });

  it("returns an empty list when no <!--RunNumber--> markers exist", () => {
    expect(parseMhhhHareline("<html><body><p>no events</p></body></html>", "https://mhhh.ca/")).toEqual([]);
  });

  it("skips chunks where RUN # can't be extracted", () => {
    const malformed = `
      <!--RunNumber --><b>RUN # broken</b>
      <!--DateTimeCost -->May 3, 2026 13h00 $13
      <!--HaresList -->Test
      <!--Location -->Somewhere</td>
    `;
    expect(parseMhhhHareline(malformed, "https://mhhh.ca/")).toEqual([]);
  });

  it("falls back to mhhh.ca itself when the Location cell has no Meetup link", () => {
    const noLink = String.raw`
      <!--RunNumber --><b> RUN #2000</b>
      <!--DateTimeCost -->January 4, 2027 13h00 $13
      <!--HaresList -->Test Hare
      <!--Location -->Old Port</td>
    `;
    const events = parseMhhhHareline(noLink, "https://mhhh.ca/");
    expect(events).toHaveLength(1);
    expect(events[0].sourceUrl).toBe("https://mhhh.ca/");
  });
});
