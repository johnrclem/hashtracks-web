import { describe, it, expect } from "vitest";
import { parseHarelineRow } from "./dublin-hash";

describe("DublinHashAdapter", () => {
  describe("parseHarelineRow", () => {
    const sourceUrl = "https://dublinhhh.com/hareline";

    it("parses a standard Dublin H3 row", () => {
      const cells = [
        "Monday",
        "16 March 2026",
        "19:30",
        "Dublin H3 #1668",
        "Dalkey DART Station",
        "Polly",
        'On on at the "The Club"',
      ];
      const hrefs = [
        undefined,
        undefined,
        undefined,
        "/hareline/2026-03-16-dublin-h3/",
        "https://maps.app.goo.gl/vuR36Jdgqy4d4svQ8",
        undefined,
        undefined,
      ];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-03-16");
      expect(event!.startTime).toBe("19:30");
      expect(event!.kennelTag).toBe("dh3");
      expect(event!.title).toBe("Dublin H3 #1668");
      expect(event!.runNumber).toBe(1668);
      expect(event!.location).toBe("Dalkey DART Station");
      expect(event!.locationUrl).toBe("https://maps.app.goo.gl/vuR36Jdgqy4d4svQ8");
      expect(event!.hares).toBe("Polly");
      expect(event!.sourceUrl).toBe("https://dublinhhh.com/hareline/2026-03-16-dublin-h3/");
      expect(event!.description).toBe('On on at the "The Club"');
    });

    it("parses an I Love Monday row", () => {
      const cells = [
        "Monday",
        "23 March 2026",
        "19:30",
        "I ♥ Monday #410",
        "Strand House, Fairview",
        "Stitch",
        "",
      ];
      const hrefs = [
        undefined,
        undefined,
        undefined,
        "/hareline/2026-03-23-i-%E2%99%A5-monday/",
        "https://maps.app.goo.gl/GoSE7C31p1WYWBY26",
        undefined,
        undefined,
      ];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-03-23");
      expect(event!.kennelTag).toBe("dh3");
      expect(event!.title).toBe("I ♥ Monday #410");
      expect(event!.runNumber).toBe(410);
      expect(event!.location).toBe("Strand House, Fairview");
      expect(event!.hares).toBe("Stitch");
    });

    it("handles TBD hares", () => {
      const cells = [
        "Monday",
        "3 July 2026",
        "",
        "Dublin H3 DH3 Nash Hash",
        "Dublin",
        "TBD",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, "/hareline/2026-07-03-dublin-h3/", undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.hares).toBeUndefined();
      expect(event!.startTime).toBeUndefined();
      expect(event!.runNumber).toBeUndefined();
    });

    it("handles date range (multi-day event)", () => {
      // The ndash gets decoded to \u2013 by Cheerio
      const cells = [
        "Friday\u2013Sunday",
        "3\u20135 July 2026",
        "",
        "Dublin H3 DH3 Nash Hash",
        "Dublin",
        "TBD",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, "/hareline/2026-07-03-dublin-h3/", undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-07-03");
    });

    it("skips rows with insufficient columns", () => {
      const cells = ["Monday", "16 March 2026"];
      const hrefs = [undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).toBeNull();
    });

    it("skips rows with empty date", () => {
      const cells = ["Monday", "", "19:30", "Dublin H3 #1668", "Somewhere", "Someone", ""];
      const hrefs = [undefined, undefined, undefined, undefined, undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).toBeNull();
    });

    it("handles missing location URL", () => {
      const cells = [
        "Monday",
        "14 September 2026",
        "12:00",
        "Dublin H3 #???",
        "TBD",
        "Volunteer",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, "/hareline/2026-09-14-dublin-h3/", undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.locationUrl).toBeUndefined();
      expect(event!.hares).toBe("Volunteer");
    });

    it("parses afternoon time correctly", () => {
      const cells = [
        "Sunday",
        "5 April 2026",
        "14:00",
        "Dublin H3 #1670",
        "Phoenix Park",
        "PhD",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, undefined, "https://maps.app.goo.gl/abc123", undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.startTime).toBe("14:00");
    });
  });
});
