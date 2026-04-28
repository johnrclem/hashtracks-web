import { describe, it, expect } from "vitest";
import { parseCfh3Post, parseHarelineRow, parseHarelineTable } from "./cape-fear-h3";
import * as cheerio from "cheerio";

// Real post content from WordPress.com API (March 21 trail)
const POST_HTML_MIS_MAN = `
<p class="wp-block-paragraph"><strong>When</strong>:</p>
<p class="wp-block-paragraph">Saturday, March 21st at<strong>\u00a02:00 p.m.</strong>\u00a0That\u2019s\u00a0<strong>1400</strong>\u00a0for you military types.</p>
<p class="wp-block-paragraph"><strong>Where</strong>:</p>
<p class="wp-block-paragraph"><a href="https://www.google.com/maps/dir//Smith+Creek+Park,+633+Shenandoah+St,+Wilmington,+NC+28411">Smith Creek Park</a></p>
<p class="wp-block-paragraph"><strong>Who \u2013 Hares:</strong></p>
<p class="wp-block-paragraph">Mis-Man</p>
<p class="wp-block-paragraph"><strong>Dog Friendly?</strong></p>
<p class="wp-block-paragraph">Yes! Leash friendly shiggy.</p>
<p class="wp-block-paragraph"><strong>Notes</strong>:</p>
<p class="wp-block-paragraph">Mis-Man is collectively haring a trail! No hash cash required!</p>
<p class="wp-block-paragraph"><strong>Why\u00a0</strong>:</p>
<p class="wp-block-paragraph">Because hashing, and beer!</p>
<p class="wp-block-paragraph"><strong>What to Bring:</strong></p>
<p class="wp-block-paragraph">You \ud83d\ude42 Hi</p>
<p class="wp-block-paragraph"><br><strong>On-After:</strong></p>
<p class="wp-block-paragraph">TBD</p>
`;

// Real post content (March 7 trail)
const POST_HTML_PHOTO = `
<p class="wp-block-paragraph"><strong>When</strong>:</p>
<p class="wp-block-paragraph">Saturday, March 7th at<strong>\u00a02:00 p.m.</strong>\u00a0That\u2019s\u00a0<strong>1400</strong>\u00a0for you military types.</p>
<p class="wp-block-paragraph"><strong>Where</strong>:</p>
<p class="wp-block-paragraph"><a href="http://2094 Old Mill Creek Rd SE, Winnabow">Photo&#8217;s Spread: 2094 Old Mill Creek Rd SE, Winnabow</a></p>
<p class="wp-block-paragraph"><strong>Who \u2013 Hares:</strong></p>
<p class="wp-block-paragraph">Photo Spread</p>
<p class="wp-block-paragraph"><strong>Dog Friendly?</strong></p>
<p class="wp-block-paragraph">Yes! Leash friendly shiggy.</p>
<p class="wp-block-paragraph"><strong>Notes</strong>:</p>
<p class="wp-block-paragraph">Swamps, rednecks, woods, and dogs.</p>
<p class="wp-block-paragraph"><strong>On-After:</strong></p>
<p class="wp-block-paragraph">Photo&#8217;s Spread</p>
`;

// Real post content from Run #517 "Impromptu Kayak Trail!" (April 18 trail).
// The author typed the colon INSIDE the <strong> tag here (`<strong>When:</strong>`)
// instead of after it, which broke the label match pre-#903.
const POST_HTML_KAYAK_COLON_INSIDE = `
<p class="wp-block-paragraph"><strong>When:</strong></p>
<p class="wp-block-paragraph">Saturday, April 18th at<strong>\u00a02:00 p.m.</strong>\u00a0That\u2019s\u00a0<strong>1400</strong>\u00a0for you military types.</p>
<p class="wp-block-paragraph"><strong>Where</strong>:</p>
<p class="wp-block-paragraph"><a href="https://maps.app.goo.gl/At4SKNixJ5pynDWZ8">Davis Creek Park</a><br></p>
<p class="wp-block-paragraph"><strong>Who \u2013 Hares:</strong></p>
<p class="wp-block-paragraph">Bear Force &amp; Spongy</p>
<p class="wp-block-paragraph"><strong>Dog Friendly?</strong></p>
<p class="wp-block-paragraph">No\u2026 unless they can swimm\u2026</p>
<p class="wp-block-paragraph"><strong>Notes</strong>:</p>
<p class="wp-block-paragraph">Spring hath sprung, and nobody signed up to hare, so guess what? We\u2019re kayakin! Suckers!</p>
`;

describe("parseCfh3Post", () => {
  it("extracts event date from When field using publish year as reference", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-21");
  });

  it("extracts start time from bold text in When paragraph", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result!.startTime).toBe("14:00");
  });

  it("extracts hares from Who – Hares field", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result!.hares).toBe("Mis-Man");
  });

  it("extracts location text from Where field", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result!.location).toBe("Smith Creek Park");
  });

  it("extracts location URL from Where link href", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result!.locationUrl).toContain("google.com/maps");
  });

  it("filters TBD on-after as placeholder", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    // On-After is TBD, should not appear in description
    expect(result!.description).not.toContain("On After: TBD");
  });

  it("includes non-TBD on-after in description", () => {
    const $ = cheerio.load(POST_HTML_PHOTO);
    const result = parseCfh3Post($, "2026-03-03T13:41:27-05:00");
    expect(result!.description).toContain("On After: Photo\u2019s Spread");
  });

  it("uses publish year for date resolution (March 7 in 2026 publish)", () => {
    const $ = cheerio.load(POST_HTML_PHOTO);
    const result = parseCfh3Post($, "2026-03-03T13:41:27-05:00");
    expect(result!.date).toBe("2026-03-07");
  });

  it("extracts location with address from link text", () => {
    const $ = cheerio.load(POST_HTML_PHOTO);
    const result = parseCfh3Post($, "2026-03-03T13:41:27-05:00");
    expect(result!.location).toContain("2094 Old Mill Creek Rd SE");
  });

  it("rejects invalid URL in Where link href", () => {
    // POST_HTML_PHOTO has href="http://2094 Old Mill Creek Rd SE, Winnabow" (address, not URL)
    const $ = cheerio.load(POST_HTML_PHOTO);
    const result = parseCfh3Post($, "2026-03-03T13:41:27-05:00");
    expect(result!.locationUrl).toBeUndefined();
  });

  it("returns null for post without When field", () => {
    const html = `<p>Just a random post with no event data.</p>`;
    const $ = cheerio.load(html);
    const result = parseCfh3Post($, "2026-01-01T00:00:00-05:00");
    expect(result).toBeNull();
  });

  it("sets kennelTag to cfh3", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result!.kennelTags[0]).toBe("cfh3");
  });

  it("parses posts with the colon inside the <strong> tag (#903 regression)", () => {
    // #517 "Impromptu Kayak Trail!" — `<strong>When:</strong>` instead of
    // `<strong>When</strong>:`. Pre-fix, the When regex required an exact
    // "when" match, so parseCfh3Post returned null and the blog-post
    // upgrade (title / startTime / location / description) was skipped
    // entirely, leaving the canonical Event with only the hareline row.
    const $ = cheerio.load(POST_HTML_KAYAK_COLON_INSIDE);
    const result = parseCfh3Post($, "2026-04-14T15:40:54-04:00");
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-04-18");
    expect(result!.startTime).toBe("14:00");
    expect(result!.location).toBe("Davis Creek Park");
    expect(result!.locationUrl).toContain("maps.app.goo.gl");
    expect(result!.hares).toBe("Bear Force & Spongy");
    expect(result!.description).toContain("Spring hath sprung");
  });
});

const SOURCE_URL = "https://capefearh3.com/hare-line/";

describe("parseHarelineRow", () => {
  it("parses simple M-D date", () => {
    const result = parseHarelineRow(["514", "3-7", "Photo Spread"], 2026, SOURCE_URL);
    expect(result).toMatchObject({
      date: "2026-03-07",
      runNumber: 514,
      hares: "Photo Spread",
      kennelTags: ["cfh3"],
    });
  });

  it("parses date with description as title", () => {
    const result = parseHarelineRow(["516", "4-4 EASTER WKND", "TBD"], 2026, SOURCE_URL);
    expect(result).toMatchObject({
      date: "2026-04-04",
      runNumber: 516,
      title: "EASTER WKND",
    });
  });

  it("parses date with colon separator", () => {
    const result = parseHarelineRow(["524", "5-30: Hash Olympics", "TBD"], 2026, SOURCE_URL);
    expect(result).toMatchObject({
      date: "2026-05-30",
      title: "Hash Olympics",
    });
  });

  it("parses slash date with multi-day range", () => {
    const result = parseHarelineRow(["527", "7/24 – 7/26 PEG ISLAND", "TBD"], 2026, SOURCE_URL);
    expect(result).toMatchObject({
      date: "2026-07-24",
      title: "PEG ISLAND",
    });
  });

  it("converts TBD hares to undefined but keeps the event", () => {
    const result = parseHarelineRow(["516", "4-4", "TBD"], 2026, SOURCE_URL);
    expect(result).not.toBeNull();
    expect(result!.hares).toBeUndefined();
  });

  it("returns null for empty cells", () => {
    const result = parseHarelineRow(["", "", ""], 2026, SOURCE_URL);
    expect(result).toBeNull();
  });
});

describe("parseHarelineTable", () => {
  const HARELINE_HTML = `<html><body>
    <figure class="wp-block-table"><table>
      <tr><th>Trail #</th><th>Date</th><th>Hare(s)</th></tr>
      <tr><td>514</td><td>3-7</td><td>Photo Spread</td></tr>
      <tr><td>515</td><td>3-21 Mis-Management trail</td><td>Mis-Man</td></tr>
      <tr><td>516</td><td>4-4 EASTER WKND</td><td>TBD</td></tr>
    </table></figure>
    <p>Receding hareline – trails and hares of the past:</p>
    <figure class="wp-block-table"><table>
      <tr><td>513</td><td>2-21</td><td>Old Hare</td></tr>
      <tr><td>512</td><td>2-7</td><td>Another</td></tr>
    </table></figure>
  </body></html>`;

  it("parses only the first table (upcoming events)", () => {
    const $ = cheerio.load(HARELINE_HTML);
    const events = parseHarelineTable($, 2026, SOURCE_URL);
    expect(events).toHaveLength(3);
    expect(events.map(e => e.runNumber)).toEqual([514, 515, 516]);
  });

  it("does not include receding hareline events", () => {
    const $ = cheerio.load(HARELINE_HTML);
    const events = parseHarelineTable($, 2026, SOURCE_URL);
    expect(events.every(e => (e.runNumber ?? 0) >= 514)).toBe(true);
  });

  it("extracts title from date description", () => {
    const $ = cheerio.load(HARELINE_HTML);
    const events = parseHarelineTable($, 2026, SOURCE_URL);
    expect(events[1].title).toBe("Mis-Management trail");
    expect(events[2].title).toBe("EASTER WKND");
  });
});
