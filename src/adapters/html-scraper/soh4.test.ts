import { describe, it, expect } from "vitest";
import { parseTrailPageHtml, parseRssItems, extractTrailNumber } from "./soh4";

// ── HTML fixtures ──

/** Complete trail page with all structured fields */
const COMPLETE_TRAIL_HTML = `<html><body>
<div class="em-item em-item-single em-event em-event-single em-event-617">
  <h1>Trail #822: Spring Flours</h1>
  <p>Saturday - March 21, 2026 - 2:09 pm</p>
  <p>March weather has been at times both warm enough to start us thinking
  spring flowers and STRAWBERRY(s) but then cold enough for snow's return to
  crush our spirits to ZERO. Cum to Geddes and encourage Mother Nature to bring
  on warmer temperatures.</p>
  <p>
    <strong>Hares:</strong> Strawberry, Zero and Hose </br>
    <strong>Location:</strong> <a href="https://maps.app.goo.gl/ZLrp543fnTDXZ4WS7">Behind Marshalls in Fairmount</a> </br>
    <strong>Start Time:</strong> 1:69PM (AKA 2:09 pm)</br>
    <strong>Hash Cash:</strong> $7 (Virgins/first timers are free!)</br>
    <strong>Theme:</strong> Spring Flours</br>
    <strong>On-After:</strong> <a href="https://maps.app.goo.gl/DJwzQJ1AgxJ8tMY3A">Asil's Pub</a> </br>
  </p>
  <p><strong style="color: #333333;">*Note:Please bring your ID!</strong></p>
</div>
</body></html>`;

/** TBD trail with placeholder fields */
const TBD_TRAIL_HTML = `<html><body>
<div class="em-item em-item-single em-event em-event-single em-event-620">
  <h1>Trail #825: TBD</h1>
  <p>Monday - April 6, 2026 - 2:09 pm</p>
  <p>Trail Details TBD</p>
  <p>
    <strong>Hares:</strong> TBD </br>
    <strong>Location:</strong> TBD </br>
    <strong>Start Time:</strong> 2:09 pm</br>
  </p>
  <p>Please include hash name and date of trail in description.</p>
</div>
</body></html>`;

/** Trail with plain text location (no link) */
const PLAIN_LOCATION_HTML = `<html><body>
<div class="em-item em-item-single em-event em-event-single em-event-618">
  <h1>Trail #823: TBD</h1>
  <p>
    <strong>Hares:</strong> Hasher McHashface </br>
    <strong>Location:</strong> Clinton Square, Syracuse </br>
    <strong>Start Time:</strong> 6:09 pm</br>
  </p>
</div>
</body></html>`;

/** Trail with boilerplate and Maps URL in description */
const BOILERPLATE_HTML = `<html><body>
<div class="em-item em-item-single em-event em-event-single em-event-619">
  <h1>Trail #824: Pink Full Moon</h1>
  <p>Come run with us under the full moon!</p>
  <p>https://maps.app.goo.gl/abc123</p>
  <p>Please include hash name and date of trail in description.</p>
  <p>
    <strong>Hares:</strong> Moon Runner </br>
    <strong>Location:</strong> <a href="https://maps.app.goo.gl/xyz">Onondaga Lake Park</a> </br>
    <strong>Start Time:</strong> 6:09 pm</br>
  </p>
</div>
</body></html>`;

/** Minimal HTML with no em-event-single container */
const EMPTY_HTML = `<html><body><div>No event content</div></body></html>`;

// ── parseTrailPageHtml ──

describe("parseTrailPageHtml", () => {
  it("extracts all fields from a complete trail page", () => {
    const result = parseTrailPageHtml(COMPLETE_TRAIL_HTML);
    expect(result.hares).toBe("Strawberry, Zero and Hose");
    expect(result.location).toBe("Behind Marshalls in Fairmount");
    expect(result.locationUrl).toBe("https://maps.app.goo.gl/ZLrp543fnTDXZ4WS7");
    expect(result.hashCash).toBe("$7 (Virgins/first timers are free!)");
    expect(result.theme).toBe("Spring Flours");
    expect(result.onAfter).toBe("Asil's Pub");
  });

  it("extracts title from h1", () => {
    const result = parseTrailPageHtml(COMPLETE_TRAIL_HTML);
    expect(result.title).toBe("Trail #822: Spring Flours");
  });

  it("parses 'AKA' start time format (hash humor)", () => {
    const result = parseTrailPageHtml(COMPLETE_TRAIL_HTML);
    expect(result.startTime).toBe("14:09");
  });

  it("parses standard start time", () => {
    const result = parseTrailPageHtml(PLAIN_LOCATION_HTML);
    expect(result.startTime).toBe("18:09");
  });

  it("returns undefined for TBD/placeholder fields", () => {
    const result = parseTrailPageHtml(TBD_TRAIL_HTML);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.locationUrl).toBeUndefined();
  });

  it("still extracts start time from TBD trail", () => {
    const result = parseTrailPageHtml(TBD_TRAIL_HTML);
    expect(result.startTime).toBe("14:09");
  });

  it("handles plain text location without link", () => {
    const result = parseTrailPageHtml(PLAIN_LOCATION_HTML);
    expect(result.location).toBe("Clinton Square, Syracuse");
    expect(result.locationUrl).toBeUndefined();
  });

  it("extracts narrative description before structured fields", () => {
    const result = parseTrailPageHtml(COMPLETE_TRAIL_HTML);
    expect(result.description).toContain("spring flowers");
    expect(result.description).toContain("Mother Nature");
    // Should not contain structured field content
    expect(result.description).not.toContain("Hares:");
    expect(result.description).not.toContain("Hash Cash:");
  });

  it("strips boilerplate from description", () => {
    const result = parseTrailPageHtml(BOILERPLATE_HTML);
    expect(result.description).not.toContain("Please include hash name");
  });

  it("strips Google Maps URLs from description", () => {
    const result = parseTrailPageHtml(BOILERPLATE_HTML);
    expect(result.description).not.toContain("maps.app.goo.gl");
  });

  it("returns empty object for HTML without event container", () => {
    const result = parseTrailPageHtml(EMPTY_HTML);
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.title).toBeUndefined();
  });

  it("extracts hare from singular 'Hare:' label", () => {
    const html = `<div class="em-event-single">
      <strong>Hare:</strong> Solo Runner </br>
    </div>`;
    const result = parseTrailPageHtml(html);
    expect(result.hares).toBe("Solo Runner");
  });
});

// ── parseRssItems ──

describe("parseRssItems", () => {
  it("extracts items from RSS XML", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>SOH4 Trails</title>
    <item>
      <title>Trail #825 – Summer Kick-Off</title>
      <link>https://www.soh4.com/trails/825/</link>
    </item>
    <item>
      <title>Trail #824 – Memorial Day Hash</title>
      <link>https://www.soh4.com/trails/824/</link>
    </item>
  </channel>
</rss>`;

    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe("https://www.soh4.com/trails/825/");
    expect(items[0].title).toBe("Trail #825 – Summer Kick-Off");
    expect(items[1].url).toBe("https://www.soh4.com/trails/824/");
  });

  it("skips items without links", () => {
    const xml = `<rss><channel><item><title>No Link</title></item></channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(0);
  });
});

// ── extractTrailNumber ──

describe("extractTrailNumber", () => {
  it("extracts number from standard trail URL", () => {
    expect(extractTrailNumber("https://www.soh4.com/trails/821/")).toBe(821);
  });

  it("extracts number without trailing slash", () => {
    expect(extractTrailNumber("https://www.soh4.com/trails/825")).toBe(825);
  });

  it("returns undefined for non-trail URL", () => {
    expect(extractTrailNumber("https://www.soh4.com/about/")).toBeUndefined();
  });
});
