import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseEventHeader, parseEventDetails, RenegadeH3Adapter } from "./renegade-h3";

/**
 * Minimal Source stub for adapter.fetch() — the real Prisma `Source` has many
 * required fields the test doesn't care about, and the adapter only reads
 * `id` and `url`. Hoisted to a single typed cast (vs inline `as never` at every
 * call site) so the cast lives in one place. (#1626 Sonar S4325)
 */
const FAKE_SOURCE = {
  id: "test",
  url: "https://www.renegadeh3.com/events",
} as unknown as Source;

describe("RenegadeH3Adapter", () => {
  describe("parseEventHeader", () => {
    it("parses standard header with 2-digit year", () => {
      const result = parseEventHeader("#293 - 03/21/26 - Anal Puttin' on the Green Trail");
      expect(result).toEqual({
        runNumber: 293,
        date: "2026-03-21",
        title: "Anal Puttin' on the Green Trail",
      });
    });

    it("parses header with 4-digit year", () => {
      const result = parseEventHeader("#290 - 01/09/2026 - Good Will Wrapping Party");
      expect(result).toEqual({
        runNumber: 290,
        date: "2026-01-09",
        title: "Good Will Wrapping Party",
      });
    });

    it("parses header with single-digit month/day", () => {
      const result = parseEventHeader("#100 - 1/5/25 - New Year Hash");
      expect(result).toEqual({
        runNumber: 100,
        date: "2025-01-05",
        title: "New Year Hash",
      });
    });

    it("returns null for non-header text", () => {
      expect(parseEventHeader("Hares needed!")).toBeNull();
      expect(parseEventHeader("2026")).toBeNull();
      expect(parseEventHeader("")).toBeNull();
    });

  });

  describe("parseEventDetails", () => {
    it("parses full event detail block — Muster wins precedence", () => {
      // #1581: Muster is the gather/start time (closest to a true event
      // start). When all three time labels are present, Muster takes
      // precedence over Pack Away (latest-arrival cutoff) and Chalk Talk
      // (briefing).
      const text = [
        "Hares: Can't feel Clap... Saran Clap and Can't Feel It",
        "Where: Meet at Mikeys Late Night Slice 6562 Riverside Drive Dublin",
        "Muster 1:00",
        "Chalk talk: 1:45",
        "Pack Away: 2:00",
        "Shiggy: 2 (out of 5)",
        "Hash Cash: $8.00",
        "Trail: A to A*",
      ].join("\n");

      const result = parseEventDetails(text);
      expect(result.hares).toBe("Can't feel Clap... Saran Clap and Can't Feel It");
      expect(result.location).toBe("Meet at Mikeys Late Night Slice 6562 Riverside Drive Dublin");
      expect(result.locationUrl).toContain("google.com/maps");
      // Muster: 1:00 (afternoon) → 13:00 — beats Pack Away 14:00 and Chalk Talk 13:45.
      expect(result.startTime).toBe("13:00");
    });

    it("treats bare evening times as PM", () => {
      const text = "Pack Away: 7:00";
      const result = parseEventDetails(text);
      expect(result.startTime).toBe("19:00");
    });

    // #1581: startTime extraction is a label precedence ladder. Muster (gather
    // time) wins over Pack Away (cutoff) which wins over Chalk Talk (briefing).
    // Cases also exercise the colon-vs-bare-space muster syntax (live source
    // mixes both — run #295 has "Muster:", run #296 has "Muster ").
    describe("startTime precedence (#1581)", () => {
      it.each([
        // [label, detail text, expected HH:MM]
        ["Muster: only", "Muster: 2:00", "14:00"],
        ["Muster (no colon) only", "Muster 5:00 PM", "17:00"],
        ["Pack Away only", "Pack away: 3:00", "15:00"],
        ["Chalk Talk only", "Chalk talk: 1:45", "13:45"],
        [
          "Muster + Pack Away — Muster wins",
          "Muster: 2:00\nPack away: 3:00",
          "14:00",
        ],
        [
          "Muster + Chalk Talk — Muster wins",
          "Muster: 2:00\nChalk talk: 2:45",
          "14:00",
        ],
        [
          "Pack Away + Chalk Talk — Pack Away wins (legacy behavior)",
          "Chalk talk: 1:45\nPack away: 3:00",
          "15:00",
        ],
        // Run #295 verbatim (live).
        [
          "Run #295 live shape",
          "Where: Nelson Park\nHares: So Many Ways & Depends on the Odds\nMuster: 2:00\nChalk Talk: 2:45\nPack away: 3:00",
          "14:00",
        ],
      ])("%s → %s", (_label, text, expected) => {
        expect(parseEventDetails(text).startTime).toBe(expected);
      });
    });

    it("handles empty detail text", () => {
      const result = parseEventDetails("");
      expect(result.hares).toBeUndefined();
      expect(result.location).toBeUndefined();
      expect(result.startTime).toBeUndefined();
    });

    it("strips TBA placeholder from location", () => {
      const text = "Where: TBA";
      const result = parseEventDetails(text);
      expect(result.location).toBeUndefined();
    });

    it("collects non-field lines as description", () => {
      const text = "Shiggy: 3/5\nHash Cash: $8.00\nBring your whistle";
      const result = parseEventDetails(text);
      expect(result.description).toContain("Shiggy: 3/5");
      expect(result.description).toContain("Hash Cash: $8.00");
    });
  });

  describe("RenegadeH3Adapter.fetch — multi-paragraph detail walk (#1581)", () => {
    it("walks across two <p> blocks of details for run #295", async () => {
      // Verbatim from renegadeh3.com/events on 2026-05-22: run #295's
      // details are split across two <p> tags — Where/Hares in the first,
      // Muster/Chalk Talk/Pack away/etc. in the second. Pre-fix, only the
      // first <p> was read, so startTime fell through to undefined.
      const html = `<html><body>
        <p>#295 - 05/23/26 - Asian Fest Trail</p>
        <p>&nbsp; &nbsp;Where: Nelson Park<br />&nbsp; &nbsp;Hares: So Many Ways &amp; Depends on the Odds</p>
        <p>&nbsp; &nbsp;Muster: 2:00<br />&nbsp; &nbsp;Chalk Talk: 2:45<br />&nbsp; &nbsp;Pack away: 3:00<br />&nbsp; &nbsp;Shiggy: 1.69<br />&nbsp; &nbsp;Hash Cash: $8<br />&nbsp; &nbsp;Trail: A to A</p>
        <p>#294 - 04/18/26 - Immaculate Cock Production</p>
      </body></html>`;
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(html, { status: 200 }),
      );
      const result = await new RenegadeH3Adapter().fetch(FAKE_SOURCE);
      const run295 = result.events.find((e) => e.runNumber === 295);
      expect(run295).toBeDefined();
      expect(run295!.date).toBe("2026-05-23");
      expect(run295!.title).toBe("Asian Fest Trail");
      expect(run295!.hares).toBe("So Many Ways & Depends on the Odds");
      expect(run295!.location).toBe("Nelson Park");
      // Muster: 2:00 (afternoon) → 14:00.
      expect(run295!.startTime).toBe("14:00");
      vi.restoreAllMocks();
    });

    it("stops accumulating details at the next event header <p>", async () => {
      // Defensive: when details span multiple <p>, the walk must terminate
      // before swallowing the *next* event header. Without the
      // parseEventHeader sentinel, run #295's description would absorb run
      // #294's header text.
      const html = `<html><body>
        <p>#295 - 05/23/26 - Asian Fest Trail</p>
        <p>Where: Nelson Park</p>
        <p>Muster: 2:00</p>
        <p>#294 - 04/18/26 - Immaculate Cock Production</p>
        <p>Where: Somewhere Else</p>
        <p>Muster: 5:00 PM</p>
      </body></html>`;
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(html, { status: 200 }),
      );
      const result = await new RenegadeH3Adapter().fetch(FAKE_SOURCE);
      const run295 = result.events.find((e) => e.runNumber === 295);
      const run294 = result.events.find((e) => e.runNumber === 294);
      expect(run295!.location).toBe("Nelson Park");
      expect(run295!.startTime).toBe("14:00");
      // Run #294 must NOT inherit run #295's data — and must pick up its own.
      expect(run294!.location).toBe("Somewhere Else");
      expect(run294!.startTime).toBe("17:00");
      vi.restoreAllMocks();
    });
  });
});
