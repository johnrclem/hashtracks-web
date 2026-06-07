import {
  compileSilentSkipRules,
  matchSilentSkip,
  titleHasHashSignal,
  hasHashSignal,
  isPlatformDepartureTitle,
} from "./skip-rules";
import type { RawEventData } from "./types";
import { SOURCES } from "../../prisma/seed-data/sources";

/** Minimal RawEventData builder for matcher tests. */
function ev(partial: Partial<RawEventData>): RawEventData {
  return { date: "2026-06-01", kennelTags: ["test-h3"], ...partial };
}

describe("compileSilentSkipRules", () => {
  it("compiles a valid rule and defaults field to title", () => {
    const [rule] = compileSilentSkipRules([{ pattern: "^LYNNE OFF$" }]);
    expect(rule.field).toBe("title");
    expect(rule.unlessHashSignal).toBe(false);
    expect(rule.source).toBe("^LYNNE OFF$");
    expect(rule.re.test("lynne off")).toBe(true); // case-insensitive
  });

  it.each([
    ["null", null, 0],
    ["non-array", { pattern: "x" }, 0],
    ["empty array", [], 0],
  ])("returns [] for %s config", (_label, raw, expected) => {
    expect(compileSilentSkipRules(raw)).toHaveLength(expected);
  });

  it.each([
    ["missing pattern", { field: "title" }],
    ["empty pattern", { pattern: "" }],
    ["non-string pattern", { pattern: 42 }],
    ["invalid field", { pattern: "x", field: "venue" }],
    ["invalid regex", { pattern: "(" }],
    ["ReDoS-unsafe", { pattern: "(a+)+$" }],
  ])("drops malformed rule: %s", (_label, badRule) => {
    expect(compileSilentSkipRules([badRule])).toHaveLength(0);
  });

  it("keeps valid rules and drops malformed ones in the same array", () => {
    const rules = compileSilentSkipRules([
      { pattern: "good" },
      { pattern: "(" },
      { pattern: "also good", field: "location" },
    ]);
    expect(rules.map((r) => r.source)).toEqual(["good", "also good"]);
  });
});

describe("matchSilentSkip — field targeting", () => {
  it.each([
    ["title", { title: "LYNNE OFF" }],
    ["description", { description: "moving to a new website" }],
    ["location", { location: "Kings B'day, no run , Yours" }],
    ["hares", { hares: "TBD admin note" }],
  ] as const)("matches on the %s field", (field, partial) => {
    const patternByField = {
      title: "^LYNNE OFF$",
      description: "new website",
      location: String.raw`\bno\s+run\b`,
      hares: "admin note",
    } as const;
    const pattern = patternByField[field];
    const rules = compileSilentSkipRules([{ pattern, field }]);
    const hit = matchSilentSkip(ev(partial), rules);
    expect(hit).toEqual({ field, pattern });
  });

  it("returns null when nothing matches", () => {
    const rules = compileSilentSkipRules([{ pattern: "^LYNNE OFF$" }]);
    expect(matchSilentSkip(ev({ title: "Red Dress Run #42" }), rules)).toBeNull();
  });

  it("only tests the configured field, not others", () => {
    // pattern targets location; a title hit must NOT drop the event
    const rules = compileSilentSkipRules([{ pattern: "secret", field: "location" }]);
    expect(matchSilentSkip(ev({ title: "secret trail", location: "Main St" }), rules)).toBeNull();
  });
});

describe("matchSilentSkip — unlessHashSignal gate", () => {
  const rules = compileSilentSkipRules([
    { pattern: "sleep study", field: "title", unlessHashSignal: true },
  ]);

  it("drops a matching event with no hash signal", () => {
    expect(matchSilentSkip(ev({ title: "Sleep Study" }), rules)).not.toBeNull();
  });

  it.each([
    ["runNumber", { title: "Sleep Study", runNumber: 42 }],
    ["hares", { title: "Sleep Study", hares: "Just Tom" }],
    ["hash keyword in title", { title: "Sleep Study Hash" }],
    ["#NN in title", { title: "Sleep Study Trail #7" }],
  ])("is suppressed by a hash signal: %s", (_label, partial) => {
    expect(matchSilentSkip(ev(partial), rules)).toBeNull();
  });

  it("unconditional rule (no gate) drops regardless of signal", () => {
    const hard = compileSilentSkipRules([{ pattern: "sleep study", field: "title" }]);
    expect(matchSilentSkip(ev({ title: "Sleep Study", runNumber: 42 }), hard)).not.toBeNull();
  });
});

describe("hash-signal helpers", () => {
  it.each([
    ["plain title", "Red Dress Run", false],
    ["hash keyword", "Full Moon Hash", true],
    ["run number", "Trail #138", true],
    ["empty", "", false],
  ])("titleHasHashSignal(%s)", (_label, title, expected) => {
    expect(titleHasHashSignal(title)).toBe(expected);
  });

  it("hasHashSignal reads runNumber/hares/title", () => {
    expect(hasHashSignal({ title: "x", runNumber: 1 })).toBe(true);
    expect(hasHashSignal({ title: "x", hares: "Tom" })).toBe(true);
    expect(hasHashSignal({ title: "Hash" })).toBe(true);
    expect(hasHashSignal({ title: "x", runNumber: null, hares: null })).toBe(false);
  });
});

describe("isPlatformDepartureTitle (retrofit built-in)", () => {
  it.each([
    "Moving to a new website site - Last day in Meetup is March 10th",
    "MIAMI HASH HOUSE HARRIERS ARE LEAVING MEETUP",
    "Please use our new website",
  ])("drops platform-departure post: %s", (title) => {
    expect(isPlatformDepartureTitle(title)).toBe(true);
  });

  it.each([
    "Farewell party for Just Departed",
    "Goodbye and good riddance",
  ])("drops un-signalled farewell post: %s", (title) => {
    expect(isPlatformDepartureTitle(title)).toBe(true);
  });

  it.each([
    "Farewell Run Trail #42", // run-numbered farewell = real trail
    "Goodbye Trail #138",
    "Leaving Las Vegas Trail #42", // bare "leaving" ≠ "leaving meetup"
    "Red Dress Run #500",
  ])("keeps legitimate hash event: %s", (title) => {
    expect(isPlatformDepartureTitle(title)).toBe(false);
  });
});

// #2023 — Capital H3's shared Google Calendar carries personal/admin entries.
// Verify the seed config drops the non-hash entries but keeps real trails.
describe("Capital Hash Calendar silentlySkipPatterns (#2023)", () => {
  const capitalSource = SOURCES.find((s) => s.name === "Capital Hash Calendar");
  if (!capitalSource) throw new Error("Capital Hash Calendar seed source missing");
  const rules = compileSilentSkipRules(
    (capitalSource.config as { silentlySkipPatterns?: unknown }).silentlySkipPatterns,
  );

  it("compiles both rules", () => {
    expect(rules).toHaveLength(2);
  });

  it.each([
    "Me Bank Interest 5.35%",
    "Daylight savings starts. Clocks go forward.",
  ])("drops non-hash entry: %s", (title) => {
    expect(matchSilentSkip(ev({ title }), rules)).not.toBeNull();
  });

  it.each([
    "Capital H3 Trail #2404",
    "Kwine & Mitzi 68 Macleay Street Turner.",
  ])("keeps real trail: %s", (title) => {
    expect(matchSilentSkip(ev({ title }), rules)).toBeNull();
  });
});
