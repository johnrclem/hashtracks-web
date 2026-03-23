import { describe, it, expect } from "vitest";
import { parseHockessinEvent } from "./hockessin";

describe("HockessinAdapter", () => {
  describe("parseHockessinEvent", () => {
    it("parses a standard event with title, date, time, and location", () => {
      const header = "Hash #1656: Green Dress Hash";
      const detail = "SATURDAY, March 14, 2026, 3:00pm, (Prelube at 2:30PM, pack off 3:15), 404 New London Road, Newark, DE";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.runNumber).toBe(1656);
      expect(event!.title).toBe("Green Dress Hash");
      expect(event!.date).toBe("2026-03-14");
      expect(event!.startTime).toBe("15:00");
      expect(event!.kennelTag).toBe("hockessin");
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
      expect(event!.title).toBe("January Thaw");
      expect(event!.date).toBe("2026-01-10");
      expect(event!.startTime).toBe("15:00");
      expect(event!.location).toContain("123 Main Street");
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

    it("uses title from header and falls back for missing title", () => {
      const header = "Hash #1700: ";
      const detail = "SATURDAY, May 2, 2026, 3:00pm, Test Location";

      const event = parseHockessinEvent(header, detail, "https://www.hockessinhash.org/");

      expect(event).not.toBeNull();
      expect(event!.title).toBe("Hockessin #1700");
    });
  });
});
