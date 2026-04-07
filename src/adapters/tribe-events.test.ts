import { describe, it, expect } from "vitest";
import { normalizeTribeEvent } from "./tribe-events";

describe("normalizeTribeEvent", () => {
  it("parses a full event via start_date_details", () => {
    const out = normalizeTribeEvent({
      id: 976,
      title: "April Hash &#8211; Analversary",
      description: "<p>Hares: <em>Cum Analyst</em></p>",
      url: "https://choochooh3.com/event/hash-analversary/",
      start_date: "2026-04-19 14:00:00",
      start_date_details: { year: "2026", month: "04", day: "19", hour: "14", minutes: "00" },
      timezone: "America/New_York",
      categories: [{ name: "Hash", slug: "hash" }],
      venue: { venue: "Pub", address: "123 Main", city: "Chattanooga" },
      all_day: false,
    });
    expect(out).toMatchObject({
      id: 976,
      title: "April Hash – Analversary",
      date: "2026-04-19",
      startTime: "14:00",
      timezone: "America/New_York",
      categorySlugs: ["hash"],
      venue: "Pub",
      location: "123 Main, Chattanooga",
      allDay: false,
    });
    expect(out?.description).toBe("Hares: Cum Analyst");
  });

  it("falls back to start_date string when details are missing", () => {
    const out = normalizeTribeEvent({
      title: "Fallback Hash",
      start_date: "2026-05-10 08:30:00",
    });
    expect(out).toMatchObject({ date: "2026-05-10", startTime: "08:30" });
  });

  it("pads single-digit month/day/hour", () => {
    const out = normalizeTribeEvent({
      title: "Padding",
      start_date_details: { year: "2026", month: "3", day: "7", hour: "9", minutes: "5" },
    });
    expect(out).toMatchObject({ date: "2026-03-07", startTime: "09:05" });
  });

  it("returns null when title is missing", () => {
    expect(
      normalizeTribeEvent({ start_date: "2026-04-19 14:00:00" }),
    ).toBeNull();
  });

  it("returns null when date is missing", () => {
    expect(normalizeTribeEvent({ title: "No date" })).toBeNull();
  });

  it("handles venue as array (tribe sometimes returns an array)", () => {
    const out = normalizeTribeEvent({
      title: "Array venue",
      start_date: "2026-06-01 12:00:00",
      venue: [{ venue: "Somewhere", city: "Chattanooga" }],
    });
    expect(out?.venue).toBe("Somewhere");
    expect(out?.location).toBe("Chattanooga");
  });
});
