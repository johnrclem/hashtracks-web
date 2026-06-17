import { describe, it, expect } from "vitest";
import seoulHistory from "./data/sh3-kr-history.json";
import { scrubHarePii, containsHarePii } from "@/adapters/html-scraper/sh3-pii";

/**
 * Regression guard for the frozen Seoul H3 archive. Codex flagged (PR #2227)
 * that the merge pipeline's sanitizeHares does NOT strip mid-string phone
 * numbers, so committing the archive with hare phone numbers would leak PII into
 * canonical events. This test fails CI if any phone number or email survives in
 * the committed dataset — using the same patterns the freeze-time scrubber removes.
 */
const PII_FIELDS = ["title", "location", "hares"] as const;

describe("sh3-kr-history.json (committed archive)", () => {
  it("contains no phone numbers or emails in any user-visible field", () => {
    const leaks: string[] = [];
    for (const row of seoulHistory as Array<Record<string, unknown>>) {
      for (const field of PII_FIELDS) {
        const value = row[field];
        if (typeof value !== "string") continue;
        if (containsHarePii(value)) {
          leaks.push(`${String(row.date)} ${field}: ${value}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("has a valid shape: ISO date + sh3-kr kennel tag on every row", () => {
    for (const row of seoulHistory as Array<Record<string, unknown>>) {
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.kennelTags).toEqual(["sh3-kr"]);
    }
  });
});

describe("scrubHarePii", () => {
  it.each([
    ["international +82 form", "Longfellow +82 10-9397-6199", "Longfellow"],
    ["double-space +82 form", "EM Blank Space +82  10-7152-6362, EM Seoul Ultraman", "EM Blank Space, EM Seoul Ultraman"],
    ["ampersand-joined", "EM Blank Space +82 10-7152-6362 & EM Seoul Ultraman", "EM Blank Space & EM Seoul Ultraman"],
    ["domestic 010 form", "ASBO 010-2354-1741", "ASBO"],
    ["email", "Hymen hymen@example.com", "Hymen"],
  ])("strips %s", (_label, input, expected) => {
    expect(scrubHarePii(input)).toBe(expected);
  });

  it.each([
    ["subway line + walk-time", "Jichuck station, line 3, exit 1 (10-15 min walk)"],
    ["year range", "GM Over There (1995-1996) Memorial Run"],
  ])("preserves false-positive %s", (_label, input) => {
    expect(scrubHarePii(input)).toBe(input);
  });

  it("returns undefined when only PII remains", () => {
    expect(scrubHarePii("+82 10-9397-6199")).toBeUndefined();
    expect(scrubHarePii("")).toBeUndefined();
  });
});
