import * as dnsPromises from "node:dns/promises";
import {
  MONTHS,
  MONTHS_ZERO,
  parse12HourTime,
  parsePublishDate,
  googleMapsSearchUrl,
  extractUkPostcode,
  validateSourceConfig,
  decodeEntities,
  stripHtmlTags,
  buildUrlVariantCandidates,
  validateSourceUrl,
  chronoParseDate,
  isPlaceholder,
  stripPlaceholder,
  bumpYearIfBefore,
  extractAddressWithAi,
  stripNonEnglishCountry,
  applyWeekdayShift,
  hasPlaceholderRunNumber,
  extractHashRunNumber,
} from "./utils";
import { validateSourceUrlWithDns } from "./ssrf-dns";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));
const mockLookup = vi.mocked(dnsPromises.lookup);

vi.mock("@/lib/ai/gemini", () => ({
  callGemini: vi.fn(),
}));

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

describe("parsePublishDate", () => {
  // Pins the contract for the shared helper that replaced the broken
  // per-adapter `utcRef` (which appended "Z" unconditionally and produced
  // Invalid Date on offset-bearing inputs). The bug shipped in three
  // adapters (CRH3, CAH3, BKK Harriettes) before being caught.

  it("parses ISO with timezone offset (Blogger / WordPress.com format)", () => {
    const d = parsePublishDate("2026-03-22T18:07:00+07:00");
    expect(d).toBeInstanceOf(Date);
    expect(d!.toISOString()).toBe("2026-03-22T11:07:00.000Z");
  });

  it("parses ISO with explicit Z suffix", () => {
    const d = parsePublishDate("2026-03-22T18:07:00Z");
    expect(d!.toISOString()).toBe("2026-03-22T18:07:00.000Z");
  });

  it("parses ISO without offset (treats as local then UTC by JS spec)", () => {
    // Date-only ISO is treated as UTC midnight by the spec.
    const d = parsePublishDate("2026-03-22");
    expect(d!.toISOString()).toBe("2026-03-22T00:00:00.000Z");
  });

  it("returns undefined for undefined input", () => {
    expect(parsePublishDate(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parsePublishDate("")).toBeUndefined();
  });

  it("returns undefined for unparseable input (regression for old utcRef)", () => {
    // The old utcRef helper produced this exact value when given an
    // offset-bearing input (it appended "Z" → "2026-03-22T18:07:00+07:00Z"
    // → Invalid Date). Confirms the new helper does not silently propagate
    // an Invalid Date to callers.
    expect(parsePublishDate("2026-03-22T18:07:00+07:00Z")).toBeUndefined();
    expect(parsePublishDate("not a date")).toBeUndefined();
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

  it("normalizes overflow minutes: 1:69 PM → 14:09", () => {
    expect(parse12HourTime("1:69 PM")).toBe("14:09");
  });

  it("normalizes overflow minutes: 12:69 PM → 13:09", () => {
    expect(parse12HourTime("12:69 PM")).toBe("13:09");
  });

  it("normalizes overflow minutes: 6:69 pm → 19:09", () => {
    expect(parse12HourTime("6:69 pm")).toBe("19:09");
  });

  it("normalizes overflow minutes: 5:69 PM → 18:09", () => {
    expect(parse12HourTime("5:69 PM")).toBe("18:09");
  });

  it("leaves normal minutes unchanged: 2:30 pm → 14:30", () => {
    expect(parse12HourTime("2:30 pm")).toBe("14:30");
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

  it("preserves block-level boundaries as newlines when separator is \\n", () => {
    expect(stripHtmlTags("<p>line1</p><p>line2</p>", "\n")).toBe("line1\nline2");
    expect(stripHtmlTags("<div>a</div><div>b</div>", "\n")).toBe("a\nb");
    expect(stripHtmlTags("<ul><li>a</li><li>b</li></ul>", "\n")).toBe("a\nb");
  });

  it("handles mixed <br> and block-level tags", () => {
    expect(stripHtmlTags("a<br>b</p>c", "\n")).toBe("a\nb\nc");
  });

  it("preserves block boundaries for headings and blockquote", () => {
    expect(stripHtmlTags("<h1>Title</h1><p>body</p>", "\n")).toBe("Title\nbody");
    expect(stripHtmlTags("<blockquote>quote</blockquote>text", "\n")).toBe("quote\ntext");
  });

  it("flattens block-level tags to spaces with default replacement", () => {
    expect(stripHtmlTags("<div>a</div><div>b</div>")).toBe("a b");
  });

  it("handles SHITH3 </div> separated content with \\n replacement", () => {
    const input =
      'mystery hare!\nStart behind "LEE GIMBAP"</div>\n\nPre-lube walkable...CHUY\'S\n11219 Lee Hwy</div>\n\nShiggy level HIGH...</div>';
    const result = stripHtmlTags(input, "\n");
    expect(result).toBe(
      "mystery hare!\nStart behind \"LEE GIMBAP\"\n\n\nPre-lube walkable...CHUY'S\n11219 Lee Hwy\n\n\nShiggy level HIGH...",
    );
  });
});


describe("validateSourceUrl", () => {
  it("accepts valid HTTPS URLs", () => {
    expect(() => validateSourceUrl("https://hashnyc.com")).not.toThrow();
    expect(() => validateSourceUrl("https://www.example.com/path")).not.toThrow();
  });

  it("accepts valid HTTPS URLs", () => {
    expect(() => validateSourceUrl("https://hashnyc.com")).not.toThrow();
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

  it("blocks octal-notation IPv4 (e.g. 0177.0.0.1 = 127.0.0.1)", () => {
    // Node's URL parser normalizes `0177.0.0.1` to `127.0.0.1` before the
    // hostname reaches our validator, so it ends up in the private-IPv4
    // branch. The important invariant is that the URL is blocked.
    expect(() => validateSourceUrl("http://0177.0.0.1")).toThrow(/private\/reserved IP/);
  });

  it("blocks integer-form IPv4 (2130706433 = 127.0.0.1)", () => {
    expect(() => validateSourceUrl("http://2130706433")).toThrow(/private\/reserved IP/);
  });

  it("rejects malformed dotted-quad (octet > 255)", () => {
    // Node's URL parser rejects `1234.0.0.1` outright.
    expect(() => validateSourceUrl("http://1234.0.0.1")).toThrow();
  });

  it("accepts normal dotted-quad with single-zero octets", () => {
    expect(() => validateSourceUrl("http://192.0.2.1")).not.toThrow();
    expect(() => validateSourceUrl("http://203.0.113.5")).not.toThrow();
  });
});

describe("validateSourceUrlWithDns", () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it("passes through when all resolved IPs are public", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
    ] as never);
    await expect(
      validateSourceUrlWithDns("https://example.com"),
    ).resolves.toBeUndefined();
    expect(mockLookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it.each([
    ["IPv4 private range", [{ address: "10.0.0.1", family: 4 }]],
    ["loopback", [{ address: "127.0.0.1", family: 4 }]],
    ["AWS/GCP metadata IP", [{ address: "169.254.169.254", family: 4 }]],
    ["IPv4-mapped IPv6 loopback", [{ address: "::ffff:127.0.0.1", family: 6 }]],
    ["IPv6 unique-local address", [{ address: "fd00::1", family: 6 }]],
    [
      "any private IP in a multi-record response",
      [
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ],
    ],
  ])(
    "rejects when DNS resolves to %s",
    async (_label, addresses) => {
      mockLookup.mockResolvedValueOnce(addresses as never);
      await expect(
        validateSourceUrlWithDns("https://resolver-test.example"),
      ).rejects.toThrow("DNS resolved to private/reserved IP");
    },
  );

  it("skips DNS lookup when the hostname is already a literal IP", async () => {
    // Sync check blocks private IP literals directly — no lookup should happen.
    await expect(
      validateSourceUrlWithDns("http://10.0.0.1"),
    ).rejects.toThrow("private/reserved IP");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("propagates the sync check rejection before lookup", async () => {
    await expect(
      validateSourceUrlWithDns("ftp://example.com"),
    ).rejects.toThrow("non-HTTP protocol");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects when DNS lookup itself fails", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(
      validateSourceUrlWithDns("https://nonexistent.example"),
    ).rejects.toThrow("DNS resolution failed");
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

describe("isPlaceholder", () => {
  it.each(["tbd", "TBD", "tba", "TBA", "tbc", "TBC", "n/a", "N/A", "?", "??", "needed", "Needed", "NEEDED", "required", "Required", "REQUIRED", "registration", "Registration", "REGISTRATION", "Sign up!", "sign up", "signup", "Sign-up", "SIGNUP", "Volunteer", "volunteer"])(
    "returns true for '%s'",
    (val) => {
      expect(isPlaceholder(val)).toBe(true);
    },
  );

  it("trims whitespace before matching", () => {
    expect(isPlaceholder("  TBD  ")).toBe(true);
    expect(isPlaceholder(" tba ")).toBe(true);
  });

  it.each(["Real Title", "TBD - check back", "Location TBD", "hash run", "123", "Hare required please"])(
    "returns false for '%s'",
    (val) => {
      expect(isPlaceholder(val)).toBe(false);
    },
  );
});

describe("stripPlaceholder", () => {
  it.each(["tbd", "TBA", "tbc", "N/A", "?", "??", "needed", "required"])(
    "returns undefined for placeholder '%s'",
    (val) => {
      expect(stripPlaceholder(val)).toBeUndefined();
    },
  );

  it("returns undefined for null/undefined/empty", () => {
    expect(stripPlaceholder(null)).toBeUndefined();
    expect(stripPlaceholder(undefined)).toBeUndefined();
    expect(stripPlaceholder("")).toBeUndefined();
    expect(stripPlaceholder("   ")).toBeUndefined();
  });

  it("returns trimmed value for non-placeholders", () => {
    expect(stripPlaceholder("Real Title")).toBe("Real Title");
    expect(stripPlaceholder("  Central Park  ")).toBe("Central Park");
    expect(stripPlaceholder("TBD - check back")).toBe("TBD - check back");
    expect(stripPlaceholder("Location TBD")).toBe("Location TBD");
  });
});

describe("bumpYearIfBefore", () => {
  it("returns input unchanged when prevDate is undefined", () => {
    expect(bumpYearIfBefore("2026-05-15", undefined)).toBe("2026-05-15");
  });

  it("returns input unchanged when already after prevDate", () => {
    expect(bumpYearIfBefore("2026-06-01", "2026-05-15")).toBe("2026-06-01");
  });

  it("bumps year forward when date is strictly before prevDate", () => {
    expect(bumpYearIfBefore("2026-01-05", "2026-12-15")).toBe("2027-01-05");
  });

  it("returns same-day duplicates unchanged (typo/duplicate row, not a year roll)", () => {
    expect(bumpYearIfBefore("2026-05-15", "2026-05-15")).toBe("2026-05-15");
  });

  it("loops to clear a multi-year wrap defensively", () => {
    expect(bumpYearIfBefore("2024-01-05", "2026-12-15")).toBe("2027-01-05");
  });

  it("clamps Feb 29 → Feb 28 when bumping into a non-leap year", () => {
    // 2024-02-29 is valid; bump targets 2025 (non-leap) so Feb 28 is the
    // safe substitute. Without clamping, `new Date("2025-02-29T12:00:00Z")`
    // silently rolls to March 1.
    expect(bumpYearIfBefore("2024-02-29", "2024-12-31")).toBe("2025-02-28");
  });

  it("preserves Feb 29 when bumping into a leap year", () => {
    // 2024 → 2028 is a leap year, so the day stays.
    expect(bumpYearIfBefore("2024-02-29", "2027-12-31")).toBe("2028-02-29");
  });
});

describe("chronoParseDate", () => {
  // UK formats (en-GB)
  it("parses UK ordinal date: '18th March 2026'", () => {
    expect(chronoParseDate("18th March 2026", "en-GB")).toBe("2026-03-18");
  });

  it("parses UK verbose: 'Saturday 21st of February 2026'", () => {
    expect(chronoParseDate("Saturday 21st of February 2026", "en-GB")).toBe("2026-02-21");
  });

  it("parses UK numeric DD/MM/YYYY: '21/02/2026'", () => {
    expect(chronoParseDate("21/02/2026", "en-GB")).toBe("2026-02-21");
  });

  it("parses UK ordinal without year and uses reference year", () => {
    const ref = new Date(Date.UTC(2026, 5, 15)); // mid-2026
    expect(chronoParseDate("25 February", "en-GB", ref)).toBe("2026-02-25");
  });

  // US formats (en-US)
  it("parses US Month-Day-Year: 'March 14, 2026'", () => {
    expect(chronoParseDate("March 14, 2026", "en-US")).toBe("2026-03-14");
  });

  it("parses US Month-Day-Year with ordinal: 'January 29th, 2026'", () => {
    expect(chronoParseDate("January 29th, 2026", "en-US")).toBe("2026-01-29");
  });

  it("parses ISO 8601 datetime prefix", () => {
    expect(chronoParseDate("2026-02-15T14:00:00-06:00")).toBe("2026-02-15");
  });

  // Locale disambiguation
  it("interprets 03/04/2026 as March 4 with en-US", () => {
    expect(chronoParseDate("03/04/2026", "en-US")).toBe("2026-03-04");
  });

  it("interprets 03/04/2026 as April 3 with en-GB", () => {
    expect(chronoParseDate("03/04/2026", "en-GB")).toBe("2026-04-03");
  });

  // Invalid inputs
  it("returns null for empty string", () => {
    expect(chronoParseDate("")).toBeNull();
  });

  it("returns null for nonsense text", () => {
    expect(chronoParseDate("no date here at all")).toBeNull();
  });

  // Year-less with forwardDate option
  it("infers future year for past month with forwardDate option", () => {
    const ref = new Date(Date.UTC(2026, 11, 15)); // Dec 15, 2026
    expect(chronoParseDate("5th January", "en-GB", ref, { forwardDate: true })).toBe("2027-01-05");
  });

  it("uses reference year without forwardDate option", () => {
    const ref = new Date(Date.UTC(2026, 5, 15)); // June 15, 2026
    expect(chronoParseDate("5th March", "en-GB", ref)).toBe("2026-03-05");
  });

  // M/D/YYYY format (US)
  it("parses US numeric M/D/YYYY: '2/12/2026'", () => {
    expect(chronoParseDate("2/12/2026", "en-US")).toBe("2026-02-12");
  });

  // Date with day-of-week prefix
  it("parses 'Thursday, 2/12/2026' (en-US)", () => {
    expect(chronoParseDate("Thursday, 2/12/2026", "en-US")).toBe("2026-02-12");
  });

  // Abbreviated month names
  it("parses abbreviated month: 'Dec 25 2025'", () => {
    expect(chronoParseDate("Dec 25 2025", "en-US")).toBe("2025-12-25");
  });

  it("parses abbreviated month with ordinal: 'Feb 19th'", () => {
    const ref = new Date(Date.UTC(2026, 0, 1)); // Jan 1, 2026
    expect(chronoParseDate("Feb 19th", "en-US", ref)).toBe("2026-02-19");
  });

  // Hyphenated M-D format (Cape Fear H3 pattern)
  it("parses hyphenated M-D: '3-7' as March 7", () => {
    const ref = new Date(Date.UTC(2026, 0, 1, 12));
    expect(chronoParseDate("3-7", "en-US", ref)).toBe("2026-03-07");
  });

  it("parses hyphenated M-DD: '4-18' as April 18", () => {
    const ref = new Date(Date.UTC(2026, 0, 1, 12));
    expect(chronoParseDate("4-18", "en-US", ref)).toBe("2026-04-18");
  });

  it("parses hyphenated MM-DD: '10-31' as October 31", () => {
    // Without forwardDate, chrono implies the most recent past October
    const ref = new Date(Date.UTC(2026, 0, 1, 12));
    expect(chronoParseDate("10-31", "en-US", ref)).toBe("2025-10-31");
  });

  it("parses hyphenated MM-DD with forwardDate: '10-31' as October 31 of current year", () => {
    const ref = new Date(Date.UTC(2026, 0, 1, 12));
    expect(chronoParseDate("10-31", "en-US", ref, { forwardDate: true })).toBe("2026-10-31");
  });

  it("parses hyphenated M-D with trailing text: '10-31: 5th Saturday Social HALLOWEEN'", () => {
    const ref = new Date(Date.UTC(2026, 0, 1, 12));
    expect(chronoParseDate("10-31: 5th Saturday Social HALLOWEEN", "en-US", ref, { forwardDate: true })).toBe("2026-10-31");
  });

  it("parses hyphenated M-D with forwardDate", () => {
    const ref = new Date(Date.UTC(2026, 11, 15, 12));
    expect(chronoParseDate("3-7", "en-US", ref, { forwardDate: true })).toBe("2027-03-07");
  });

  it("does not apply hyphen fallback to M-D-YY patterns like '3-7-26'", () => {
    // Chrono natively parses M-D-YY; the negative lookahead must not interfere
    expect(chronoParseDate("3-7-26", "en-US")).toBe("2026-03-07");
  });

  // ── "D[D] MMM YY[YY]" fast-path (chrono-node bug workaround) ──
  // chrono mis-parses single-digit-day variants of this format: "5 May 26"
  // becomes 2026-05-26 (interpreting the year fragment as the day) instead of
  // 2026-05-05. We pre-parse the unambiguous DDMonYY shape before chrono.
  // Bug surfaced in Ladies H4 HK where rows like "5 May 26" / "2 Jun 26" /
  // "7 Jul 26" all landed on the 26th of their month.

  it("parses single-digit-day '5 May 26' as 2026-05-05 (not chrono's 2026-05-26)", () => {
    expect(chronoParseDate("5 May 26", "en-GB")).toBe("2026-05-05");
  });

  it("parses single-digit-day '2 Jun 26' as 2026-06-02", () => {
    expect(chronoParseDate("2 Jun 26", "en-GB")).toBe("2026-06-02");
  });

  it("parses single-digit-day '7 Jul 26' as 2026-07-07", () => {
    expect(chronoParseDate("7 Jul 26", "en-GB")).toBe("2026-07-07");
  });

  it("still parses two-digit-day '28 Apr 26' as 2026-04-28", () => {
    expect(chronoParseDate("28 Apr 26", "en-GB")).toBe("2026-04-28");
  });

  it("parses hyphenated D-Mon-YY '5-May-26' as 2026-05-05", () => {
    expect(chronoParseDate("5-May-26", "en-GB")).toBe("2026-05-05");
  });

  it("parses 4-digit year 'D MMM YYYY': '5 May 2026'", () => {
    expect(chronoParseDate("5 May 2026", "en-GB")).toBe("2026-05-05");
  });

  it("parses 2-digit year boundary 49 → 2049", () => {
    expect(chronoParseDate("5 May 49", "en-GB")).toBe("2049-05-05");
  });

  it("parses 2-digit year boundary 50 → 1950", () => {
    expect(chronoParseDate("5 May 50", "en-GB")).toBe("1950-05-05");
  });

  it("rejects impossible D MMM YY '31 Apr 26'", () => {
    // Apr has 30 days — fast-path returns null and chrono fallback also rejects
    expect(chronoParseDate("31 Apr 26", "en-GB")).toBeNull();
  });

  it("rejects unknown month abbreviation 'D Xyz YY'", () => {
    // Fast-path rejects; chrono fallback returns null too because Xyz isn't a month
    expect(chronoParseDate("5 Xyz 26", "en-GB")).toBeNull();
  });

  it("does not fast-path 3-digit year tokens (year-226 AD would be absurd)", () => {
    // The fast-path regex requires exactly 2 OR 4 digits, so "5 May 226"
    // falls through to chrono. chrono parses the "5 May" prefix and infers
    // a sensible current-year date, NOT a literal "226-05-05" the old
    // permissive `\d{2,4}` quantifier would have produced.
    const result = chronoParseDate("5 May 226", "en-GB");
    expect(result).toMatch(/^20\d{2}-05-05$/);
  });
});

describe("extractAddressWithAi", () => {
  it("extracts address from paragraph text", async () => {
    const { callGemini } = await import("@/lib/ai/gemini");
    vi.mocked(callGemini).mockResolvedValueOnce({
      text: '{"address": "The Pub, 42 High Street, SW1A 1AA"}',
    } as never);

    const result = await extractAddressWithAi(
      "Long paragraph text with The Pub at 42 High Street SW1A 1AA and more details about the event...",
    );
    expect(result).toBe("The Pub, 42 High Street, SW1A 1AA");
  });

  it("returns null on API error", async () => {
    const { callGemini } = await import("@/lib/ai/gemini");
    vi.mocked(callGemini).mockRejectedValueOnce(new Error("API error"));

    const result = await extractAddressWithAi(
      "Some text that is long enough for processing by AI extraction logic",
    );
    expect(result).toBeNull();
  });

  it("returns null for short text (< 20 chars)", async () => {
    const result = await extractAddressWithAi("Short");
    expect(result).toBeNull();
  });

  it("returns null when Gemini returns no address", async () => {
    const { callGemini } = await import("@/lib/ai/gemini");
    vi.mocked(callGemini).mockResolvedValueOnce({
      text: '{"address": null}',
    } as never);

    const result = await extractAddressWithAi(
      "A long paragraph with no actual address information in it at all whatsoever",
    );
    expect(result).toBeNull();
  });
});

// ── stripNonEnglishCountry ──

describe("stripNonEnglishCountry", () => {
  it("strips French 'États-Unis' suffix", () => {
    expect(stripNonEnglishCountry("Rochester, NY 14609, États-Unis")).toBe("Rochester, NY 14609");
  });

  it("strips German 'Vereinigte Staaten' suffix", () => {
    expect(stripNonEnglishCountry("123 Main St, Springfield, IL, Vereinigte Staaten")).toBe("123 Main St, Springfield, IL");
  });

  it("strips Spanish 'Estados Unidos' suffix", () => {
    expect(stripNonEnglishCountry("Miami, FL, Estados Unidos")).toBe("Miami, FL");
  });

  it("strips 'Etats-Unis' (no accent) suffix", () => {
    expect(stripNonEnglishCountry("Boston, MA, Etats-Unis")).toBe("Boston, MA");
  });

  it("does not modify English locations", () => {
    expect(stripNonEnglishCountry("Rochester, NY 14609, USA")).toBe("Rochester, NY 14609, USA");
  });

  it("does not modify locations without country suffix", () => {
    expect(stripNonEnglishCountry("Lucien Morin Park, Rochester, NY")).toBe("Lucien Morin Park, Rochester, NY");
  });
});

// ── applyWeekdayShift ──

describe("applyWeekdayShift", () => {
  // Sanity anchor: 2026-05-01 is a Friday, 2026-05-03 is a Sunday.
  const FRIDAY = "2026-05-01";
  const THURSDAY_BEFORE = "2026-04-30";
  const SUNDAY = "2026-05-03";
  const SATURDAY_BEFORE = "2026-05-02";

  it("shifts Friday → Thursday by −1 day and rewrites startTime", () => {
    const result = applyWeekdayShift(FRIDAY, "00:00", {
      from: "Friday",
      to: "Thursday",
      placeholderTime: "00:00",
      defaultStartTime: "20:00",
    });
    expect(result).toEqual({ date: THURSDAY_BEFORE, startTime: "20:00", shifted: true });
  });

  it("shifts Sunday → Saturday across the week boundary using shortest signed delta", () => {
    const result = applyWeekdayShift(SUNDAY, "10:00", { from: "Sunday", to: "Saturday" });
    expect(result).toEqual({ date: SATURDAY_BEFORE, startTime: "10:00", shifted: true });
  });

  it("accepts RFC 5545 abbreviations interchangeably with full names", () => {
    const a = applyWeekdayShift(FRIDAY, "00:00", { from: "FR", to: "TH" });
    const b = applyWeekdayShift(FRIDAY, "00:00", { from: "Friday", to: "Thursday" });
    expect(a.date).toBe(b.date);
    expect(a.shifted).toBe(true);
  });

  it("leaves event unchanged when source weekday differs from `from`", () => {
    // 2026-05-02 is a Saturday — does not match `from: Friday`.
    const result = applyWeekdayShift("2026-05-02", "00:00", {
      from: "Friday",
      to: "Thursday",
      defaultStartTime: "20:00",
    });
    expect(result).toEqual({ date: "2026-05-02", startTime: "00:00", shifted: false });
  });

  it("leaves event unchanged when placeholderTime is set and startTime mismatches", () => {
    const result = applyWeekdayShift(FRIDAY, "19:00", {
      from: "Friday",
      to: "Thursday",
      placeholderTime: "00:00",
      defaultStartTime: "20:00",
    });
    expect(result).toEqual({ date: FRIDAY, startTime: "19:00", shifted: false });
  });

  it("shifts when placeholderTime is absent (always-shift mode)", () => {
    const result = applyWeekdayShift(FRIDAY, "19:00", { from: "Friday", to: "Thursday" });
    expect(result).toEqual({ date: THURSDAY_BEFORE, startTime: "19:00", shifted: true });
  });

  it("preserves original startTime when defaultStartTime is absent", () => {
    const result = applyWeekdayShift(FRIDAY, "19:00", {
      from: "Friday",
      to: "Thursday",
      placeholderTime: "19:00",
    });
    expect(result.shifted).toBe(true);
    expect(result.startTime).toBe("19:00");
  });

  it("shifts even when startTime is undefined and placeholderTime is unset", () => {
    const result = applyWeekdayShift(FRIDAY, undefined, { from: "Friday", to: "Thursday" });
    expect(result).toEqual({ date: THURSDAY_BEFORE, startTime: undefined, shifted: true });
  });

  it("does not shift when startTime is undefined and placeholderTime is set", () => {
    // placeholderTime gate requires an exact string match, and undefined !== "00:00".
    const result = applyWeekdayShift(FRIDAY, undefined, {
      from: "Friday",
      to: "Thursday",
      placeholderTime: "00:00",
    });
    expect(result.shifted).toBe(false);
  });

  it("returns shifted: false when from and to are the same weekday (no-op)", () => {
    const result = applyWeekdayShift(FRIDAY, "00:00", {
      from: "Friday",
      to: "Friday",
      defaultStartTime: "20:00",
    });
    expect(result).toEqual({ date: FRIDAY, startTime: "00:00", shifted: false });
  });

  it("throws on unknown weekday names", () => {
    expect(() => applyWeekdayShift(FRIDAY, "00:00", { from: "Funday", to: "Thursday" })).toThrow(/unknown weekday/);
    expect(() => applyWeekdayShift(FRIDAY, "00:00", { from: "Friday", to: "Xxx" })).toThrow(/unknown weekday/);
  });

  it("throws on malformed date input", () => {
    expect(() => applyWeekdayShift("not-a-date", "00:00", { from: "Friday", to: "Thursday" })).toThrow(/invalid date/);
  });
});

// #1440 — Japanese kennels (Kyoto/Tokyo/Osaka) encode `Run＃132` with the
// fullwidth `＃` (U+FF03). The shared helper must accept both the ASCII and
// fullwidth variants without changing behavior on existing ASCII callers
// (Phoenix HHH, every GCal source).
describe("extractHashRunNumber", () => {
  it.each<[string, string | undefined, number | undefined]>([
    // ASCII baseline (existing callers must not regress)
    ["ASCII basic", "Run #132", 132],
    ["ASCII with space", "FCH3 # 88", 88],
    ["ASCII with trailing colon", "BH3 #2781:", 2781],
    ["ASCII with comma delimiter", "Hash #100, hare needed", 100],
    // Fullwidth ＃ (U+FF03) — Japanese kennels
    ["fullwidth Kyoto", `Run＃132 Sunday June 25th "Bunter's North Side Trail!"`, 132],
    ["fullwidth with space", "＃55 trail", 55],
    ["fullwidth Tokyo style", "Tokyo H3 Run＃2080", 2080],
    // Placeholder forms still rejected (#1147 delimiter guard)
    ["ASCII placeholder X rejected", "Run #30X?", undefined],
    ["fullwidth placeholder X rejected", "Run＃30X?", undefined],
    // No run number present
    ["no hash", "Just a regular run", undefined],
    ["bare digits", "Event 100", undefined],
    ["empty", "", undefined],
    ["undefined", undefined, undefined],
  ])("%s: %j → %p", (_, input, expected) => {
    expect(extractHashRunNumber(input)).toBe(expected);
  });
});

// #1272/#1274/#1275 — placeholder-runNumber detection. Kennel admins use
// `#NN[X|XX|X?|TBD|TBA|?]` to signal "next run, number not yet assigned".
// `extractHashRunNumber` correctly rejects these, but downstream callers
// (the GCal `extractRunNumber`) also need to distinguish "no signal" from
// "explicit placeholder" so the merge pipeline's tri-state can clear stale
// runNumbers from prior scrapes.
describe("hasPlaceholderRunNumber", () => {
  it.each<[string, string | undefined, boolean]>([
    // Houston H4 #1272
    ["#1272 X-suffix double", "H4 Run #25XX— Erections", true],
    // jHav #1274
    ["#1274 X-suffix single", "Open for Hares--Jhav Trail #208X", true],
    // FCH3 #1275
    ["#1275 X-question", "FCH3 #30X?: Frisky Whisk-her and CBD", true],
    // Common variants
    ["TBD suffix", "FCH3 #30TBD", true],
    ["TBA suffix", "Boston #2784 TBA", true],
    ["TBC suffix", "BH3 #2792TBC", true],
    ["question-mark only", "FCH3 #30?", true],
    ["lower-case x", "Run #50x", true],
    ["digit + space before suffix", "Run #100 TBD", true],
    // Digit-free placeholders — kennel admin hasn't typed any digit yet
    // (Gemini + Claude review feedback on PR #1297).
    ["digit-free TBD", "Run #TBD", true],
    ["digit-free question", "Run #?", true],
    ["digit-free X", "Run #X", true],
    // Negative — clean run numbers must not register as placeholders
    ["clean simple", "FCH3 #308: Laporte", false],
    ["clean with delimiter", "BH3 #2781", false],
    ["clean with comma", "Hash #100, hare needed", false],
    ["no run number", "Just a regular run", false],
    ["bare digits", "Event 100", false],
    ["empty", "", false],
    ["undefined", undefined, false],
  ])("%s: %j → %p", (_, input, expected) => {
    expect(hasPlaceholderRunNumber(input)).toBe(expected);
  });
});
