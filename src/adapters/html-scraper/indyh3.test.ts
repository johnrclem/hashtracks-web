import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { parseIndyDate, parseIndyTime, parseIndyCard, parseIndyDetail } from "./indyh3";

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

  // ── #1352: bare "THICC Moon" title (no surrounding descriptor) must emit + route ──
  it("(#1352) parses bare 'THICC Moon' cards (issue body shape) and routes to thicch3", () => {
    // Three cards mirroring runs #1125, #1128, #1134 from the issue body.
    const html = `
      <div class="ht-upcoming-card">
        <h3>Hash #1125: THICC Moon</h3>
        <div><strong>📅 Date:</strong> Sunday, May 17, 2026</div>
        <div><strong>⏰ Time:</strong> 7:00 PM</div>
        <div><strong>🐇 Hares:</strong> NEEEEERRRRRD! / Sheiße Superveiße</div>
        <a href="https://indyhhh.com/hashes/hash-1125-thicc-moon/">View</a>
      </div>
      <div class="ht-upcoming-card">
        <h3>Hash #1128: THICC Moon</h3>
        <div><strong>📅 Date:</strong> Monday, June 15, 2026</div>
        <div><strong>⏰ Time:</strong> 7:00 PM</div>
        <div><strong>🐇 Hares:</strong> Someone</div>
        <a href="https://indyhhh.com/hashes/hash-1128-thicc-moon/">View</a>
      </div>
      <div class="ht-upcoming-card">
        <h3>Hash #1134: THICC Moon</h3>
        <div><strong>📅 Date:</strong> Tuesday, July 14, 2026</div>
        <div><strong>⏰ Time:</strong> 7:00 PM</div>
        <div><strong>🐇 Hares:</strong> Another</div>
        <a href="https://indyhhh.com/hashes/hash-1134-thicc-moon/">View</a>
      </div>
    `;
    const $ = cheerio.load(html);
    const cards = $(".ht-upcoming-card").toArray();
    expect(cards).toHaveLength(3);
    const events = cards.map((el) =>
      parseIndyCard(
        $(el) as cheerio.Cheerio<never>,
        $,
        [[/THICC/i, "thicch3"]],
        "indyh3",
        "https://indyhhh.com",
      ),
    );
    expect(events.every((e) => e !== null)).toBe(true);
    expect(events.map((e) => e!.runNumber)).toEqual([1125, 1128, 1134]);
    expect(events.every((e) => e!.kennelTags[0] === "thicch3")).toBe(true);
    expect(events.map((e) => e!.title)).toEqual(["THICC Moon", "THICC Moon", "THICC Moon"]);
    expect(events.map((e) => e!.date)).toEqual(["2026-05-17", "2026-06-15", "2026-07-14"]);
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

describe("parseIndyDetail", () => {
  // Mirrors the live indyhhh.com /hashes/<slug>/ page (verified 2026-05-10):
  // a heading section repeats `<strong>Start Location:</strong>` with no value,
  // and the body block carries the real value before a `<br>`.
  const sampleDetailHtml = `
    <body>
      <div class="hash-header">
        <strong>Start Location:</strong>
        <link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css" />
      </div>
      <p><span><strong>Start Location:</strong> Gravel lot across from Goose the Market <br class="html-br" /><strong>Trail:</strong> ~3.69mi<br class="html-br" /><strong>Shiggy level:</strong> 0.69</span></p>
    </body>
  `;

  it("extracts Start Location from the body block, ignoring the empty heading repeat", () => {
    const result = parseIndyDetail(sampleDetailHtml);
    expect(result.location).toBe("Gravel lot across from Goose the Market");
  });

  it("returns undefined when no Start Location label appears", () => {
    const result = parseIndyDetail(`<p>Just description text, no labels.</p>`);
    expect(result.location).toBeUndefined();
  });

  it("treats TBD/TBA value as undefined", () => {
    const result = parseIndyDetail(
      `<p><strong>Start Location:</strong> TBD<br /><strong>Trail:</strong> 3mi</p>`,
    );
    expect(result.location).toBeUndefined();
  });

  it("decodes HTML entities in the location value", () => {
    const result = parseIndyDetail(
      `<p><strong>Start Location:</strong> Tom &amp; Jerry&#8217;s Pub <br /><strong>Trail:</strong> 3mi</p>`,
    );
    expect(result.location).toBe("Tom & Jerry’s Pub");
  });

  it("falls back to <strong>Where?</strong> for upcoming events", () => {
    // Pre-posted upcoming events have an empty Start Location heading and
    // publish the venue under a Where? label in the description body.
    const html = `
      <div class="hash-header"><strong>Start Location:</strong></div>
      <div><strong>What?</strong> HAH Hash 2026</div>
      <div><strong>Where?</strong> Leonard Park – Speedway, Indiana</div>
    `;
    const result = parseIndyDetail(html);
    expect(result.location).toBe("Leonard Park – Speedway, Indiana");
  });

  it("prefers Start Location over Where? when both have values", () => {
    const html = `
      <p><strong>Where?</strong> Old fallback</p>
      <p><strong>Start Location:</strong> Canonical address</p>
    `;
    const result = parseIndyDetail(html);
    expect(result.location).toBe("Canonical address");
  });
});
