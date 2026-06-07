import { describe, it, expect } from "vitest";
import { parseVictoriaH3Page } from "./victoria-h3";

const SOURCE_URL = "https://vh3.ca/";

// Faithful to the live Gamma markup: every text block is wrapped in a
// `data-node-view-content-inner="paragraph"` node-view div, and venue links are
// `maps.app.goo.gl` anchors whose text is the venue (verified against the real
// 2026-06-04 capture of vh3.ca).
const p = (inner: string) =>
  `<div data-node-view-content-inner="paragraph" style="whitespace:inherit">${inner}</div>`;
const mapLink = (venue: string, url: string) =>
  `<a class="chakra-text link css-0" rel="noopener nofollow" href="${url}"><span>${venue}</span></a>`;

const FIXTURE = `<!DOCTYPE html><html><body>
${p("Up Cumming Hashes and Hashing Events 2026")}

${p("VH3 #929 The Double Sixth Festival 六月六")}
${p("Saturday, June 6, 2:30 pm")}
${p("Where: " + mapLink("Claremont High School, 4980 Wesley Rd.", "https://maps.app.goo.gl/ExcW2VSGMc5vDik78"))}
${p("Hare: Goes Down Well")}
${p("Cost: $10 (includes two beverages, first timers free)")}
${p("On-afters: Little Thai Place Royal Oak")}
${p("Dark Side of the Moon Run #388")}
${p("Friday June 12th at 7 pm")}
${p("Next page")}
${p("VH3 #930")}
${p("Saturday, June 20, 2:30 pm Hares needed.")}
${p("Next page")}
${p("VH3 #938 The AGPU")}
${p("(Annual Generalmeeting & Piss Up)")}
${p("When: Saturday, October 10, 2:30 pm")}
${p("Hares: The Grand Mattress & Yeast Infection")}
${p("Where: TBA")}
${p("Cost: $10 (includes two beverages, first timers free)")}
${p("OnAfters: TBA")}
${p("Next page")}
${p("Victoria K9 H3 #79 Boxing Day Special")}
${p("When: Sunday, December 26, 2:30 pm")}
${p("Where: TBA")}
${p("Hares: Atatürd, Yeast Infection, & O'Candida")}
${p("Cost: $5 (humans) dogs free.")}
${p("Note: Bring your own vessel or you may go thirsty.")}
${p("Next page")}
${p("VH3 #944")}
${p("Friday January 1 (2027), 2:30 pm Hares needed.")}
${p("Next page")}
${p("Back to top")}

${p("Hash Write-ups")}
${p("Hash#918 The Annual New Year&#x27;s Day Polar Bear Swim, (Jan 1st)")}
${p("A solid A to B trail, starting at Wildplay Colwood.")}

${p("Victoria H3 Runs")}
${p("2026 Runs")}
${p("VH3 #918: Thursday, January 1, 2:30 pm.")}
${p("VH3 #923: Saturday, March 14, 2026, 2:30 pm.")}
${p("VH3 #929: Saturday, June 6, 2:30 pm. Hares needed.")}
${p("VH3 #930: Saturday, June 20, 2:30 pm. Hares needed.")}
${p("Back to Up Cumming Hashes")}
${p("Dark Side Runs")}
${p("2026 Runs")}
${p("Dark Side of the Moon Run #383: Friday January 9 at 7 pm")}
${p("Dark Side of the Moon Run #387 Friday May 15th at 7 pm")}
${p("Dark Side of the Moon Run #388 Friday June 12th at 7 pm")}
${p("Back to Up Cumming Hashes")}
${p("Victoria K9 H3")}
${p("2026 Runs")}
${p("Victoria K9 H3 #79 Sunday, December 26, 2:30 pm.")}
${p("Back to Up Cumming Hashes")}
${p("Hashy Hours & Other Events")}
${p("2026 Meet ups")}
${p("Hashy hour #60 Wednesday January 21, 5 pm")}
</body></html>`;

function parse() {
  return parseVictoriaH3Page(FIXTURE, SOURCE_URL);
}

function eventFor(tag: string, runNumber: number) {
  const { events } = parse();
  return events.find((e) => e.kennelTags[0] === tag && e.runNumber === runNumber);
}

describe("VictoriaH3Adapter parser", () => {
  it("parses the union of schedule + card runs across all three kennels", () => {
    const { events, errors } = parse();
    expect(errors).toEqual([]);
    const byTag: Record<string, number> = {};
    for (const e of events) byTag[e.kennelTags[0]] = (byTag[e.kennelTags[0]] ?? 0) + 1;
    // vh3: 918,923,929,930,938,944 · dsmh3: 383,387,388 · vk9h3: 79
    expect(byTag).toEqual({ vh3: 6, dsmh3: 3, vk9h3: 1 });
  });

  it("routes each run to a single kennel tag and never co-hosts", () => {
    const { events } = parse();
    for (const e of events) expect(e.kennelTags).toHaveLength(1);
  });

  it("excludes the Hashy Hours social meet-ups", () => {
    const { events } = parse();
    expect(events.some((e) => e.runNumber === 60)).toBe(false);
  });

  it.each([
    { label: "implicit-year January → season year", tag: "vh3", run: 918, date: "2026-01-01" },
    { label: "explicit mid-string year", tag: "vh3", run: 923, date: "2026-03-14" },
    { label: "parenthetical (2027) Dec→Jan rollover", tag: "vh3", run: 944, date: "2027-01-01" },
    { label: "ordinal day (15th)", tag: "dsmh3", run: 387, date: "2026-05-15" },
    { label: "card-only K9 Boxing Day", tag: "vk9h3", run: 79, date: "2026-12-26" },
  ])("resolves dates: $label", ({ tag, run, date }) => {
    expect(eventFor(tag, run)?.date).toBe(date);
  });

  it.each([
    { tag: "vh3", run: 918, startTime: "14:30" },
    { tag: "dsmh3", run: 388, startTime: "19:00" },
    { tag: "vk9h3", run: 79, startTime: "14:30" },
  ])("parses $tag start times to HH:MM", ({ tag, run, startTime }) => {
    expect(eventFor(tag, run)?.startTime).toBe(startTime);
  });

  it("enriches a near-term card with venue, hare, cost, and theme (card hare beats schedule placeholder)", () => {
    const e = eventFor("vh3", 929);
    expect(e).toMatchObject({
      title: "The Double Sixth Festival 六月六",
      hares: "Goes Down Well",
      location: "Claremont High School",
      locationStreet: "4980 Wesley Rd.",
      locationUrl: "https://maps.app.goo.gl/ExcW2VSGMc5vDik78",
      cost: "$10 (includes two beverages, first timers free)",
    });
  });

  it("titles a bare run from its run number and flags placeholder hares as null (#2013)", () => {
    const e = eventFor("vh3", 930);
    expect(e?.title).toBe("Run #930");
    expect(e?.hares).toBeNull();
  });

  it.each([
    { label: "dsmh3 schedule-only run → bare Run #", tag: "dsmh3", run: 383, title: "Run #383" },
    { label: "dsmh3 schedule-only run → bare Run #", tag: "dsmh3", run: 388, title: "Run #388" },
  ])("emits a source-faithful title for $label (#2013)", ({ tag, run, title }) => {
    expect(eventFor(tag, run)?.title).toBe(title);
  });

  it.each([
    { label: "vh3 schedule section", tag: "vh3", run: 918, anchor: "card-lmli4jg2j066rob" },
    { label: "dsmh3 schedule section", tag: "dsmh3", run: 388, anchor: "card-crvryp3aex0zqgj" },
    { label: "vk9h3 schedule section", tag: "vk9h3", run: 79, anchor: "card-jdsydiqd0hrhaqt" },
  ])("deep-links sourceUrl to the $label (#2014)", ({ tag, run, anchor }) => {
    expect(eventFor(tag, run)?.sourceUrl).toBe(`https://vh3.ca/#${anchor}`);
  });

  it("deep-links a card-only run (no schedule entry) to the Up Cumming card (#2014)", () => {
    // #944 lives only in the "Up Cumming" cards, not the VH3 schedule list, so
    // it must NOT point at the bottom schedule section where it's absent.
    expect(eventFor("vh3", 944)?.sourceUrl).toBe("https://vh3.ca/#card-bh9pp0f7dagcfyu");
  });

  it("normalizes the Oxford-comma co-hare conjunction", () => {
    expect(eventFor("vk9h3", 79)?.hares).toBe("Atatürd, O'Candida, Yeast Infection");
  });

  it("omits a TBA venue and keeps the AGPU subtitle as description", () => {
    const e = eventFor("vh3", 938);
    expect(e?.title).toBe("The AGPU");
    expect(e?.location).toBeUndefined();
    expect(e?.hares).toBe("The Grand Mattress, Yeast Infection");
    expect(e?.description).toContain("Annual Generalmeeting");
  });

  it("titles a completed run from its write-up heading", () => {
    expect(eventFor("vh3", 918)?.title).toBe("The Annual New Year's Day Polar Bear Swim");
  });

  it("prefers the card's start time over the schedule list (last-minute change)", () => {
    const html = `<!DOCTYPE html><html><body>
      ${p("Up Cumming Hashes and Hashing Events 2026")}
      ${p("VH3 #931")}
      ${p("Saturday, July 4, 5:00 pm")}
      ${p("Next page")}
      ${p("Victoria H3 Runs")}
      ${p("2026 Runs")}
      ${p("VH3 #931: Saturday, July 4, 2:30 pm.")}
      ${p("Dark Side Runs")}
      ${p("2026 Runs")}
      ${p("Dark Side of the Moon Run #388 Friday June 12th at 7 pm")}
      ${p("Victoria K9 H3")}
      ${p("2026 Runs")}
      ${p("Victoria K9 H3 #79 Sunday, December 26, 2:30 pm.")}
    </body></html>`;
    const { events } = parseVictoriaH3Page(html, SOURCE_URL);
    expect(events.find((e) => e.runNumber === 931)?.startTime).toBe("17:00");
  });

  it("treats a card heading whose theme contains a month name as a card, not a schedule row", () => {
    const html = `<!DOCTYPE html><html><body>
      ${p("Up Cumming Hashes and Hashing Events 2026")}
      ${p("VH3 #945 May Day Madness")}
      ${p("Saturday, August 15, 2:30 pm")}
      ${p("Next page")}
      ${p("Dark Side of the Moon Run #388 Friday June 12th at 7 pm")}
      ${p("Victoria K9 H3 #79 Sunday, December 26, 2:30 pm.")}
    </body></html>`;
    const { events } = parseVictoriaH3Page(html, SOURCE_URL);
    const e = events.find((x) => x.runNumber === 945);
    expect(e?.date).toBe("2026-08-15"); // the card date, NOT a date derived from "May"
    expect(e?.title).toBe("May Day Madness");
  });

  it("fails loud per kennel when one kennel drops out (protects reconcile)", () => {
    // Only VH3 present — dsmh3 + vk9h3 missing should each raise an error so
    // scrape.ts skips reconcile and doesn't cancel their future runs.
    const html = `<!DOCTYPE html><html><body>
      ${p("Up Cumming Hashes and Hashing Events 2026")}
      ${p("Victoria H3 Runs")}
      ${p("2026 Runs")}
      ${p("VH3 #918: Thursday, January 1, 2:30 pm.")}
    </body></html>`;
    const { events, errors } = parseVictoriaH3Page(html, SOURCE_URL);
    expect(events).toHaveLength(1);
    expect(errors.some((e) => /no runs parsed for dsmh3/i.test(e))).toBe(true);
    expect(errors.some((e) => /no runs parsed for vk9h3/i.test(e))).toBe(true);
  });

  it("fails loud when no run rows parse at all (Gamma markup drift)", () => {
    const { events, errors } = parseVictoriaH3Page("<html><body><p>nothing</p></body></html>", SOURCE_URL);
    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(3); // one per expected kennel
    expect(errors[0]).toMatch(/no runs parsed for/i);
  });
});
