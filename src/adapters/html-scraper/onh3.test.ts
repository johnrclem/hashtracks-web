import { describe, it, expect } from "vitest";
import {
  parseTextDate,
  parseNumericDate,
  fieldValue,
  parseOnh3Title,
  deriveTheme,
  postToEvent,
  parseHarelineTable,
} from "./onh3";

type Post = Parameters<typeof postToEvent>[0];

function post(title: string, contentHtml: string, id = 1): Post {
  return {
    id,
    date: "2026-03-29T07:58:13",
    link: `https://onh3.wordpress.com/post/${id}/`,
    title: { rendered: title },
    content: { rendered: contentHtml },
  };
}

describe("parseTextDate", () => {
  it.each([
    ["full month name", "30 March 2026", "2026-03-30"],
    ["abbreviated month (2019-era post)", "16 Mar 2019", "2019-03-16"],
    ["leading weekday + comma", "Monday, 20 April 2026", "2026-04-20"],
    ["impossible date", "31 February 2026", undefined],
    ["no date present", "see the WhatsApp group", undefined],
  ])("handles %s", (_label, input, expected) => {
    expect(parseTextDate(input)).toBe(expected);
  });
});

describe("parseNumericDate", () => {
  it.each([
    ["DD/MM/YYYY (UK/Kenyan order, not US)", "05/01/2026", "2026-01-05"],
    ["DD/MM/YYYY second case", "12/01/2026", "2026-01-12"],
    ["out-of-range day", "45/01/2026", undefined],
  ])("handles %s", (_label, input, expected) => {
    expect(parseNumericDate(input)).toBe(expected);
  });
});

describe("fieldValue", () => {
  const body =
    "Run 1326 on Date: 30 March 2026 Hare: Bitchcoin Venue: Spring Valley Oven Restaurant " +
    "Location: https://maps.app.goo.gl/DMF5uSdngCy6XcpV6 The run starts at 5:45pm.";
  it.each([
    ["Date", "30 March 2026"],
    ["Hares?", "Bitchcoin"],
    ["Venue", "Spring Valley Oven Restaurant"],
  ])("slices the %s value up to the next label", (label, expected) => {
    expect(fieldValue(body, label)).toBe(expected);
  });
  it("captures the location value (URL + trailing prose) for later URL extraction", () => {
    expect(fieldValue(body, "Location")).toContain("https://maps.app.goo.gl/DMF5uSdngCy6XcpV6");
  });
  it("returns undefined for an absent label", () => {
    expect(fieldValue(body, "Cost")).toBeUndefined();
  });
});

describe("parseOnh3Title / deriveTheme", () => {
  it("extracts run number from 'Run NNNN'", () => {
    expect(parseOnh3Title("Run 1329 Peeping Clam’s Birthday hash").runNumber).toBe(1329);
  });
  it("derives a theme suffix after the run number", () => {
    expect(deriveTheme("Run 1329 Peeping Clam’s Birthday hash")).toBe("Peeping Clam’s Birthday hash");
  });
  it("yields no theme for a 'Monday DD Mon YYYY | Run NNNN' title", () => {
    const parsed = parseOnh3Title("Monday 30 Mar 2026 | Run 1326");
    expect(parsed.runNumber).toBe(1326);
    expect(parsed.theme).toBeUndefined();
  });
  it("strips a leading ONH3 token before the theme", () => {
    expect(deriveTheme("ONH3 Run 2024. Cinco de Mayo hash")).toBe("Cinco de Mayo hash");
  });
  it("refuses a labeled-fields title as a theme", () => {
    expect(deriveTheme("Run 1068. Hare: Dodger. Venue: Hare’s hole.")).toBeUndefined();
  });
});

describe("postToEvent", () => {
  // Captured live 2026-05-29 from the WordPress.com REST API (run 1326 post).
  const RUN_1326 = post(
    "Monday 30 Mar 2026 | Run 1326",
    "<table><tr><td>Original Nairobi Hash House Harriers</td></tr><tr><td>" +
      "Run 1326 on Date: 30 March 2026 Hare: Bitchcoin Venue: Spring Valley Oven " +
      "Restaurant Location: https://maps.app.goo.gl/DMF5uSdngCy6XcpV6 The run starts " +
      "at 5:45pm. Please pay 900/- in cash or M-Pesa to the hare." +
      "</td></tr><tr><td>Hash Trash Run: 1325 Date: 23 March 2026 " +
      "Hares: Deadloss Venue: Hare’s hole in Runda Deadloss’ helpers...</td></tr></table>",
    344,
  );

  it("parses the announcement and ignores the embedded Hash Trash recap", () => {
    const ev = postToEvent(RUN_1326)!;
    expect(ev.date).toBe("2026-03-30"); // NOT the recap's 23 March
    expect(ev.runNumber).toBe(1326);
    expect(ev.hares).toBe("Bitchcoin");
    expect(ev.location).toBe("Spring Valley Oven Restaurant");
    expect(ev.locationUrl).toMatch(/maps\.app\.goo\.gl/);
    expect(ev.startTime).toBe("17:45");
    expect(ev.kennelTags).toEqual(["onh3"]);
    expect(ev.title).toBeUndefined(); // no theme → merge synthesizes the canonical title
  });

  it("handles per-block fields and stops the venue before an unlabeled recap", () => {
    // Real shape: each field is its own block element, the recap follows in
    // separate <p> tags with no label and no "Hash Trash" delimiter.
    const ev = postToEvent(
      post(
        "Run 1329 Peeping Clam’s Birthday hash",
        '<h5 class="wp-block-heading">Date: Monday, 20 April 2026</h5>' +
          "<p>Hares: Peeping Clam &amp; the Runda maffia</p>" +
          "<p>Venue: German Point, &nbsp;Rosslyn Riviera mall (Runda)</p>" +
          "<p>The Runda Maffia led by uber-maffioso NomNom hosted a special birthday hash. " +
          "The run was hilly but not too long.</p>",
        353,
      ),
    )!;
    expect(ev.date).toBe("2026-04-20");
    expect(ev.runNumber).toBe(1329);
    expect(ev.hares).toBe("Peeping Clam & the Runda maffia");
    expect(ev.location).toBe("German Point, Rosslyn Riviera mall (Runda)"); // recap not swallowed
    expect(ev.title).toBe("Peeping Clam’s Birthday hash");
  });

  it("parses a 2019-era post with an abbreviated month", () => {
    const ev = postToEvent(
      post(
        "Run 1068. Hare: Dodger. Venue: Hare&#8217;s hole.",
        "<p>Monday’s run will be hosted by Dodger. Run: #1068 Date: 16 Mar 2019 " +
          "Hare: Dodger Time: 5:45 PM (registration starts at 5PM) Venue: Hare’s hole, Peponi Gardens</p>",
        289,
      ),
    )!;
    expect(ev.date).toBe("2019-03-16");
    expect(ev.runNumber).toBe(1068);
    expect(ev.hares).toBe("Dodger");
    expect(ev.location).toBe("Hare’s hole, Peponi Gardens");
  });

  it("trims a sentence of directions off a verbose venue", () => {
    const ev = postToEvent(
      post(
        "Run 1340",
        "<p>Date: 6 July 2026</p><p>Hare: Squat</p>" +
          "<p>Venue: Community Cooker at the Planning House on Lower Kabete. " +
          "A couple hundred meters before Zen Garden, look for the sign.</p>",
        400,
      ),
    )!;
    expect(ev.location).toBe("Community Cooker at the Planning House on Lower Kabete");
  });

  it("returns null for a post with no parseable date (a social)", () => {
    expect(postToEvent(post("Hash Jargon", "<p>Glossary of hash terms.</p>", 59))).toBeNull();
  });
});

describe("parseHarelineTable", () => {
  const TABLE = post(
    "Hareline 2026",
    '<figure class="wp-block-table"><table><tbody>' +
      "<tr><td>Run nr</td><td>Day</td><td>Date</td><td>Hare</td><td>Venue</td><td>Location</td></tr>" +
      "<tr><td>1314</td><td>Monday</td><td>05/01/2026</td><td>STFU &amp; Blown Fuse</td><td>Spring Valley Oven</td><td>Spring Valley</td></tr>" +
      "<tr><td>1315</td><td>Monday</td><td>12/01/2026</td><td>Glossy</td><td>Matteo&#8217;s Italian Restaurant</td><td>Karen</td></tr>" +
      "</tbody></table></figure>",
    338,
  );

  it("emits one event per data row and skips the header", () => {
    const events = parseHarelineTable(TABLE);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      date: "2026-01-05",
      runNumber: 1314,
      hares: "STFU & Blown Fuse",
      location: "Spring Valley Oven",
      startTime: "17:45",
      kennelTags: ["onh3"],
    });
    expect(events[1]).toMatchObject({ date: "2026-01-12", runNumber: 1315, hares: "Glossy" });
  });
});
