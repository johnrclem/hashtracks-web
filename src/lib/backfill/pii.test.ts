import { describe, it, expect } from "vitest";
import { scanArchiveForPii, summarizePiiHits } from "./pii";

const scan = (value: unknown) => scanArchiveForPii([{ date: "2020-01-01", kennelTags: ["k"], hares: value }]);
const patterns = (value: unknown) => scan(value).map((h) => h.pattern);

describe("PII scanner (G8)", () => {
  it.each([
    ["dashed NA", "Call 555-123-4567", "na"],
    ["spaced NA", "555 123 4567", "na"],
    ["dotted NA", "555.123.4567", "na"],
    ["parenthesised NA", "(555)123-4567", "na-paren"],
    ["bare 10 digits", "5551234567", "bare-10"],
    ["7-digit local", "phone 286-0444 for directions", "local-7"],
    ["international", "+385 91 234 5678", "intl"],
    ["Croatian mobile", "091 234 5678", "eu-mobile"],
    ["slashed mobile", "098/123-4567", "eu-mobile"],
    ["email", "hare@example.com", "email"],
    ["email (at)", "flush_pe (at) yahoo.com", "email-at-word"],
    ["email [at] [dot]", "name [at] domain [dot] org", "email-at-word"],
  ])("catches a %s", (_label, text, pattern) => {
    expect(patterns(text)).toContain(pattern);
  });

  it.each([
    ["a run number", "Run #2059"],
    ["a date", "2014-10-04"],
    ["a dotted date", "04.10.2014"],
    ["a year range", "1998-2004"],
    ["driving directions with @", "Turn right at Expy@1.3 mi"],
    ["a Maps coordinate", "https://www.google.com/maps/place/37.647889+126.914607"],
    ["a blog date path", "https://x.blogspot.com/2026/09/1274-25th-anniversary.html"],
    ["a time", "11:00"],
  ])("ignores %s", (_label, text) => {
    expect(patterns(text)).toEqual([]);
  });

  it("checks every match, so an excused date doesn't hide a later number", () => {
    expect(patterns("04.10.2014, hare 098/123-456")).toContain("eu-mobile");
  });

  it("scans URL fields again after percent-decoding, and nested fields", () => {
    const hits = scanArchiveForPii([
      { date: "2020-01-01", kennelTags: ["k"], locationUrl: "https://maps.example/?q=Call%20555-123-4567" },
      { date: "2020-01-02", kennelTags: ["k"], externalLinks: [{ url: "mailto:hare%40example.com", label: "x" }] },
    ]);
    expect(hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 0, field: "locationUrl", pattern: "na" }),
        expect.objectContaining({ row: 1, field: "externalLinks.0.url", pattern: "email", decoded: true }),
      ]),
    );
  });

  it("reports row, field and pattern, never the matched text", () => {
    const [hit] = scan("hare@example.com");
    expect(hit).toEqual({ row: 0, field: "hares", pattern: "email", decoded: false });
    expect(JSON.stringify(scan("hare@example.com"))).not.toContain("example.com");
    expect(summarizePiiHits(scan("a@b.co 555-123-4567"))).toEqual({ email: 1, na: 1 });
  });
});
