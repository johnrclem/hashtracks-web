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

  // Single-pass partitioning to avoid evaluating shouldScrape() twice per source
  const dueSources: typeof sources = [];
  const skippedSources: typeof sources = [];
  for (const s of sources) {
    (shouldScrape(s.scrapeFreq, s.lastScrapeAt) ? dueSources : skippedSources).push(s);
  }

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

  // Publish all messages in parallel — fan-out is the whole point
  const settled = await Promise.allSettled(
    dueSources.map((source) =>
      client.publishJSON({
        url: `${appUrl}/api/cron/scrape/${source.id}`,
        body: { days: source.scrapeDays },
        retries: 2,
      }).then(() => ({ sourceId: source.id, name: source.name })),
    ),
  );

  const results = settled.map((outcome, i) => {
    if (outcome.status === "fulfilled") {
      return { sourceId: outcome.value.sourceId, name: outcome.value.name, dispatched: true };
    }
    const errorMsg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
    console.error(`[cron/dispatch] Failed to dispatch ${dueSources[i].name}: ${errorMsg}`);
    return { sourceId: dueSources[i].id, name: dueSources[i].name, dispatched: false, error: errorMsg };
  });

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
