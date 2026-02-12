import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scrapeSource } from "@/pipeline/scrape";

export async function POST() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const sources = await prisma.source.findMany({
    select: { id: true, name: true, scrapeDays: true },
  });

  // Scrape each source sequentially to avoid rate-limiting external APIs
  const results = [];
  for (const source of sources) {
    try {
      const result = await scrapeSource(source.id, { days: source.scrapeDays });
      results.push({ sourceId: source.id, name: source.name, ...result });
    } catch (err) {
      results.push({
        sourceId: source.id,
        name: source.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return NextResponse.json({
    success: failed === 0,
    summary: { total: sources.length, succeeded, failed },
    sources: results,
  });
}
