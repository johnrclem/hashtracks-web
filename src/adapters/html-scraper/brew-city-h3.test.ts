import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseDateTime, parseTitle, parseDetails, BrewCityH3Adapter } from "./brew-city-h3";

// Mock browserRender
vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-abc123"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

const SOURCE_URL = "https://www.brewcityh3.com/calendar";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-bch3",
    name: "Brew City H3 Website",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

// ── Unit tests for parse helpers ──

describe("parseDateTime", () => {
  it("parses weekday, date, and PM time", () => {
    const result = parseDateTime("Saturday, April 4, 2026 AT 7 PM");
    expect(result.date).toBe("2026-04-04");
    expect(result.startTime).toBe("19:00");
  });

  it("parses AM time", () => {
    const result = parseDateTime("Sunday, May 10, 2026 AT 11 AM");
    expect(result.date).toBe("2026-05-10");
    expect(result.startTime).toBe("11:00");
  });

  it("returns undefined startTime for midnight (12 AM placeholder)", () => {
    const result = parseDateTime("Friday, April 3, 2026 AT 12 AM");
    expect(result.date).toBe("2026-04-03");
    expect(result.startTime).toBeUndefined();
  });

  it("handles 12 PM correctly", () => {
    const result = parseDateTime("Thursday, June 1, 2026 AT 12 PM");
    expect(result.date).toBe("2026-06-01");
    expect(result.startTime).toBe("12:00");
  });

  it("returns null date for non-matching text", () => {
    const result = parseDateTime("Some random text");
    expect(result.date).toBeNull();
    expect(result.startTime).toBeUndefined();
  });
});

describe("parseTitle", () => {
  it("parses trail number and name", () => {
    const result = parseTitle("BCH3 Trail #359: Moonlit Easter Egg Hunt Hash III");
    expect(result.runNumber).toBe(359);
    expect(result.title).toBe("Moonlit Easter Egg Hunt Hash III");
  });

  it("preserves leading emoji in trail name (#699)", () => {
    const result = parseTitle("BCH3 Trail #363: 🌕 Cinco De Moonio Karto");
    expect(result.runNumber).toBe(363);
    expect(result.title).toBe("🌕 Cinco De Moonio Karto");
  });

  it("parses trail number without name", () => {
    const result = parseTitle("BCH3 Trail #361");
    expect(result.runNumber).toBe(361);
    expect(result.title).toBe("BCH3 Trail #361");
  });

  it("handles title with colon and name", () => {
    const result = parseTitle("BCH3 Trail #361: Beer Mile");
    expect(result.runNumber).toBe(361);
    expect(result.title).toBe("Beer Mile");
  });

  it("handles non-trail titles", () => {
    const result = parseTitle("Easter Hash");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBe("Easter Hash");
  });

  it("handles question mark in title", () => {
    const result = parseTitle("World Circus Day?");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBe("World Circus Day?");
  });
});

describe("parseDetails", () => {
  it("extracts hare, hash cash, and on-out location", () => {
    const text = [
      "\uD83D\uDC30 Hare: Amber Alert",
      "\uD83D\uDC6F\u200D\u2642\uFE0F Theme: Moonlit Easter Egg Hunt Hash III",
      "\uD83D\uDCCF Distance: 4 or 5",
      "\uD83D\uDD1B On-Out: 5880 S Packard Ave, Cudahy, WI 53110",
      "\uD83C\uDF35 Shiggy level: bring a splint",
      "\uD83D\uDC15\u200D\uD83E\uDDBA Dog friendly: No no no",
      "\uD83D\uDEBE Bathroom on trail: Pee into the lake!",
      "\uD83C\uDF7A Booze plan: Wine only trail! No hash cooler.",
      "\uD83D\uDCB5 Hash cash: $8",
    ].join("\n");

    const result = parseDetails(text);
    expect(result.hares).toBe("Amber Alert");
    expect(result.location).toBe("5880 S Packard Ave, Cudahy, WI 53110");
    expect(result.description).toContain("Theme: Moonlit Easter Egg Hunt Hash III");
    expect(result.description).toContain("Distance: 4 or 5");
    expect(result.description).toContain("Hash cash: $8");
  });

  it("skips TBD on-out location", () => {
    const text = "\uD83D\uDD1B On-Out: TBD\n\uD83D\uDCB5 Hash cash: $7";
    const result = parseDetails(text);
    expect(result.location).toBeUndefined();
    expect(result.description).toContain("Hash cash: $7");
  });

  it("skips TBD-only detail fields", () => {
    const text = [
      "\uD83D\uDC30 Hare: Sex Canoe",
      "\uD83C\uDF35 Shiggy level: TBD",
      "\uD83D\uDC15\u200D\uD83E\uDDBA Dog friendly: TBD",
      "\uD83D\uDEBE Bathroom on trail: TBD",
      "\uD83C\uDF7A Booze plan: TBD",
    ].join("\n");

    const result = parseDetails(text);
    expect(result.hares).toBe("Sex Canoe");
    expect(result.description).toBeUndefined();
  });

  it("handles empty text", () => {
    const result = parseDetails("");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.description).toBeUndefined();
  });
});

// ── Integration test with mocked browser render ──

describe("BrewCityH3Adapter", () => {
  const adapter = new BrewCityH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses events from Wix repeater HTML", async () => {
    mockedBrowserRender.mockResolvedValue(buildTestHtml());

    const result = await adapter.fetch(makeSource());
    expect(result.events.length).toBeGreaterThanOrEqual(2);

    // First event: BCH3 Trail #359
    const trail359 = result.events.find(e => e.runNumber === 359);
    expect(trail359).toBeDefined();
    expect(trail359!.date).toBe("2026-04-03");
    expect(trail359!.kennelTag).toBe("bch3");
    expect(trail359!.title).toBe("🌕 Moonlit Easter Egg Hunt Hash III");
    expect(trail359!.hares).toBe("Amber Alert");
    // "Location:" header wins over On-Out abbreviated value (#698)
    expect(trail359!.location).toBe("Dirty Dime Tavern");
    expect(trail359!.description).toContain("Hash cash: $8");

    // Second event: Easter Hash (no trail number)
    const easterHash = result.events.find(e => e.title === "Easter Hash");
    expect(easterHash).toBeDefined();
    expect(easterHash!.date).toBe("2026-04-04");
    expect(easterHash!.startTime).toBe("19:00");
    expect(easterHash!.runNumber).toBeUndefined();
  });

  it("extracts Facebook event links", async () => {
    mockedBrowserRender.mockResolvedValue(buildTestHtml());

    const result = await adapter.fetch(makeSource());
    const trail359 = result.events.find(e => e.runNumber === 359);
    expect(trail359?.externalLinks).toEqual([
      { label: "Facebook Event", url: "https://www.facebook.com/events/901410519416540/" },
    ]);
  });

  it("returns fetch error when browser render fails", async () => {
    mockedBrowserRender.mockRejectedValue(new Error("Browser render service not configured: set BROWSER_RENDER_URL and BROWSER_RENDER_KEY"));

    const result = await adapter.fetch(makeSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles empty repeater gracefully", async () => {
    mockedBrowserRender.mockResolvedValue(
      "<html><body><div id='SITE_CONTAINER'><h2>BREW CITY H3</h2></div></body></html>",
    );

    const result = await adapter.fetch(makeSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

/** Build minimal Wix-like HTML for testing */
function buildTestHtml(): string {
  return `<!DOCTYPE html><html><body>
<div id="SITE_CONTAINER">
  <div class="Exmq9">
    <div role="listitem" class="_FiCX">
      <div data-testid="richTextElement">
        <h6 class="font_6">Friday, April 3, 2026 AT 12 AM</h6>
      </div>
      <div data-testid="richTextElement">
        <h2 class="font_2">BCH3 Trail #359: \u{1F315} Moonlit Easter Egg Hunt Hash III</h2>
      </div>
      <div data-testid="richTextElement">
        <h6 class="font_6">Location:\u00a0</h6>
      </div>
      <div data-testid="richTextElement">
        <h6 class="font_6"><span style="font-weight:bold;">Dirty Dime Tavern</span></h6>
      </div>
      <a data-testid="linkElement" href="https://www.facebook.com/events/901410519416540/"></a>
      <div data-testid="richTextElement">
        <p class="font_7">\u{1F430} Hare: Amber Alert<br>\u{1F46F}\u200D\u2642\uFE0F Theme: \u{1F315} Moonlit Easter Egg Hunt Hash III<br>\u{1F4CF} Distance: 4 or 5<br>\u{1F51B} On-Out: 5880 S Packard Ave, Cudahy, WI 53110<br>\u{1F335} Shiggy level: bring a splint<br>\u{1F415}\u200D\u{1F9BA} Dog friendly: No no no<br>\u{1F6BE} Bathroom on trail: Pee into the lake!<br>\u{1F37A} Booze plan: Wine only trail!<br>\u{1F4B5} Hash cash: $8</p>
      </div>
    </div>
    <div role="listitem" class="_FiCX">
      <div data-testid="richTextElement">
        <h6 class="font_6">Saturday, April 4, 2026 AT 7 PM</h6>
      </div>
      <div data-testid="richTextElement">
        <h2 class="font_2">Easter Hash</h2>
      </div>
      <div data-testid="richTextElement">
        <h6 class="font_6">Location:\u00a0</h6>
      </div>
      <div data-testid="richTextElement">
        <h6 class="font_6"><span class="wixGuard">\u200B</span></h6>
      </div>
      <a data-testid="linkElement" href="https://www.facebook.com/events/879294511419668/"></a>
      <div data-testid="richTextElement">
        <p class="font_7">\u{1F430} Hare: Backstage Ass<br>\u{1F46F}\u200D\u2642\uFE0F Theme: Hashy Birthday!<br>\u{1F4CF} Distance: TBD<br>\u{1F51B} On-Out: TBD<br>\u{1F335} Shiggy level: TBD<br>\u{1F415}\u200D\u{1F9BA} Dog friendly: TBD<br>\u{1F6BE} Bathroom on trail: TBD<br>\u{1F37A} Booze plan: TBD<br>\u{1F4B5} Hash cash: $7</p>
      </div>
    </div>
  </div>
</div>
</body></html>`;
}
