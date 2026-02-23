import {
  MONTHS,
  MONTHS_ZERO,
  parse12HourTime,
  googleMapsSearchUrl,
  extractUkPostcode,
  validateSourceConfig,
  decodeEntities,
  stripHtmlTags,
  buildUrlVariantCandidates,
  validateSourceUrl,
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


describe("validateSourceUrl", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(() => validateSourceUrl("https://hashnyc.com")).not.toThrow();
    expect(() => validateSourceUrl("https://www.example.com/path")).not.toThrow();
  });

  it("accepts valid HTTP URLs", () => {
    expect(() => validateSourceUrl("http://hashnyc.com")).not.toThrow();
  });

  it("rejects non-HTTP protocols", () => {
    expect(() => validateSourceUrl("ftp://example.com")).toThrow("non-HTTP protocol");
    expect(() => validateSourceUrl("file:///etc/passwd")).toThrow("non-HTTP protocol");
  });

  it("rejects malformed URLs", () => {
    expect(() => validateSourceUrl("not-a-url")).toThrow();
  });

  it("rejects localhost", () => {
    expect(() => validateSourceUrl("http://localhost")).toThrow();
    expect(() => validateSourceUrl("http://localhost:3000")).toThrow();
  });

  it("rejects 127.0.0.1", () => {
    expect(() => validateSourceUrl("http://127.0.0.1")).toThrow("private/reserved IP");
  });

  it("rejects 0.0.0.0", () => {
    expect(() => validateSourceUrl("http://0.0.0.0")).toThrow("private/reserved IP");
  });

  it("rejects cloud metadata endpoint", () => {
    expect(() => validateSourceUrl("http://169.254.169.254")).toThrow("private/reserved IP");
    expect(() => validateSourceUrl("http://metadata.google.internal")).toThrow("internal hostname");
  });

  it("rejects private 10.x.x.x range", () => {
    expect(() => validateSourceUrl("http://10.0.0.1")).toThrow("private/reserved IP");
    expect(() => validateSourceUrl("http://10.255.255.255")).toThrow("private/reserved IP");
  });

  it("rejects private 172.16-31.x.x range", () => {
    expect(() => validateSourceUrl("http://172.16.0.1")).toThrow("private/reserved IP");
    expect(() => validateSourceUrl("http://172.31.255.255")).toThrow("private/reserved IP");
  });

  it("allows public 172.x outside private range", () => {
    expect(() => validateSourceUrl("http://172.15.0.1")).not.toThrow();
    expect(() => validateSourceUrl("http://172.32.0.1")).not.toThrow();
  });

  it("rejects private 192.168.x.x range", () => {
    expect(() => validateSourceUrl("http://192.168.1.1")).toThrow("private/reserved IP");
  });

  it("rejects decimal IP for loopback (2130706433 = 127.0.0.1)", () => {
    expect(() => validateSourceUrl("http://2130706433")).toThrow("private/reserved IP");
  });

  it("rejects hex IP for loopback (0x7f000001 = 127.0.0.1)", () => {
    expect(() => validateSourceUrl("http://0x7f000001")).toThrow("private/reserved IP");
  });

  it("rejects IPv4-mapped IPv6 (::ffff:127.0.0.1)", () => {
    expect(() => validateSourceUrl("http://[::ffff:127.0.0.1]")).toThrow("private/reserved IP");
  });

  it("rejects IPv6 loopback (::1)", () => {
    expect(() => validateSourceUrl("http://[::1]")).toThrow("private/reserved IP");
  });

  it("rejects IPv6 unique-local (fc00::)", () => {
    expect(() => validateSourceUrl("http://[fc00::1]")).toThrow("private/reserved IP");
    expect(() => validateSourceUrl("http://[fd00::1]")).toThrow("private/reserved IP");
  });

  it("rejects IPv6 link-local (fe80::)", () => {
    expect(() => validateSourceUrl("http://[fe80::1]")).toThrow("private/reserved IP");
  });
});

describe("buildUrlVariantCandidates", () => {
  it("builds protocol and host fallback variants", () => {
    expect(buildUrlVariantCandidates("https://dch4.org/")).toEqual([
      "https://dch4.org",
      "https://www.dch4.org",
      "http://dch4.org",
      "http://www.dch4.org",
    ]);
  });

  it("dedupes variants when input already uses www", () => {
    expect(buildUrlVariantCandidates("http://www.example.com/")).toEqual([
      "http://www.example.com",
      "http://example.com",
      "https://www.example.com",
      "https://example.com",
    ]);
  });

  it("returns normalized input when URL is malformed", () => {
    expect(buildUrlVariantCandidates("not a valid url/")).toEqual(["not a valid url"]);
  });
});
