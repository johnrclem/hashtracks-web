import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import {
  extractThirstyElements,
  parseThirstyElements,
  resolveThirstyDate,
  stripMapBoilerplate,
} from "./sydney-thirsty-h3";

const URL = "https://www.sth3.org/upcoming-runs";
const REF = new Date("2026-11-05T00:00:00Z");

// Trimmed from live https://www.sth3.org/upcoming-runs (2026-11-05). Google
// Sites splits text across spans ("Run #188" + "2") and prefixes every heading
// with a "Copy heading link" anchor.
const COPY = `<div><a href="#h.x" aria-label="Copy heading link"><svg></svg></a></div>`;
const LIVE_HTML = `<div role="main">
<p class="zfr3Q"><span>Every Thursday at 6:30pm</span></p>
<h1>${COPY}<span>THIS WEEK'S HASH</span></h1>
<h2>${COPY}<span>🍺 🏃 </span><span>Thursday 5 November — 6:30pm </span><span>🍺 🏃</span></h2>
<h3>${COPY}<span>Run #1881</span><span><br></span><span>Lavendar Hash</span><span><br></span><span>Clark Park, Lavender Bay</span></h3>
<h3>${COPY}<a href="https://maps.app.goo.gl/2HQt1EwovHv2X2JB9" target="_blank"><span>Open in Google Maps</span></a></h3>
<h2>${COPY}<span>🍺 🏃 </span><span>Saturday 7 November — </span><span>2</span><span>:</span><span>0</span><span>0pm</span><span> 🍺 🏃</span></h2>
<h3>${COPY}<span>Run #188</span><span>2</span><span><br></span><span>Robertson Park, Watsons Bay</span><span><br></span><a href="https://maps.app.goo.gl/Crjbhpf2cXgBavkF8" target="_blank"><span>Open in Google Maps</span></a></h3>
<p><span>Coming Alone? Don't worry - you'll see us!</span></p>
<h1>${COPY}<span>COMING UP</span></h1>
<h2>${COPY}<span>🍺 🏃 </span><span>Thursday 12 November — 6:30pm </span><span>🍺 🏃</span></h2>
<h3>${COPY}<span>Run #188</span><span>3</span><span><br></span><span>Location TBC</span><span><br></span><a href="https://maps.app.goo.gl/2HQt1EwovHv2X2JB9" target="_blank"><span>TBC</span></a></h3>
<p><span>Running very optional.</span></p>
</div>`;

describe("sydney-thirsty-h3 extractThirstyElements", () => {
  it("joins span fragments, splits on <br>, drops the copy-link anchor", () => {
    const els = extractThirstyElements(cheerio.load(LIVE_HTML));
    expect(els).toContainEqual({ lines: ["Run #1882", "Robertson Park, Watsons Bay", "Open in Google Maps"], href: "https://maps.app.goo.gl/Crjbhpf2cXgBavkF8" });
    expect(els).toContainEqual({ lines: ["Saturday 7 November — 2:00pm"], href: undefined });
  });
});

describe("sydney-thirsty-h3 parseThirstyElements", () => {
  const events = parseThirstyElements(extractThirstyElements(cheerio.load(LIVE_HTML)), URL, REF);

  it("parses every run block on the live layout", () => {
    expect(events).toEqual([
      {
        date: "2026-11-05",
        kennelTags: ["sth3-au"],
        runNumber: 1881,
        title: "Lavendar Hash",
        location: "Clark Park, Lavender Bay",
        locationUrl: "https://maps.app.goo.gl/2HQt1EwovHv2X2JB9",
        startTime: "18:30",
        sourceUrl: URL,
      },
      {
        date: "2026-11-07",
        kennelTags: ["sth3-au"],
        runNumber: 1882,
        title: undefined,
        location: "Robertson Park, Watsons Bay",
        locationUrl: "https://maps.app.goo.gl/Crjbhpf2cXgBavkF8",
        startTime: "14:00",
        sourceUrl: URL,
      },
      {
        date: "2026-11-12",
        kennelTags: ["sth3-au"],
        runNumber: 1883,
        title: undefined,
        location: undefined,
        locationUrl: undefined,
        startTime: "18:30",
        sourceUrl: URL,
      },
    ]);
  });

  it("emits two events for a multi-day 'Runs (Sat and Sun) N & M' block", () => {
    const evs = parseThirstyElements(
      [{ lines: ["Saturday 21 November — 2:00pm"] }, { lines: ["Runs (Sat and Sun) 1884 & 1885", "AGPU Weekend"] }],
      URL,
      REF,
    );
    expect(evs.map((e) => e.runNumber)).toEqual([1884, 1885]);
    expect(evs[0]).toMatchObject({ date: "2026-11-21", location: "AGPU Weekend" });
  });

  it("closes a dated block that is followed by prose instead of a Run line", () => {
    expect(
      parseThirstyElements([{ lines: ["Thursday 19 November"] }, { lines: ["No run this week — see you next time"] }], URL, REF),
    ).toEqual([]);
  });
});

describe("sydney-thirsty-h3 resolveThirstyDate", () => {
  it("uses the weekday to keep a just-passed run in the current year", () => {
    expect(resolveThirstyDate("Thursday 29 October — 6:30pm", REF)).toBe("2026-10-29");
  });
  it("rolls into next year when the weekday matches there", () => {
    expect(resolveThirstyDate("Thursday 7 January — 6:30pm", REF)).toBe("2027-01-07");
  });
  it("ignores lines without a weekday + day + month", () => {
    expect(resolveThirstyDate("Every Thursday at 6:30pm", REF)).toBeUndefined();
  });
});

describe("sydney-thirsty-h3 stripMapBoilerplate", () => {
  it("strips the 'at the map location below' tail", () => {
    expect(stripMapBoilerplate("Redfern Park, Redfern, at the map location below.")).toBe("Redfern Park, Redfern");
  });
});
