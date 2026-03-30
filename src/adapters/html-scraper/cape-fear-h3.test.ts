import { describe, it, expect } from "vitest";
import { parseCfh3Post } from "./cape-fear-h3";
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

  it("returns null for post without When field", () => {
    const html = `<p>Just a random post with no event data.</p>`;
    const $ = cheerio.load(html);
    const result = parseCfh3Post($, "2026-01-01T00:00:00-05:00");
    expect(result).toBeNull();
  });

  it("sets kennelTag to cfh3", () => {
    const $ = cheerio.load(POST_HTML_MIS_MAN);
    const result = parseCfh3Post($, "2026-03-17T18:40:42-04:00");
    expect(result!.kennelTag).toBe("cfh3");
  });
});
