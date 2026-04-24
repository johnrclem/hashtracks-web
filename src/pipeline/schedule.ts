/** Map scrapeFreq values to minimum interval in milliseconds */
export const FREQ_INTERVALS = new Map<string, number>([
  ["hourly", 60 * 60 * 1000],           // 1 hour
  ["every_6h", 6 * 60 * 60 * 1000],     // 6 hours
  ["daily", 24 * 60 * 60 * 1000],       // 24 hours
  ["weekly", 7 * 24 * 60 * 60 * 1000],  // 7 days
]);

const DEFAULT_INTERVAL = 24 * 60 * 60 * 1000; // daily

/** 10-minute buffer to avoid edge-case misses near interval boundaries */
export const BUFFER_MS = 10 * 60 * 1000;

/** Window over which dispatcher spreads QStash `delay` across a fan-out batch.
 *  Invariant: STAGGER_WINDOW_SECONDS * 1000 < BUFFER_MS so a staggered scrape
 *  still lands inside the schedule tolerance window. */
export const STAGGER_WINDOW_SECONDS = 240;

/** Returns the QStash `delay` (seconds) for message `i` of `n` across STAGGER_WINDOW_SECONDS. */
export function staggerDelaySeconds(i: number, n: number): number {
  return Math.floor((i / Math.max(n - 1, 1)) * STAGGER_WINDOW_SECONDS);
}

/**
 * Determines whether a source is due for scraping based on its frequency and last scrape time.
 * Returns `true` if the source has never been scraped or enough time has elapsed (minus buffer).
 */
export function shouldScrape(scrapeFreq: string, lastScrapeAt: Date | null): boolean {
  if (!lastScrapeAt) return true; // Never scraped — always scrape
  const interval = FREQ_INTERVALS.get(scrapeFreq);
  if (interval == null) {
    console.warn(`[schedule] Unknown scrapeFreq "${scrapeFreq}", defaulting to daily`);
  }
  const elapsed = Date.now() - lastScrapeAt.getTime();
  return elapsed >= (interval ?? DEFAULT_INTERVAL) - BUFFER_MS;
}
