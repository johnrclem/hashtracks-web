import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeSource } from "@/pipeline/scrape";

/** Map scrapeFreq values to minimum interval in milliseconds */
const FREQ_INTERVALS: Record<string, number> = {
  hourly: 60 * 60 * 1000,           // 1 hour
  every_6h: 6 * 60 * 60 * 1000,     // 6 hours
  daily: 24 * 60 * 60 * 1000,       // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1000,  // 7 days
};

/** 10-minute buffer to avoid edge-case misses near interval boundaries */
const BUFFER_MS = 10 * 60 * 1000;

export function shouldScrape(scrapeFreq: string, lastScrapeAt: Date | null): boolean {
  if (!lastScrapeAt) return true; // Never scraped — always scrape
  const interval = FREQ_INTERVALS[scrapeFreq] ?? FREQ_INTERVALS.daily;
  const elapsed = Date.now() - lastScrapeAt.getTime();
  return elapsed >= interval - BUFFER_MS;
}

export async function GET(request: NextRequest) {
  // Validate CRON_SECRET (timing-safe to prevent timing attacks)
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (
    !process.env.CRON_SECRET ||
    !authHeader ||
    authHeader.length !== expected.length ||
    !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Query all enabled sources with per-source scrape window and frequency
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      scrapeDays: true,
      scrapeFreq: true,
      lastScrapeAt: true,
    },
  });

  console.log(
    `[cron] Starting scrape run: ${sources.length} sources found at ${new Date().toISOString()}`,
  );

  // Determine which sources are due for scraping
  const dueSources = sources.filter((s) =>
    shouldScrape(s.scrapeFreq, s.lastScrapeAt),
  );
  const skippedSources = sources.filter(
    (s) => !shouldScrape(s.scrapeFreq, s.lastScrapeAt),
  );

  if (skippedSources.length > 0) {
    console.log(
      `[cron] Skipping ${skippedSources.length} sources (not due): ${skippedSources.map((s) => s.name).join(", ")}`,
    );
  }

  console.log(
    `[cron] Scraping ${dueSources.length} sources: ${dueSources.map((s) => s.name).join(", ")}`,
  );

  // Scrape each due source sequentially to avoid rate-limiting external APIs
  const results = [];
  for (const source of dueSources) {
    const result = await scrapeSource(source.id, { days: source.scrapeDays });
    results.push({ sourceId: source.id, name: source.name, ...result });
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(
    `[cron] Scrape run complete: ${succeeded} succeeded, ${failed} failed, ${skippedSources.length} skipped`,
  );

  return NextResponse.json({
    success: failed === 0,
    summary: {
      total: sources.length,
      scraped: dueSources.length,
      succeeded,
      failed,
      skipped: skippedSources.length,
    },
    sources: results,
    skipped: skippedSources.map((s) => ({
      sourceId: s.id,
      name: s.name,
      scrapeFreq: s.scrapeFreq,
      lastScrapeAt: s.lastScrapeAt?.toISOString(),
    })),
  });
}
