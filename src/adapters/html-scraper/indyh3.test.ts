import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { parseIndyDate, parseIndyTime, parseIndyCard } from "./indyh3";

describe("parseIndyDate", () => {
  it("parses a full human date", () => {
    expect(parseIndyDate("Friday, April 10, 2026")).toBe("2026-04-10");
  });
  it("handles no leading day-of-week", () => {
    expect(parseIndyDate("April 10, 2026")).toBe("2026-04-10");
  });
  it("returns null on unparseable input", () => {
    expect(parseIndyDate("next friday")).toBeNull();
  });
});

describe("parseIndyTime", () => {
  it("parses 12-hour PM", () => {
    expect(parseIndyTime("5:00 PM")).toBe("17:00");
  });
  it("parses noon correctly", () => {
    expect(parseIndyTime("12:00 PM")).toBe("12:00");
  });
  it("parses midnight correctly", () => {
    expect(parseIndyTime("12:00 AM")).toBe("00:00");
  });
  it("handles missing minutes", () => {
    expect(parseIndyTime("7 PM")).toBe("19:00");
  });
});

describe("parseIndyCard", () => {
  const sampleHtml = `
    <div class="ht-upcoming-card">
      <h3>Hash #1119: IndyScent Prom - Spy vs Spy 2026 - Initial Contact</h3>
      <div><strong>📅 Date:</strong> Friday, April 10, 2026</div>
      <div><strong>⏰ Time:</strong> 5:00 PM</div>
      <div><strong>🐇 Hares:</strong> <em>TBD</em></div>
      <div>
        <a href="https://indyhhh.com/hashes/hash-1119-indy-prom-pre-lube/">View Full Details</a>
      </div>
    </div>
    <div class="ht-upcoming-card">
      <h3>Hash #1122: Untrimmed Bush THICC Moon Trail</h3>
      <div><strong>📅 Date:</strong> Friday, April 17, 2026</div>
      <div><strong>⏰ Time:</strong> 7:00 PM</div>
      <div><strong>🐇 Hares:</strong> Shaggy</div>
    </div>
  `;

  it("parses a complete card", () => {
    const $ = cheerio.load(sampleHtml);
    const event = parseIndyCard(
      $(".ht-upcoming-card").first() as cheerio.Cheerio<never>,
      $,
      [],
      "indyh3",
      "https://indyhhh.com",
    );
    expect(event).toMatchObject({
      date: "2026-04-10",
      startTime: "17:00",
      kennelTags: ["indyh3"],
      runNumber: 1119,
      title: "IndyScent Prom - Spy vs Spy 2026 - Initial Contact",
      sourceUrl: "https://indyhhh.com/hashes/hash-1119-indy-prom-pre-lube/",
    });
    expect(event?.hares).toBeUndefined(); // TBD → stripPlaceholder
  });

  it("routes THICC events via kennelPatterns", () => {
    const $ = cheerio.load(sampleHtml);
    const event = parseIndyCard(
      $(".ht-upcoming-card").eq(1) as cheerio.Cheerio<never>,
      $,
      [[/THICC/i, "thicch3"]],
      "indyh3",
      "https://indyhhh.com",
    );
    expect(event?.kennelTags[0]).toBe("thicch3");
    expect(event?.runNumber).toBe(1122);
    expect(event?.hares).toBe("Shaggy");
  });

  it("#752: preserves multi-hare comma-separated string", () => {
    const html = `
      <div class="ht-upcoming-card">
        <h3>Hash #1122: Untrimmed Bush THICC Moon Trail</h3>
        <div><strong>📅 Date:</strong> Friday, April 17, 2026</div>
        <div><strong>⏰ Time:</strong> 7:00 PM</div>
        <div><strong>🐇 Hares:</strong> Never Comes, Did We Fuck?</div>
      </div>
    `;
    const $ = cheerio.load(html);
    const event = parseIndyCard(
      $(".ht-upcoming-card").first() as cheerio.Cheerio<never>,
      $,
      [[/THICC/i, "thicch3"]],
      "indyh3",
      "https://indyhhh.com",
    );
    expect(event?.hares).toBe("Never Comes, Did We Fuck?");
  });

  it("returns null when date is missing", () => {
    const html = `
      <div class="ht-upcoming-card">
        <h3>Hash #999: No Date</h3>
        <div><strong>⏰ Time:</strong> 7:00 PM</div>
      </div>
    `;
    const $ = cheerio.load(html);
    const event = parseIndyCard(
      $(".ht-upcoming-card").first() as cheerio.Cheerio<never>,
      $,
      [],
      "indyh3",
      "https://indyhhh.com",
    );
    expect(event).toBeNull();
  });
});
