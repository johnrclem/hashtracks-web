import { parseNextRunArticle, parseHarelineApiHtml } from "./bangkokhash";

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
    expect(event!.kennelTag).toBe("bth3");
    expect(event!.runNumber).toBe(519);
    expect(event!.startTime).toBe("18:30");
    expect(event!.hares).toBe("Jessticles");
    expect(event!.location).toBe("Silom Road");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/abc123");
  });

  it("parses S2H3 next run article", () => {
    const event = parseNextRunArticle(SIAM_SUNDAY_HTML, "s2h3", "16:30", "https://www.bangkokhash.com/siamsunday/index.php");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-12");
    expect(event!.kennelTag).toBe("s2h3");
    expect(event!.runNumber).toBe(653);
    expect(event!.startTime).toBe("16:30");
    expect(event!.hares).toBe("Horny Viking");
    expect(event!.location).toBe("On Nut 37");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/LF88EQZtSPZkdt826");
  });

  it("returns null for empty article", () => {
    const event = parseNextRunArticle("<div></div>", "bth3", "18:30", "https://example.com");
    expect(event).toBeNull();
  });
});

describe("parseHarelineApiHtml", () => {
  // Simplified version of the actual API response HTML
  const HARELINE_HTML = `
<div style='padding: 0px;'>
  <div style='font-weight: bold; background: #b3d9ff;'>16-Apr-2026 <span>Thursday</span></div>
  <div style='font-size: 10pt;'><label style='width: 100px;'>Run #519</label>Jessticles</div>
</div>
<div style='padding: 0px;'>
  <div style='font-weight: bold; background: #b3d9ff;'>23-Apr-2026 <span>Thursday</span></div>
  <div style='font-size: 10pt;'><label style='width: 100px;'>Run #520</label>Here for Beer</div>
</div>
<div style='padding: 0px;'>
  <div style='font-weight: bold; background: #b3d9ff;'>01-May-2026 <span>Friday</span></div>
  <div style='font-size: 10pt;'><label>&nbsp;</label><label>Fullmoon-255</label></div>
</div>
<div style='padding: 0px;'>
  <div style='font-weight: bold; background: #b3d9ff;'>07-May-2026 <span>Thursday</span></div>
  <div style='font-size: 10pt;'><label style='width: 100px;'>Run #521</label>Drunkin Donut</div>
</div>`;

  it("parses BTH3 hareline entries", () => {
    const events = parseHarelineApiHtml(HARELINE_HTML, "bth3", "bfmh3", "18:30", "https://www.bangkokhash.com/thursday/index.php");
    expect(events.length).toBe(4);

    // First entry: BTH3
    expect(events[0].date).toBe("2026-04-16");
    expect(events[0].kennelTag).toBe("bth3");
    expect(events[0].runNumber).toBe(519);
    expect(events[0].hares).toBe("Jessticles");

    // Second entry: BTH3
    expect(events[1].date).toBe("2026-04-23");
    expect(events[1].runNumber).toBe(520);
    expect(events[1].hares).toBe("Here for Beer");
  });

  it("routes Fullmoon entries to bfmh3 tag", () => {
    const events = parseHarelineApiHtml(HARELINE_HTML, "bth3", "bfmh3", "18:30", "https://www.bangkokhash.com/thursday/index.php");
    const fullmoon = events.find((e) => e.kennelTag === "bfmh3");
    expect(fullmoon).toBeDefined();
    expect(fullmoon!.date).toBe("2026-05-01");
    expect(fullmoon!.runNumber).toBe(255);
    expect(fullmoon!.startTime).toBe("18:30");
  });

  it("does not route Fullmoon when fullmoonTag is null", () => {
    const events = parseHarelineApiHtml(HARELINE_HTML, "s2h3", null, "16:30", "https://www.bangkokhash.com/siamsunday/index.php");
    const fullmoon = events.find((e) => e.kennelTag === "bfmh3");
    expect(fullmoon).toBeUndefined();
  });

  it("handles empty hareline", () => {
    const events = parseHarelineApiHtml("", "bth3", "bfmh3", "18:30", "https://example.com");
    expect(events).toEqual([]);
  });
});
