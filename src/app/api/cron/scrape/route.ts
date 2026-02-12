import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scrapeSource } from "@/pipeline/scrape";

export async function GET(request: NextRequest) {
  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Query all sources with per-source scrape window
  const sources = await prisma.source.findMany({
    select: { id: true, name: true, scrapeDays: true },
  });

  // Scrape each source sequentially to avoid rate-limiting external APIs
  const results = [];
  for (const source of sources) {
    const result = await scrapeSource(source.id, { days: source.scrapeDays });
    results.push({ sourceId: source.id, name: source.name, ...result });
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    success: failed === 0,
    summary: { total: sources.length, succeeded, failed },
    sources: results,
  });
}
