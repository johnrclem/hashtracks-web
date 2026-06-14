import { describe, it, expect } from "vitest";
import { parseKaohsiungHashPage } from "./kaohsiung-hash";

// Fixture mirrors the verbatim Wix markup captured from
// https://www.kaohsiunghash.com/run-information on 2026-06-14:
// each content block is a <div data-testid="richTextElement"> wrapping an
// h2 run heading / p prose / h4 "Your Hares:" label / h1 hare names. Includes
// the real nbsp + <br> inside the #2734 heading, the maps anchor inside the
// prose, and a non-run "Dragon Boats" block that must be skipped.
const FIXTURE = `
<div data-testid="richTextElement"><h3 class="font_2"><span>KAOHSIUNG HASH HOUSE HARRIERS</span></h3></div>
<div data-testid="richTextElement"><h6 class="font_6"><span>EST. 1973</span></h6></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>#2732 June 27 Saturday Night Run</span></h2></div>
<div data-testid="richTextElement"><p class="font_8"><span>Our night runs typically start around 19:00 at a public transport friendly site. Stay tuned for details to come!</span></p></div>
<div data-testid="richTextElement"><h4 class="font_4"><span><span>Your Hares:&nbsp;</span></span></h4></div>
<div data-testid="richTextElement"><h1 class="font_0"><span><span>Dobby's Cock Sock and LOL</span></span></h1></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>#2734 July 11&nbsp;<br> 7-eleven Joint Night Run</span></h2></div>
<div data-testid="richTextElement"><p class="font_8"><span>On July 11th, Kaohsiung Hash House Harriers team up with the bi-annual hash group Kaohsiung 7/11 Hash House Harriers for a Joint Run! Run Costs are NTD300 per person. There will be no car runs; the start is MRT friendly. Time: 6:30PM Place: <a href="https://maps.app.goo.gl/AheK8veDRwxfwJZf7">Here</a> Meet at Qinshui Park behind SKM Mall in CianJhen Take Exit 2 from Caoya MRT station. DO NOT DRIVE YOUR CAR HERE. Hare and hounds set off together at 7PM.</span></p></div>
<div data-testid="richTextElement"><h4 class="font_4"><span>Your Hares:&nbsp;</span></h4></div>
<div data-testid="richTextElement"><h1 class="font_0"><span>Less Fun Than AIDS + Hare</span></h1></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>June 19, 20, 21 Dragon Boats</span></h2></div>
`;

// Reference "now" before both runs so forward-year resolution keeps 2026.
const NOW = new Date("2026-06-14T00:00:00Z");

describe("parseKaohsiungHashPage", () => {
  it("parses both numbered runs and skips the non-run Dragon Boats block", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    expect(runs.map((r) => r.runNumber)).toEqual([2732, 2734]);
  });

  it("resolves year-less dates forward to UTC-noon date strings", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    expect(runs[0].date).toBe("2026-06-27");
    expect(runs[1].date).toBe("2026-07-11");
  });

  it("leaves bare run-type labels undefined but keeps descriptive titles", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    // "Saturday Night Run" → bare → undefined (merge synthesizes the title)
    expect(runs[0].title).toBeUndefined();
    // "7-eleven Joint Night Run" → descriptive → kept
    expect(runs[1].title).toBe("7-eleven Joint Night Run");
  });

  it("extracts hares from the block after the 'Your Hares:' label", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    expect(runs[0].hares).toBe("Dobby's Cock Sock and LOL");
    expect(runs[1].hares).toBe("Less Fun Than AIDS + Hare");
  });

  it("parses explicit times and falls back by run type", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    // #2732 prose has only a 24-hour "around 19:00"
    expect(runs[0].startTime).toBe("19:00");
    // #2734 prose leads with "Time: 6:30PM" (before the 7PM pack-off)
    expect(runs[1].startTime).toBe("18:30");
  });

  it("extracts venue after 'Meet at', cost, and a validated maps URL", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    expect(runs[1].location).toBe(
      "Qinshui Park behind SKM Mall in CianJhen Take Exit 2 from Caoya MRT station",
    );
    expect(runs[1].cost).toBe("NTD300");
    expect(runs[1].locationUrl).toBe("https://maps.app.goo.gl/AheK8veDRwxfwJZf7");
  });

  it("drops placeholder venue text and absent maps links", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    // #2732 says "Stay tuned for details" → no venue, no maps link
    expect(runs[0].location).toBeUndefined();
    expect(runs[0].locationUrl).toBeUndefined();
  });

  it("rolls year-less dates into next year once safely past", () => {
    // A January run viewed from mid-June resolves to the following January.
    const janFixture = `
      <div data-testid="richTextElement"><h2><span>#2800 January 10 Saturday Night Run</span></h2></div>
      <div data-testid="richTextElement"><p><span>Night run, around 19:00.</span></p></div>`;
    const { runs } = parseKaohsiungHashPage(janFixture, NOW);
    expect(runs[0].date).toBe("2027-01-10");
  });

  it("returns no runs for markup with no '#NNNN' headings (fail-loud upstream)", () => {
    const empty = `<div data-testid="richTextElement"><p><span>No runs scheduled.</span></p></div>`;
    const { runs } = parseKaohsiungHashPage(empty, NOW);
    expect(runs).toHaveLength(0);
  });
});
