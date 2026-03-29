import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractRunNumber,
  parseNorfolkDate,
  parseNorfolkRunBlock,
  htmlToText,
  NorfolkH3Adapter,
} from "./norfolk-h3";
import type { Source } from "@/generated/prisma/client";

describe("NorfolkH3Adapter", () => {
  describe("extractRunNumber", () => {
    it("extracts run number from 'Run #2139'", () => {
      expect(extractRunNumber("Run #2139")).toBe(2139);
    });

    it("extracts run number from 'Run #2144'", () => {
      expect(extractRunNumber("Run #2144")).toBe(2144);
    });

    it("returns undefined for non-matching text", () => {
      expect(extractRunNumber("Some random text")).toBeUndefined();
    });

    it("handles extra spaces", () => {
      expect(extractRunNumber("Run # 2150")).toBe(2150);
    });
  });

  describe("parseNorfolkDate", () => {
    it("parses UK ordinal date with 11am time", () => {
      const result = parseNorfolkDate("Sunday 29th March 2026, 11am");
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-03-29");
      expect(result!.startTime).toBe("11:00");
    });

    it("parses UK ordinal date with 7pm time", () => {
      const result = parseNorfolkDate("Wednesday 6th May 2026, 7pm");
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-05-06");
      expect(result!.startTime).toBe("19:00");
    });

    it("parses date without ordinal suffix", () => {
      const result = parseNorfolkDate("Wednesday 13 May 2026, 7pm");
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-05-13");
      expect(result!.startTime).toBe("19:00");
    });

    it("handles date with merged notes after time", () => {
      const result = parseNorfolkDate(
        "Sunday 26th April 2026, 11amBelated St. Georges Day Hash",
      );
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-04-26");
      expect(result!.startTime).toBe("11:00");
    });

    it("returns null for non-date text", () => {
      expect(parseNorfolkDate("Welcome to Norfolk H3")).toBeNull();
    });

    it("parses 5th April format", () => {
      const result = parseNorfolkDate("Sunday 5th April 2026, 11am");
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-04-05");
    });

    it("parses 3 June format (no ordinal)", () => {
      const result = parseNorfolkDate("Wednesday 3 June 2026, 7pm");
      expect(result).not.toBeNull();
      expect(result!.date).toBe("2026-06-03");
      expect(result!.startTime).toBe("19:00");
    });
  });

  describe("parseNorfolkRunBlock", () => {
    it("parses a complete run block with all fields", () => {
      const text = [
        "Sunday 29th March 2026, 11am",
        "Venue:",
        "The Crown Inn",
        "Front Street",
        "Trunch",
        "NR28 0AH",
        "Please park on roads near the pub.",
        "Hare(s):",
        "Woolly and Bagpuss",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-03-29");
      expect(run!.startTime).toBe("11:00");
      expect(run!.location).toContain("The Crown Inn");
      expect(run!.location).toContain("NR28 0AH");
      expect(run!.hares).toBe("Woolly and Bagpuss");
      expect(run!.locationUrl).toContain("NR28");
      expect(run!.locationUrl).toContain("0AH");
    });

    it("parses a run with special event notes", () => {
      const text = [
        "Sunday 5th April 2026, 11am",
        "Easter Egg Hunt and Beer stops on the trail.",
        "Prize for best Easter Bonnet.",
        "Venue:",
        "The Duke of Wellington",
        "91-93 Waterloo Road",
        "Norwich.",
        "NR3 1EG",
        "Hare(s):",
        "Bottomtanicals and P.E.",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-04-05");
      expect(run!.startTime).toBe("11:00");
      expect(run!.location).toContain("Duke of Wellington");
      expect(run!.location).toContain("NR3 1EG");
      expect(run!.hares).toBe("Bottomtanicals and P.E.");
      expect(run!.notes).toContain("Easter Egg Hunt");
    });

    it("handles Wednesday 7pm runs", () => {
      const text = [
        "Wednesday 6th May 2026, 7pm",
        "Venue:",
        "Heathlands Social Club",
        "and Community Centre",
        "Woodbastwick Road",
        "Blofield Heath",
        "NR13 4QH",
        "Hare(s):",
        "Fi Fi and Tweedledee ( Flori)",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-05-06");
      expect(run!.startTime).toBe("19:00");
      expect(run!.location).toContain("Heathlands Social Club");
      expect(run!.location).toContain("NR13 4QH");
      expect(run!.hares).toBe("Fi Fi and Tweedledee ( Flori)");
    });

    it("handles placeholder venues (???)", () => {
      const text = [
        "Wednesday 13 May 2026, 7pm",
        "Venue: ???",
        "Hare(s): It could be you?",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-05-13");
      expect(run!.startTime).toBe("19:00");
      expect(run!.location).toBeUndefined();
      expect(run!.hares).toBeUndefined();
      expect(run!.locationUrl).toBeUndefined();
    });

    it("extracts postcode for Google Maps URL", () => {
      const text = [
        "Sunday 12th April 2026, 11am",
        "Venue:",
        "The Dukes Head",
        "Corpusty",
        "NR11 6QG",
        "Hare(s):",
        "Woolly Jumper and Bagpuss",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.locationUrl).toContain("google.com/maps");
      expect(run!.locationUrl).toContain("NR11");
      expect(run!.locationUrl).toContain("6QG");
    });

    it("captures notes after the hares block", () => {
      const text = [
        "Sunday 12th April 2026, 11am",
        "Venue:",
        "The Dukes Head",
        "Corpusty",
        "NR11 6QG",
        "Hare(s):",
        "Woolly Jumper and Bagpuss",
        "Dead Beat Cats band playing at 4pm.",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.notes).toContain("Dead Beat Cats");
    });

    it("returns null for empty text", () => {
      expect(parseNorfolkRunBlock("")).toBeNull();
      expect(parseNorfolkRunBlock("   \n  \n  ")).toBeNull();
    });

    it("returns null for text with no date", () => {
      expect(parseNorfolkRunBlock("Just some random text")).toBeNull();
    });
  });

  describe("htmlToText", () => {
    it("converts <br> to newlines", () => {
      const html =
        "<p>Venue:<br>The Crown Inn<br>Front Street<br>NR28 0AH</p>";
      const text = htmlToText(html);
      expect(text).toContain("Venue:");
      expect(text).toContain("\nThe Crown Inn");
      expect(text).toContain("\nNR28 0AH");
    });

    it("converts </p> to newlines", () => {
      const html = "<p>Line one</p><p>Line two</p>";
      const text = htmlToText(html);
      expect(text).toBe("Line one\nLine two");
    });

    it("inserts space after inline closing tags", () => {
      const html = "<p><strong>Wednesday</strong> 6th May 2026</p>";
      const text = htmlToText(html);
      expect(text).toContain("Wednesday 6th May");
    });

    it("decodes HTML entities", () => {
      const html = "<p>Haven&rsquo;t got time &amp; no restrictions.</p>";
      const text = htmlToText(html);
      expect(text).toContain("\u2019t got time & no restrictions.");
    });
  });

  describe("adapter integration", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("has correct type", () => {
      const adapter = new NorfolkH3Adapter();
      expect(adapter.type).toBe("HTML_SCRAPER");
    });

    it("parses realistic WordPress HTML fixture", async () => {
      const mockHtml = `<!DOCTYPE html><html><body>
        <ul class="wp-block-post-template is-layout-grid">
          <li class="wp-block-post post-1397 post">
            <div class="wp-block-group">
              <div class="wp-block-group has-global-padding">
                <h3 class="has-text-align-left wp-block-post-title has-large-font-size">
                  <a href="https://norfolkh3.co.uk/2026/01/10/run-2139/">Run #2139</a>
                </h3>
                <div class="entry-content wp-block-post-content is-layout-flow">
                  <p>Sunday 29th March 2026, 11am</p>
                  <p>Venue:<br>
                  The Crown Inn<br>
                  Front Street<br>
                  Trunch<br>
                  NR28 0AH</p>
                  <p>Please park on roads<br>
                  near the pub.</p>
                  <p>Hare(s):<br>
                  Woolly and Bagpuss</p>
                </div>
              </div>
            </div>
          </li>
          <li class="wp-block-post post-1398 post">
            <div class="wp-block-group">
              <div class="wp-block-group has-global-padding">
                <h3 class="has-text-align-left wp-block-post-title has-large-font-size">
                  <a href="https://norfolkh3.co.uk/2026/01/10/run-2144/">Run #2144</a>
                </h3>
                <div class="entry-content wp-block-post-content is-layout-flow">
                  <p><strong>Wednesday</strong> 6th May 2026, <strong>7pm</strong></p>
                  <p>Venue:<br>
                  Heathlands Social Club<br>
                  and Community Centre<br>
                  Woodbastwick Road<br>
                  Blofield Heath<br>
                  NR13 4QH</p>
                  <p>Hare(s):<br>
                  Fi Fi and Tweedledee ( Flori)</p>
                </div>
              </div>
            </div>
          </li>
          <li class="wp-block-post post-1399 post">
            <div class="wp-block-group">
              <div class="wp-block-group has-global-padding">
                <h3 class="has-text-align-left wp-block-post-title has-large-font-size">
                  <a href="https://norfolkh3.co.uk/2026/01/10/run-2145/">Run #2145</a>
                </h3>
                <div class="entry-content wp-block-post-content is-layout-flow">
                  <p>Wednesday 13 May 2026, 7pm</p>
                  <p>Venue: ???</p>
                  <p>Hare(s): It could be you?</p>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </body></html>`;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
        status: 200,
        statusText: "OK",
      });
      vi.stubGlobal("fetch", mockFetch);

      const adapter = new NorfolkH3Adapter();
      const source = {
        id: "test",
        url: "https://norfolkh3.co.uk/trails/",
        config: {},
      } as unknown as Source;

      const result = await adapter.fetch(source, { days: 365 });

      // Should find 3 posts — all have dates
      expect(result.events.length).toBe(3);

      // First event: Run #2139
      const run2139 = result.events.find((e) => e.runNumber === 2139);
      expect(run2139).toBeDefined();
      expect(run2139!.date).toBe("2026-03-29");
      expect(run2139!.startTime).toBe("11:00");
      expect(run2139!.location).toContain("Crown Inn");
      expect(run2139!.location).toContain("NR28 0AH");
      expect(run2139!.hares).toBe("Woolly and Bagpuss");
      expect(run2139!.kennelTag).toBe("Norfolk H3");

      // Second event: Run #2144 (Wednesday evening)
      const run2144 = result.events.find((e) => e.runNumber === 2144);
      expect(run2144).toBeDefined();
      expect(run2144!.date).toBe("2026-05-06");
      expect(run2144!.startTime).toBe("19:00");
      expect(run2144!.location).toContain("Heathlands Social Club");
      expect(run2144!.hares).toBe("Fi Fi and Tweedledee ( Flori)");

      // Third event: Run #2145 (placeholder)
      const run2145 = result.events.find((e) => e.runNumber === 2145);
      expect(run2145).toBeDefined();
      expect(run2145!.date).toBe("2026-05-13");
      expect(run2145!.startTime).toBe("19:00");
      expect(run2145!.location).toBeUndefined();
      expect(run2145!.hares).toBeUndefined();
    });
  });
});
