import { describe, it, expect } from "vitest";
import { extractHares } from "./hare-extraction";

describe("extractHares — basic label patterns", () => {
  it.each([
    ["Hare: line", "Details\nHare: Mudflap\nON-IN: Some Bar", "Mudflap"],
    ["Hares: line", "Hares: Alice & Bob", "Alice & Bob"],
    ["'Hare & Co-Hares:' (Voodoo H3 format)", "Hare & Co-Hares: Steven with a D\nStart Address: 123 Main", "Steven with a D"],
    ["'Hare & Co-Hares:' multiple names", "Hare & Co-Hares: Whordini & Mudflap", "Whordini & Mudflap"],
    ["Who: line", "Who: Charlie", "Charlie"],
    ["takes only first line of hare text", "Hare: Alice\nSome other info", "Alice"],
    ["Hare(s): pattern (jHavelina format)", "Trail info\nHare(s): Splat!\nLocation: Park", "Splat!"],
    ["'Hare [Name]' without colon (MH3 format)", "Details\nHare C*ck Swap\nLocation: Park", "C*ck Swap"],
    ["preserves names starting with 'the' (e.g. 'The Pope')", "Hare: The Pope", "The Pope"],
  ])("extracts from %s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — negative / filtered cases", () => {
  it.each([
    ["generic 'that be you'", "Who: that be you"],
    ["'everyone'", "Who: everyone"],
    ["no hare info present", "No hare info here"],
    ["preposition 'at' prefix", "Hare: at the corner of 5th and Main"],
    ["preposition 'from' prefix", "Hare: from the old pub to the new one"],
    ["false-match 'hare off at'", "Pack off at 7:30, hare off at 7:15"],
    ["song lyric after 'Hare drop'", "Some intro\nHare drop another for the prince of this\nMore lyrics"],
  ])("returns undefined for %s", (_label, desc) => {
    expect(extractHares(desc)).toBeUndefined();
  });
});

describe("extractHares — #1082 EPH3 concatenated section labels", () => {
  // Source description sometimes has no newlines between WHO/WHAT/WHEN sections —
  // the greedy `(.*)` swallowed everything to end of string. Section-label
  // lookahead now stops before the next label.
  it.each([
    [
      "stops at next concatenated WHAT/WHEN section label without newlines",
      "WHO ARE THE HARES: TBDWHAT TIME IS THE HASH: @10am B-TRUCK OUT 9:50WHAT TO WEAR: Hash GearWHATIS THE COST: $7",
      "TBD",
    ],
    [
      "preserves multi-line WHO ARE THE HARES values (backwards compat)",
      "WHO ARE THE HARES: Leeroy\n\nWHAT TIME IS THE HASH: 10am",
      "Leeroy",
    ],
    [
      "captures multi-name hares before next section label",
      "WHO ARE THE HARES: choco & cuntswayloWHAT TIME IS THE HASH: 10am",
      "choco & cuntswaylo",
    ],
  ])("%s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — custom patterns", () => {
  const LAID_BY = String.raw`(?:^|\n)\s*Laid by:\s*(.+)`;
  const WHO_ARE_THE_HARES = String.raw`(?:^|\n)\s*WHO ARE THE HARES:\s*(.+)`;

  it("uses provided custom patterns", () => {
    expect(extractHares("WHO ARE THE HARES:  Used Rubber & Leeroy", [WHO_ARE_THE_HARES])).toBe(
      "Used Rubber & Leeroy",
    );
  });

  it("uses custom 'Laid by' pattern", () => {
    expect(extractHares("Laid by: Speedy Gonzalez", [LAID_BY])).toBe("Speedy Gonzalez");
  });

  it("falls back to defaults when customPatterns is undefined", () => {
    expect(extractHares("Hare: DefaultMatch")).toBe("DefaultMatch");
  });

  it("falls back to defaults when customPatterns is empty array", () => {
    expect(extractHares("Hare: DefaultMatch", [])).toBe("DefaultMatch");
  });

  it("custom patterns replace defaults — Hare: no longer matches", () => {
    expect(extractHares("Hare: Mudflap", [LAID_BY])).toBeUndefined();
  });

  it("skips malformed custom patterns gracefully", () => {
    expect(extractHares("Laid by: Speedy", ["[invalid(", LAID_BY])).toBe("Speedy");
  });

  it("still filters generic answers with custom patterns", () => {
    expect(extractHares("Laid by: everyone", [LAID_BY])).toBeUndefined();
  });
});

describe("extractHares — embedded label truncation (HTML field collapse)", () => {
  it.each([
    ["What:", "Who: AmazonWhat: A beautiful trail that doesn't start at the Mad Hanna", "Amazon"],
    ["Where:", "Hare: John DoeWhere: Some Bar, 123 Main St", "John Doe"],
    ["Hash Cash:", "Hare: AliceHash Cash: $5", "Alice"],
  ])("truncates at embedded %s label", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — boilerplate marker truncation", () => {
  // Fixes EPTX, O2H3 hare corruption.
  it.each([
    ["WHAT TIME", "Hare: Captain Hash WHAT TIME: 6:30 PM", "Captain Hash"],
    ["WHERE", "Hare: Trail Blazer WHERE: The Pub, 123 Main St", "Trail Blazer"],
    ["Location", "Hare: Mudflap Location: Central Park", "Mudflap"],
    ["Cost", "Hare: Captain Cost: $5", "Captain"],
    ["HASH CASH", "Hare: Alice HASH CASH: $7", "Alice"],
    ["Directions", "Hare: Trail Blazer Directions: Take I-95 North", "Trail Blazer"],
    ["Meet at", "Hare: Mudflap Meet at the park at 6pm", "Mudflap"],
  ])("truncates at '%s' marker", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — WHO (hares) DeMon format", () => {
  it("extracts from 'WHO (hares):' pattern", () => {
    const desc = "WHO (hares): A Girl Named Steve\nWHAT TIME: 7:00 PM\nSome song lyrics\nHare drop another for the prince";
    expect(extractHares(desc)).toBe("A Girl Named Steve");
  });

  it("extracts WHO (hares): when HTML stripping splits label from colon", () => {
    // GCal API returns HTML like "<b>WHO (hares)</b>: Name" which after
    // stripHtmlTags may produce "WHO (hares)\n: Name" (newline before colon).
    const desc = "WHO (hares)\n: A Girl Named Steve\nWHEN:Monday, March 21st, 2026\nWHAT: song lyrics with Hare drop another";
    expect(extractHares(desc)).toBe("A Girl Named Steve");
  });
});

describe("extractHares — co-hare commentary stripping", () => {
  it.each([
    ["*** separator", "Hare(s): Denny's Sucks *** could use a co-hare", "Denny's Sucks"],
    ["'could use a co-hare'", "Hare(s): Denny's Sucks could use a co-hare", "Denny's Sucks"],
    ["'need a cohare'", "Hare: Trail Blazer need a cohare for this one", "Trail Blazer"],
  ])("strips %s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — trailing phone strip (formatted variants)", () => {
  it.each([
    ["dashed", "Hare: Dr Sh!t Yeah! 719-360-3805", "Dr Sh!t Yeah!"],
    ["parenthesized", "Hare: Trail Name (555) 123-4567", "Trail Name"],
    ["dotted", "Hares: Name1 & Name2 555.123.4567", "Name1 & Name2"],
  ])("strips %s phone format", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });

  it("strips phone from full description context", () => {
    const description =
      "March Madness!\nRilea's Pub 5672 N Union Blvd\nHare: Dr Sh!t Yeah! 719-360-3805\nBring: whistle";
    expect(extractHares(description)).toBe("Dr Sh!t Yeah!");
  });
});

describe("extractHares — multi-line continuation under 'Hares:' label", () => {
  it.each([
    [
      "joins two names",
      "Hares:\nIvanna Hairy Buttchug\nIndiana Bones and the Temple of Poon",
      "Ivanna Hairy Buttchug, Indiana Bones and the Temple of Poon",
    ],
    ["joins three names", "Hares:\nAlice\nBob\nCarol", "Alice, Bob, Carol"],
    ["stops at blank line", "Hares:\nAlice\nBob\n\nSome other paragraph", "Alice, Bob"],
    ["stops at next field label", "Hares:\nAlice\nBob\nWhere: Some Pub", "Alice, Bob"],
    ["stops at URL continuation", "Hares:\nAlice\nhttps://example.com/trail-map", "Alice"],
    ["stops at boilerplate marker", "Hares:\nAlice\nHash Cash: $5", "Alice"],
  ])("%s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });

  it("inline hare on label line does NOT sweep in continuation prose", () => {
    // Continuation only triggers for label-only headers; an inline hare is
    // assumed complete (following prose is description, not co-hares).
    const desc = "Hares: Alice\nBob the Hare did a thing yesterday\nWhere: Park";
    expect(extractHares(desc)).toBe("Alice");
  });

  it.each([
    ["single-line hare regression", "Hare: Mudflap\nON-IN: Some Bar", "Mudflap"],
    ["single-line hare with immediate next-label", "Hares: Alice & Bob\nWhere: Park", "Alice & Bob"],
  ])("preserves %s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — adversarial prose protection under label-only header", () => {
  it("does not ingest sentence-like prose", () => {
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
  it.each([
    ["single hare", "WHO ARE THE HARES: Leeroy", "Leeroy"],
    ["multiple hares", "WHO ARE THE HARES: Leeroy & Jenkins", "Leeroy & Jenkins"],
    ["case-insensitive", "Who Are The Hares: Leeroy", "Leeroy"],
  ])("captures %s from WHO ARE THE HARES: label", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});
