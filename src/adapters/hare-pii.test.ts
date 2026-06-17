import { describe, it, expect } from "vitest";
import { scrubHarePii, containsHarePii } from "./hare-pii";

describe("scrubHarePii", () => {
  it.each([
    // Korean — the original Seoul H3 cases (PR #2227), now handled by the
    // generic +CC / Korean-domestic patterns. These must stay identical.
    ["international +82 form", "Longfellow +82 10-9397-6199", "Longfellow"],
    ["double-space +82 form", "EM Blank Space +82  10-7152-6362, EM Seoul Ultraman", "EM Blank Space, EM Seoul Ultraman"],
    ["ampersand-joined", "EM Blank Space +82 10-7152-6362 & EM Seoul Ultraman", "EM Blank Space & EM Seoul Ultraman"],
    ["domestic 010 form", "ASBO 010-2354-1741", "ASBO"],
    ["email", "Hymen hymen@example.com", "Hymen"],
    // North American (generalization)
    ["NA dashed", "Captain Hash 415-555-1212", "Captain Hash"],
    ["NA in parens, co-hare rescued", "Alice (415) 555-1212 & Bob", "Alice & Bob"],
    ["NA bare 10-digit", "Hares 4155551212", "Hares"],
    // Paren artifacts: the NA pattern's "\(?" eats the open paren, leaving a
    // dangling ")"; the email pattern leaves an empty "()". Both get tidied.
    ["orphan close paren (phone in parens)", "Just Jorge (973-760-5774)", "Just Jorge"],
    ["orphan close paren mid-string", "The Tickler (089-813-0090) and Others", "The Tickler and Others"],
    ["empty parens (email in parens)", "DJO (davehi@speakeasy.net)", "DJO"],
    // Other international (generalization)
    ["UK intl", "Slippery +44 7911 123456", "Slippery"],
    ["German intl", "Hare +49 30 12345678", "Hare"],
  ])("strips %s", (_label, input, expected) => {
    expect(scrubHarePii(input)).toBe(expected);
  });

  it.each([
    ["subway line + walk-time", "Jichuck station, line 3, exit 1 (10-15 min walk)"],
    ["year range", "GM Over There (1995-1996) Memorial Run"],
    ["run number + dollar amount", "Trail #500, raised $1500"],
    ["distance range", "3-5 milers welcome"],
    ["clock time", "6:30 start"],
  ])("preserves false-positive %s", (_label, input) => {
    expect(scrubHarePii(input)).toBe(input);
  });

  it("returns undefined when only PII remains", () => {
    expect(scrubHarePii("+82 10-9397-6199")).toBeUndefined();
    expect(scrubHarePii("415-555-1212")).toBeUndefined();
    expect(scrubHarePii("")).toBeUndefined();
    expect(scrubHarePii(null)).toBeUndefined();
    expect(scrubHarePii(undefined)).toBeUndefined();
  });
});

describe("containsHarePii", () => {
  it("detects each PII shape", () => {
    expect(containsHarePii("Longfellow +82 10-9397-6199")).toBe(true);
    expect(containsHarePii("ASBO 010-2354-1741")).toBe(true);
    expect(containsHarePii("Captain Hash 415-555-1212")).toBe(true);
    expect(containsHarePii("Hares 4155551212")).toBe(true);
    expect(containsHarePii("Slippery +44 7911 123456")).toBe(true);
    expect(containsHarePii("Hymen hymen@example.com")).toBe(true);
  });

  it("does not flag legit content", () => {
    expect(containsHarePii("GM Over There (1995-1996) Memorial Run")).toBe(false);
    expect(containsHarePii("Jichuck station, line 3, exit 1 (10-15 min walk)")).toBe(false);
    expect(containsHarePii("Trail #500, raised $1500")).toBe(false);
    expect(containsHarePii("3-5 milers welcome")).toBe(false);
    expect(containsHarePii("Mudflap & Trail Blazer")).toBe(false);
  });

  it("is deterministic across repeated calls on shared /g regexes (no lastIndex leak)", () => {
    // Guards against a future refactor to RegExp.test on the module-level /g
    // patterns, which would carry lastIndex between calls and flip results.
    const value = "Captain Hash 415-555-1212";
    expect(containsHarePii(value)).toBe(true);
    expect(containsHarePii(value)).toBe(true);
    // Mixing detect (.search) then scrub (.replace) must not desync either.
    expect(scrubHarePii(value)).toBe("Captain Hash");
    expect(containsHarePii(value)).toBe(true);
  });
});
