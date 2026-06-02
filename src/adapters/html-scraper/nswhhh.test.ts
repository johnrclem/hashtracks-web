import { describe, it, expect } from "vitest";
import { parseNSWHHHPage } from "./nswhhh";

const SOURCE_URL = "https://www.nswhhh.info/home";

/**
 * Fixture mirroring the live nswhhh.info/home markup (captured 2026-06-02):
 * Google Sites renders the run block as <h3> headings containing <br>-separated
 * <span>s, with the venue/on-inn/directions as further blocks, an embedded
 * Maps iframe, and a "Recent Runs/Walks" prose list below (the stop sentinel).
 * The head <meta og:description> deliberately repeats the run text to prove the
 * parser reads the body, not the meta tags.
 */
const FIXTURE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="North Shore Wanderers H3">
<meta property="og:description" content="Run #: 1065 Date: Monday, 1 June 2026 6.30pm Hare: Lost Jewels">
</head><body>
<div class="nav"><a href="/home">Home</a><a href="/hareline">Hareline</a><a href="/about-us">About Us</a></div>
<h3 id="h.run" dir="ltr">
  <div class="copy-link"><a href="#h.run" aria-label="Copy heading link"><span>link</span></a></div>
  <span style="font-weight:700">Run #: 1065 </span><span><br></span><span><br></span><span style="font-weight:700">Date: Monday, 1 June 2026 6.30pm  </span>
</h3>
<h3 id="h.hare"><span>Hare: Lost Jewels</span></h3>
<h3 id="h.note"><span>Bring torches</span></h3>
<h3 id="h.circle"><span>Circle up:&nbsp; Bay Road Reserve, Bay Rd, Waverton, bring your Opal Card, credit card or &ldquo;pay enabled device&rdquo; to allow you to travel on a train/bus/ferry&hellip;</span></h3>
<h3 id="h.oninn"><span>On Inn: &nbsp; Ivory Thai, Waverton</span></h3>
<h3 id="h.dir"><span>Directions:</span></h3>
<div><a href="https://maps.app.goo.gl/iiY2q5avvkBvBchS6">https://maps.app.goo.gl/iiY2q5avvkBvBchS6</a></div>
<div class="map"><iframe src="https://maps-api-ssl.google.com/maps?hl=en-US&amp;ll=-33.837436,151.197159&amp;output=embed&amp;q=-33.837524,151.196929&amp;z=19"></iframe></div>
<h3 id="h.recent"><span>Recent Runs/Walks</span></h3>
<div><span>Run #: 1064 - 25 May 2026 - Camp</span></div>
<div><span>Run #: 1063 - 18 May 2026 - Je Suis Chatterbox</span></div>
</body></html>`;

describe("parseNSWHHHPage", () => {
  it("parses the current run block with venue + coords", () => {
    const { event, error } = parseNSWHHHPage(FIXTURE, SOURCE_URL);
    expect(error).toBeUndefined();
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      date: "2026-06-01",
      runNumber: 1065,
      hares: "Lost Jewels",
      location: "Bay Road Reserve, Bay Rd, Waverton",
      locationUrl: "https://maps.app.goo.gl/iiY2q5avvkBvBchS6",
      startTime: "18:30",
      kennelTags: ["nswhhh"],
      sourceUrl: SOURCE_URL,
    });
  });

  it("extracts coordinates from the embedded maps iframe (q= marker)", () => {
    const { event } = parseNSWHHHPage(FIXTURE, SOURCE_URL);
    expect(event?.latitude).toBeCloseTo(-33.8375, 3);
    expect(event?.longitude).toBeCloseTo(151.1969, 3);
  });

  it("captures notes (bring torches, on-inn) as the description", () => {
    const { event } = parseNSWHHHPage(FIXTURE, SOURCE_URL);
    expect(event?.description).toContain("Bring torches");
    expect(event?.description).toContain("Ivory Thai, Waverton");
  });

  it("stops at the 'Recent Runs/Walks' sentinel (does not read #1064/#1063)", () => {
    const { event } = parseNSWHHHPage(FIXTURE, SOURCE_URL);
    // The current run is #1065; prose-list entries below the sentinel are ignored.
    expect(event?.runNumber).toBe(1065);
    expect(event?.description ?? "").not.toContain("Je Suis Chatterbox");
  });

  it.each([
    {
      name: "hare-wanted placeholder → null",
      hareLine: "Hare: Hare Wanted",
      expectHares: null,
    },
    {
      name: "named hare → string",
      hareLine: "Hare: Short Sheeter",
      expectHares: "Short Sheeter",
    },
  ])("normalizes hares: $name", ({ hareLine, expectHares }) => {
    // Target the body markup specifically (the og:description meta also
    // contains "Hare: Lost Jewels").
    const html = FIXTURE.replace("<span>Hare: Lost Jewels</span>", `<span>${hareLine}</span>`);
    const { event } = parseNSWHHHPage(html, SOURCE_URL);
    expect(event?.hares).toBe(expectHares);
  });

  it("defaults startTime to 18:30 when the Date line omits a time", () => {
    const html = FIXTURE.replace(
      "Date: Monday, 1 June 2026 6.30pm  ",
      "Date: Monday, 1 June 2026",
    );
    const { event } = parseNSWHHHPage(html, SOURCE_URL);
    expect(event?.startTime).toBe("18:30");
    expect(event?.date).toBe("2026-06-01");
  });

  it("returns an error when no run heading is present", () => {
    const { event, error } = parseNSWHHHPage("<html><body><p>No runs listed</p></body></html>", SOURCE_URL);
    expect(event).toBeNull();
    expect(error).toMatch(/no 'Run #' heading/i);
  });
});
