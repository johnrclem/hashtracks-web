import { parseNextRunArticle, parseHarelineRows, parseNextRunDirections } from "./bangkokhash";

const NEXT_RUN_HTML = `
<div class="item-content">
  <h2 class="item-title">
    <a href="/thursday/index.php/run-archives-bth3/295-run-519">Run #519</a>
  </h2>
  <div style="font-size: 12pt;">
    <p><strong>Date</strong>: 16-Apr-2026<br>
    <strong>Start Time</strong>: 18:30<br>
    <strong>Hare</strong>: Jessticles<br>
    <strong>Station</strong>: BTS Chong Nonsi<br>
    <strong>Run Site</strong>: Silom Road<br>
    <strong>Google Map</strong>: https://maps.app.goo.gl/abc123</p>
  </div>
</div>`;

const SIAM_SUNDAY_HTML = `
<div class="item-content">
  <h2 class="item-title">
    <a href="/siamsunday/index.php/run-archives-s2h3/232-run-653">Run #653. On Nut 37</a>
  </h2>
  <p><strong>Date</strong>: 12-Apr-2026<br>
  <strong>Start Time</strong>: 16:30<br>
  <strong>Hare</strong>: Horny Viking<br>
  <strong>Restaurant</strong>: Kung Pao On Nut<br>
  <strong>Location</strong>: On Nut 37<br>
  <strong>Googlemaps Link</strong>: https://maps.app.goo.gl/LF88EQZtSPZkdt826</p>
</div>`;

describe("parseNextRunArticle", () => {
  it("parses BTH3 next run article", () => {
    const event = parseNextRunArticle(NEXT_RUN_HTML, "bth3", "18:30", "https://www.bangkokhash.com/thursday/index.php");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-16");
    expect(event!.kennelTags[0]).toBe("bth3");
    expect(event!.runNumber).toBe(519);
    expect(event!.startTime).toBe("18:30");
    // Bare "Run #519" heading (no trail name) → leave title undefined so merge
    // synthesizes "<Kennel> Trail #519"; persisting "Run #519" would double up
    // with consumers that prepend the run number (#2189 / Codex review).
    expect(event!.title).toBeUndefined();
    expect(event!.hares).toBe("Jessticles");
    expect(event!.location).toBe("Silom Road");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/abc123");
  });

  it("parses S2H3 next run article", () => {
    const event = parseNextRunArticle(SIAM_SUNDAY_HTML, "s2h3", "16:30", "https://www.bangkokhash.com/siamsunday/index.php");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-12");
    expect(event!.kennelTags[0]).toBe("s2h3");
    expect(event!.runNumber).toBe(653);
    expect(event!.startTime).toBe("16:30");
    expect(event!.hares).toBe("Horny Viking");
    // #2189: the run headline from `.item-title` becomes the event title
    // instead of the synthesized "Siam Sunday H3 Trail #653" default.
    expect(event!.title).toBe("Run #653. On Nut 37");
    expect(event!.location).toBe("On Nut 37");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/LF88EQZtSPZkdt826");
  });

  it("leaves title undefined when the heading is a bare run number (#2189 / Codex)", () => {
    // BTH3 archive page whose heading carries no trail name beyond "Run #300".
    const html = `
<div class="page-header"><h1>Run #300</h1></div>
<div class="com-content-article__body">
  <p><strong>Date</strong>: 03-Apr-2026<br>
  <strong>Start Time</strong>: 18:30<br>
  <strong>Hare</strong>: Jessticles<br>
  <strong>Station</strong>: BTS Asok</p>
</div>`;
    const event = parseNextRunArticle(html, "bth3", "18:30", "https://www.bangkokhash.com/thursday/index.php/run-archives-bth3/9-run-300");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(300);
    expect(event!.title).toBeUndefined();
  });

  it("merges Cohare into the hares field, sorted (#2189)", () => {
    // The Siam Sunday next-run article lists `Hare:` and `Cohare:` on separate
    // lines; both belong in the hares field. normalizeHaresField sorts them so
    // the joined value is fingerprint-stable regardless of source order.
    const html = `
<div class="item-content">
  <h2 class="item-title">
    <a href="/siamsunday/index.php/run-archives-s2h3/236-run-657">Run #657, Suan Eden</a>
  </h2>
  <p><strong>Date</strong>: 14-June-2026<br>
  <strong>Start Time</strong>: 16:30<br>
  <strong>Hare</strong>: Hot Lips<br>
  <strong>Cohare</strong>: Patpom<br>
  <strong>Location</strong>: Suan Eden, Nonthaburi</p>
</div>`;
    const event = parseNextRunArticle(html, "s2h3", "16:30", "https://www.bangkokhash.com/siamsunday/index.php");
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Run #657, Suan Eden");
    expect(event!.hares).toBe("Hot Lips, Patpom");
  });

  it("falls back to Station when Run Site starts with 'Google Map:'", () => {
    const html = `
<div class="item-content">
  <p><strong>Date</strong>: 16-Apr-2026<br>
  <strong>Station</strong>: BTS Chong Nonsi<br>
  <strong>Run Site</strong>: Google Map: https://maps.app.goo.gl/HHfhEm6<br>
  <strong>Hare</strong>: Jessticles</p>
</div>`;
    const event = parseNextRunArticle(html, "bth3", "18:30", "https://www.bangkokhash.com/thursday/index.php");
    expect(event!.location).toBe("BTS Chong Nonsi");
    // No `.item-title` / `.page-header` heading → title stays undefined so
    // merge.ts synthesizes the "<Kennel> Trail #N" default (#2189 guard).
    expect(event!.title).toBeUndefined();
  });

  it("returns null for empty article", () => {
    const event = parseNextRunArticle("<div></div>", "bth3", "18:30", "https://example.com");
    expect(event).toBeNull();
  });

  it("rejects label-only values that leak as field content (#827)", () => {
    // Belt-and-suspenders: if a value slot is empty/malformed such that the
    // captured text is literally another field label (e.g. "Run Site:"),
    // grab() must return undefined rather than surfacing the label as data.
    // Audit #827 reported `locationName = "Run Site:"` on a BTH3 event — this
    // ensures the label string never flows through to output.
    const html = `
<div class="item-content">
  <p><strong>Date</strong>: 23-Apr-2026<br>
  <strong>Start Time</strong>: 18:30<br>
  <strong>Hare</strong>: Here for Beer<br>
  <strong>Station</strong>: MRT Sutthisan<br>
  <strong>Run Site</strong>: Run Site:</p>
</div>`;
    const event = parseNextRunArticle(html, "bth3", "18:30", "https://www.bangkokhash.com/thursday/index.php");
    expect(event).not.toBeNull();
    // Run Site held its own label (leak) — rejected → falls through to
    // station → locationName = "MRT Sutthisan", never the literal label.
    expect(event!.location).toBe("MRT Sutthisan");
  });

  it("does not leak the next label when a slot is empty (#846 BFMH3)", () => {
    // BFMH3 Run #255: the Station and Restaurant slots are empty — the source
    // emits `Station:\nRestaurant:\nGooglemaps: https://...`. A grab() regex
    // with `\s*:\s*(.+?)(?:\n|$)` consumes the newline after `Station:` and
    // captures "Restaurant:", and `Restaurant:` then captures "Googlemaps:
    // https://...". The fix makes grab() strictly single-line.
    const html = `
<div class="item-content">
  <p><strong>Date</strong>: 03-May-2026<br>
  <strong>Start Time</strong>: 18:30<br>
  <strong>Hare</strong>: Jessticles<br>
  <strong>Station</strong>: <br>
  <strong>Restaurant</strong>: <br>
  <strong>Googlemaps</strong>: https://maps.app.goo.gl/abc123</p>
</div>`;
    const event = parseNextRunArticle(html, "bfmh3", "18:30", "https://www.bangkokhash.com/fullmoon/index.php");
    expect(event).not.toBeNull();
    // With all three venue slots empty, there should be NO location value —
    // not "Restaurant:" leaking from Station, not "Googlemaps: ..." leaking
    // from Restaurant.
    expect(event!.location).toBeUndefined();
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/abc123");
  });

  it("parses archive detail pages using .com-content-article__body template", () => {
    // Archive detail uses `.com-content-article__body` wrapper (not `.item-content`);
    // the `Googlemaps:` label is one word on historical pages.
    const html = `
<div class="page-header"><h1>Run #254, BTS Asok</h1></div>
<div class="com-content-article__body">
  <p><strong>Date</strong>: 03-Apr-2026<br>
  <strong>Start Time</strong>: 18:30<br>
  <strong>Hare</strong>: Patpom<br>
  <strong>Station</strong>: BTS Asok<br>
  <strong>Restaurant</strong>: Little Hut House of Waffle<br>
  <strong>Googlemaps</strong>: https://maps.app.goo.gl/v5yucg6jKmXALUf59</p>
</div>`;
    const event = parseNextRunArticle(html, "bfmh3", "18:30", "https://www.bangkokhash.com/fullmoon/index.php/run-archives-bfmh3/157-run-254");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-03");
    expect(event!.kennelTags[0]).toBe("bfmh3");
    // Archive detail pages carry the headline in `.page-header h1` (#2189) —
    // both the title and the run number come from there (the body lacks "Run #").
    expect(event!.title).toBe("Run #254, BTS Asok");
    expect(event!.runNumber).toBe(254);
    expect(event!.hares).toBe("Patpom");
    expect(event!.location).toBe("BTS Asok");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/v5yucg6jKmXALUf59");
    expect(event!.startTime).toBe("18:30");
  });

  it("parses pre-2022 BFMH3 archive pages using When/Where labels", () => {
    // Older BFMH3 archive pages (#187-#197, ~2019-2021) use "When:" instead
    // of "Date:" and "Where:" instead of "Station:"/"Run Site:". Date format
    // also varies — chrono handles the natural-language variations.
    const html = `
<div class="com-content-article__body">
  <p><strong>When</strong>: Friday, 10-Jan-2020<br>
  <strong>Where</strong>: On Nut BTS, Car park behind Cheap Charlies<br>
  <strong>Hare</strong>: Soi Squatter</p>
</div>`;
    const event = parseNextRunArticle(html, "bfmh3", "18:30", "https://www.bangkokhash.com/fullmoon/index.php/run-archives-bfmh3/73-run-187");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2020-01-10");
    expect(event!.hares).toBe("Soi Squatter");
    expect(event!.location).toBe("On Nut BTS, Car park behind Cheap Charlies");
  });

  it("salvages a maps URL in the Location field into locationUrl (#2190 archive)", () => {
    // Older S2H3 archive pages put the Google Maps link directly in the
    // `Location:` field with no separate Googlemaps row. It must surface as
    // locationUrl, never as the venue label.
    const html = `
<div class="page-header"><h1>Run #520, Talin Chan</h1></div>
<div class="com-content-article__body">
  <p><strong>Date</strong>: 12-Jan-2020<br>
  <strong>Start Time</strong>: 16:30<br>
  <strong>Hare</strong>: Boob-a-lube<br>
  <strong>Location</strong>: https://goo.gl/maps/p3zCf2va3RjKc96x7</p>
</div>`;
    const event = parseNextRunArticle(html, "s2h3", "16:30", "https://www.bangkokhash.com/siamsunday/index.php/run-archives-s2h3/99-run-520");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(520);
    expect(event!.title).toBe("Run #520, Talin Chan");
    expect(event!.location).toBeUndefined();
    expect(event!.locationUrl).toBe("https://goo.gl/maps/p3zCf2va3RjKc96x7");
  });

  it("returns null when the Date field lacks a 4-digit year", () => {
    // chrono defaults yearless dates to the current year, which would
    // silently misfile historical runs. The year-guard rejects them so we
    // skip rather than corrupt. Real archive example: older BFMH3 pages
    // occasionally published "Friday, January 1st" without a year.
    const html = `
<div class="com-content-article__body">
  <p><strong>Date</strong>: Friday, January 1st<br>
  <strong>Hare</strong>: Soi Squatter<br>
  <strong>Station</strong>: On Nut BTS</p>
</div>`;
    const event = parseNextRunArticle(html, "bfmh3", "18:30", "https://www.bangkokhash.com/fullmoon/index.php/run-archives-bfmh3/73-run-187");
    expect(event).toBeNull();
  });

  it("filters boilerplate 'On On Q' out of Hares field (#802 BFMH3)", () => {
    // From BFMH3 (Bangkok Full Moon) next-run article — the labeled
    // `Hares:` row carries "On On Q" filler instead of a real name.
    const html = `
<div class="item-content">
  <p><strong>Date</strong>: 22-Apr-2026<br>
  <strong>Start Time</strong>: 18:30<br>
  <strong>Hares</strong>: On On Q<br>
  <strong>Station</strong>: BTS Asok<br>
  <strong>Run Site</strong>: Lumpini Park</p>
</div>`;
    const event = parseNextRunArticle(html, "bfmh3", "18:30", "https://www.bangkokhash.com/fullmoon/index.php");
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
  });
});

// Trimmed from the live HashWebApp hareline payload (Nov 2026 rebuild):
// POST /HashWebApp/Runs/05_Hareline/ViewHL_Server.php {"hashclub":"BTH3","viewoption":3}
const BTH3_HARELINE_HTML =
  "<div class='hl-month'>November 2026</div><div class='hl-group'>" +
  "<div class='hl-row hl-past'><div class='hl-date' title='Thursday 5 November 2026'><span class='hl-dow'>Thu</span><span class='hl-day'>5</span></div><div class='hl-main'><span class='hl-hare'>Khlong Dump</span></div><div class='hl-side'><span class='hl-num'>#541</span></div></div>" +
  "<div class='hl-row hl-booked hl-next'><div class='hl-date' title='Thursday 12 November 2026'><span class='hl-dow'>Thu</span><span class='hl-day'>12</span></div><div class='hl-main'><span class='hl-hare'>On On Que</span></div><div class='hl-side'><span class='hl-tag'>Next</span><span class='hl-num'>#542</span></div></div>" +
  "<div class='hl-row hl-note'><div class='hl-date' title='Friday 27 November 2026'><span class='hl-dow'>Fri</span><span class='hl-day'>27</span></div><div class='hl-main'><span class='hl-notetext'>Fullmoon-262</span></div></div></div>" +
  "<div class='hl-month'>April 2027</div><div class='hl-group'>" +
  "<div class='hl-row hl-booked'><div class='hl-date' title='Thursday 1 April 2027'><span class='hl-dow'>Thu</span><span class='hl-day'>1</span></div><div class='hl-main'><span class='hl-hare'>City Girl / Shaggy</span></div><div class='hl-side'><span class='hl-num'>#557</span></div></div>" +
  "<div class='hl-row'><div class='hl-date' title='Thursday 8 April 2027'><span class='hl-dow'>Thu</span><span class='hl-day'>8</span></div><div class='hl-main'><span class='hl-hare'><span class='hl-wanted'>Hare wanted!</span></span></div><div class='hl-side'><span class='hl-num'>#558</span></div></div>" +
  "<div class='hl-row hl-note hl-past'><div class='hl-date' title='Friday 23 October 2020'><span class='hl-dow'>Fri</span><span class='hl-day'>23</span></div><div class='hl-main'><span class='hl-notetext'>Fullmoon - Cancelled</span></div></div>" +
  "<div class='hl-row hl-note hl-past'><div class='hl-date' title='Thursday 19 March 2020'><span class='hl-dow'>Thu</span><span class='hl-day'>19</span></div><div class='hl-main'><span class='hl-notetext'>Cancelled</span></div></div></div>";

const S2H3_HARELINE_HTML =
  "<div class='hl-month'>November 2026</div><div class='hl-group'><div class='hl-row hl-booked hl-next'><div class='hl-date' title='Sunday 8 November 2026'><span class='hl-dow'>Sun</span><span class='hl-day'>8</span></div><div class='hl-main'><span class='hl-hare'>Chicken Licker</span> <span class='hl-comment'>80th Birthday Run</span></div><div class='hl-side'><span class='hl-tag'>Next</span><span class='hl-num'>#667</span></div></div></div>";

const BTH3_OPTS = {
  kennelTag: "bth3",
  fullmoonTag: "bfmh3",
  defaultTime: "18:30",
  sourceUrl: "https://bangkokhash.com/thursday/",
};

describe("parseHarelineRows", () => {
  it("parses run rows with date, run number and hares", () => {
    const events = parseHarelineRows(BTH3_HARELINE_HTML, BTH3_OPTS);
    const r541 = events.find((e) => e.runNumber === 541);
    expect(r541).toMatchObject({
      date: "2026-11-05",
      kennelTags: ["bth3"],
      hares: "Khlong Dump",
      startTime: "18:30",
      sourceUrl: "https://bangkokhash.com/thursday/",
    });
  });

  it("drops 'On On Que' filler and 'Hare wanted!' placeholders from hares (#802)", () => {
    const events = parseHarelineRows(BTH3_HARELINE_HTML, BTH3_OPTS);
    const r542 = events.find((e) => e.runNumber === 542);
    const r558 = events.find((e) => e.runNumber === 558);
    expect(r542?.date).toBe("2026-11-12");
    expect(r542?.hares).toBeUndefined();
    expect(r558?.date).toBe("2027-04-08");
    expect(r558?.hares).toBeUndefined();
  });

  it("splits slash-joined co-hares", () => {
    const events = parseHarelineRows(BTH3_HARELINE_HTML, BTH3_OPTS);
    expect(events.find((e) => e.runNumber === 557)?.hares).toBe("City Girl, Shaggy");
  });

  it("routes the BTH3 feed's Fullmoon-NNN note rows to bfmh3", () => {
    const events = parseHarelineRows(BTH3_HARELINE_HTML, BTH3_OPTS);
    const fm = events.filter((e) => e.kennelTags[0] === "bfmh3");
    expect(fm).toHaveLength(1);
    expect(fm[0]).toMatchObject({ date: "2026-11-27", runNumber: 262, startTime: "18:30" });
  });

  it("skips Fullmoon rows when no fullmoonTag is set, and skips Cancelled notes", () => {
    const events = parseHarelineRows(BTH3_HARELINE_HTML, { ...BTH3_OPTS, fullmoonTag: null });
    expect(events.some((e) => e.kennelTags[0] === "bfmh3")).toBe(false);
    expect(events.some((e) => e.date.startsWith("2020-"))).toBe(false);
    expect(events.map((e) => e.runNumber)).toEqual([541, 542, 557, 558]);
  });

  it("maps the .hl-comment annotation to description", () => {
    const events = parseHarelineRows(S2H3_HARELINE_HTML, {
      kennelTag: "s2h3",
      fullmoonTag: null,
      defaultTime: "16:30",
      sourceUrl: "https://bangkokhash.com/siamsunday/",
    });
    expect(events).toEqual([
      {
        date: "2026-11-08",
        kennelTags: ["s2h3"],
        runNumber: 667,
        hares: "Chicken Licker",
        description: "80th Birthday Run",
        startTime: "16:30",
        sourceUrl: "https://bangkokhash.com/siamsunday/",
      },
    ]);
  });

  it("handles an empty hareline", () => {
    expect(parseHarelineRows("", BTH3_OPTS)).toEqual([]);
  });
});

// Trimmed from live GET /HashWebApp/Runs/05_Hareline/ViewNextRunDirections.php?b=S2H3
const S2H3_NEXT_RUN_HTML = `<!DOCTYPE html><html lang="en"><head><title>S2H3 Run Directions</title></head><body>
<div class="wrap">
<table class="run"><caption>S2H3  Run #667</caption><tbody>
<tr><th>Date</th><td>Sunday 08-Nov-2026</td></tr>
<tr><th>Start Time</th><td>4:30 pm</td></tr>
<tr><th>Hare</th><td>Chicken Licker</td></tr>
<tr><th>Location</th><td>Thetsaban Bang Pu Soi-70</td></tr>
<tr><th>Restaurant</th><td>Baan Chidlom Bang Pu</td></tr>
<tr><th>Google Maps</th><td><a class="maplink" href="https://maps.app.goo.gl/d6ia7xVD6as8EMFd8" target="_blank" rel="noopener">Open in Google Maps &#8599;</a></td></tr>
</tbody></table>
<div class="notes"><p><strong><span class="dk">Mis-directions</span>:</strong></p><ul>
<li>Chicken Licker&#039;s 80th birthday run</li>
<li><strong>By BTS</strong>: Go to Kheha BTS on the green line and then a 5 minute taxi ride to Soi 70</li>
<li><strong>Run Fee</strong>: 300 Baht</li>
</ul></div>
</div></body></html>`;

// Live BTH3 shape when directions aren't posted yet.
const BTH3_NEXT_RUN_PENDING_HTML = `<div class="wrap"><table class="run"><caption>BTH3  Run #542</caption><tbody>
<tr><th>Date</th><td>Thursday 12-Nov-2026</td></tr>
<tr><th>Start Time</th><td>6:30 pm</td></tr>
<tr><th>Hare</th><td>Tallman</td></tr>
</tbody></table>
<div class="notes"><p class="soon">The run directions will be posted when they are available.</p></div></div>`;

describe("parseNextRunDirections", () => {
  it("parses the run table, maps link, notes and fee", () => {
    const event = parseNextRunDirections(S2H3_NEXT_RUN_HTML, {
      kennelTag: "s2h3",
      defaultTime: "16:30",
      sourceUrl: "https://bangkokhash.com/siamsunday/",
    });
    expect(event).toEqual({
      date: "2026-11-08",
      kennelTags: ["s2h3"],
      runNumber: 667,
      hares: "Chicken Licker",
      location: "Thetsaban Bang Pu Soi-70",
      locationUrl: "https://maps.app.goo.gl/d6ia7xVD6as8EMFd8",
      startTime: "16:30",
      cost: "300 Baht",
      description:
        "Chicken Licker's 80th birthday run\nBy BTS: Go to Kheha BTS on the green line and then a 5 minute taxi ride to Soi 70\nRestaurant: Baan Chidlom Bang Pu",
      sourceUrl: "https://bangkokhash.com/siamsunday/",
    });
  });

  it("ignores the 'directions will be posted' placeholder and converts 12h time", () => {
    const event = parseNextRunDirections(BTH3_NEXT_RUN_PENDING_HTML, BTH3_OPTS);
    expect(event).toMatchObject({ date: "2026-11-12", runNumber: 542, hares: "Tallman", startTime: "18:30" });
    expect(event?.description).toBeUndefined();
    expect(event?.location).toBeUndefined();
  });

  it("returns null when there is no run table", () => {
    expect(parseNextRunDirections("<div class='msg'>No run scheduled</div>", BTH3_OPTS)).toBeNull();
  });
});
