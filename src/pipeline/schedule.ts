/** Map scrapeFreq values to minimum interval in milliseconds */
export const FREQ_INTERVALS: Record<string, number> = {
  hourly: 60 * 60 * 1000,           // 1 hour
  every_6h: 6 * 60 * 60 * 1000,     // 6 hours
  daily: 24 * 60 * 60 * 1000,       // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1000,  // 7 days
};

/** 10-minute buffer to avoid edge-case misses near interval boundaries */
export const BUFFER_MS = 10 * 60 * 1000;

/**
 * Determines whether a source is due for scraping based on its frequency and last scrape time.
 * Returns `true` if the source has never been scraped or enough time has elapsed (minus buffer).
 */
export function shouldScrape(scrapeFreq: string, lastScrapeAt: Date | null): boolean {
  if (!lastScrapeAt) return true; // Never scraped — always scrape
  const interval = FREQ_INTERVALS[scrapeFreq] ?? FREQ_INTERVALS.daily;
  const elapsed = Date.now() - lastScrapeAt.getTime();
  return elapsed >= interval - BUFFER_MS;
}
