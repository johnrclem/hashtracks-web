import {
  MONTHS,
  MONTHS_ZERO,
  parse12HourTime,
  googleMapsSearchUrl,
  extractUkPostcode,
  validateSourceConfig,
  decodeEntities,
  stripHtmlTags,
} from "./utils";

describe("MONTHS", () => {
  it("maps abbreviated month names to 1-indexed numbers", () => {
    expect(MONTHS.jan).toBe(1);
    expect(MONTHS.dec).toBe(12);
    expect(MONTHS.june).toBe(6);
  });
});

describe("MONTHS_ZERO", () => {
  it("maps abbreviated month names to 0-indexed numbers", () => {
    expect(MONTHS_ZERO.jan).toBe(0);
    expect(MONTHS_ZERO.december).toBe(11);
    expect(MONTHS_ZERO.june).toBe(5);
  });
});

describe("parse12HourTime", () => {
  it("parses PM time", () => {
    expect(parse12HourTime("7:00 PM")).toBe("19:00");
  });

  it("parses AM time", () => {
    expect(parse12HourTime("9:30 am")).toBe("09:30");
  });

  it("handles 12 PM (noon)", () => {
    expect(parse12HourTime("12:00 pm")).toBe("12:00");
  });

  it("handles 12 AM (midnight)", () => {
    expect(parse12HourTime("12:00 am")).toBe("00:00");
  });

  it("returns undefined for no match", () => {
    expect(parse12HourTime("no time here")).toBeUndefined();
  });

  it("extracts time from surrounding text", () => {
    expect(parse12HourTime("7:00 PM gather at the pub")).toBe("19:00");
  });
});

describe("googleMapsSearchUrl", () => {
  it("generates a Google Maps search URL", () => {
    expect(googleMapsSearchUrl("Central Park")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Central%20Park",
    );
  });

  it("encodes special characters", () => {
    const url = googleMapsSearchUrl("123 Main St, NYC");
    expect(url).toContain("123%20Main%20St%2C%20NYC");
  });
});

describe("extractUkPostcode", () => {
  it("extracts a UK postcode", () => {
    expect(extractUkPostcode("The Dolphin, SE11 5JA")).toBe("SE11 5JA");
  });

  it("extracts postcode without space", () => {
    expect(extractUkPostcode("SW182SS area")).toBe("SW182SS");
  });

  it("returns null when no postcode found", () => {
    expect(extractUkPostcode("no postcode here")).toBeNull();
  });
});

describe("validateSourceConfig", () => {
  it("validates a valid config object", () => {
    const config = validateSourceConfig<{ sheetId: string }>(
      { sheetId: "abc123" }, "TestAdapter", { sheetId: "string" },
    );
    expect(config.sheetId).toBe("abc123");
  });

  it("throws for null config", () => {
    expect(() => validateSourceConfig(null, "TestAdapter", { sheetId: "string" }))
      .toThrow("source.config is null");
  });

  it("throws for missing required field", () => {
    expect(() => validateSourceConfig({ foo: "bar" }, "TestAdapter", { sheetId: "string" }))
      .toThrow('missing required config field "sheetId"');
  });

  it("throws for wrong type", () => {
    expect(() => validateSourceConfig({ sheetId: 123 }, "TestAdapter", { sheetId: "string" }))
      .toThrow("config.sheetId must be a string");
  });

  it("validates array fields", () => {
    const config = validateSourceConfig<{ slugs: string[] }>(
      { slugs: ["a", "b"] }, "TestAdapter", { slugs: "array" },
    );
    expect(config.slugs).toEqual(["a", "b"]);
  });

  it("throws for non-array when array expected", () => {
    expect(() => validateSourceConfig({ slugs: "not-array" }, "TestAdapter", { slugs: "array" }))
      .toThrow("config.slugs must be an array");
  });
});

describe("decodeEntities", () => {
  it("decodes named HTML entities", () => {
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("a &lt; b &gt; c")).toBe("a < b > c");
    expect(decodeEntities("&quot;hello&quot;")).toBe('"hello"');
  });

  it("decodes numeric decimal entities", () => {
    expect(decodeEntities("dash &#8212; here")).toBe("dash \u2014 here");
  });

  it("decodes numeric hex entities", () => {
    expect(decodeEntities("quote &#x2019; here")).toBe("quote \u2019 here");
  });

  it("normalizes non-breaking spaces to regular spaces", () => {
    expect(decodeEntities("hello&nbsp;world")).toBe("hello world");
    expect(decodeEntities("hello\u00A0world")).toBe("hello world");
  });

  it("passes through plain text unchanged", () => {
    expect(decodeEntities("no entities here")).toBe("no entities here");
  });
});

describe("stripHtmlTags", () => {
  it("strips basic HTML tags", () => {
    expect(stripHtmlTags("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("converts <br> to space by default", () => {
    expect(stripHtmlTags("line1<br>line2")).toBe("line1 line2");
    expect(stripHtmlTags("line1<br/>line2")).toBe("line1 line2");
    expect(stripHtmlTags("line1<br />line2")).toBe("line1 line2");
  });

  it("converts <br> to custom replacement", () => {
    expect(stripHtmlTags("line1<br>line2", "\n")).toBe("line1\nline2");
  });

  it("removes <script> blocks entirely", () => {
    expect(stripHtmlTags("hello<script>alert(1)</script> world")).toBe("hello world");
    expect(stripHtmlTags("before<script>evil()</script>after")).toBe("beforeafter");
  });

  it("removes <style> blocks entirely", () => {
    expect(stripHtmlTags("hello<style>.x{color:red}</style> world")).toBe("hello world");
    expect(stripHtmlTags("before<style>.x{}</style>after")).toBe("beforeafter");
  });

  it("preserves newlines from <br> replacement when collapsing whitespace", () => {
    const result = stripHtmlTags("line1<br>  line2<br>  line3", "\n");
    expect(result).toContain("\n");
    expect(result).toBe("line1\nline2\nline3");
  });

  it("handles malformed HTML with > in attributes", () => {
    // Cheerio handles this correctly where regex /<[^>]+>/g would fail
    const result = stripHtmlTags('<img src=">" onerror="alert(1)">safe text');
    expect(result).not.toContain("onerror");
    expect(result).toContain("safe text");
  });

  it("collapses horizontal whitespace", () => {
    expect(stripHtmlTags("<p>hello</p>  <p>world</p>")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(stripHtmlTags("  <p>hello</p>  ")).toBe("hello");
  });
});
