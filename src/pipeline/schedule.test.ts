import {
  BUFFER_MS,
  STAGGER_WINDOW_SECONDS,
  shouldScrape,
  staggerDelaySeconds,
} from "@/pipeline/schedule";

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

describe("staggerDelaySeconds", () => {
  it("returns 0 for single source (n=1)", () => {
    expect(staggerDelaySeconds(0, 1)).toBe(0);
  });

  it("returns 0 for empty batch (n=0) without throwing", () => {
    expect(staggerDelaySeconds(0, 0)).toBe(0);
  });

  it("spans 0 to STAGGER_WINDOW_SECONDS across a large batch", () => {
    const n = 121;
    expect(staggerDelaySeconds(0, n)).toBe(0);
    expect(staggerDelaySeconds(n - 1, n)).toBe(STAGGER_WINDOW_SECONDS);
  });

  it("is strictly increasing when n ≤ STAGGER_WINDOW_SECONDS + 1", () => {
    const n = 50;
    for (let i = 1; i < n; i++) {
      expect(staggerDelaySeconds(i, n)).toBeGreaterThan(staggerDelaySeconds(i - 1, n));
    }
  });

  it("is non-decreasing (duplicates allowed) when n > STAGGER_WINDOW_SECONDS + 1", () => {
    const n = 500;
    let duplicates = 0;
    for (let i = 1; i < n; i++) {
      const prev = staggerDelaySeconds(i - 1, n);
      const curr = staggerDelaySeconds(i, n);
      expect(curr).toBeGreaterThanOrEqual(prev);
      if (curr === prev) duplicates++;
    }
    // Pigeonhole: 500 items into 241 buckets must produce duplicates.
    expect(duplicates).toBeGreaterThan(0);
  });

  it("stays inside BUFFER_MS schedule tolerance", () => {
    expect(STAGGER_WINDOW_SECONDS * 1000).toBeLessThan(BUFFER_MS);
  });
});
