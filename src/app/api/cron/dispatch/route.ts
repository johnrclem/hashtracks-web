import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getQStashClient } from "@/lib/qstash";
import { shouldScrape } from "@/pipeline/schedule";

export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_APP_URL is not configured" },
      { status: 500 },
    );
  }

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

  const dueSources = sources.filter((s) =>
    shouldScrape(s.scrapeFreq, s.lastScrapeAt),
  );
  const skippedSources = sources.filter(
    (s) => !shouldScrape(s.scrapeFreq, s.lastScrapeAt),
  );

  console.log(
    `[cron/dispatch] ${dueSources.length} due, ${skippedSources.length} skipped, auth=${auth.method}`,
  );

  if (dueSources.length === 0) {
    return NextResponse.json({
      success: true,
      dispatched: 0,
      failed: 0,
      skipped: skippedSources.length,
      total: sources.length,
    });
  }

  const client = getQStashClient();
  const results: Array<{ sourceId: string; name: string; dispatched: boolean; error?: string }> = [];

  for (const source of dueSources) {
    try {
      await client.publishJSON({
        url: `${appUrl}/api/cron/scrape/${source.id}`,
        body: { days: source.scrapeDays },
        retries: 2,
      });
      results.push({ sourceId: source.id, name: source.name, dispatched: true });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[cron/dispatch] Failed to dispatch ${source.name}: ${errorMsg}`);
      results.push({ sourceId: source.id, name: source.name, dispatched: false, error: errorMsg });
    }
  }

  const dispatched = results.filter((r) => r.dispatched).length;
  const failed = results.filter((r) => !r.dispatched).length;

  console.log(
    `[cron/dispatch] Complete: ${dispatched} dispatched, ${failed} failed, ${skippedSources.length} skipped`,
  );

  return NextResponse.json({
    success: failed === 0,
    dispatched,
    failed,
    skipped: skippedSources.length,
    total: sources.length,
    results,
  });
}

// Also accept GET for Vercel Cron during transition (Vercel Cron sends GET)
export async function GET(request: Request) {
  return POST(request);
}
