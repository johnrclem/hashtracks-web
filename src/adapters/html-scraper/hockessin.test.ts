import { describe, it, expect } from "vitest";
import { parseHockessinEvent } from "./hockessin";
import { generateFingerprint } from "@/pipeline/fingerprint";

describe("HockessinAdapter", () => {
  describe("parseHockessinEvent", () => {
    it("parses a standard event with title, date, time, hares, and location", () => {
      // #797: post-colon header text is the hare name, not the event title.
      const header = "Hash #1656: Green Dress Hash";
      const detail = "SATURDAY, March 14, 2026, 3:00pm, (Prelube at 2:30PM, pack off 3:15), 404 New London Road, Newark, DE";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(1656);
      // #1326: no source-distinct title; merge/UI synthesizes from kennel + run #.
      expect(event!.title).toBeUndefined();
      expect(event!.hares).toBe("Green Dress Hash");
      expect(event!.date).toBe("2026-03-14");
      expect(event!.startTime).toBe("15:00");
      expect(event!.kennelTags[0]).toBe("hockessin");
      expect(event!.location).toContain("404 New London Road");
      expect(event!.location).toContain("Newark");
      expect(event!.location).toContain("DE");
    });

    it("parses an event without parenthetical notes", () => {
      const header = "Hash #1650: January Thaw";
      const detail = "SATURDAY, January 10, 2026, 3:00pm, 123 Main Street, Hockessin, DE";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(1650);
      expect(event!.title).toBeUndefined();
      expect(event!.hares).toBe("January Thaw");
      expect(event!.date).toBe("2026-01-10");
      expect(event!.startTime).toBe("15:00");
      expect(event!.location).toContain("123 Main Street");
    });

    it("live-format fixture from #797: '715 Art Lane, Newark, DE'", () => {
      // Verbatim from hockessinhash.org on 2026-04-19.
      const header = "Hash #1661: Asshopper";
      const detail = "SATURDAY, April 18, 2026, 3:00pm,  715 Art Lane, Newark, DE";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(1661);
      expect(event!.title).toBeUndefined();
      expect(event!.hares).toBe("Asshopper");
      expect(event!.date).toBe("2026-04-18");
      expect(event!.startTime).toBe("15:00");
      expect(event!.location).toBe("715 Art Lane, Newark, DE");
    });

    it("rejects TBA/TBD placeholder locations", () => {
      const header = "Hash #1670: Placeholder Event";
      const detail = "SATURDAY, July 4, 2026, 3:00pm, TBA";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.location).toBeUndefined();
    });

    it("returns null for non-matching header", () => {
      const event = parseHockessinEvent(
        "Some other text",
        "SATURDAY, March 14, 2026",
        "https://www.hockessinhash.org/",
      );
      expect(event).toBeNull();
    });

    it("returns null for empty detail text", () => {
      const event = parseHockessinEvent(
        "Hash #1656: Test",
        "",
        "https://www.hockessinhash.org/",
      );
      expect(event).toBeNull();
    });

    it("returns null when date cannot be parsed", () => {
      const event = parseHockessinEvent(
        "Hash #1656: Test",
        "No date info here at all",
        "https://www.hockessinhash.org/",
      );
      expect(event).toBeNull();
    });

    it("parses events with Wednesday summer schedule", () => {
      const header = "Hash #1660: Midsummer Hash";
      const detail = "WEDNESDAY, June 17, 2026, 6:30pm, Brandywine Park, Wilmington, DE";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(1660);
      expect(event!.date).toBe("2026-06-17");
      expect(event!.startTime).toBe("18:30");
      expect(event!.location).toContain("Brandywine Park");
    });

    it("handles run numbers correctly", () => {
      const header = "Hash #999: Small Number";
      const detail = "SATURDAY, April 5, 2026, 3:00pm, Test Location";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(999);
    });

    it("splits hares from theme on ' - ' (#1493 / #1665 fixture)", () => {
      // Verbatim from hockessinhash.org on 2026-05-19. The post-colon segment
      // carries both hare names and a theme — split on first space-dash-space.
      const header = "Hash #1665: Circle Jerk and Do Me On The Beach - Is It Summer Already??";
      const detail = "WEDNESDAY, May 20, 2026, 6:30pm, White Clay Creek preserve - Lot 3";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(1665);
      expect(event!.hares).toBe("Circle Jerk and Do Me On The Beach");
      expect(event!.title).toBe("Is It Summer Already??");
      expect(event!.date).toBe("2026-05-20");
      expect(event!.startTime).toBe("18:30");
      // Location parser splits on the first dash, but the residual after the
      // last time match still includes the lot number — verify it survives.
      expect(event!.location).toContain("White Clay Creek preserve");
    });

    it("normalizes en/em dash variants in the title separator (#1493)", () => {
      // Hockessin currently uses ASCII " - " but future copy edits could swap
      // to en/em dashes — normalize so the split still works.
      const header = "Hash #1680: Hares Name – Theme Goes Here";
      const detail = "SATURDAY, August 1, 2026, 3:00pm, Test Location";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.hares).toBe("Hares Name");
      expect(event!.title).toBe("Theme Goes Here");
    });

    it("treats single-segment post-colon text as hares with no title (#797)", () => {
      // Existing #797 behavior must not regress: when there's no " - "
      // separator, the whole post-colon segment is hares and title is left
      // undefined for the UI to synthesize from kennel + run #.
      const header = "Hash #1670: Some Hare Name";
      const detail = "SATURDAY, June 6, 2026, 3:00pm, Test Location";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.hares).toBe("Some Hare Name");
      expect(event!.title).toBeUndefined();
    });

    it("emits empty hares when the header has no post-colon text", () => {
      // #1326: title is always undefined (let UI synthesize); missing
      // post-colon segment just leaves hares undefined too.
      const header = "Hash #1700: ";
      const detail = "SATURDAY, May 2, 2026, 3:00pm, Test Location";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.title).toBeUndefined();
      expect(event!.hares).toBeUndefined();
    });

    it("#1748: a source-duplicated run number on two dates stays distinct", () => {
      // Verbatim from hockessinhash.org on 2026-05-28: the kennel assigned the
      // same run number (#1668) to two different Wednesday runs. The adapter
      // faithfully scrapes both; distinctness is guaranteed downstream by the
      // event date (the first field of the merge fingerprint), so the two never
      // merge or collapse into one canonical Event. No renumbering — we don't
      // fabricate data the source didn't provide.
      const jun10 = parseHockessinEvent(
        "Hash #1668: HARE(S) NEEDED?!",
        "WEDNESDAY, June 10, 2026, 6:30pm, TBA",
        "https://www.hockessinhash.org/",
      );
      const jun17 = parseHockessinEvent(
        "Hash #1668: 7th Hole",
        "WEDNESDAY, June 17, 2026, 6:30pm, TBA",
        "https://www.hockessinhash.org/",
      );

      expect(jun10).not.toBeNull();
      expect(jun17).not.toBeNull();

      // Same (duplicated) run number, faithfully preserved on both.
      expect(jun10!.runNumber).toBe(1668);
      expect(jun17!.runNumber).toBe(1668);

      // Distinct dates and hares keep them apart.
      expect(jun10!.date).toBe("2026-06-10");
      expect(jun17!.date).toBe("2026-06-17");
      expect(jun10!.hares).toBe("HARE(S) NEEDED?!");
      expect(jun17!.hares).toBe("7th Hole");

      // The merge fingerprint differs (date is its first component), so the two
      // RawEvents never dedup into one — this is the actual no-collapse guard.
      expect(generateFingerprint(jun10!)).not.toBe(generateFingerprint(jun17!));
    });
  });
});
