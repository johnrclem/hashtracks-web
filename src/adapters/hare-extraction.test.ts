import { describe, it, expect } from "vitest";
import { extractHares } from "./hare-extraction";

describe("extractHares", () => {
  it("extracts from Hare: line", () => {
    expect(extractHares("Details\nHare: Mudflap\nON-IN: Some Bar")).toBe("Mudflap");
  });

  it("extracts from Hares: line", () => {
    expect(extractHares("Hares: Alice & Bob")).toBe("Alice & Bob");
  });

  it("extracts from 'Hare & Co-Hares:' line (Voodoo H3 format)", () => {
    expect(extractHares("Hare & Co-Hares: Steven with a D\nStart Address: 123 Main")).toBe("Steven with a D");
  });

  it("extracts from 'Hare & Co-Hares:' with multiple names", () => {
    expect(extractHares("Hare & Co-Hares: Whordini & Mudflap")).toBe("Whordini & Mudflap");
  });

  it("extracts from Who: line", () => {
    expect(extractHares("Who: Charlie")).toBe("Charlie");
  });

  it("skips generic Who: answers", () => {
    expect(extractHares("Who: that be you")).toBeUndefined();
  });

  it("skips 'everyone'", () => {
    expect(extractHares("Who: everyone")).toBeUndefined();
  });

  it("returns undefined when no match", () => {
    expect(extractHares("No hare info here")).toBeUndefined();
  });

  it("takes only first line of hare text", () => {
    expect(extractHares("Hare: Alice\nSome other info")).toBe("Alice");
  });

  // #1082 EPH3 #2719: source description sometimes has no newlines between
  // WHO/WHAT/WHEN sections — the greedy `(.*)` swallowed everything to the
  // end of string. Section-label lookahead now stops before the next label.
  it("stops at next concatenated WHAT/WHEN/etc. section label without newlines (#1082 EPH3)", () => {
    const desc = "WHO ARE THE HARES: TBDWHAT TIME IS THE HASH: @10am B-TRUCK OUT 9:50WHAT TO WEAR: Hash GearWHATIS THE COST: $7";
    expect(extractHares(desc)).toBe("TBD");
  });

  it("preserves multi-line WHO ARE THE HARES values (#1082 backwards compat)", () => {
    const desc = "WHO ARE THE HARES: Leeroy\n\nWHAT TIME IS THE HASH: 10am";
    expect(extractHares(desc)).toBe("Leeroy");
  });

  it("captures multi-name hares before next section label (#1082)", () => {
    const desc = "WHO ARE THE HARES: choco & cuntswayloWHAT TIME IS THE HASH: 10am";
    expect(extractHares(desc)).toBe("choco & cuntswaylo");
  });

  // Custom hare patterns (configurable via source config)
  it("uses custom patterns when provided", () => {
    expect(
      extractHares("WHO ARE THE HARES:  Used Rubber & Leeroy", [
        String.raw`(?:^|\n)\s*WHO ARE THE HARES:\s*(.+)`,
      ]),
    ).toBe("Used Rubber & Leeroy");
  });

  it("uses custom pattern: Laid by", () => {
    expect(
      extractHares("Laid by: Speedy Gonzalez", [
        String.raw`(?:^|\n)\s*Laid by:\s*(.+)`,
      ]),
    ).toBe("Speedy Gonzalez");
  });

  it("falls back to defaults when customPatterns is undefined", () => {
    expect(extractHares("Hare: DefaultMatch")).toBe("DefaultMatch");
  });

  it("falls back to defaults when customPatterns is empty array", () => {
    expect(extractHares("Hare: DefaultMatch", [])).toBe("DefaultMatch");
  });

  it("truncates hares at embedded What: label when HTML stripping collapses fields", () => {
    expect(
      extractHares("Who: AmazonWhat: A beautiful trail that doesn't start at the Mad Hanna"),
    ).toBe("Amazon");
  });

  it("truncates hares at embedded Where: label", () => {
    expect(extractHares("Hare: John DoeWhere: Some Bar, 123 Main St")).toBe("John Doe");
  });

  it("truncates hares at embedded Hash Cash label", () => {
    expect(extractHares("Hare: AliceHash Cash: $5")).toBe("Alice");
  });

  it("custom patterns replace defaults", () => {
    expect(
      extractHares("Hare: Mudflap", [String.raw`(?:^|\n)\s*Laid by:\s*(.+)`]),
    ).toBeUndefined();
  });

  it("skips malformed custom patterns gracefully", () => {
    expect(
      extractHares("Laid by: Speedy", [
        "[invalid(",
        String.raw`(?:^|\n)\s*Laid by:\s*(.+)`,
      ]),
    ).toBe("Speedy");
  });

  it("still filters generic answers with custom patterns", () => {
    expect(
      extractHares("Laid by: everyone", [String.raw`(?:^|\n)\s*Laid by:\s*(.+)`]),
    ).toBeUndefined();
  });

  // Boilerplate truncation (fixes EPTX, O2H3 hare corruption)
  it("truncates at 'WHAT TIME' boilerplate marker", () => {
    expect(extractHares("Hare: Captain Hash WHAT TIME: 6:30 PM")).toBe("Captain Hash");
  });

  it("truncates at 'WHERE' boilerplate marker", () => {
    expect(extractHares("Hare: Trail Blazer WHERE: The Pub, 123 Main St")).toBe("Trail Blazer");
  });

  it("truncates at 'Location' boilerplate marker", () => {
    expect(extractHares("Hare: Mudflap Location: Central Park")).toBe("Mudflap");
  });

  it("truncates at 'Cost' boilerplate marker", () => {
    expect(extractHares("Hare: Captain Cost: $5")).toBe("Captain");
  });

  it("truncates at 'HASH CASH' boilerplate marker", () => {
    expect(extractHares("Hare: Alice HASH CASH: $7")).toBe("Alice");
  });

  it("truncates at 'Directions' boilerplate marker", () => {
    expect(extractHares("Hare: Trail Blazer Directions: Take I-95 North")).toBe("Trail Blazer");
  });

  it("truncates at 'Meet at' boilerplate marker", () => {
    expect(extractHares("Hare: Mudflap Meet at the park at 6pm")).toBe("Mudflap");
  });

  // Preposition/verb filter (description text, not names)
  it("filters hare string starting with 'at'", () => {
    expect(extractHares("Hare: at the corner of 5th and Main")).toBeUndefined();
  });

  it("filters hare string starting with 'from'", () => {
    expect(extractHares("Hare: from the old pub to the new one")).toBeUndefined();
  });

  it("preserves hare names starting with 'the' (e.g. 'The Pope')", () => {
    expect(extractHares("Hare: The Pope")).toBe("The Pope");
  });

  it("extracts from Hare(s): pattern (jHavelina format)", () => {
    expect(extractHares("Trail info\nHare(s): Splat!\nLocation: Park")).toBe("Splat!");
  });

  it("extracts from 'Hare [Name]' without colon (MH3 format)", () => {
    expect(extractHares("Details\nHare C*ck Swap\nLocation: Park")).toBe("C*ck Swap");
  });

  it("does not false-match 'hare off at' as a hare name", () => {
    expect(extractHares("Pack off at 7:30, hare off at 7:15")).toBeUndefined();
  });

  it("extracts from WHO (hares): pattern (DeMon format)", () => {
    const desc = "WHO (hares): A Girl Named Steve\nWHAT TIME: 7:00 PM\nSome song lyrics\nHare drop another for the prince";
    expect(extractHares(desc)).toBe("A Girl Named Steve");
  });

  it("does not extract song lyric after 'Hare drop' (negative lookahead)", () => {
    const desc = "Some intro\nHare drop another for the prince of this\nMore lyrics";
    expect(extractHares(desc)).toBeUndefined();
  });

  it("extracts WHO (hares): when HTML stripping splits label from colon", () => {
    // GCal API returns HTML like "<b>WHO (hares)</b>: Name" which after
    // stripHtmlTags may produce "WHO (hares)\n: Name" (newline before colon)
    const desc = "WHO (hares)\n: A Girl Named Steve\nWHEN:Monday, March 21st, 2026\nWHAT: song lyrics with Hare drop another";
    expect(extractHares(desc)).toBe("A Girl Named Steve");
  });

  it("truncates at *** separator in hare field", () => {
    expect(extractHares("Hare(s): Denny's Sucks *** could use a co-hare")).toBe("Denny's Sucks");
  });

  it("strips 'could use a co-hare' commentary", () => {
    expect(extractHares("Hare(s): Denny's Sucks could use a co-hare")).toBe("Denny's Sucks");
  });

  it("strips 'need a co-hare' commentary", () => {
    expect(extractHares("Hare: Trail Blazer need a cohare for this one")).toBe("Trail Blazer");
  });

  it("strips trailing phone number (dashed format)", () => {
    expect(extractHares("Hare: Dr Sh!t Yeah! 719-360-3805")).toBe("Dr Sh!t Yeah!");
  });

  it("strips trailing phone number (parenthesized format)", () => {
    expect(extractHares("Hare: Trail Name (555) 123-4567")).toBe("Trail Name");
  });

  it("strips trailing phone number (dotted format)", () => {
    expect(extractHares("Hares: Name1 & Name2 555.123.4567")).toBe("Name1 & Name2");
  });

  it("strips phone from full description context", () => {
    const description =
      "March Madness!\nRilea's Pub 5672 N Union Blvd\nHare: Dr Sh!t Yeah! 719-360-3805\nBring: whistle";
    expect(extractHares(description)).toBe("Dr Sh!t Yeah!");
  });

  // Multi-line hare continuation: some calendars put each hare on its own line
  // beneath the "Hares:" label.

  it("joins continuation lines under 'Hares:' label (two names)", () => {
    const desc = "Hares:\nIvanna Hairy Buttchug\nIndiana Bones and the Temple of Poon";
    expect(extractHares(desc)).toBe("Ivanna Hairy Buttchug, Indiana Bones and the Temple of Poon");
  });

  it("joins continuation lines under 'Hares:' label (three names)", () => {
    const desc = "Hares:\nAlice\nBob\nCarol";
    expect(extractHares(desc)).toBe("Alice, Bob, Carol");
  });

  it("stops multi-line hares at blank line", () => {
    const desc = "Hares:\nAlice\nBob\n\nSome other paragraph";
    expect(extractHares(desc)).toBe("Alice, Bob");
  });

  it("stops multi-line hares at next field label", () => {
    const desc = "Hares:\nAlice\nBob\nWhere: Some Pub";
    expect(extractHares(desc)).toBe("Alice, Bob");
  });

  it("stops multi-line hares at URL continuation", () => {
    const desc = "Hares:\nAlice\nhttps://example.com/trail-map";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("stops multi-line hares at boilerplate marker", () => {
    const desc = "Hares:\nAlice\nHash Cash: $5";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("inline hare on label line does NOT sweep in continuation prose", () => {
    // Continuation only triggers for label-only headers; an inline hare is
    // assumed complete (following prose is description, not co-hares).
    const desc = "Hares: Alice\nBob the Hare did a thing yesterday\nWhere: Park";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("single-line hare behavior unchanged (regression)", () => {
    expect(extractHares("Hare: Mudflap\nON-IN: Some Bar")).toBe("Mudflap");
  });

  it("single-line hare with immediate next-label unchanged", () => {
    expect(extractHares("Hares: Alice & Bob\nWhere: Park")).toBe("Alice & Bob");
  });

  // Adversarial: label-only "Hares:" followed by prose/instructions must not
  // sweep description text into hare names.
  it("does not ingest sentence-like prose after label-only header", () => {
    const desc = "Hares:\nBring a flashlight.\nMeet at the park.";
    expect(extractHares(desc)).toBeUndefined();
  });

  it("does not ingest lines containing colons (unrecognized field labels)", () => {
    const desc = "Hares:\nNote: see FB for details\nDistance: 5k";
    expect(extractHares(desc)).toBeUndefined();
  });

  it("stops at overly long continuation line (prose, not a name)", () => {
    const longLine = "This is a long paragraph describing the trail that goes on for many words in a row";
    const desc = `Hares:\nAlice\n${longLine}`;
    expect(extractHares(desc)).toBe("Alice");
  });
});

describe("extractHares — bare 10-digit phone strip (#742 BAH3, #809)", () => {
  it.each([
    ["bare 10-digit suffix", "Hares: Slick Willy 2406185563", "Slick Willy"],
    ["formatted phone suffix", "Hares: Slick Willy 240-618-5563", "Slick Willy"],
    ["mid-string phone + commentary", "Hares: Any Cock'll Do Me, 2406185563 CALL for same day service", "Any Cock'll Do Me"],
    ["mid-string formatted phone", "Hares: Slick Willy 240-618-5563 text for address", "Slick Willy"],
    ["phone with 'Phone:' label", "Hares: Slick Willy, phone: 2406185563 for details", "Slick Willy"],
  ])("%s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — WHO ARE THE HARES template (#774 BJH3)", () => {
  it("captures hare name from WHO ARE THE HARES: label", () => {
    expect(extractHares("WHO ARE THE HARES: Leeroy")).toBe("Leeroy");
  });

  it("captures multiple hares from WHO ARE THE HARES: label", () => {
    expect(extractHares("WHO ARE THE HARES: Leeroy & Jenkins")).toBe(
      "Leeroy & Jenkins",
    );
  });

  it("matches case-insensitively", () => {
    expect(extractHares("Who Are The Hares: Leeroy")).toBe("Leeroy");
  });
});
