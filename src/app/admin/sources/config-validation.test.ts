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
      expect(validateSourceConfig("HASHREGO", null)).toEqual([]);
      expect(validateSourceConfig("HASHREGO", undefined)).toEqual([]);
    });

    it.each(["GOOGLE_SHEETS", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE", "FACEBOOK_HOSTED_EVENTS"])(
      "rejects null config for %s",
      (type) => {
        const errors = validateSourceConfig(type, null);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain("requires a config");
      },
    );

    it.each(["GOOGLE_SHEETS", "MEETUP", "RSS_FEED", "STATIC_SCHEDULE", "FACEBOOK_HOSTED_EVENTS"])(
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
      expect(errors[0]).toContain("must be a [regex, tag");
    });

    it.each([
      [[[123, "TAG"]], "regex must be a string"],
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

    // #1023 step 4: multi-kennel array tag values — gated by source type
    it("accepts a multi-kennel array tag pattern for GOOGLE_CALENDAR (migrated to matchKennelPatterns)", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: [["Cherry City.*OH3", ["cch3-or", "oh3"]]],
      });
      expect(errors).toEqual([]);
    });

    it.each(["MEETUP", "ICAL_FEED", "HTML_SCRAPER", "RSS_FEED"])(
      "rejects a multi-kennel array tag pattern for non-migrated source type %s",
      (type) => {
        const errors = validateSourceConfig(type, {
          kennelPatterns: [["X", ["a", "b"]]],
        });
        expect(errors.some((e) => e.includes("multi-kennel array tags are not supported"))).toBe(true);
      },
    );

    it.each([
      [[[".*", []]], "multi-kennel tag array cannot be empty"],
      [[[".*", ["valid", ""]]], "each multi-kennel tag must be a non-empty string"],
      [[[".*", ["valid", 123]]], "each multi-kennel tag must be a non-empty string"],
      [[[".*", 42]], "tag must be a string or string[]"],
    ])("rejects invalid multi-kennel tag value: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        kennelPatterns: patterns,
      });
      expect(errors.some((e) => e.includes(expectedMsg))).toBe(true);
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
  // titleHarePattern validation (single string, not array)
  // ---------------------------------------------------------------------------

  describe("titleHarePattern validation", () => {
    it("accepts valid titleHarePattern", () => {
      expect(validateSourceConfig("GOOGLE_CALENDAR", {
        titleHarePattern: String.raw`^(.+?)\s+AH3\s+#`,
      })).toEqual([]);
    });

    it("rejects invalid regex titleHarePattern", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        titleHarePattern: "[broken(",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("invalid regex");
    });

    it("rejects ReDoS-unsafe titleHarePattern", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        titleHarePattern: "(a+a+)+$",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("catastrophic backtracking");
    });

    it("rejects non-string titleHarePattern", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        titleHarePattern: 123,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be a string");
    });
  });

  // ---------------------------------------------------------------------------
  // harePatterns validation
  // ---------------------------------------------------------------------------

  describe("harePatterns validation", () => {
    it("accepts valid harePatterns", () => {
      const config = {
        harePatterns: [String.raw`(?:^|\n)\s*WHO ARE THE HARES:\s*(.+)`, String.raw`(?:^|\n)\s*Laid by:\s*(.+)`],
        defaultKennelTag: "ELPH3",
      };
      expect(validateSourceConfig("GOOGLE_CALENDAR", config)).toEqual([]);
    });

    it("rejects non-array harePatterns", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        harePatterns: "not an array",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be an array");
    });

    it.each([
      [["[broken("], "invalid regex"],
      [[123], "must be a string"],
      [["(x+x+)+y"], "catastrophic backtracking"],
    ])("rejects invalid hare pattern: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        harePatterns: patterns,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(expectedMsg);
    });
  });

  // ---------------------------------------------------------------------------
  // runNumberPatterns validation
  // ---------------------------------------------------------------------------

  describe("runNumberPatterns validation", () => {
    it("accepts valid runNumberPatterns", () => {
      const config = {
        runNumberPatterns: [String.raw`Hash\s*#\s*(\d+)`, String.raw`Run\s*#\s*(\d+)`],
        defaultKennelTag: "ELPH3",
      };
      expect(validateSourceConfig("GOOGLE_CALENDAR", config)).toEqual([]);
    });

    it("rejects non-array runNumberPatterns", () => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        runNumberPatterns: "not an array",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be an array");
    });

    it.each([
      [["[broken("], "invalid regex"],
      [[123], "must be a string"],
      [["(x+x+)+y"], "catastrophic backtracking"],
    ])("rejects invalid run number pattern: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("GOOGLE_CALENDAR", {
        runNumberPatterns: patterns,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(expectedMsg);
    });
  });

  // ---------------------------------------------------------------------------
  // costPatterns validation
  // ---------------------------------------------------------------------------

  describe("costPatterns validation", () => {
    it("accepts valid costPatterns", () => {
      const config = {
        costPatterns: [String.raw`(?:^|\n)\s*Hash\s*Cash:\s*([^\n]+)`],
        defaultKennelTag: "berlinh3",
      };
      expect(validateSourceConfig("ICAL_FEED", config)).toEqual([]);
    });

    it("rejects non-array costPatterns", () => {
      const errors = validateSourceConfig("ICAL_FEED", {
        costPatterns: "not an array",
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("must be an array");
    });

    it.each([
      [["[broken("], "invalid regex"],
      [[123], "must be a string"],
      [["(x+x+)+y"], "catastrophic backtracking"],
    ])("rejects invalid cost pattern: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("ICAL_FEED", {
        costPatterns: patterns,
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(expectedMsg);
    });
  });

  // ---------------------------------------------------------------------------
  // locationOmitIfMatches validation
  // ---------------------------------------------------------------------------

  describe("locationOmitIfMatches validation", () => {
    const baseHtmlConfig = {
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(2)" },
      defaultKennelTag: "bristolh3",
    };

    it("accepts valid pattern array", () => {
      const config = {
        ...baseHtmlConfig,
        locationOmitIfMatches: [
          String.raw`^t\.?b\.?[ad]\.?$`,
          String.raw`^hare\s+wanted\.?$`,
        ],
      };
      expect(validateSourceConfig("HTML_SCRAPER", config)).toEqual([]);
    });

    it("rejects non-array locationOmitIfMatches", () => {
      const errors = validateSourceConfig("HTML_SCRAPER", {
        ...baseHtmlConfig,
        locationOmitIfMatches: "not an array",
      });
      expect(errors.some((e) => e.includes("locationOmitIfMatches"))).toBe(true);
      expect(errors.some((e) => e.includes("must be an array"))).toBe(true);
    });

    it.each([
      [["[broken("], "invalid regex"],
      [[123], "must be a string"],
      [["(x+x+)+y"], "catastrophic backtracking"],
    ])("rejects invalid locationOmitIfMatches entry: %s", (patterns, expectedMsg) => {
      const errors = validateSourceConfig("HTML_SCRAPER", {
        ...baseHtmlConfig,
        locationOmitIfMatches: patterns,
      });
      expect(errors.some((e) => e.includes(expectedMsg))).toBe(true);
    });

    it.each([
      [["^.*$"], "universal anchored"],
      [[".*"], "universal unanchored"],
      [["^.+$"], "any-non-empty"],
      [[String.raw`^\s*$`], "whitespace-only"],
    ])("rejects too-broad locationOmitIfMatches pattern (%s)", (patterns, _label) => {
      const errors = validateSourceConfig("HTML_SCRAPER", {
        ...baseHtmlConfig,
        locationOmitIfMatches: patterns,
      });
      expect(errors.some((e) => e.includes("too broad"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // defaultStartTime + defaultStartTimeByKennel validation
  // ---------------------------------------------------------------------------

  describe("default start time validation", () => {
    const baseHtmlConfig = {
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(2)" },
      defaultKennelTag: "bristolh3",
    };

    it("accepts valid HH:MM defaultStartTime", () => {
      expect(
        validateSourceConfig("HTML_SCRAPER", {
          ...baseHtmlConfig,
          defaultStartTime: "19:00",
        }),
      ).toEqual([]);
    });

    it.each(["7:00", "19", "19:0", "25:00", "12:60", "noon"])(
      "rejects malformed defaultStartTime %s",
      (bad) => {
        const errors = validateSourceConfig("HTML_SCRAPER", {
          ...baseHtmlConfig,
          defaultStartTime: bad,
        });
        expect(errors.some((e) => e.includes("HH:MM"))).toBe(true);
      },
    );

    it("accepts valid defaultStartTimeByKennel map", () => {
      expect(
        validateSourceConfig("HTML_SCRAPER", {
          ...baseHtmlConfig,
          defaultStartTimeByKennel: {
            bristolh3: "11:00",
            "bristol-grey": "19:00",
            "bogs-h3": "19:15",
          },
        }),
      ).toEqual([]);
    });

    it("rejects non-object defaultStartTimeByKennel", () => {
      const errors = validateSourceConfig("HTML_SCRAPER", {
        ...baseHtmlConfig,
        defaultStartTimeByKennel: ["not", "an", "object"],
      });
      expect(errors.some((e) => e.includes("must be an object"))).toBe(true);
    });

    it("rejects malformed time values in defaultStartTimeByKennel", () => {
      const errors = validateSourceConfig("HTML_SCRAPER", {
        ...baseHtmlConfig,
        defaultStartTimeByKennel: { bristolh3: "11am" },
      });
      expect(errors.some((e) => e.includes("HH:MM"))).toBe(true);
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

  describe("FACEBOOK_HOSTED_EVENTS", () => {
    const valid = {
      kennelTag: "gsh3",
      pageHandle: "GrandStrandHashing",
      timezone: "America/New_York",
      upcomingOnly: true,
    };

    it("accepts a complete config", () => {
      expect(validateSourceConfig("FACEBOOK_HOSTED_EVENTS", valid)).toEqual([]);
    });

    it("rejects missing kennelTag, pageHandle, timezone, upcomingOnly", () => {
      const errors = validateSourceConfig("FACEBOOK_HOSTED_EVENTS", {});
      expect(errors.some((e) => /kennelTag/.test(e))).toBe(true);
      expect(errors.some((e) => /pageHandle/.test(e))).toBe(true);
      expect(errors.some((e) => /timezone/.test(e))).toBe(true);
      expect(errors.some((e) => /upcomingOnly/.test(e))).toBe(true);
    });

    it("rejects pageHandle with disallowed characters (XSS / spaces)", () => {
      const errors = validateSourceConfig("FACEBOOK_HOSTED_EVENTS", { ...valid, pageHandle: "Some Page" });
      expect(errors.some((e) => /pageHandle/.test(e))).toBe(true);
    });

    it.each(["events", "groups", "watch", "profile.php", "Events"])(
      "rejects FB reserved namespace as pageHandle: %s",
      (reserved) => {
        const errors = validateSourceConfig("FACEBOOK_HOSTED_EVENTS", {
          ...valid,
          pageHandle: reserved,
        });
        expect(errors.some((e) => /structural namespace/.test(e))).toBe(true);
      },
    );

    it("rejects an invalid IANA timezone", () => {
      const errors = validateSourceConfig("FACEBOOK_HOSTED_EVENTS", { ...valid, timezone: "America/Los_Angles" });
      expect(errors.some((e) => /IANA/.test(e))).toBe(true);
    });

    it("rejects upcomingOnly: false (Codex pass-2: server-side invariant)", () => {
      const errors = validateSourceConfig("FACEBOOK_HOSTED_EVENTS", { ...valid, upcomingOnly: false });
      expect(errors.some((e) => /upcomingOnly/.test(e))).toBe(true);
    });

    it("rejects upcomingOnly missing entirely (e.g. raw-JSON edit drops it)", () => {
      const partial = { ...valid };
      delete (partial as Partial<typeof valid>).upcomingOnly;
      const errors = validateSourceConfig("FACEBOOK_HOSTED_EVENTS", partial);
      expect(errors.some((e) => /upcomingOnly/.test(e))).toBe(true);
    });
  });
});
