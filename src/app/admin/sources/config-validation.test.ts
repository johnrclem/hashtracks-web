import { validateSourceConfig } from "./config-validation";

describe("validateSourceConfig", () => {
  describe("config shape validation", () => {
    it("accepts null/undefined config for optional types", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", null)).toEqual([]);
      expect(validateSourceConfig("GOOGLE_CALENDAR", undefined)).toEqual([]);
      expect(validateSourceConfig("ICAL_FEED", null)).toEqual([]);
      expect(validateSourceConfig("HTML_SCRAPER", null)).toEqual([]);
    });

    it("rejects null/undefined config for types that require it", () => {
      const sheetsErrors = validateSourceConfig("GOOGLE_SHEETS", null);
      expect(sheetsErrors).toHaveLength(1);
      expect(sheetsErrors[0]).toContain("requires a config");

      const regoErrors = validateSourceConfig("HASHREGO", undefined);
      expect(regoErrors).toHaveLength(1);
      expect(regoErrors[0]).toContain("requires a config");
    });

    it("rejects non-object config (array)", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", [1, 2, 3]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be a JSON object");
    });

    it("rejects non-object config (string)", () => {
      const errors = validateSourceConfig("ICAL_FEED", "not an object");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be a JSON object");
    });

    it("rejects non-object config (number)", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", 42);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be a JSON object");
    });

    it("accepts empty config for optional types", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", {})).toEqual([]);
    });
  });

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

    it("rejects non-string pattern values", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [[123, "TAG"]],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be strings");
    });

    it("rejects empty kennel tag", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [["^EWH3", "  "]],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("cannot be empty");
    });

    it("rejects invalid regex patterns", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [["[invalid(", "TAG"]],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("invalid regex");
    });

    it("rejects ReDoS-vulnerable patterns", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [["(a+)+$", "TAG"]],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("catastrophic backtracking");
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

    it("rejects invalid skip regex", () => {
      const errors = validateSourceConfig("ICAL_FEED", {
        skipPatterns: ["[broken("],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("invalid regex");
    });

    it("rejects non-string skip patterns", () => {
      const errors = validateSourceConfig("ICAL_FEED", {
        skipPatterns: [123],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be a string");
    });

    it("rejects ReDoS-vulnerable skip patterns", () => {
      const errors = validateSourceConfig("ICAL_FEED", {
        skipPatterns: ["(x+x+)+y"],
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("catastrophic backtracking");
    });
  });

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

    it("rejects null config for GOOGLE_SHEETS", () => {
      const errors = validateSourceConfig("GOOGLE_SHEETS", null);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("requires a config");
    });
  });

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

    it("rejects null config for HASHREGO", () => {
      const errors = validateSourceConfig("HASHREGO", null);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("requires a config");
    });
  });

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

  describe("RSS_FEED config validation", () => {
    it("accepts valid RSS_FEED config", () => {
      const config = { kennelTag: "EWH3" };
      expect(validateSourceConfig("RSS_FEED", config)).toEqual([]);
    });

    it("requires config object for RSS_FEED", () => {
      expect(validateSourceConfig("RSS_FEED", null)).toContain("RSS_FEED requires a config object");
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

  describe("STATIC_SCHEDULE config validation", () => {
    it("accepts valid STATIC_SCHEDULE config", () => {
      const config = {
        kennelTag: "Rumson",
        rrule: "FREQ=WEEKLY;BYDAY=SA",
        startTime: "10:17 AM",
        defaultTitle: "Rumson H3 Weekly Run",
      };
      expect(validateSourceConfig("STATIC_SCHEDULE", config)).toEqual([]);
    });

    it("requires config object for STATIC_SCHEDULE", () => {
      expect(validateSourceConfig("STATIC_SCHEDULE", null)).toContain(
        "STATIC_SCHEDULE requires a config object",
      );
    });

    it("requires non-empty kennelTag", () => {
      const config = { kennelTag: "", rrule: "FREQ=WEEKLY;BYDAY=SA" };
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors.some((e) => e.includes("kennelTag"))).toBe(true);
    });

    it("requires non-empty rrule", () => {
      const config = { kennelTag: "Rumson", rrule: "" };
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors.some((e) => e.includes("rrule"))).toBe(true);
    });

    it("requires rrule to start with FREQ=", () => {
      const config = { kennelTag: "Rumson", rrule: "BYDAY=SA" };
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors.some((e) => e.includes("FREQ="))).toBe(true);
    });

    it("rejects non-string startTime", () => {
      const config = { kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA", startTime: 123 };
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors.some((e) => e.includes("startTime"))).toBe(true);
    });

    it("reports both errors when both required fields are missing", () => {
      const config = {};
      const errors = validateSourceConfig("STATIC_SCHEDULE", config);
      expect(errors).toHaveLength(2);
    });

    it("accepts minimal config with only required fields", () => {
      const config = { kennelTag: "Rumson", rrule: "FREQ=WEEKLY;BYDAY=SA" };
      expect(validateSourceConfig("STATIC_SCHEDULE", config)).toEqual([]);
    });
  });

  describe("MEETUP config validation", () => {
    it("accepts valid MEETUP config", () => {
      const config = { groupUrlname: "brooklyn-hash-house-harriers", kennelTag: "BrH3" };
      expect(validateSourceConfig("MEETUP", config)).toEqual([]);
    });

    it("requires config object for MEETUP", () => {
      expect(validateSourceConfig("MEETUP", null)).toContain("MEETUP requires a config object");
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
      const config = {};
      const errors = validateSourceConfig("MEETUP", config);
      expect(errors).toHaveLength(2);
    });
  });
});
