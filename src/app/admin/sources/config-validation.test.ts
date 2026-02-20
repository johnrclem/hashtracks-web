import { validateSourceConfig } from "./config-validation";

describe("validateSourceConfig", () => {
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

    it("accepts empty config", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", {})).toEqual([]);
    });

    it("accepts null/undefined config", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", null)).toEqual([]);
      expect(validateSourceConfig("GOOGLE_CALENDAR", undefined)).toEqual([]);
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
});
