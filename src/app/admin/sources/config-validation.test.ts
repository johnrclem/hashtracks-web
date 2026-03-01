import { validateSourceConfig } from "./config-validation";

describe("validateSourceConfig", () => {
  // ---------------------------------------------------------------------------
  // Null/undefined config — parameterized to eliminate per-type duplication
  // ---------------------------------------------------------------------------

  describe("null/undefined config handling", () => {
    it("accepts null/undefined config for optional types", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", null)).toEqual([]);
      expect(validateSourceConfig("GOOGLE_CALENDAR", undefined)).toEqual([]);
      expect(validateSourceConfig("ICAL_FEED", null)).toEqual([]);
      expect(validateSourceConfig("HTML_SCRAPER", null)).toEqual([]);
    });

    it.each(["GOOGLE_SHEETS", "HASHREGO", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE"])(
      "rejects null config for %s",
      (type) => {
        const errors = validateSourceConfig(type, null);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("requires a config");
      },
    );

    it.each(["GOOGLE_SHEETS", "HASHREGO", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE"])(
      "rejects undefined config for %s",
      (type) => {
        const errors = validateSourceConfig(type, undefined);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("requires a config");
      },
    );
  });

  // ---------------------------------------------------------------------------
  // Config shape validation
  // ---------------------------------------------------------------------------

  describe("config shape validation", () => {
    it.each([
      ["GOOGLE_CALENDAR", [1, 2, 3], "array"],
      ["ICAL_FEED", "not an object", "string"],
      ["GOOGLE_CALENDAR", 42, "number"],
    ])("rejects non-object config (%s with %s)", (type, config, _label) => {
      const errors = validateSourceConfig(type, config);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be a JSON object");
    });

    it("accepts empty config for optional types", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", {})).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // kennelPatterns validation
  // ---------------------------------------------------------------------------

  describe("kennelPatterns validation", () => {
    it("accepts valid kennelPatterns", () => {
      const config = {
        kennelPatterns: [
          ["^EWH3", "EWH3"],
          ["^SHITH3", "SHITH3"],
        ],
        defaultKennelTag: "BoH3",
      };
      expect(validateSourceConfig("GOOGLE_CALENDAR", config)).toEqual([]);
    });

    it("rejects non-array kennelPatterns", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: "not an array",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be an array");
    });

    it("rejects malformed pattern pairs", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [["only one"]],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("[regex, tag] pair");
    });

    it.each([
      [[[123, "TAG"]], "must be strings"],
      [[["^EWH3", "  "]], "cannot be empty"],
      [[["[invalid(", "TAG"]], "invalid regex"],
      [[["(a+)+$", "TAG"]], "catastrophic backtracking"],
    ])("rejects invalid kennelPattern entry: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: patterns,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(expectedMsg);
    });

    it("collects multiple errors", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [
          ["[bad(", "TAG1"],
          ["^OK", "TAG2"],
          ["(unclosed", "TAG3"],
        ],
      });
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // skipPatterns validation
  // ---------------------------------------------------------------------------

  describe("skipPatterns validation", () => {
    it("accepts valid skipPatterns", () => {
      const config = {
        skipPatterns: ["^Hand Pump", "Workday"],
        defaultKennelTag: "SFH3",
      };
      expect(validateSourceConfig("ICAL_FEED", config)).toEqual([]);
    });

    it("rejects non-array skipPatterns", () => {
      const errors = validateSourceConfig("ICAL_FEED", {
        skipPatterns: "not an array",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be an array");
    });

    it.each([
      [["[broken("], "invalid regex"],
      [[123], "must be a string"],
      [["(x+x+)+y"], "catastrophic backtracking"],
    ])("rejects invalid skip pattern: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("ICAL_FEED", {
        skipPatterns: patterns,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(expectedMsg);
    });
  });

  // ---------------------------------------------------------------------------
  // GOOGLE_SHEETS required fields
  // ---------------------------------------------------------------------------

  describe("GOOGLE_SHEETS required fields", () => {
    it("requires sheetId, columns, and kennelTagRules", () => {
      const errors = validateSourceConfig("GOOGLE_SHEETS", {});
      expect(errors).toHaveLength(3);
      expect(errors.some((e) => e.includes("sheetId"))).toBe(true);
      expect(errors.some((e) => e.includes("columns"))).toBe(true);
      expect(errors.some((e) => e.includes("kennelTagRules"))).toBe(true);
    });

    it("accepts valid Sheets config", () => {
      const config = {
        sheetId: "1abc123",
        columns: { date: 0, hares: 1, location: 2, title: 3, runNumber: 4 },
        kennelTagRules: { default: "SH3" },
      };
      expect(validateSourceConfig("GOOGLE_SHEETS", config)).toEqual([]);
    });

    it("rejects kennelTagRules without default", () => {
      const errors = validateSourceConfig("GOOGLE_SHEETS", {
        sheetId: "1abc",
        columns: { date: 0 },
        kennelTagRules: {},
      });
      expect(errors.some((e) => e.includes("kennelTagRules"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // HASHREGO required fields
  // ---------------------------------------------------------------------------

  describe("HASHREGO required fields", () => {
    it("requires non-empty kennelSlugs array", () => {
      const errors = validateSourceConfig("HASHREGO", {});
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("kennelSlug");
    });

    it("rejects empty kennelSlugs array", () => {
      const errors = validateSourceConfig("HASHREGO", { kennelSlugs: [] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("kennelSlug");
    });

    it("accepts valid Hash Rego config", () => {
      const config = { kennelSlugs: ["BFMH3", "EWH3"] };
      expect(validateSourceConfig("HASHREGO", config)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Real-world configs
  // ---------------------------------------------------------------------------

  describe("real-world configs", () => {
    it("validates SFH3 iCal config (14 patterns + 2 skip)", () => {
      const config = {
        kennelPatterns: [
          ["^Bawdy", "BAH3"],
          ["^BAHN3|^Bay Area", "BAHN3"],
          ["^Full Moon|^Bos?ton FM", "BFH3"],
          ["^Hashmob", "Hashmob"],
          ["^Headbanger|^HBH3", "HBH3"],
          ["^Marin", "MH3"],
          ["^Napa", "NapaH3"],
          ["^Oakland", "OBH3"],
          ["^Petaluma|^PH3", "PH3"],
          ["^SHTH3|^South Bay", "SHTH3"],
          ["^SSF|^South San", "SSF H3"],
          ["^Surf City", "SCH3"],
          ["^(GGINTL|Golden Gate INT|International)", "GGINTL"],
          ["^San Francisco|^SFH3", "SFH3"],
        ],
        defaultKennelTag: "SFH3",
        skipPatterns: ["^Hand Pump", "^Pub Crawl"],
      };
      expect(validateSourceConfig("ICAL_FEED", config)).toEqual([]);
    });

    it("validates BFM Calendar config (4 patterns)", () => {
      const config = {
        kennelPatterns: [
          ["BFM|bfm", "BFM"],
          ["Philly|PH3", "Philly H3"],
          ["Mainline|MLH3", "MLH3"],
          ["Jersey Shore", "JSH3"],
        ],
        defaultKennelTag: "BFM",
      };
      expect(validateSourceConfig("GOOGLE_CALENDAR", config)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // RSS_FEED config validation
  // ---------------------------------------------------------------------------

  describe("RSS_FEED config validation", () => {
    it("accepts valid RSS_FEED config", () => {
      expect(validateSourceConfig("RSS_FEED", { kennelTag: "EWH3" })).toEqual([]);
    });

    it("requires non-empty kennelTag", () => {
      const errors = validateSourceConfig("RSS_FEED", { kennelTag: "" });
      expect(errors.some((e) => e.includes("kennelTag"))).toBe(true);
    });

    it("rejects missing kennelTag", () => {
      const errors = validateSourceConfig("RSS_FEED", {});
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("kennelTag");
    });
  });

  // ---------------------------------------------------------------------------
  // STATIC_SCHEDULE config validation
  // ---------------------------------------------------------------------------

  describe("STATIC_SCHEDULE config validation", () => {
    it("accepts valid STATIC_SCHEDULE config", () => {
      const config = {
        kennelTag: "Rumson",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "10:17",
        anchorDate: "2026-01-03",
        defaultTitle: "Rumson H3 Weekly Run",
      };
      expect(validateSourceConfig("STATIC_SCHEDULE", config)).toEqual([]);
    });

    it.each([
      [{ kennelTag: "", rrule: "FREQ=WEEKLY;BYDAY=SA" }, "kennelTag"],
      [{ kennelTag: "Rumson", rrule: "" }, "rrule"],
      [{ kennelTag: "Rumson", rrule: "BYDAY=SA" }, "FREQ="],
      [{ kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", startTime: 123 }, "startTime"],
      [{ kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", startTime: "10:17 AM" }, "HH:MM"],
    ])("rejects invalid STATIC_SCHEDULE config: expects error containing %s", (config, expectedField) => {
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors.some((e) => e.includes(expectedField as string))).toBe(true);
    });

    it("accepts valid HH:MM startTime", () => {
      const config = { kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", startTime: "19:00" };
      expect(validateSourceConfig("STATIC_SCHEDULE", config)).toEqual([]);
    });

    it.each([
      [{ kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", anchorDate: 123 }, "anchorDate"],
      [{ kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", anchorDate: "Jan 3 2026" }, "YYYY-MM-DD"],
    ])("rejects invalid anchorDate: expects error containing %s", (config, expectedField) => {
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors.some((e) => e.includes(expectedField as string))).toBe(true);
    });

    it("accepts valid anchorDate", () => {
      const config = { kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", anchorDate: "2026-01-03" };
      expect(validateSourceConfig("STATIC_SCHEDULE", config)).toEqual([]);
    });

    it("reports both errors when both required fields are missing", () => {
      const errors = validateSourceConfig("STATIC_SCHEDULE", {});
      expect(errors).toHaveLength(2);
    });

    it("accepts minimal config with only required fields", () => {
      const config = { kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA" };
      expect(validateSourceConfig("STATIC_SCHEDULE", config)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // MEETUP config validation
  // ---------------------------------------------------------------------------

  describe("MEETUP config validation", () => {
    it("accepts valid MEETUP config", () => {
      const config = { groupUrlname: "brooklyn-hash-house-harriers", kennelTag: "BrH3" };
      expect(validateSourceConfig("MEETUP", config)).toEqual([]);
    });

    it("requires non-empty groupUrlname", () => {
      const config = { groupUrlname: "", kennelTag: "BrH3" };
      const errors = validateSourceConfig("MEETUP", config);
      expect(errors.some((e) => e.includes("groupUrlname"))).toBe(true);
    });

    it("requires non-empty kennelTag", () => {
      const config = { groupUrlname: "brooklyn-hash", kennelTag: "" };
      const errors = validateSourceConfig("MEETUP", config);
      expect(errors.some((e) => e.includes("kennelTag"))).toBe(true);
    });

    it("reports both errors when both fields are missing", () => {
      const errors = validateSourceConfig("MEETUP", {});
      expect(errors).toHaveLength(2);
    });
  });
});
