import { describe, it, expect } from "vitest";
import {
  parseHashtoryDate,
  normalizeHares,
  parseHashtoryYear,
} from "./backfill-london-h3-history";

describe("parseHashtoryDate", () => {
  it("parses 'DOW Mon DDth' with year context", () => {
    expect(parseHashtoryDate("Sun Dec 26th", 2010)).toBe("2010-12-26");
    expect(parseHashtoryDate("Sat May 23rd", 2026)).toBe("2026-05-23");
    expect(parseHashtoryDate("Fri Jan 1st", 2010)).toBe("2010-01-01");
  });

  it("tolerates trailing whitespace", () => {
    expect(parseHashtoryDate("Sun Dec 26th ", 2010)).toBe("2010-12-26");
  });

  it("accepts 4-9 char month names", () => {
    expect(parseHashtoryDate("Tue September 7th", 2010)).toBe("2010-09-07");
  });

  it("returns null for invalid month", () => {
    expect(parseHashtoryDate("Sun Xyz 10th", 2010)).toBeNull();
  });

  it("returns null for invalid day", () => {
    expect(parseHashtoryDate("Mon Feb 30th", 2010)).toBeNull();
  });

  it("returns null for empty / garbage", () => {
    expect(parseHashtoryDate("", 2010)).toBeNull();
    expect(parseHashtoryDate("blah", 2010)).toBeNull();
  });
});

describe("normalizeHares", () => {
  it("parses 'X and Y' format", () => {
    expect(normalizeHares("Tuna Melt and Opee")).toBe("Opee, Tuna Melt");
  });

  it("parses 'X, Y and Z' format with alphabetical sort", () => {
    expect(normalizeHares("Charlie, Alpha and Bravo")).toBe(
      "Alpha, Bravo, Charlie",
    );
  });

  it("returns single hare verbatim", () => {
    expect(normalizeHares("Mick Mac")).toBe("Mick Mac");
  });

  it("returns undefined for placeholders", () => {
    expect(normalizeHares("Hare required")).toBeUndefined();
    expect(normalizeHares("TBA")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(normalizeHares("")).toBeUndefined();
    expect(normalizeHares("   ")).toBeUndefined();
  });

  it("drops placeholder tokens but keeps real names alongside them", () => {
    expect(normalizeHares("Alice and TBA")).toBe("Alice");
  });
});

// Verbatim row from `curl https://www.londonhash.org/hashtory.php?year=2010`
// (captures the issue-body sample for run #1988).
const SAMPLE_HRLIST_ROW = `
<div class='hrlistRow'><div class='hashtory htIcon'><image src='./images/hashMarker.png' alt='hash' /></div><div class='hashtory htRunNo'><a href='nextrun.php?run=316'>1988</a></div><div class='hashtory htDate'>Sun Dec 26th </div><div class='hashtory htlocDesc'><a href="http://www.beerintheevening.com/pubs/s/30/30389/Springfield_Park_Tavern/Bounds_Green" target="_blank">The Springfield Park Tavern</a> at Bounds Green</div><div class='hashtory htHare'>Mick Mac</div></div>
<div class="packHolder"><span class="bold">The Pack:</span> <b>Mick Mac</b>, Anuconda, Born again, Karin De Gugilmoy and Marxist. Total <b>5</b>. </div>
`;

const SAMPLE_HRLIST_ROW_MULTI_HARES = `
<div class='hrlistRow'><div class='hashtory htRunNo'><a href='nextrun.php?run=268'>1987</a></div><div class='hashtory htDate'>Sun Dec 19th </div><div class='hashtory htlocDesc'>The Lord Nelson at Brentford</div><div class='hashtory htHare'>Billy the Fish and Ryde</div></div>
<div class="packHolder">The Pack: Billy the Fish, Ryde, 2AM, Bhopal. Total 4.</div>
`;

const SAMPLE_HRLIST_ROW_NO_RUN = `
<div class='hrlistRow'><div class='hashtory htRunNo'></div><div class='hashtory htDate'>Sun Nov 21st </div><div class='hashtory htlocDesc'>Somewhere</div><div class='hashtory htHare'>Nobody</div></div>
`;

const SAMPLE_HRLIST_ROW_BAD_DATE = `
<div class='hrlistRow'><div class='hashtory htRunNo'><a href='nextrun.php?run=999'>1999</a></div><div class='hashtory htDate'>Garbage</div><div class='hashtory htlocDesc'>X</div><div class='hashtory htHare'>Y</div></div>
`;

const SAMPLE_ANNIVERSARY_ROW = `
<div class='hrlistRow'><div class='hashtory htRunNo'><a href='nextrun.php?run=4100'>2826</a></div><div class='hashtory htDate'>Sat Apr 11th </div><div class='hashtory htlocDesc'>St James Park <b>LH3 50th Anniversary Hash</b></div><div class='hashtory htHare'>Old Faithful</div></div>
`;

function wrap(rows: string[]): string {
  return `<html><body><div id="pageContent"><h2>Hash Runs 2010</h2>${rows.join("")}</div></body></html>`;
}

describe("parseHashtoryYear", () => {
  it("parses a verbatim live row (run #1988, Springfield Park Tavern)", () => {
    const events = parseHashtoryYear(wrap([SAMPLE_HRLIST_ROW]), 2010);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.date).toBe("2010-12-26");
    expect(ev.kennelTags).toEqual(["lh3"]);
    expect(ev.runNumber).toBe(1988);
    expect(ev.hares).toBe("Mick Mac");
    expect(ev.location).toContain("Springfield Park Tavern");
    expect(ev.location).toContain("Bounds Green");
    expect(ev.description).toContain("Pack");
    expect(ev.description).toContain("Total");
    expect(ev.startTime).toBeUndefined();
    expect(ev.sourceUrl).toBe("https://www.londonhash.org/nextrun.php?run=316");
  });

  it("sorts multi-hare values deterministically (#1987)", () => {
    const events = parseHashtoryYear(wrap([SAMPLE_HRLIST_ROW_MULTI_HARES]), 2010);
    expect(events).toHaveLength(1);
    // "Billy the Fish and Ryde" → ["Billy the Fish", "Ryde"] → alphabetical
    expect(events[0].hares).toBe("Billy the Fish, Ryde");
  });

  it("preserves theme tags in location (anniversary runs)", () => {
    const events = parseHashtoryYear(wrap([SAMPLE_ANNIVERSARY_ROW]), 2026);
    expect(events).toHaveLength(1);
    expect(events[0].location).toContain("St James Park");
    expect(events[0].location).toContain("LH3 50th Anniversary Hash");
  });

  it("skips rows without a run number", () => {
    const events = parseHashtoryYear(wrap([SAMPLE_HRLIST_ROW_NO_RUN]), 2010);
    expect(events).toHaveLength(0);
  });

  it("skips rows with unparseable dates", () => {
    const events = parseHashtoryYear(wrap([SAMPLE_HRLIST_ROW_BAD_DATE]), 2010);
    expect(events).toHaveLength(0);
  });

  it("partitions a mixed page — keeps good rows, drops malformed ones", () => {
    const events = parseHashtoryYear(
      wrap([SAMPLE_HRLIST_ROW, SAMPLE_HRLIST_ROW_BAD_DATE, SAMPLE_HRLIST_ROW_MULTI_HARES, SAMPLE_HRLIST_ROW_NO_RUN]),
      2010,
    );
    expect(events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1987, 1988]);
  });

  it("year context drives the resolved date (2026 page → 2026 dates)", () => {
    const events = parseHashtoryYear(wrap([SAMPLE_HRLIST_ROW]), 2026);
    expect(events[0].date).toBe("2026-12-26");
  });
});
