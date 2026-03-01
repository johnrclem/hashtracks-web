import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { scrapeSource } from "@/pipeline/scrape";
import { shouldScrape } from "@/pipeline/schedule";

export async function GET(request: NextRequest) {
  // Validate CRON_SECRET (timing-safe comparison to prevent timing attacks)
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
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
