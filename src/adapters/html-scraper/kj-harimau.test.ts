import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  KjHarimauAdapter,
  parseKjHarimauBody,
  parseKjHarimauDate,
  parseKjHarimauTitle,
} from "./kj-harimau";
import * as bloggerApi from "../blogger-api";

vi.mock("../blogger-api");

describe("parseKjHarimauDate", () => {
  it("parses DD/MM/YYYY (Malaysian order)", () => {
    expect(parseKjHarimauDate("14/04/2026")).toBe("2026-04-14");
  });
  it("parses DD/MM/YY", () => {
    expect(parseKjHarimauDate("14/04/26")).toBe("2026-04-14");
  });
  it("parses DD-MM-YYYY", () => {
    expect(parseKjHarimauDate("14-04-2026")).toBe("2026-04-14");
  });
  it("rejects non-numeric date text", () => {
    expect(parseKjHarimauDate("April 14")).toBeNull();
    expect(parseKjHarimauDate("TBD")).toBeNull();
  });
});

describe("parseKjHarimauTitle", () => {
  it("extracts run number and date from the title", () => {
    const fields = parseKjHarimauTitle(
      "Run#:1548, 14/04/2026, Hare: Silver Hai Ho, Runsite: Radio Cafe, Botanic Klang",
    );
    expect(fields.runNumber).toBe(1548);
    expect(fields.date).toBe("2026-04-14");
    expect(fields.hare).toBe("Silver Hai Ho");
    expect(fields.runsite).toBe("Radio Cafe, Botanic Klang");
  });

  it("handles titles without Hare/Runsite labels", () => {
    const fields = parseKjHarimauTitle("Run#:1544, 17/03/26");
    expect(fields.runNumber).toBe(1544);
    expect(fields.date).toBe("2026-03-17");
    expect(fields.hare).toBeUndefined();
  });
});

describe("parseKjHarimauBody", () => {
  const body = `
*Kelab Hash House Harimau Kelana Jaya*
Run#: 1548
Date: 14/04/26,
Time: 6:00 pm
Hare: Silver Hai Ho - https://shorturl.at/9SSG7
Runsite: Radio Cafe, Botanic Klang
GPS: 2.9874534,101.4512081
Maps: https://maps.app.goo.gl/4z3La8RTDfd4MPbo8
Waze: https://waze.com/ul/hw280uxu68
Guest Fee: RM 60
Details at khhhkj.blogspot.com
`;

  it("extracts all labeled fields", () => {
    const fields = parseKjHarimauBody(body);
    expect(fields.runNumber).toBe(1548);
    expect(fields.date).toBe("2026-04-14");
    expect(fields.startTime).toBe("18:00");
    expect(fields.hare).toBe("Silver Hai Ho");
    expect(fields.runsite).toBe("Radio Cafe, Botanic Klang");
    expect(fields.latitude).toBeCloseTo(2.9874534);
    expect(fields.longitude).toBeCloseTo(101.4512081);
    expect(fields.mapsUrl).toBe("https://maps.app.goo.gl/4z3La8RTDfd4MPbo8");
    expect(fields.wazeUrl).toBe("https://waze.com/ul/hw280uxu68");
    expect(fields.guestFee).toBe("RM 60");
  });

  it("handles empty body gracefully", () => {
    expect(parseKjHarimauBody("")).toEqual({});
  });

  // #1446 regression: an early-announcement post had `Runsite:` empty followed
  // by `Maps:` (also empty). The labeled-field regex over-matched across the
  // newline and captured the literal "Maps:" as the runsite value. Now empty
  // fields and label-only captures both resolve to `undefined`.
  it("rejects label-only over-matches when an earlier field is empty (#1446)", () => {
    const earlyAnnouncement = `
*Kelab Hash House Harimau Kelana Jaya*
Run#: 1553
Date: 19/05/26,
Time: 6:00 pm
Hare: Siva Lembu
Runsite:

Maps:
Guest Fee: RM 60
Details at khhhkj.blogspot.com
`;
    const fields = parseKjHarimauBody(earlyAnnouncement);
    expect(fields.runNumber).toBe(1553);
    expect(fields.runsite).toBeUndefined();
    expect(fields.mapsUrl).toBeUndefined();
    expect(fields.hare).toBe("Siva Lembu");
    expect(fields.guestFee).toBe("RM 60");
  });
});

describe("KjHarimauAdapter.fetch dedup (#1446)", () => {
  let adapter: KjHarimauAdapter;

  beforeEach(() => {
    adapter = new KjHarimauAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the most-complete post when duplicates share (date, runNumber)", async () => {
    // Two Blogger posts for the same Run #1553: an early announcement with
    // empty Runsite/Maps, then a corrected post with full details. The
    // adapter must keep the corrected one regardless of post order.
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [
        {
          // Early/incomplete post — encountered first.
          title: "Run#:1553, 19/05/2026, Hare:  Siva Lembu, Runsite:",
          content: `<p>*Kelab Hash House Harimau Kelana Jaya*<br>
Run#: 1553<br>
Date: 19/05/26,<br>
Time: 6:00 pm<br>
Hare: Siva Lembu<br>
Runsite:<br>
<br>
Maps:<br>
Guest Fee: RM 60</p>`,
          url: "https://khhhkj.blogspot.com/2026/05/run-1553-early.html",
          published: "2026-05-10T00:00:00Z",
        },
        {
          // Corrected post — encountered second, has full details.
          title: "Run#:1553, 19/05/26, Hare:Siva Lembu, Runsite:Bukit Gasing Car Park",
          content: `<p>*Kelab Hash House Harimau Kelana Jaya*<br>
Run#: 1553<br>
Date: 19/05/26,<br>
Time: 6:00 pm<br>
Hare: Siva Lembu - https://shorturl.at/x<br>
Runsite: Bukit Gasing Car Park<br>
GPS: 3.0936761,101.6555709<br>
Maps: https://maps.app.goo.gl/example<br>
Guest Fee: RM 60</p>`,
          url: "https://khhhkj.blogspot.com/2026/05/run-1553-corrected.html",
          published: "2026-05-15T00:00:00Z",
        },
      ],
      blogId: "kjhash",
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch({
      id: "src-kj-harimau",
      url: "https://khhhkj.blogspot.com",
      scrapeDays: 365,
    } as never);

    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.runNumber).toBe(1553);
    expect(event.location).toBe("Bukit Gasing Car Park");
    expect(event.locationUrl).toBe("https://maps.app.goo.gl/example");
    expect(event.latitude).toBeCloseTo(3.0936761);
    expect(event.longitude).toBeCloseTo(101.6555709);
  });
});
