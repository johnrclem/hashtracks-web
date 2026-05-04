import { describe, it, expect } from "vitest";
import { extractHares } from "./hare-extraction";

type ExpectedRow = readonly [label: string, desc: string, expected: string];
type UndefinedRow = readonly [label: string, desc: string];

interface ExpectedGroup {
  describe: string;
  template: string;
  table: ReadonlyArray<ExpectedRow>;
}

interface UndefinedGroup {
  describe: string;
  template: string;
  table: ReadonlyArray<UndefinedRow>;
}

const EXPECTED_GROUPS: ExpectedGroup[] = [
  {
    describe: "extractHares — basic label patterns",
    template: "extracts from %s",
    table: [
      ["Hare: line", "Details\nHare: Mudflap\nON-IN: Some Bar", "Mudflap"],
      ["Hares: line", "Hares: Alice & Bob", "Alice & Bob"],
      ["'Hare & Co-Hares:' (Voodoo H3 format)", "Hare & Co-Hares: Steven with a D\nStart Address: 123 Main", "Steven with a D"],
      ["'Hare & Co-Hares:' multiple names", "Hare & Co-Hares: Whordini & Mudflap", "Whordini & Mudflap"],
      ["Who: line", "Who: Charlie", "Charlie"],
      ["takes only first line of hare text", "Hare: Alice\nSome other info", "Alice"],
      ["Hare(s): pattern (jHavelina format)", "Trail info\nHare(s): Splat!\nLocation: Park", "Splat!"],
      ["'Hare [Name]' without colon (MH3 format)", "Details\nHare C*ck Swap\nLocation: Park", "C*ck Swap"],
      ["preserves names starting with 'the' (e.g. 'The Pope')", "Hare: The Pope", "The Pope"],
    ],
  },
  {
    // #1082 EPH3 #2719: source description sometimes has no newlines between
    // WHO/WHAT/WHEN sections — section-label lookahead now stops before the next label.
    describe: "extractHares — #1082 EPH3 concatenated section labels",
    template: "%s",
    table: [
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
    ],
  },
  {
    describe: "extractHares — embedded label truncation (HTML field collapse)",
    template: "truncates at embedded %s label",
    table: [
      ["What:", "Who: AmazonWhat: A beautiful trail that doesn't start at the Mad Hanna", "Amazon"],
      ["Where:", "Hare: John DoeWhere: Some Bar, 123 Main St", "John Doe"],
      ["Hash Cash:", "Hare: AliceHash Cash: $5", "Alice"],
    ],
  },
  {
    // Fixes EPTX, O2H3 hare corruption.
    describe: "extractHares — boilerplate marker truncation",
    template: "truncates at '%s' marker",
    table: [
      ["WHAT TIME", "Hare: Captain Hash WHAT TIME: 6:30 PM", "Captain Hash"],
      ["WHERE", "Hare: Trail Blazer WHERE: The Pub, 123 Main St", "Trail Blazer"],
      ["Location", "Hare: Mudflap Location: Central Park", "Mudflap"],
      ["Cost", "Hare: Captain Cost: $5", "Captain"],
      ["HASH CASH", "Hare: Alice HASH CASH: $7", "Alice"],
      ["Directions", "Hare: Trail Blazer Directions: Take I-95 North", "Trail Blazer"],
      ["Meet at", "Hare: Mudflap Meet at the park at 6pm", "Mudflap"],
    ],
  },
  {
    describe: "extractHares — WHO (hares) DeMon format",
    template: "%s",
    table: [
      [
        "extracts from 'WHO (hares):' pattern",
        "WHO (hares): A Girl Named Steve\nWHAT TIME: 7:00 PM\nSome song lyrics\nHare drop another for the prince",
        "A Girl Named Steve",
      ],
      [
        // GCal API returns HTML like "<b>WHO (hares)</b>: Name" which after
        // stripHtmlTags may produce "WHO (hares)\n: Name" (newline before colon).
        "extracts WHO (hares): when HTML stripping splits label from colon",
        "WHO (hares)\n: A Girl Named Steve\nWHEN:Monday, March 21st, 2026\nWHAT: song lyrics with Hare drop another",
        "A Girl Named Steve",
      ],
    ],
  },
  {
    describe: "extractHares — co-hare commentary stripping",
    template: "strips %s",
    table: [
      ["*** separator", "Hare(s): Denny's Sucks *** could use a co-hare", "Denny's Sucks"],
      ["'could use a co-hare'", "Hare(s): Denny's Sucks could use a co-hare", "Denny's Sucks"],
      ["'need a cohare'", "Hare: Trail Blazer need a cohare for this one", "Trail Blazer"],
    ],
  },
  {
    describe: "extractHares — trailing phone strip (formatted variants)",
    template: "strips %s phone format",
    table: [
      ["dashed", "Hare: Dr Sh!t Yeah! 719-360-3805", "Dr Sh!t Yeah!"],
      ["parenthesized", "Hare: Trail Name (555) 123-4567", "Trail Name"],
      ["dotted", "Hares: Name1 & Name2 555.123.4567", "Name1 & Name2"],
    ],
  },
  {
    describe: "extractHares — multi-line continuation tables",
    template: "%s",
    table: [
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
      ["single-line hare regression (preserved)", "Hare: Mudflap\nON-IN: Some Bar", "Mudflap"],
      ["single-line hare with immediate next-label (preserved)", "Hares: Alice & Bob\nWhere: Park", "Alice & Bob"],
    ],
  },
  {
    // #742 BAH3, #809: bare 10-digit phone numbers should not pollute hare names.
    describe: "extractHares — bare 10-digit phone strip (#742 BAH3, #809)",
    template: "%s",
    table: [
      ["bare 10-digit suffix", "Hares: Slick Willy 2406185563", "Slick Willy"],
      ["formatted phone suffix", "Hares: Slick Willy 240-618-5563", "Slick Willy"],
      ["mid-string phone + commentary", "Hares: Any Cock'll Do Me, 2406185563 CALL for same day service", "Any Cock'll Do Me"],
      ["mid-string formatted phone", "Hares: Slick Willy 240-618-5563 text for address", "Slick Willy"],
      ["phone with 'Phone:' label", "Hares: Slick Willy, phone: 2406185563 for details", "Slick Willy"],
    ],
  },
  {
    describe: "extractHares — WHO ARE THE HARES template (#774 BJH3)",
    template: "captures %s from WHO ARE THE HARES: label",
    table: [
      ["single hare", "WHO ARE THE HARES: Leeroy", "Leeroy"],
      ["multiple hares", "WHO ARE THE HARES: Leeroy & Jenkins", "Leeroy & Jenkins"],
      ["case-insensitive", "Who Are The Hares: Leeroy", "Leeroy"],
    ],
  },
];

const UNDEFINED_GROUPS: UndefinedGroup[] = [
  {
    describe: "extractHares — negative / filtered cases",
    template: "returns undefined for %s",
    table: [
      ["generic 'that be you'", "Who: that be you"],
      ["'everyone'", "Who: everyone"],
      ["no hare info present", "No hare info here"],
      ["preposition 'at' prefix", "Hare: at the corner of 5th and Main"],
      ["preposition 'from' prefix", "Hare: from the old pub to the new one"],
      ["false-match 'hare off at'", "Pack off at 7:30, hare off at 7:15"],
      ["song lyric after 'Hare drop'", "Some intro\nHare drop another for the prince of this\nMore lyrics"],
    ],
  },
  {
    describe: "extractHares — adversarial prose protection under label-only header",
    template: "%s does not pollute hares",
    table: [
      ["sentence-like prose", "Hares:\nBring a flashlight.\nMeet at the park."],
      ["lines containing colons (unrecognized field labels)", "Hares:\nNote: see FB for details\nDistance: 5k"],
    ],
  },
];

for (const group of EXPECTED_GROUPS) {
  describe(group.describe, () => {
    it.each(group.table.map((row) => [...row]))(group.template, (_label, desc, expected) => {
      expect(extractHares(desc as string)).toBe(expected);
    });
  });
}

for (const group of UNDEFINED_GROUPS) {
  describe(group.describe, () => {
    it.each(group.table.map((row) => [...row]))(group.template, (_label, desc) => {
      expect(extractHares(desc as string)).toBeUndefined();
    });
  });
}

describe("extractHares — custom patterns", () => {
  const LAID_BY = String.raw`(?:^|\n)\s*Laid by:\s*(.+)`;
  const WHO_ARE_THE_HARES = String.raw`(?:^|\n)\s*WHO ARE THE HARES:\s*(.+)`;

  it.each([
    ["uses provided custom patterns", "WHO ARE THE HARES:  Used Rubber & Leeroy", [WHO_ARE_THE_HARES], "Used Rubber & Leeroy"],
    ["uses custom 'Laid by' pattern", "Laid by: Speedy Gonzalez", [LAID_BY], "Speedy Gonzalez"],
    ["falls back to defaults when customPatterns is undefined", "Hare: DefaultMatch", undefined, "DefaultMatch"],
    ["falls back to defaults when customPatterns is empty array", "Hare: DefaultMatch", [], "DefaultMatch"],
    ["skips malformed custom patterns gracefully", "Laid by: Speedy", ["[invalid(", LAID_BY], "Speedy"],
  ] as const)("%s", (_label, desc, patterns, expected) => {
    expect(extractHares(desc, patterns as string[] | undefined)).toBe(expected);
  });

  it.each([
    ["custom patterns replace defaults — Hare: no longer matches", "Hare: Mudflap", [LAID_BY]],
    ["still filters generic answers with custom patterns", "Laid by: everyone", [LAID_BY]],
  ] as const)("%s", (_label, desc, patterns) => {
    expect(extractHares(desc, [...patterns])).toBeUndefined();
  });
});

describe("extractHares — anchored single-case scenarios", () => {
  it("inline hare on label line does NOT sweep in continuation prose", () => {
    // Continuation only triggers for label-only headers; an inline hare is
    // assumed complete (following prose is description, not co-hares).
    const desc = "Hares: Alice\nBob the Hare did a thing yesterday\nWhere: Park";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("strips phone from full description context", () => {
    const description =
      "March Madness!\nRilea's Pub 5672 N Union Blvd\nHare: Dr Sh!t Yeah! 719-360-3805\nBring: whistle";
    expect(extractHares(description)).toBe("Dr Sh!t Yeah!");
  });

  it("stops at overly long continuation line (prose, not a name)", () => {
    const longLine = "This is a long paragraph describing the trail that goes on for many words in a row";
    const desc = `Hares:\nAlice\n${longLine}`;
    expect(extractHares(desc)).toBe("Alice");
  });
});

describe("extractHares — Co-Hare merge + annotation strip (#1212 GLH3)", () => {
  it("merges a separate Co-Hare line into the primary hare", () => {
    const desc = "Hare: Just Ayaka\nCo-Hare: Backseat Muffher\nDirections: ...";
    expect(extractHares(desc)).toBe("Just Ayaka, Backseat Muffher");
  });

  it("merges Co-Hares (plural) variant", () => {
    const desc = "Hare: Alice\nCo-Hares: Bob & Carol";
    expect(extractHares(desc)).toBe("Alice, Bob & Carol");
  });

  it("merges 'Cohare' (no dash) variant", () => {
    const desc = "Hare: Alice\nCohare: Bob";
    expect(extractHares(desc)).toBe("Alice, Bob");
  });

  it("strips trailing ' - lowercase commentary' annotation", () => {
    const desc = "Hare: Just Ayaka - it's her first time haring!";
    expect(extractHares(desc)).toBe("Just Ayaka");
  });

  it("preserves capital-leading second name (e.g. 'Alice - Bob')", () => {
    // Annotation strip is anchored to a lowercase first char after the dash;
    // a real co-hare written inline after a dash starts with a capital letter
    // and survives the strip.
    const desc = "Hare: Alice - Bob";
    expect(extractHares(desc)).toBe("Alice - Bob");
  });

  it("regression: lone Hare line still returns just the primary", () => {
    expect(extractHares("Hare: Alice")).toBe("Alice");
  });

  it("regression: no spurious join when description has unrelated text", () => {
    const desc = "Hare: Alice\nLocation: 123 Main St";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("avoids duplicate when Co-Hare name already appears in primary", () => {
    const desc = "Hare: Alice and Bob\nCo-Hare: Bob";
    expect(extractHares(desc)).toBe("Alice and Bob");
  });
});
