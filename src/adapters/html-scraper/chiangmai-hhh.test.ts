import { ChiangMaiHHHAdapter, parseChiangMaiLine } from "./chiangmai-hhh";
import * as utils from "../utils";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";

// chiangmaihhh.com is HTTP-only — HTTPS fails on the live site (see adapter
// header). The plain http:// URL here is intentional. NOSONAR
const SOURCE_URL = "http://www.chiangmaihhh.com/ch3-hareline/";
const CBH3_URL = "http://www.chiangmaihhh.com/cbh3-hareline/"; // NOSONAR

describe("parseChiangMaiLine", () => {
  it("parses CH3 format: 'Monday 6th April CH3 Run # 1631 Suckit'", () => {
    const event = parseChiangMaiLine(
      "Monday 6th April CH3  Run # 1631 Suckit",
      "ch3-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-06");
    expect(event!.kennelTags[0]).toBe("ch3-cm");
    expect(event!.runNumber).toBe(1631);
    expect(event!.hares).toBe("Suckit");
  });

  it("parses CH4 format with en-dash: 'Thursday 2 April – CH4 Run # 1098 – ABB & Anal Vice'", () => {
    const event = parseChiangMaiLine(
      "Thursday 2 April \u2013 CH4 Run # 1098 \u2013  ABB & Anal Vice",
      "ch4-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-02");
    expect(event!.runNumber).toBe(1098);
    expect(event!.hares).toContain("ABB");
  });

  it("parses CSH3 format: 'Saturday April 4 – CSH3 – Run #1805 – Head Hacker'", () => {
    const event = parseChiangMaiLine(
      "Saturday April 4 \u2013 CSH3 \u2013 Run #1805 \u2013 Head Hacker",
      "csh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-04");
    expect(event!.runNumber).toBe(1805);
    expect(event!.hares).toBe("Head Hacker");
  });

  // CSH3's "Day Month DD" form trips chrono when DD ≥ 19 — month gets dropped
  // and chrono returns the next matching day-of-week.
  it("parses CSH3 'Day Month DD' form for late-month dates with referenceYear", () => {
    const apr25 = parseChiangMaiLine(
      "Saturday April 25 – CSH3 – Run #1809 – Skid Mark and Bushy Tail",
      "csh3",
      SOURCE_URL,
      2026,
    );
    expect(apr25!.date).toBe("2026-04-25");

    const may23 = parseChiangMaiLine(
      "Saturday May 23 – CSH3 – Run #1813 – Bed Hopper and Kanisa",
      "csh3",
      SOURCE_URL,
      2026,
    );
    expect(may23!.date).toBe("2026-05-23");

    const jun20 = parseChiangMaiLine(
      "Saturday June 20 – CSH3 – Run #1817 – HARE NEEDED",
      "csh3",
      SOURCE_URL,
      2026,
    );
    expect(jun20!.date).toBe("2026-06-20");
  });

  it("parses CGH3 format: 'Monday 6 April – CGH3 Run #255 – Emma Royde'", () => {
    const event = parseChiangMaiLine(
      "Monday 6 April \u2013 CGH3 Run #255 \u2013 Emma Royde",
      "cgh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-06");
    expect(event!.runNumber).toBe(255);
    expect(event!.hares).toBe("Emma Royde");
  });

  it("strips CGH3 'Hare.' label prefix (#814)", () => {
    const event = parseChiangMaiLine(
      "Monday 20 April \u2013 CGH3 Run #256 \u2013 Hare. HRA",
      "cgh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("HRA");
  });

  it("parses CBH3 format: 'Sunday 26 April – CBH3 – Run # 281 – Misfortune and Bare Bum'", () => {
    const event = parseChiangMaiLine(
      "Sunday 26 April \u2013 CBH3 \u2013 Run # 281 \u2013 Misfortune and Bare Bum",
      "cbh3-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-26");
    expect(event!.runNumber).toBe(281);
    expect(event!.hares).toContain("Bare Bum");
    expect(event!.hares).toContain("Misfortune");
  });

  it("skips HARE NEEDED entries", () => {
    const event = parseChiangMaiLine(
      "Monday 18 May \u2013 CGH3 Run #258 \u2013 HARE NEEDED",
      "cgh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
  });

  it("skips lines without Run keyword", () => {
    const event = parseChiangMaiLine("April 2026", "ch3-cm", SOURCE_URL);
    expect(event).toBeNull();
  });

  it("skips lines with placeholder run numbers like 16xx", () => {
    // The regex won't match "16xx" since it requires digits
    const event = parseChiangMaiLine(
      "Monday 1st June CH3  Run # 16xx Hare Needed",
      "ch3-cm",
      SOURCE_URL,
    );
    expect(event).toBeNull();
  });

  it("handles multi-hare with 'and'", () => {
    const event = parseChiangMaiLine(
      "Saturday May 2 \u2013 CSH3 \u2013 Run #1810 \u2013 Jersey Whore and Va Jay Jay Boom",
      "csh3",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toContain("Jersey Whore");
    expect(event!.hares).toContain("Va Jay Jay Boom");
  });

  it("handles multi-hare with '&'", () => {
    const event = parseChiangMaiLine(
      "Thursday 14 May \u2013 CH4 Run # 1104 \u2013 Anal Vice & ABB",
      "ch4-cm",
      SOURCE_URL,
    );
    expect(event).not.toBeNull();
    expect(event!.hares).toContain("ABB");
    expect(event!.hares).toContain("Anal Vice");
  });

  describe("title is left unset (#1058)", () => {
    // Per #1058, the adapter must not put hare names into `title` \u2014 they
    // belong in `haresText` only. Leaving `title` undefined lets merge.ts
    // synthesize a "{kennel.displayName} Trail #{N}" default, the same
    // pattern used by every other hareline adapter.
    it.each([
      ["CSH3 em-dash", "Saturday May 9 \u2013 CSH3 \u2013 Run #1811 \u2013 Stumbling Dyke", "csh3"],
      ["CH4 em-dash with '&' joiner", "Thursday 30 April \u2013 CH4 Run # 1102 \u2013 Bushy Tail & co-hare BUF", "ch4-cm"],
      ["CBH3 em-dash hare list", "Sunday 26 April \u2013 CBH3 \u2013 Run # 281 \u2013 Misfortune and Bare Bum", "cbh3-cm"],
      ["CH3 whitespace form", "Monday 27th April CH3  Run # 1635 Dyke Converter", "ch3-cm"],
      ["HARE NEEDED row", "Monday 18 May \u2013 CGH3 Run #258 \u2013 HARE NEEDED", "cgh3"],
    ])("leaves title undefined for %s", (_label, line, tag) => {
      const event = parseChiangMaiLine(line, tag, SOURCE_URL);
      expect(event!.title).toBeUndefined();
    });
  });
});

describe("ChiangMaiHHHAdapter \u2014 year attribution from <b>Month YYYY</b> headers", () => {
  // [month, day, runNumber, hareText] \u2014 covers Apr\u2013Dec 2026 (the year
  // boundary that broke in production).
  const CBH3_RUNS: ReadonlyArray<[string, number, number, string]> = [
    ["April", 26, 281, "Misfortune and Bare Bum"],
    ["May", 31, 282, "Taste My Juice and Cherry Picker"],
    ["June", 28, 283, "Hot Nipples"],
    ["July", 26, 284, "Itchy Bitchy"],
    ["August", 30, 285, "Bare Bum"],
    ["September", 27, 286, "Bed Hopper"],
    ["October", 25, 287, "Happy Ending and Doesnt Get It"],
    ["November", 22, 288, "Misfortune and Tom Boy"],
    ["December", 27, 289, "Bushy Tail"],
  ];

  // Verbatim chiangmaihhh.com shape: stray "CGH3 Hareline 2024" line at the
  // top (a known source-side typo / confounder for the year regex),
  // <b>Month YYYY</b> headers, <font>-wrapped event lines, &#8211; en-dashes.
  const CBH3_FIXTURE = `
<div class="entry-content">
<p>CGH3 Hareline 2024</p>
<p>${CBH3_RUNS.map(
    ([month, day, run, hares]) =>
      `<b>${month} 2026</b><BR><font color=DeepPink>Sunday ${day} ${month} \u2013 CBH3 \u2013 Run # ${run} \u2013 ${hares}</font>`,
  ).join("<br />\n")}</p>
</div>
`;

  beforeEach(() => {
    vi.spyOn(utils, "fetchHTMLPage").mockResolvedValue({
      ok: true,
      html: CBH3_FIXTURE,
      $: cheerio.load(CBH3_FIXTURE),
      structureHash: "test-hash",
      fetchDurationMs: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stamps every event with year 2026, including July\u2013December", async () => {
    const adapter = new ChiangMaiHHHAdapter();
    const source = {
      id: "test",
      url: CBH3_URL,
      config: { harelineKey: "cbh3" },
      scrapeDays: 365,
    } as unknown as Source;

    const result = await adapter.fetch(source, { days: 365 });

    expect(result.events).toHaveLength(CBH3_RUNS.length);
    const byRun = new Map(result.events.map((e) => [e.runNumber, e.date]));
    const monthOf = (name: string) =>
      [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ].indexOf(name) + 1;
    for (const [month, day, run] of CBH3_RUNS) {
      const expected = `2026-${String(monthOf(month)).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      expect(byRun.get(run)).toBe(expected);
    }
  });
});
