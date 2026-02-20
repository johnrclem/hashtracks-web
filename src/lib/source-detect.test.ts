import { detectSourceType, extractSheetId, extractCalendarId, suggestKennelPatterns } from "./source-detect";

describe("detectSourceType", () => {
  describe("Google Sheets", () => {
    it("detects Google Sheets URL and extracts sheetId", () => {
      const result = detectSourceType(
        "https://docs.google.com/spreadsheets/d/1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk/edit",
      );
      expect(result?.type).toBe("GOOGLE_SHEETS");
      expect(result?.sheetId).toBe("1wG-BNb5ekMHM5euiPJT1nxQXZ3UxNqFZMdQtCBbYaMk");
    });

    it("detects Sheets URL without /edit suffix", () => {
      const result = detectSourceType(
        "https://docs.google.com/spreadsheets/d/abc123/pub?output=csv",
      );
      expect(result?.type).toBe("GOOGLE_SHEETS");
      expect(result?.sheetId).toBe("abc123");
    });

    it("has no extractedUrl for Sheets", () => {
      const result = detectSourceType("https://docs.google.com/spreadsheets/d/abc/");
      expect(result?.extractedUrl).toBeUndefined();
    });
  });

  describe("Google Calendar", () => {
    it("detects embed URL with ?src= and extracts calendarId", () => {
      const result = detectSourceType(
        "https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com",
      );
      expect(result?.type).toBe("GOOGLE_CALENDAR");
      expect(result?.extractedUrl).toBe("abc@group.calendar.google.com");
    });

    it("detects iCal URL format and extracts calendarId", () => {
      const result = detectSourceType(
        "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics",
      );
      expect(result?.type).toBe("GOOGLE_CALENDAR");
      expect(result?.extractedUrl).toBe("abc@group.calendar.google.com");
    });

    it("detects cid= format and extracts calendarId", () => {
      const result = detectSourceType(
        "https://calendar.google.com/calendar/u/0/r?cid=abc%40group.calendar.google.com",
      );
      expect(result?.type).toBe("GOOGLE_CALENDAR");
      expect(result?.extractedUrl).toBe("abc@group.calendar.google.com");
    });

    it("returns undefined extractedUrl when no calendarId found in URL", () => {
      const result = detectSourceType("https://calendar.google.com/calendar/r");
      expect(result?.type).toBe("GOOGLE_CALENDAR");
      expect(result?.extractedUrl).toBeUndefined();
    });
  });

  describe("Hash Rego", () => {
    it("detects hashrego.com URL", () => {
      const result = detectSourceType("https://hashrego.com/kennels/EWH3");
      expect(result?.type).toBe("HASHREGO");
    });
  });

  describe("iCal feed", () => {
    it("detects .ics URL", () => {
      const result = detectSourceType("https://example.com/calendar/feed.ics");
      expect(result?.type).toBe("ICAL_FEED");
    });

    it("detects webcal:// scheme", () => {
      const result = detectSourceType("webcal://example.com/calendar/feed.ics");
      expect(result?.type).toBe("ICAL_FEED");
    });

    it("detects ?format=ical query param", () => {
      const result = detectSourceType("https://example.com/calendar?format=ical");
      expect(result?.type).toBe("ICAL_FEED");
    });
  });

  describe("no match", () => {
    it("returns null for a generic HTML URL", () => {
      const result = detectSourceType("https://hashnyc.com/schedule");
      expect(result).toBeNull();
    });

    it("returns null for an invalid URL", () => {
      const result = detectSourceType("not-a-url");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = detectSourceType("");
      expect(result).toBeNull();
    });
  });
});

describe("extractSheetId", () => {
  it("extracts from standard edit URL", () => {
    expect(extractSheetId("https://docs.google.com/spreadsheets/d/abc123/edit")).toBe("abc123");
  });

  it("extracts with hyphens and underscores", () => {
    expect(extractSheetId("https://docs.google.com/spreadsheets/d/a-b_C123/")).toBe("a-b_C123");
  });

  it("returns undefined when no sheetId present", () => {
    expect(extractSheetId("https://docs.google.com/spreadsheets/")).toBeUndefined();
  });
});

describe("extractCalendarId", () => {
  it("extracts from ?src= param (encoded)", () => {
    expect(
      extractCalendarId("https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com"),
    ).toBe("abc@group.calendar.google.com");
  });

  it("extracts from /ical/ path", () => {
    expect(
      extractCalendarId("https://calendar.google.com/calendar/ical/abc%40gmail.com/public/basic.ics"),
    ).toBe("abc@gmail.com");
  });

  it("returns undefined when no calendarId extractable", () => {
    expect(extractCalendarId("https://calendar.google.com/calendar/r")).toBeUndefined();
  });
});

describe("suggestKennelPatterns", () => {
  it("returns [tag, tag] pairs for unmatched tags", () => {
    expect(suggestKennelPatterns(["EWH3", "BFM"])).toEqual([
      ["EWH3", "EWH3"],
      ["BFM", "BFM"],
    ]);
  });

  it("deduplicates repeated tags", () => {
    const result = suggestKennelPatterns(["EWH3", "EWH3", "BFM"]);
    expect(result).toHaveLength(2);
  });

  it("filters out empty strings", () => {
    expect(suggestKennelPatterns(["", "EWH3", "  "])).toEqual([["EWH3", "EWH3"]]);
  });

  it("returns empty array for empty input", () => {
    expect(suggestKennelPatterns([])).toEqual([]);
  });
});
