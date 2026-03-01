import { shouldScrape } from "@/pipeline/schedule";

describe("shouldScrape", () => {
  it("returns true when lastScrapeAt is null (never scraped)", () => {
    expect(shouldScrape("daily", null)).toBe(true);
    expect(shouldScrape("hourly", null)).toBe(true);
    expect(shouldScrape("weekly", null)).toBe(true);
  });

  it("returns false for hourly when scraped 30 min ago", () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(shouldScrape("hourly", thirtyMinAgo)).toBe(false);
  });

  it("returns true for hourly when scraped 61 min ago", () => {
    const sixtyOneMinAgo = new Date(Date.now() - 61 * 60 * 1000);
    expect(shouldScrape("hourly", sixtyOneMinAgo)).toBe(true);
  });

  it("returns true for hourly within 10-min buffer (scraped 51 min ago)", () => {
    const fiftyOneMinAgo = new Date(Date.now() - 51 * 60 * 1000);
    expect(shouldScrape("hourly", fiftyOneMinAgo)).toBe(true);
  });

  it("returns false for daily when scraped 12h ago", () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    expect(shouldScrape("daily", twelveHoursAgo)).toBe(false);
  });

  it("returns true for daily within buffer window (scraped 23h 51m ago)", () => {
    const almostDay = new Date(Date.now() - (23 * 60 + 51) * 60 * 1000);
    expect(shouldScrape("daily", almostDay)).toBe(true);
  });

  it("returns false for weekly when scraped 6 days ago", () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    expect(shouldScrape("weekly", sixDaysAgo)).toBe(false);
  });

  it("returns true for weekly when scraped 6d 23h 51m ago", () => {
    const almostWeek = new Date(
      Date.now() - (6 * 24 * 60 + 23 * 60 + 51) * 60 * 1000,
    );
    expect(shouldScrape("weekly", almostWeek)).toBe(true);
  });

  it("defaults unknown frequency to daily interval", () => {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    expect(shouldScrape("unknown_freq", twelveHoursAgo)).toBe(false);

    const almostDay = new Date(Date.now() - (23 * 60 + 51) * 60 * 1000);
    expect(shouldScrape("unknown_freq", almostDay)).toBe(true);
  });

  it("returns true for every_6h when scraped 6h ago", () => {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    expect(shouldScrape("every_6h", sixHoursAgo)).toBe(true);
  });

  it("returns false for every_6h when scraped 3h ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(shouldScrape("every_6h", threeHoursAgo)).toBe(false);
  });
});
