import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseKaohsiungHashPage, parseInlineHares, KaohsiungHashAdapter } from "./kaohsiung-hash";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash"),
}));

import { safeFetch } from "@/adapters/safe-fetch";

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

  it("keeps the source title for single-line and multi-line headings (#2225)", () => {
    const { runs } = parseKaohsiungHashPage(FIXTURE, NOW);
    // Single-line "#2732 June 27 Saturday Night Run" → the source's real title.
    expect(runs[0].title).toBe("Saturday Night Run");
    // Multi-line "#2734 July 11 <br> 7-eleven Joint Night Run" → kept as before.
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

  it("emits no parse errors for clean markup", () => {
    const { parseErrors } = parseKaohsiungHashPage(FIXTURE, NOW);
    expect(parseErrors).toHaveLength(0);
  });

  it("returns no runs for markup with no '#NNNN' headings (fail-loud upstream)", () => {
    const empty = `<div data-testid="richTextElement"><p><span>No runs scheduled.</span></p></div>`;
    const { runs, parseErrors } = parseKaohsiungHashPage(empty, NOW);
    expect(runs).toHaveLength(0);
    expect(parseErrors).toHaveLength(0);
  });

  it("flags a numbered run whose date drifted while still returning the parseable one", () => {
    // Partial markup drift: #2901 has a date cue ("When:") that no longer
    // parses. The good run must still be returned, AND the drifted run must surface a parse error so
    // fetch() suppresses reconcile.ts (otherwise the reconciler false-CANCELs
    // #2901's sole-source canonical even though the page still lists it).
    const drift = `
      <div data-testid="richTextElement"><h2><span>#2900 June 27 Saturday Night Run</span></h2></div>
      <div data-testid="richTextElement"><p><span>Night run, around 19:00.</span></p></div>
      <div data-testid="richTextElement"><h2><span>#2901 Mystery Run — details soon</span></h2></div>
      <div data-testid="richTextElement"><p><span>When: see the Facebook group.</span></p></div>`;
    const { runs, parseErrors } = parseKaohsiungHashPage(drift, NOW);
    expect(runs.map((r) => r.runNumber)).toEqual([2900]);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].error).toContain("2901");
    expect(parseErrors[0].field).toBe("date");
  });
});

// 2026-11 live shape: a multi-run "weekend away" heading carries no date; the
// date is only in the body's "When:" line, with an ordinal ("November 7th").
const WEEKEND_AWAY_FIXTURE = `
<div data-testid="richTextElement"><h3 class="font_2"><span>KAOHSIUNG HASH HOUSE HARRIERS</span></h3></div>
<div data-testid="richTextElement"><h2><span>#2743 and 2744 WEEKEND AWAY GUANZILING HOT SPRINGS TAINAN</span></h2></div>
<div data-testid="richTextElement"><p>WEEKEND AWAY!</p><p>When: Saturday November 7th Hares off at Noon</p><p>And Sunday November 8th Hares off at 11:00 AM</p><p>Where: Guanzihling Baihe District Tainan.</p><p>Hares: Trojan Whores, Seldom Cums and River Horse.</p><p>Details: There will be burgers.</p></div>
<div data-testid="richTextElement"><p>#2745 November 14 Saturday Run</p></div>
`;

describe("parseKaohsiungHashPage — dateless heading with a When: line", () => {
  const { runs, parseErrors } = parseKaohsiungHashPage(WEEKEND_AWAY_FIXTURE, new Date("2026-11-05T12:00:00Z"));

  it("dates the run from the body's first When: date (ordinal tolerated)", () => {
    expect(parseErrors).toEqual([]);
    const away = runs.find((r) => r.runNumber === 2743);
    expect(away?.date).toBe("2026-11-07");
    expect(away?.title).toBe("WEEKEND AWAY GUANZILING HOT SPRINGS TAINAN");
  });

  it("takes the start time from the dated day's clause only (Saturday's Noon, not Sunday's 11:00)", () => {
    expect(runs.find((r) => r.runNumber === 2743)?.startTime).toBe("12:00");
  });

  it("takes hares from an inline 'Hares: …' sentence when there is no label block", () => {
    expect(runs.find((r) => r.runNumber === 2743)?.hares).toBe("River Horse, Seldom Cums, Trojan Whores");
  });

  it("still parses ordinary dated headings", () => {
    expect(runs.find((r) => r.runNumber === 2745)?.date).toBe("2026-11-14");
  });

  it("still fails loud when neither the heading nor a When: line has a date", () => {
    const { parseErrors: errs } = parseKaohsiungHashPage(
      `<div data-testid="richTextElement"><p>#2750 Mystery Run</p></div><div data-testid="richTextElement"><p>When: TBD</p></div>`,
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(errs.map((e) => e.error)).toEqual(["Kaohsiung H3: could not parse date for run #2750"]);
  });
});

describe("parseInlineHares", () => {
  it("splits a trailing 'and' and sorts", () => {
    expect(parseInlineHares("Hares: B Name, A Name and C Name. Details: x")).toBe("A Name, B Name, C Name");
  });
  it("drops the next label word when no period ends the list", () => {
    expect(parseInlineHares("Hares: Solo Hare Details: bring cash")).toBe("Solo Hare");
  });
  it("keeps an honorific period inside a name", () => {
    expect(parseInlineHares("Hares: Mr. Fister and Dr. Diddle. Details: x")).toBe("Dr. Diddle, Mr. Fister");
  });
  it("drops a multi-word next label ('Start Time:')", () => {
    expect(parseInlineHares("Hares: Alpha, Beta Start Time: 6pm")).toBe("Alpha, Beta");
  });
  it("ignores 'Hares off at Noon' (no colon)", () => {
    expect(parseInlineHares("When: Saturday Hares off at Noon")).toBeUndefined();
  });
});

// 2026-11-12 live shape (trimmed): a dateless "#2744" heading whose body block
// repeats "Run #2744:" and carries a day-first "When:" date; hares are an
// unlabelled <h1>; "#2745" is one <br>-split heading with the date in its lines.
const NOV_2026_FIXTURE = `
<div data-testid="richTextElement"><h3><span>KAOHSIUNG HASH HOUSE HARRIERS</span></h3></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>#2744 Saturday Afternoon Run</span></h2></div>
<div data-testid="richTextElement"><p class="font_8"><span>KHHH Run #2744: &ldquo;The Hills Are Alive with the Sound of Karaoke and Gunshots&rdquo;</span></p>
<p class="font_8"><br>
<span>When: Saturday, 14 November 2026<br>
Time: Meet: 1:00 PM;&nbsp;</span><span>Hares off: 1:30 PM</span></p>
<p class="font_8"><span>Where: Meeting point: Guanyinshan Triangle Park (觀音山三角公園) <a href="https://maps.app.goo.gl/WorVoCijQEPNNzsP7">HERE</a></span></p>
<p class="font_8"><span>&#8203;</span></p>
<p class="font_8"><span>Info: In November 1918, the guns fell silent. This, you will discover, in November 2026!</span></p></div>
<div data-testid="richTextElement"><h1 class="font_0"><span><span>Why Hold Out? and Happy Hour</span></span></h1></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>#2745 Saturday Afternoon Run<br>
<br>
This will be an afternoon run on Taiwanese Midterm Election Day:<br>
November 28, 2026&nbsp;<br>
<br>
Be ready to start around 13:00<br>
<br>
On On!</span></h2></div>
<div data-testid="richTextElement"><h1 class="font_0"><span><span>Topless Goblin and Brendok (Virgin)</span></span></h1></div>
`;

describe("parseKaohsiungHashPage — 2026-11 layout", () => {
  const { runs, parseErrors } = parseKaohsiungHashPage(NOV_2026_FIXTURE, new Date("2026-11-12T12:00:00Z"));
  const run2744 = runs.find((r) => r.runNumber === 2744);
  const run2745 = runs.find((r) => r.runNumber === 2745);

  it("treats a body block repeating the run number as body, not a second run", () => {
    expect(parseErrors).toEqual([]);
    expect(runs.map((r) => r.runNumber)).toEqual([2744, 2745]);
  });

  it("reads a day-first When: date and the body's named title", () => {
    expect(run2744).toMatchObject({
      date: "2026-11-14",
      title: "The Hills Are Alive with the Sound of Karaoke and Gunshots",
      startTime: "13:00",
      location: "Guanyinshan Triangle Park (觀音山三角公園)",
      locationUrl: "https://maps.app.goo.gl/WorVoCijQEPNNzsP7",
    });
  });

  it("takes hares from an unlabelled <h1> block", () => {
    expect(run2744?.hares).toBe("Why Hold Out? and Happy Hour");
    expect(run2745?.hares).toBe("Topless Goblin and Brendok (Virgin)");
  });

  it("dates a <br>-split heading from its later lines and keeps its first line as title", () => {
    expect(run2745).toMatchObject({
      date: "2026-11-28",
      title: "Saturday Afternoon Run",
      startTime: "13:00",
    });
    expect(run2745?.description).toContain("Be ready to start around 13:00");
  });

  it("honours an explicit year instead of resolving forward", () => {
    const { runs: past } = parseKaohsiungHashPage(NOV_2026_FIXTURE, new Date("2027-06-01T12:00:00Z"));
    expect(past.map((r) => r.date)).toEqual(["2026-11-14", "2026-11-28"]);
  });
});

describe("parseKaohsiungHashPage — date and title edge cases", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const page = (...blocks: string[]) => blocks.map((b) => `<div data-testid="richTextElement">${b}</div>`).join("\n");

  it("skips a month word with no day ('you may bring') and reads the real date", () => {
    const { runs } = parseKaohsiungHashPage(
      page("<h2>#2746 Saturday Run<br>Hashers may bring torches.<br>December 5, 2026</h2>"),
      now,
    );
    expect(runs[0]).toMatchObject({ date: "2026-12-05", title: "Saturday Run" });
  });

  it("ignores an explicit year far from now ('11 November 1918')", () => {
    const { runs } = parseKaohsiungHashPage(
      page("<h2>#2746 Remembrance Run<br>Remembering 11 November 1918<br>Saturday 21 November 2026</h2>"),
      now,
    );
    expect(runs[0].date).toBe("2026-11-21");
  });

  it("never takes a later paragraph's date for a 'When: TBD'", () => {
    const { runs, parseErrors } = parseKaohsiungHashPage(
      page("<h2>#2751 Mystery Run</h2>", "<p>When: TBD</p><p>Info: last year's run was on 21 November 2026.</p>"),
      now,
    );
    expect(runs).toEqual([]);
    expect(parseErrors.map((e) => e.error)).toEqual(["Kaohsiung H3: could not parse date for run #2751"]);
  });

  it("keeps every heading line after the date in the title", () => {
    const { runs } = parseKaohsiungHashPage(page("<h2>#2750 December 12 Joint Run<br>with Kaohsiung 7/11 H3</h2>"), now);
    expect(runs[0].title).toBe("Joint Run with Kaohsiung 7/11 H3");
  });

  it("takes a body 'Run #N:' name only when quoted", () => {
    const { runs } = parseKaohsiungHashPage(
      page("<h2>#2750 December 12 Night Run</h2>", "<p>KHHH Run #2750: details soon</p><p>Where: St. Paul's Church HERE</p>"),
      now,
    );
    expect(runs[0].title).toBe("Night Run");
    expect(runs[0].location).toBe("St. Paul's Church");
  });
});

// Live shape captured from https://www.kaohsiunghash.com/run-information on
// 2026-11-25 (the scrape that failed with "could not parse date for run #2745
// | #2746"). #2745's date is only in a body "Time: Saturday, November 28 at
// 13:00" line with a "Place: … HERE" venue line; #2746 is announced with no
// date anywhere yet.
const LATE_NOV_2026_FIXTURE = `
<div data-testid="richTextElement"><h3 class="font_2"><span>KAOHSIUNG HASH HOUSE HARRIERS</span></h3></div>
<div data-testid="richTextElement"><h6 class="font_6"><span>EST. 1973</span></h6></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>#2745 Saturday Afternoon Run</span></h2></div>
<div data-testid="richTextElement"><p class="font_8"><span>Run #2745</span></p>
<p class="font_8"><span><span>&#8203;</span></span></p>
<p class="font_8"><span>The "Erection Anal-ysis&rdquo; Run</span></p>
<p class="font_8">&nbsp;</p>
<p class="font_8"><span>Time: Saturday, November 28 at 13:00</span></p>
<p class="font_8"><span>Place: Yuen Sheng Park<span><a href="https://maps.app.goo.gl/CqgbRQ7H9JPBmeVd8" target="_blank" rel="noreferrer noopener">&nbsp; HERE&nbsp;</a></span></span></p>
<p class="font_8"><span>Cost: NT300</span></p>
<p class="font_8">&nbsp;</p>
<p class="font_8"><span>Details: Taiwan&rsquo;s Erection Day is almost here!</span></p>
<p class="font_8"><span>Get out early, vote, then come drink away the memories.</span></p>
<p class="font_8"><span>On On!</span></p></div>
<div data-testid="richTextElement"><h1 class="font_0"><span><span>Brendok (Virgin) and Hare</span></span></h1></div>
<div data-testid="richTextElement"><h2 class="font_2"><span>#2746 Saturday Afternoon Run<br>
<br>
This will be an afternoon run starting around the Qishan bus terminal.&nbsp;<br>
<br>
Be ready to start around 13:00<br>
<br>
On On!</span></h2></div>
<div data-testid="richTextElement"><h1 class="font_0"><span><span>Seldom Cums and Happy Hour</span></span></h1></div>
`;

describe("parseKaohsiungHashPage — late 2026-11 layout (Time: line, undated next run)", () => {
  const now = new Date("2026-11-25T04:00:00Z");
  const { runs, parseErrors, undatedRuns } = parseKaohsiungHashPage(LATE_NOV_2026_FIXTURE, now);

  it("regression: dates #2745 from its body 'Time:' line instead of erroring", () => {
    expect(parseErrors).toEqual([]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runNumber: 2745,
      date: "2026-11-28",
      title: "Saturday Afternoon Run",
      startTime: "13:00",
      location: "Yuen Sheng Park",
      locationUrl: "https://maps.app.goo.gl/CqgbRQ7H9JPBmeVd8",
      cost: "NT300",
      hares: "Brendok (Virgin) and Hare",
    });
  });

  it("regression: skips #2746 as undated (no date published) without a parse error", () => {
    expect(undatedRuns).toEqual([2746]);
  });

  it("keeps an undated run numbered BELOW a dated one as a parse error (reconcile guard)", () => {
    // #2745 rewritten without a date while #2746 is dated: skipping #2745
    // silently would let reconcile cancel its stored event.
    const swapped = LATE_NOV_2026_FIXTURE
      .replace("#2745 Saturday Afternoon Run", "#2747 Saturday Afternoon Run")
      .replace("Run #2745", "Run #2747");
    const res = parseKaohsiungHashPage(swapped.replace("#2746 Saturday", "#2744 Saturday"), now);
    expect(res.runs.map((r) => r.runNumber)).toEqual([2747]);
    expect(res.undatedRuns).toEqual([]);
    expect(res.parseErrors.map((e) => e.error)).toEqual([
      "Kaohsiung H3: could not parse date for run #2744",
    ]);
  });

  it("skips a 'Time:' line that holds only a clock and keeps looking", () => {
    const html = [
      "<h2>#2760 Saturday Run</h2>",
      "<p>Time: Meet: 1:00 PM</p><p>Time: Saturday, December 12 at 13:30</p>",
    ].map((b) => `<div data-testid="richTextElement">${b}</div>`).join("");
    const { runs: r } = parseKaohsiungHashPage(html, now);
    expect(r[0]).toMatchObject({ date: "2026-12-12", startTime: "13:30" });
  });

  it("resolves a year-less Time: date forward across the new year", () => {
    const html = `<div data-testid="richTextElement"><h2>#2765 Saturday Run</h2></div>
      <div data-testid="richTextElement"><p>Time: Saturday, January 9 at 13:00</p></div>`;
    const { runs: r } = parseKaohsiungHashPage(html, new Date("2026-12-28T04:00:00Z"));
    expect(r[0].date).toBe("2027-01-09");
  });
});

describe("KaohsiungHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T04:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const source = { id: "src-khh", url: "https://www.kaohsiunghash.com/run-information" } as Source;

  it("regression: the live late-Nov page scrapes cleanly with #2746 reported as undated", async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(LATE_NOV_2026_FIXTURE, { status: 200 }));
    const result = await new KaohsiungHashAdapter().fetch(source, { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.errorDetails).toBeUndefined();
    expect(result.events.map((e) => [e.runNumber, e.date, e.kennelTags])).toEqual([
      [2745, "2026-11-28", ["kaohsiung-h3"]],
    ]);
    expect(result.diagnosticContext?.undatedRuns).toEqual([2746]);
  });

  it("still fails loud when no run on the page is dated", async () => {
    const onlyUndated = LATE_NOV_2026_FIXTURE.replace("Time: Saturday, November 28 at 13:00", "Time: 13:00");
    vi.mocked(safeFetch).mockResolvedValue(new Response(onlyUndated, { status: 200 }));
    const result = await new KaohsiungHashAdapter().fetch(source, { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors.some((e) => e.includes("no upcoming runs"))).toBe(true);
  });
});
