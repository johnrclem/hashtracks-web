import { describe, it, expect } from "vitest";
import { extractHares } from "./hare-extraction";

type ExpectedRow = readonly [label: string, desc: string, expected: string];
type UndefinedRow = readonly [label: string, desc: string];
// A NullRow asserts the tri-state CLEAR signal: a candidate was captured but
// recognized as a non-hare, so extractHares returns `null` (clear stale
// canonical haresText) — distinct from `undefined` (no candidate at all).
type NullRow = readonly [label: string, desc: string];

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

interface NullGroup {
  describe: string;
  template: string;
  table: ReadonlyArray<NullRow>;
}

const EXPECTED_GROUPS: ExpectedGroup[] = [
  {
    describe: "extractHares — basic label patterns",
    template: "extracts from %s",
    table: [
      ["Hare: line", "Details\nHare: Mudflap\nON-IN: Some Bar", "Mudflap"],
      ["Hares: line", "Hares: Alice & Bob", "Alice & Bob"],
      // #1884 MH3-Mpls — space before the colon ("Hare : Butt Knuckles").
      ["'Hare :' space-before-colon", "Hare : Butt Knuckles\nTheme: 1984", "Butt Knuckles"],
      ["'Hares :' space-before-colon", "Hares : Alice & Bob", "Alice & Bob"],
      ["'Hare & Co-Hares:' (Voodoo H3 format)", "Hare & Co-Hares: Steven with a D\nStart Address: 123 Main", "Steven with a D"],
      ["'Hare & Co-Hares:' multiple names", "Hare & Co-Hares: Whordini & Mudflap", "Whordini & Mudflap"],
      ["Who: line", "Who: Charlie", "Charlie"],
      ["takes only first line of hare text", "Hare: Alice\nSome other info", "Alice"],
      ["Hare(s): pattern (jHavelina format)", "Trail info\nHare(s): Splat!\nLocation: Park", "Splat!"],
      ["'Hare [Name]' without colon (MH3 format)", "Details\nHare C*ck Swap\nLocation: Park", "C*ck Swap"],
      ["preserves names starting with 'the' (e.g. 'The Pope')", "Hare: The Pope", "The Pope"],
      // #1584 — natural-language "Hares are X and Y" form (Austin H3 #2278).
      ["'Hares are X and Y' form", "Hares are Smegma Balls and Dry Hose. Pool party at the park.", "Smegma Balls and Dry Hose"],
      ["'Hares are X and Y' to end of line", "Some intro.\nHares are Alice and Bob\nLocation: Park", "Alice and Bob"],
      ["lowercase 'hares are X and Y'", "hares are Cool Beans and Banana Boat.", "Cool Beans and Banana Boat"],
      // #1615 mid-sentence follow-up — Austin H3 publishes "...Birthday Hash! Hares are X..."
      // after a sentence terminator (exclam/period/question + space). The line-start
      // anchor in #1584 missed these. Lookbehind `(?<=[.!?]\s)` covers it. Capture
      // still bounded by the next `[.!?]\s` / newline / end-of-string.
      ["mid-sentence after exclamation", "Cookout - Birthday Hash! Hares are Smegma Balls and Dry Hose. Pool party after.", "Smegma Balls and Dry Hose"],
      ["mid-sentence after period", "Welcome to the trail. Hares are Alice and Bob. Meet at 6pm.", "Alice and Bob"],
      ["mid-sentence after question mark", "Ready for fun? Hares are Crusty Crab and Pearl. Bring water.", "Crusty Crab and Pearl"],
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
  {
    // #1981 Brasilia / 6th cross-kennel instance — role-header template family.
    // Real shapes drawn from brasiliah3.blogspot.com (Blogger bodies) plus the
    // "The Hares:" / "Perpetrator(s):" historical variants.
    describe: "extractHares — role-header template family (#1981)",
    template: "%s",
    table: [
      ["'The Hares:' inline", "The Hares: Sperm Bank", "Sperm Bank"],
      ["'The Hare:' inline", "The Hare: Just One Guy", "Just One Guy"],
      ["emoji-prefixed 'The Hares:'", "🐾 The Hares: Sperm Bank", "Sperm Bank"],
      ["'The Hares:' header + next line", "The Hares:\nAlice & Bob", "Alice & Bob"],
      ["'Perpetrator(s):' inline", "Perpetrator(s): Foo & Bar", "Foo & Bar"],
      ["'Perpetrators:' plural inline", "Perpetrators: Baz", "Baz"],
      ["'This week's perpetrator:' inline", "This week's perpetrator: Sperm Bank", "Sperm Bank"],
      ["curly-apostrophe 'This week's perpetrator:'", "This week’s perpetrator: Spunk Bubble", "Spunk Bubble"],
      [
        // The exact current-post shape (after the adapter collapses blank lines):
        // a "🐾 The Hare" banner, then the perpetrator header, then the name.
        "Brasilia banner + 'This week's perpetrator:' header + name",
        "🐾 The Hare\nThis week's perpetrator:\nSperm Bank",
        "Sperm Bank",
      ],
    ],
  },
  {
    describe: "extractHares — defensive hardening (#1999/#2008)",
    template: "%s",
    table: [
      // #1999 BAH3 — a real multi-name hare line still extracts cleanly (the
      // "Hares:" label prefix is consumed, never surfaced).
      ["BAH3 multi-name line keeps names, drops label", "Hares: Princess Jizzmine, Blinded by the Spooge, PITA\nStart: Park in Branch Ave Metro", "Princess Jizzmine, Blinded by the Spooge, PITA"],
      // #2008 PGH H3 — a non-kennel-code "Who:" value is a real hare and passes.
      ["non-kennel-code 'Who: ICP' passes", "Who: ICP", "ICP"],
      // #2008 PGH H3 row 4 — strip a trailing "and you, of course" conversational
      // tail rather than surfacing the whole sentence as hares.
      ["strips 'and you, of course' tail", "Hares: Just Johnny, Honeynut Squirreleo and you, of course.", "Just Johnny, Honeynut Squirreleo"],
    ],
  },
];

// CLEAR cases: a candidate WAS captured from a label/pattern but recognized as
// a non-hare. extractHares returns `null` so the merge tri-state scrubs a stale
// canonical haresText (self-heal — replaces the manual post-#2032 SQL cleanup).
const NULL_GROUPS: NullGroup[] = [
  {
    describe: "extractHares — captured-but-rejected non-hare cases (explicit clear, #2032)",
    template: "returns null for %s",
    table: [
      // Generic "who is the hare" answers (GENERIC_WHO_ANSWER_RE).
      ["generic 'that be you'", "Who: that be you"],
      ["'everyone'", "Who: everyone"],
      // Prepositional / verb prose leak after a real label (PROSE_PREFIX_RE).
      ["preposition 'at' prefix", "Hare: at the corner of 5th and Main"],
      ["preposition 'from' prefix", "Hare: from the old pub to the new one"],
      ["song lyric after 'Hare drop'", "Some intro\nHare drop another for the prince of this\nMore lyrics"],
      // #1584 — natural-language "Hares are X" placeholder forms. First-word
      // denylist (HARES_ARE_PROSE_FIRST_WORD_RE) — these are "hare needed"
      // placeholders, which types.ts says SHOULD clear stale hare text.
      ["'Hares are Needed for volunteers'", "Hares are Needed for July volunteers."],
      ["'Hares are Welcome'", "Hares are Welcome at the pool party."],
      ["'Hares are Wanted'", "Hares are Wanted — apply within."],
      ["'Hares are Going to set early'", "Hares are Going to set early."],
      ["'Hares are Looking for help'", "Hares are Looking for help."],
      // Plural forms — Gemini PR #1612 review: `Volunteers?` / `Needs?`.
      ["'Hares are Volunteers for July'", "Hares are Volunteers for July."],
      ["'Hares are Needs more volunteers'", "Hares are Needs more volunteers."],
      // Case-insensitive (Codex P2 review): all-caps placeholder forms.
      ["all-caps 'Hares are NEEDED for July'", "Hares are NEEDED for July."],
      ["all-caps 'Hares are WELCOME at the party'", "Hares are WELCOME at the party."],
      // #1615 mid-sentence follow-up.
      ["mid-sentence 'Hares are Needed'", "Sign up now! Hares are Needed for July."],
      ["mid-sentence 'Hares are Welcome'", "Bring friends. Hares are Welcome to the pool party."],
      // #2008 PGH H3 / #2032 — a bare kennel code (ends in H<digit>) is the
      // kennel name, never a hash name (BARE_KENNEL_CODE_RE). These are the
      // exact prod values scrubbed by hand after #2032; emitting null makes the
      // next scrape self-heal them.
      ["bare kennel code 'Who: PGHH3'", "Who: PGHH3"],
      ["bare kennel code 'Hares: NYCH3'", "Hares: NYCH3"],
      ["#2032 cfh3 'Hares: DTWH3'", "Hares: DTWH3"],
      ["#2032 bjh3 'Who: EPH3'", "Who: EPH3"],
      ["#2032 nah3 'Hares: DMCH3'", "Hares: DMCH3"],
      ["#2032 nych3 'Who: NYH3'", "Who: NYH3"],
      ["#2032 dh3 'Hares: DH3'", "Hares: DH3"],
    ],
  },
];

const UNDEFINED_GROUPS: UndefinedGroup[] = [
  {
    describe: "extractHares — no-candidate cases (preserve existing)",
    template: "returns undefined for %s",
    table: [
      ["no hare info present", "No hare info here"],
      // No label at line start, so no candidate is ever captured.
      ["false-match 'hare off at'", "Pack off at 7:30, hare off at 7:15"],
      // Verb-form lowercase — the `[A-Z*]` regex anchor bars the capture, so
      // nothing is captured at all (no signal → preserve, NOT clear).
      ["'Hares are getting ready'", "Hares are getting ready for the trail."],
      ["'Hares are running tomorrow'", "Hares are running tomorrow."],
      ["mid-sentence lowercase 'the hares are bringing'", "Tonight the hares are bringing dogs and friends."],
      // #1981 role-header family — prose that mentions "hare"/"perpetrator" but
      // is NOT a labeled hare line (no colon). No capture → preserve.
      ["prose 'the hare set a cracking trail'", "Last week the hare set a cracking trail through the park."],
      ["prose 'thanks to the hare'", "Big thanks to the hare from last week."],
      ["prose 'we chased the hares'", "We chased the hares through the park for hours."],
      ["prose 'Perpetrators of' (no colon)", "Perpetrators of the great beer theft remain at large."],
      ["banner 'The Hare' with no name (no colon)", "🐾 The Hare"],
    ],
  },
  {
    describe: "extractHares — adversarial prose protection under label-only header",
    template: "%s does not pollute hares",
    table: [
      // Label-only header whose continuation is all prose/field-labels → the
      // captured value is empty after cleaning → undefined (no candidate), not
      // a clear: a blank "Hares:" header shouldn't wipe a hare another source set.
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

for (const group of NULL_GROUPS) {
  describe(group.describe, () => {
    it.each(group.table.map((row) => [...row]))(group.template, (_label, desc) => {
      expect(extractHares(desc as string)).toBeNull();
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
    // #1999 — a custom pattern that captures the label along with the value
    // (e.g. a broad line grab) must not surface the "Hares:" prefix; the
    // defensive leading-label strip removes it.
    ["defensive label strip on label-inclusive capture", "Hares: Mudflap & Whordini", [String.raw`(?:^|\n)\s*(Hares:.+)`], "Mudflap & Whordini"],
  ] as const)("%s", (_label, desc, patterns, expected) => {
    expect(extractHares(desc, patterns as string[] | undefined)).toBe(expected);
  });

  it.each([
    // No custom pattern matches → no candidate captured → undefined (preserve).
    ["custom patterns replace defaults — Hare: no longer matches", "Hare: Mudflap", [LAID_BY]],
  ] as const)("%s", (_label, desc, patterns) => {
    expect(extractHares(desc, [...patterns])).toBeUndefined();
  });

  it.each([
    // Custom pattern DOES match but the value is a generic non-hare answer →
    // null (clear), same tri-state as the default patterns.
    ["still filters generic answers with custom patterns", "Laid by: everyone", [LAID_BY]],
  ] as const)("%s", (_label, desc, patterns) => {
    expect(extractHares(desc, [...patterns])).toBeNull();
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

describe("extractHares — description-sentence trailer strip (#1551 Wasatch)", () => {
  it.each([
    {
      name: "single name + sentence description",
      desc: "hare: Nipples. A Wasarch/Bash crossover event. Bring your bike and ride the trails around Bingham Creek Regional park.",
      expected: "Nipples",
    },
    {
      name: "Dr. <name> survives — only 1 word after period",
      desc: "Hare: Dr. Strange",
      expected: "Dr. Strange",
    },
    {
      name: "St. <name> survives — only 1 word after period",
      desc: "Hare: St. John",
      expected: "St. John",
    },
    {
      name: "two short words after period strip threshold not met",
      desc: "Hare: Alice. Bob",
      expected: "Alice. Bob",
    },
    {
      name: "Title-Case-only tail preserved — 'Dr. Strange. Captain Hook' (Codex review)",
      desc: "Hare: Dr. Strange. Captain Hook",
      expected: "Dr. Strange. Captain Hook",
    },
    {
      name: "Title-Case-only tail preserved — 'Mr. Happy. Big Fun Bob' (Codex review)",
      desc: "Hare: Mr. Happy. Big Fun Bob",
      expected: "Mr. Happy. Big Fun Bob",
    },
    {
      name: "honorific period skipped — 'Dr. Strange. A crossover event…' truncates to 'Dr. Strange' (Claude bot review)",
      desc: "Hare: Dr. Strange. A crossover event with disc golf and snacks",
      expected: "Dr. Strange",
    },
    {
      name: "honorific period skipped — 'St. Mary. The trail starts at noon' truncates to 'St. Mary'",
      desc: "Hare: St. Mary. The trail starts at the park at noon",
      expected: "St. Mary",
    },
    {
      name: "Mrs. honorific skipped",
      desc: "Hare: Mrs. Robinson. A trail with surprises and beverages",
      expected: "Mrs. Robinson",
    },
  ])("$name", ({ desc, expected }) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractHares — date-range rejection (#1547 ABQ)", () => {
  // A captured value that is a campout date range is a recognized non-hare, so
  // it returns null (clear) — the label matched, the value is junk.
  it.each([
    {
      name: "weekday + slash-date range rejected",
      desc: "hare: Friday 5/22-Monday 5/25",
    },
    {
      name: "bare slash-date range rejected",
      desc: "Hares: 5/22-5/25",
    },
    {
      name: "date range embedded after a name still rejects (whole captured value is a date range)",
      desc: "Who: 12/31 - 1/2",
    },
  ])("$name", ({ desc }) => {
    expect(extractHares(desc)).toBeNull();
  });
});

describe("extractHares — Co-Hare merge + annotation strip (#1212 GLH3)", () => {
  // Each row is independent — no shared object state between them. Note that
  // the annotation-strip cases stand alone (no Co-Hare line) and the
  // capital-leading test verifies the strip is gated on lowercase-only.
  it.each([
    { name: "single Co-Hare line", desc: "Hare: Just Ayaka\nCo-Hare: Backseat Muffher\nDirections: ...", expected: "Just Ayaka, Backseat Muffher" },
    { name: "Co-Hares plural", desc: "Hare: Alice\nCo-Hares: Bob & Carol", expected: "Alice, Bob & Carol" },
    { name: "Cohare no-dash", desc: "Hare: Alice\nCohare: Bob", expected: "Alice, Bob" },
    { name: "multiple Co-Hare lines", desc: "Hare: Alice\nCo-Hare: Bob\nCo-Hare: Carol\nLocation: ...", expected: "Alice, Bob, Carol" },
    { name: "token compare on comma-joined primary", desc: "Hare: Alice and Bob\nCo-Hare: Bob\nCo-Hare: Carol", expected: "Alice and Bob, Carol" },
    { name: "duplicate Co-Hare already in primary", desc: "Hare: Alice and Bob\nCo-Hare: Bob", expected: "Alice and Bob" },
    { name: "trailing lowercase commentary stripped", desc: "Hare: Just Ayaka - it's her first time haring!", expected: "Just Ayaka" },
    { name: "capital-leading second name preserved", desc: "Hare: Alice - Bob", expected: "Alice - Bob" },
    { name: "lone Hare line — primary only", desc: "Hare: Alice", expected: "Alice" },
    { name: "unrelated description text — primary only", desc: "Hare: Alice\nLocation: 123 Main St", expected: "Alice" },
  ])("$name", ({ desc, expected }) => {
    expect(extractHares(desc)).toBe(expected);
  });
});
