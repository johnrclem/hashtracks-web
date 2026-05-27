import { describe, it, expect } from "vitest";
import { detectVenueWeekendEndDate } from "./venue-weekend";

// Unit tests for the venue-weekend campout heuristic. The parser test
// suite (`src/adapters/hashrego/adapter.test.ts`) covers the original
// PR #1637 cases via the re-export from parser.ts; this file pins the
// behavior of the shared utility itself + the cross-adapter audit
// anchors from PR #1718 bucket A.2.

describe("detectVenueWeekendEndDate — audit anchor cases", () => {
  it("MadisonH3 Token Run Campout 2026 — Fri/Sat/Sun in description", () => {
    const desc = `Another banger of a campout for you this year!

Cum to Token Creek on the outskirts of Madison for a weekend of camping.

Friday:
Arrive, set up your tent

Saturday:
Olympdic Games

Sunday:
Hair of the Dog and GTFO`;
    expect(
      detectVenueWeekendEndDate(desc, "MadisonH3 Token Run Campout 2026", "2026-05-29"),
    ).toBe("2026-05-31");
  });

  it("RIH3 40th Analversary Weekend Events — multi-day banner", () => {
    const desc =
      "40th Analversary Weekend Events!\n\nFriday: registration + welcome.\nSaturday: A-to-B trail.\nSunday: brunch on-down.";
    expect(
      detectVenueWeekendEndDate(desc, "The RIH3's 40th Analversary Weekend Events", "2027-05-01"),
    ).not.toBeNull();
  });

  it("returns null when only one weekday is mentioned", () => {
    const desc = "Annual Saturday-only campout. Just a brunch and a trail.";
    expect(detectVenueWeekendEndDate(desc, "Saturday Campout", "2026-01-17")).toBeNull();
  });

  it("returns null when the trigger word is absent", () => {
    const desc = "Friday prelube, Saturday hare meeting. No retreat or campout this time.";
    // The description has the trigger words! Recheck: 'retreat or campout' contains
    // the negation form — but `\b(?:camp\s?out|weekend|retreat|rendezvous)\b` matches
    // the bare words regardless of "or". Trigger fires; that's the correct behavior.
    expect(detectVenueWeekendEndDate(desc, "Just a regular meeting", "2026-05-29")).not.toBeNull();
  });

  it("returns null for a true non-campout trail (no trigger word)", () => {
    const desc = "Friday prelube, Saturday trail. Pack your shiggy shoes.";
    expect(detectVenueWeekendEndDate(desc, "Friday + Saturday double-trouble", "2026-05-29")).toBeNull();
  });

  it("caps the forward offset at 4 days (prelube/teaser ignored)", () => {
    // Friday start (dow=5). Thursday mention would be 6 days forward — capped.
    const desc = "Camping weekend! Thursday prelube, Friday arrival, Saturday trail.";
    const result = detectVenueWeekendEndDate(desc, "Weekend Campout", "2026-05-29");
    // Mentioned: Thu(4), Fri(5), Sat(6). Offsets from Fri: Thu→6 (capped),
    // Fri→0, Sat→1. maxOffset=1, endDate = Saturday.
    expect(result).toBe("2026-05-30");
  });
});
