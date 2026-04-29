import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { parseRunBlock, parseEdinburghRuns, extractWeeblyBlockText, EdinburghH3Adapter } from "./edinburgh-h3";

describe("EdinburghH3Adapter", () => {
  describe("parseRunBlock", () => {
    it("extracts all fields from a complete run block", () => {
      const block = `Run No. 2302
Date 22nd March 2026
Hares Rugrat & Hairspray
Venue Holyrood Park, Meadowbank car park (EH8 7AT)
Time 11:00
Location (w3w): https://w3w.co/scam.spark.sample
Directions Take a No. 4, 5, 26 or 44 Lothian bus to the stop near Meadowbank.
ON INN: The Bellfield Brewery.`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(2302);
      expect(run!.date).toBe("2026-03-22");
      expect(run!.hares).toBe("Rugrat & Hairspray");
      expect(run!.location).toBe("Holyrood Park, Meadowbank car park (EH8 7AT)");
      expect(run!.startTime).toBe("11:00");
      expect(run!.locationW3W).toBe("https://w3w.co/scam.spark.sample");
      expect(run!.directions).toBe("Take a No. 4, 5, 26 or 44 Lothian bus to the stop near Meadowbank.");
      expect(run!.onInn).toBe("The Bellfield Brewery.");
    });

    it("parses ordinal dates (1st, 2nd, 3rd, 4th)", () => {
      const block = `Run No. 2310
Date 1st May 2026
Hares Captain Slog
Venue Arthur's Seat Car Park
Time 10:30`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.date).toBe("2026-05-01");
      expect(run!.runNumber).toBe(2310);
      expect(run!.startTime).toBe("10:30");
    });

    it("handles missing optional fields gracefully", () => {
      const block = `Run No. 2305
Date 12th April 2026
Venue Edinburgh Castle Esplanade`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(2305);
      expect(run!.date).toBe("2026-04-12");
      expect(run!.location).toBe("Edinburgh Castle Esplanade");
      expect(run!.hares).toBeUndefined();
      expect(run!.startTime).toBeUndefined();
      expect(run!.onInn).toBeUndefined();
      expect(run!.locationW3W).toBeUndefined();
      expect(run!.directions).toBeUndefined();
    });

    it("returns null for block with no date", () => {
      const block = `Run No. 2305
Hares Captain Slog
Venue Somewhere in Edinburgh`;

      const run = parseRunBlock(block);

      expect(run).toBeNull();
    });

    // #1107: Edinburgh's `<br>` separators inside a single labeled section
    // (especially Directions / ON INN) were collapsing to single sentences
    // because parseRunBlock iterated line-by-line and only matched the label
    // regex on the first line of each section. Continuation lines (no label
    // prefix) must be folded into the current section's value.
    it("preserves multi-line Directions and ON INN sections (#1107)", () => {
      const block = `Run No. 2308
Date 3rd May 2026
Hares Septic Sporran
Venue Charlestown Limekilns (KY11 3ET)
Time 11:00
Location (w3w): https://w3w.co/soggy.galaxies.scatters
Directions Take the M90 to Fife over the Queensferry Crossing.
Take exit 1c onto the A985 towards Kincardine Bridge and Rosyth.
Follow this road through 3 roundabouts.
After the turn off left to Rosyth Dockyard West Gate take the left to Charlestown and Limekilns.
Stay on this road for 1.1 miles.
Just before entering Charlestown and the uphill cobbled road turn left on to Saltpans.
Follow this road along the sea for 0.4 of a mile and park on the road at the Limekilns.
ON INN: The Bruce Arms
Septic has booked 16 spaces at 13:30 for lunch at The Bruce Arms, a preorder is required, menus attached.`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.runNumber).toBe(2308);
      expect(run!.date).toBe("2026-05-03");
      expect(run!.hares).toBe("Septic Sporran");
      expect(run!.directions).toContain("Take the M90 to Fife");
      expect(run!.directions).toContain("Stay on this road for 1.1 miles");
      expect(run!.directions).toContain("park on the road at the Limekilns");
      expect(run!.onInn).toContain("The Bruce Arms");
      expect(run!.onInn).toContain("Septic has booked 16 spaces");
      expect(run!.onInn).toContain("preorder is required");
    });

    it("handles TBD hares", () => {
      const block = `Run No. 2306
Date 19th April 2026
Hares TBD
Venue TBA
Time 11:00`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.hares).toBeUndefined();
      expect(run!.location).toBeUndefined();
    });

    it("pads single-digit hours in time", () => {
      const block = `Run No. 2307
Date 26th April 2026
Time 9:30`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.startTime).toBe("09:30");
    });

    it("handles ON INN without colon", () => {
      const block = `Run No. 2308
Date 3rd May 2026
ON INN The Oxford Bar`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.onInn).toBe("The Oxford Bar");
    });

    it("does not let ON INN prose overwrite real hare names (#659)", () => {
      // The ON INN section can contain "Hare will provide soup..." which
      // matches /^Hares?/ but is prose, not the hare field. The first-match
      // guard ensures the real "Hares Ankle Grinder & Flying Boats" sticks
      // and the later prose line is ignored.
      const block = `Run No. 2305
Date 12th April 2026
Hares Ankle Grinder & Flying Boats
Venue Meldon Hills car park
Time 11:00
ON INN: An informal affair at Dean Cottage
Hare will provide soup, sandwiches, beer and bubbles.`;

      const run = parseRunBlock(block);

      expect(run).not.toBeNull();
      expect(run!.hares).toBe("Ankle Grinder & Flying Boats");
      expect(run!.hares).not.toContain("soup");
    });

    it("returns null for empty text", () => {
      expect(parseRunBlock("")).toBeNull();
      expect(parseRunBlock("   \n  \n  ")).toBeNull();
    });
  });

  describe("parseEdinburghRuns", () => {
    it("splits multiple runs correctly", () => {
      const text = `Some header text about the Edinburgh Hash House Harriers

Run No. 2302
Date 22nd March 2026
Hares Rugrat & Hairspray
Venue Holyrood Park, Meadowbank car park (EH8 7AT)
Time 11:00

Run No. 2303
Date 29th March 2026
Hares Toad
Venue Corstorphine Hill Car Park
Time 11:00
ON INN: The Roseburn Bar

Run No. 2304
Date 5th April 2026
Hares Bravefart
Venue Stockbridge, Glenogle Baths
Time 10:30`;

      const runs = parseEdinburghRuns(text);

      expect(runs).toHaveLength(3);
      expect(runs[0].runNumber).toBe(2302);
      expect(runs[0].date).toBe("2026-03-22");
      expect(runs[1].runNumber).toBe(2303);
      expect(runs[1].date).toBe("2026-03-29");
      expect(runs[1].onInn).toBe("The Roseburn Bar");
      expect(runs[2].runNumber).toBe(2304);
      expect(runs[2].date).toBe("2026-04-05");
      expect(runs[2].startTime).toBe("10:30");
    });

    it("handles single run", () => {
      const text = `Run No. 2302
Date 22nd March 2026
Hares Test Hare
Venue Test Venue
Time 11:00`;

      const runs = parseEdinburghRuns(text);

      expect(runs).toHaveLength(1);
      expect(runs[0].runNumber).toBe(2302);
    });

    it("returns empty array for text with no runs", () => {
      const text = "Welcome to Edinburgh Hash House Harriers! Check back for upcoming runs.";

      const runs = parseEdinburghRuns(text);

      expect(runs).toHaveLength(0);
    });

    it("skips run blocks that have no valid date", () => {
      const text = `Run No. 2302
Date 22nd March 2026
Hares Test Hare
Venue Test Venue
Time 11:00

Run No. 2303
Hares No Date Hare
Venue Some Place`;

      const runs = parseEdinburghRuns(text);

      expect(runs).toHaveLength(1);
      expect(runs[0].runNumber).toBe(2302);
    });
  });

  describe("Weebly HTML integration (realistic structure)", () => {
    // Uses the exported extractWeeblyBlockText directly — no logic duplication
    function extractFromH2s(html: string): ReturnType<typeof parseRunBlock>[] {
      const $ = cheerio.load(html);
      const runs: ReturnType<typeof parseRunBlock>[] = [];
      $("h2.wsite-content-title").each((_, el) => {
        const blockText = extractWeeblyBlockText($(el).html() ?? "");
        const parsed = parseRunBlock(blockText);
        if (parsed) runs.push(parsed);
      });
      return runs;
    }

    it("parses real Weebly HTML with <strong> + <br> structure", () => {
      const html = `<html><body><h2 class="wsite-content-title"><strong>Run No. 2302<br>Date 22nd March 2026<br>Hares Rugrat &amp; Hairspray</strong><br><strong>Venue</strong> <strong>Holyrood Park,</strong> <a href="#">Meadowbank car park</a> <strong>(EH8 7AT)</strong><br><strong>Time 11:00</strong><br><strong>ON INN:</strong> <a href="#">The Bellfield Brewery</a> <strong>.</strong></h2><h2 class="wsite-content-title"><strong>Run No. 2303<br>Date 29th March 2026<br>Hares Shaggus &amp; Megasaurarse</strong><br><strong>Venue</strong> <strong>Car Park, Glenlochart Road, EH10 5PY</strong><br><strong>Time 11:00</strong></h2></body></html>`;

      const runs = extractFromH2s(html);

      expect(runs).toHaveLength(2);
      expect(runs[0]!.runNumber).toBe(2302);
      expect(runs[0]!.date).toBe("2026-03-22");
      expect(runs[0]!.hares).toBe("Rugrat & Hairspray");
      expect(runs[0]!.location).toBe("Holyrood Park, Meadowbank car park (EH8 7AT)");
      expect(runs[0]!.startTime).toBe("11:00");
      expect(runs[0]!.onInn).toBe("The Bellfield Brewery.");
      expect(runs[1]!.runNumber).toBe(2303);
      expect(runs[1]!.date).toBe("2026-03-29");
      expect(runs[1]!.hares).toBe("Shaggus & Megasaurarse");
      expect(runs[1]!.location).toBe("Car Park, Glenlochart Road, EH10 5PY");
    });

    it("handles nested font tags inside strong", () => {
      const html = `<html><body><h2 class="wsite-content-title"><strong><font color="#000000">Run No. 2310<br>Date 1st May 2026<br>Hares Captain Slog</font></strong><br><strong><font color="#000000">Venue Arthur's Seat Car Park</font></strong><br><strong><font color="#000000">Time 10:30</font></strong></h2></body></html>`;

      const runs = extractFromH2s(html);

      expect(runs).toHaveLength(1);
      expect(runs[0]!.runNumber).toBe(2310);
      expect(runs[0]!.date).toBe("2026-05-01");
      expect(runs[0]!.hares).toBe("Captain Slog");
      expect(runs[0]!.location).toBe("Arthur's Seat Car Park");
      expect(runs[0]!.startTime).toBe("10:30");
    });
  });

  describe("adapter type", () => {
    it("has correct type", () => {
      const adapter = new EdinburghH3Adapter();
      expect(adapter.type).toBe("HTML_SCRAPER");
    });
  });
});
