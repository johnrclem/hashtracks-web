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

    it("captures multi-line hares and stops venue at on-after blurb (#1257)", () => {
      // Verbatim from issue #1257 (Run #2144). Two hares on separate lines
      // under one Hare(s): label, and an "Afterwards, ..." on-after blurb
      // that previously concatenated into the address.
      const text = [
        "Wednesday 6th May 2026, 7pm",
        "Venue: Heathlands Social Club and Community Centre",
        "Woodbastwick Road",
        "Blofield Heath NR13 4QH",
        "Afterwards, sandwich buffet, wagon wheels, cake, tea & coffee and the bar will be open!",
        "Hare(s): Fi Fi and Tweedledee ( Flori)",
        "Tweedledum (Simon)",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-05-06");
      expect(run!.startTime).toBe("19:00");
      // Location stops at the postcode; "Afterwards" blurb must NOT bleed in.
      expect(run!.location).toContain("Heathlands Social Club");
      expect(run!.location).toContain("NR13 4QH");
      expect(run!.location).not.toMatch(
        /sandwich|buffet|wagon wheels|bar will be open/i,
      );
      // Both hares captured, joined with comma.
      expect(run!.hares).toBe(
        "Fi Fi and Tweedledee ( Flori), Tweedledum (Simon)",
      );
      // Notes/description must NOT contain the second hare.
      expect(run!.notes ?? "").not.toMatch(/Tweedledum/);
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
      // The Venue: field was present ("???") but is a placeholder → explicit
      // clear (null) so merge wipes any stale address, not preserve (#1747).
      expect(run!.location).toBeNull();
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
      // Notes that follow hares come from a separate <p> in the source HTML;
      // htmlToText emits a blank line between paragraphs. parseNorfolkRunBlock
      // treats that blank as a section stop so multi-line hares (#1257) don't
      // swallow the following notes paragraph.
      const text = [
        "Sunday 12th April 2026, 11am",
        "Venue:",
        "The Dukes Head",
        "Corpusty",
        "NR11 6QG",
        "Hare(s):",
        "Woolly Jumper and Bagpuss",
        "",
        "Dead Beat Cats band playing at 4pm.",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Woolly Jumper and Bagpuss");
      expect(run!.notes).toContain("Dead Beat Cats");
    });

    it("returns null for empty text", () => {
      expect(parseNorfolkRunBlock("")).toBeNull();
      expect(parseNorfolkRunBlock("   \n  \n  ")).toBeNull();
    });

    it("returns null for text with no date", () => {
      expect(parseNorfolkRunBlock("Just some random text")).toBeNull();
    });

    it("stops venue capture at 'Park on nearby roads.' parking note (#1544)", () => {
      // Verbatim from issue #1544 (Run #2147). The confirmed Reepham venue
      // had a "Park on nearby roads." note appended after the postcode.
      // Without a SECTION_STOP entry the note bled into locationName.
      const text = [
        "Wednesday 27th May 2026, 7pm",
        "Venue:",
        "The Crown",
        "90 Ollands Road",
        "Reepham.",
        "NR10 4EJ",
        "Park on nearby roads.",
        "Hare(s):",
        "Woolly & Bagpuss",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-05-27");
      expect(run!.startTime).toBe("19:00");
      expect(run!.location).toContain("The Crown");
      expect(run!.location).toContain("90 Ollands Road");
      expect(run!.location).toContain("NR10 4EJ");
      expect(run!.location).not.toMatch(/Park on nearby roads/i);
      expect(run!.hares).toBe("Woolly & Bagpuss");
    });

    it("captures hares when venue spans multi-line free-text body, dropping the 'Details to follow' qualifier (#1545/#1747)", () => {
      // Verbatim from issue #1545 (Run #2153). Venue is a two-line free-text
      // body ("Drayton area" + "Details to follow") with no postcode, then
      // a Hare(s): label on the next line. The hare extraction must not be
      // dropped just because the venue body is informal. Per #1747 the
      // trailing "Details to follow" uncertainty qualifier is now stripped
      // from the location so the geocoder sees just "Drayton area".
      const text = [
        "Wednesday 8th July 2026, 7pm",
        "Venue:",
        "Drayton area",
        "Details to follow",
        "Hare(s):",
        "James & Custodian",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-07-08");
      expect(run!.location).toBe("Drayton area");
      expect(run!.location).not.toMatch(/Details to follow/i);
      expect(run!.hares).toBe("James & Custodian");
    });

    it("captures hares for single-line T.B.A. venue and clears the location (#1545/#1747 Run #2154)", () => {
      const text = [
        "Wednesday 15th July 2026, 7pm",
        "Venue:",
        "T.B.A.",
        "Hare(s):",
        "Maddie Mc Madder",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Maddie Mc Madder");
      // "T.B.A." is a pure uncertainty marker — the Venue: field was present
      // but cleans to non-venue text, so emit an explicit clear (#1747).
      expect(run!.location).toBeNull();
    });

    it("peels leading 'Maybe,' and trailing 'T.B.C' qualifiers but keeps the postcode (#1747 Run #2148)", () => {
      const text = [
        "Sunday 1st June 2026, 11am",
        "Venue:",
        "Maybe, The Maids Head,",
        "85 Spixworth Road",
        "Old Catton",
        "Norwich",
        "NR6 7NH",
        "T.B.C.",
        "Hare(s):",
        "Woolly",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.location).toBe(
        "The Maids Head, 85 Spixworth Road, Old Catton, Norwich, NR6 7NH",
      );
      expect(run!.location).not.toMatch(/maybe/i);
      expect(run!.location).not.toMatch(/t\.b\.c/i);
      // Postcode survives the trailing-qualifier strip → map pin still resolves.
      expect(run!.locationUrl).toContain("NR6");
    });

    it("strips leading '?' prefix from haresText (#1546)", () => {
      // When a "???" placeholder gets split across `<br>`/`<p>` boundaries
      // upstream, a residual "?" can prefix the hares string. The parser
      // must strip it before storing.
      const text = [
        "Wednesday 24th June 2026, 7pm",
        "Venue: T.B.A. Maybe Worstead",
        "Hare(s): ? Woolly & Bagpuss",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Woolly & Bagpuss");
      expect(run!.hares).not.toMatch(/^\?/);
    });

    it("strips leading '?' prefix from locationName (#1546)", () => {
      const text = [
        "Wednesday 1st July 2026, 7pm",
        "Venue: ? Clint Green, Yaxham T.B.C. / updates to follow",
        "Hare(s): Hugo & Riff Raff",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.location).toContain("Clint Green");
      expect(run!.location).toContain("Yaxham");
      expect(run!.location).not.toMatch(/^\?/);
    });

    it("strips '?' prefix with no following space ('?Woolly') (#1546)", () => {
      // Tag-stripped placeholders can collapse directly against the next
      // token with no separator, e.g. "<span>?</span>Woolly". The leading
      // "?" must still be removed.
      const text = [
        "Wednesday 24th June 2026, 7pm",
        "Venue: T.B.A. Maybe Worstead",
        "Hare(s): ?Woolly & Bagpuss",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Woolly & Bagpuss");
    });

    it("filters 'It could be you?' volunteer prompt even when split by <br> (#1546)", () => {
      // When the placeholder straddles a <br>/<p> boundary, htmlToText emits
      // a newline that joinFieldSegments rejoins with a comma. The volunteer
      // guard must still recognize it.
      const text = [
        "Wednesday 22nd July 2026, 7pm",
        "Venue: ???",
        "Hare(s): It could be",
        "you?",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.hares).toBeUndefined();
    });

    it("filters standalone '?' lines out of multi-line venue (#1546)", () => {
      // Simulates a "???" placeholder split across `<br>`/`<p>` boundaries
      // where a stray "?" token ends up on its own line between real
      // address parts.
      const text = [
        "Wednesday 1st July 2026, 7pm",
        "Venue:",
        "Clint Green,",
        "?",
        "Yaxham T.B.C. / updates to follow",
        "Hare(s):",
        "Hugo & Riff Raff",
      ].join("\n");

      const run = parseNorfolkRunBlock(text);
      expect(run).not.toBeNull();
      expect(run!.location).toContain("Clint Green");
      expect(run!.location).toContain("Yaxham");
      // The "?" line should be filtered, not joined as a fragment.
      expect(run!.location).not.toMatch(/(?:^|, )\?(?:,|$)/);
      expect(run!.hares).toBe("Hugo & Riff Raff");
    });
  });

  describe("htmlToText", () => {
    it("converts <br> to newlines", () => {
      const html = "<p>Venue:<br>The Crown Inn<br>Front Street<br>NR28 0AH</p>";
      const text = htmlToText(html);
      expect(text).toContain("Venue:");
      expect(text).toContain("\nThe Crown Inn");
      expect(text).toContain("\nNR28 0AH");
    });

    it("converts </p> to paragraph breaks (blank line between)", () => {
      // Paragraph break preserved as a blank line so parseNorfolkRunBlock can
      // stop multi-line Hare(s): captures at the boundary (#1257).
      const html = "<p>Line one</p><p>Line two</p>";
      const text = htmlToText(html);
      expect(text).toBe("Line one\n\nLine two");
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
      expect(run2139!.kennelTags[0]).toBe("Norfolk H3");

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
      // Placeholder Venue: → explicit clear (null), not preserve (#1747).
      expect(run2145!.location).toBeNull();
      expect(run2145!.hares).toBeUndefined();
    });

    it("does not leak '?' across posts when a '???'-placeholder post sits between confirmed ones (#1546)", async () => {
      // Three posts in DOM order: a confirmed venue (#2150), a placeholder
      // run (#2151 with `Venue: ???` / `Hare(s): It could be you?`), then a
      // second confirmed venue (#2152). The placeholder must not leak any
      // residual "?" into the surrounding posts' location or hares.
      const mockHtml = `<!DOCTYPE html><html><body>
        <ul class="wp-block-post-template">
          <li class="wp-block-post">
            <h3 class="wp-block-post-title"><a href="#">Run #2150</a></h3>
            <div class="entry-content wp-block-post-content">
              <p>Wednesday 17 June 2026, 7pm</p>
              <p>Venue:<br>Red Lion<br>Marsh Road<br>Halvergate<br>NR13 3QB</p>
              <p>Hare(s):<br>Saboteur &amp; Twice a day</p>
            </div>
          </li>
          <li class="wp-block-post">
            <h3 class="wp-block-post-title"><a href="#">Run #2151</a></h3>
            <div class="entry-content wp-block-post-content">
              <p>Wednesday 24 June 2026, 7pm</p>
              <p>Venue: ???</p>
              <p>Hare(s): It could be you?</p>
            </div>
          </li>
          <li class="wp-block-post">
            <h3 class="wp-block-post-title"><a href="#">Run #2152</a></h3>
            <div class="entry-content wp-block-post-content">
              <p>Wednesday 1 July 2026, 7pm</p>
              <p>Venue: Clint Green, Yaxham T.B.C. / updates to follow</p>
              <p>Hare(s): Hugo &amp; Riff Raff</p>
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
      expect(result.events.length).toBe(3);

      const run2150 = result.events.find((e) => e.runNumber === 2150);
      expect(run2150!.location).toContain("Red Lion");
      expect(run2150!.location).not.toMatch(/^\?/);
      expect(run2150!.hares).toBe("Saboteur & Twice a day");
      expect(run2150!.hares).not.toMatch(/^\?/);

      const run2151 = result.events.find((e) => e.runNumber === 2151);
      // Placeholder Venue: → explicit clear (null), not preserve (#1747).
      expect(run2151!.location).toBeNull();
      expect(run2151!.hares).toBeUndefined();

      const run2152 = result.events.find((e) => e.runNumber === 2152);
      expect(run2152!.location).toContain("Clint Green");
      expect(run2152!.location).toContain("Yaxham");
      expect(run2152!.location).not.toMatch(/^\?/);
      expect(run2152!.hares).toBe("Hugo & Riff Raff");
      expect(run2152!.hares).not.toMatch(/^\?/);
    });
  });
});
