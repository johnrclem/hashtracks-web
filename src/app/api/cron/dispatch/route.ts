import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { getQStashClient } from "@/lib/qstash";
import { shouldScrape, staggerDelaySeconds } from "@/pipeline/schedule";

/**
 * Fan-out dispatcher: queries all enabled sources, filters to those due for scraping,
 * and publishes a QStash message per source to `/api/cron/scrape/[sourceId]`.
 * Supports `?force=true` query param to bypass schedule checks (all sources treated as due).
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!appUrl) {
    return NextResponse.json(
      { data: null, error: "NEXT_PUBLIC_APP_URL (or VERCEL_URL) is not configured" },
      { status: 500 },
    );
  }

  // Ordered by id so the stagger index maps deterministically to the same source
  // across runs — makes timing-sensitive debugging reproducible.
  const sources = await prisma.source.findMany({
    where: { enabled: true },
    orderBy: { id: "asc" },
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
  if (force) {
    dueSources.push(...sources);
  } else {
    for (const s of sources) {
      (shouldScrape(s.scrapeFreq, s.lastScrapeAt) ? dueSources : skippedSources).push(s);
    }
  }

  console.log(
    `[cron/dispatch] ${dueSources.length} due, ${skippedSources.length} skipped, auth=${auth.method}${force ? ", force=true" : ""}`,
  );

  if (dueSources.length === 0) {
    return NextResponse.json({
      data: {
        success: true,
        force,
        dispatched: 0,
        failed: 0,
        skipped: skippedSources.length,
        total: sources.length,
      },
    });
  }

  let client;
  try {
    client = getQStashClient();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { data: null, error: `QStash client setup failed: ${msg}` },
      { status: 500 },
    );
  }

  // Stagger via QStash `delay` so ~120 scrapes don't hit the residential
  // proxy at once — concurrent 429s + retry-wait burn Vercel Function CPU.
  // Applies to `force=true` too: a forced full-batch fan-out would recreate
  // the exact saturation this stagger is meant to prevent. Single-source
  // urgent re-scrapes go through the admin action, not this route.
  const n = dueSources.length;
  const results = await Promise.all(
    dueSources.map(async (source, i) => {
      try {
        const res = await client.publishJSON({
          url: `${appUrl}/api/cron/scrape/${source.id}`,
          body: { days: source.scrapeDays },
          retries: 2,
          delay: staggerDelaySeconds(i, n),
        });
        return { sourceId: source.id, name: source.name, dispatched: true, messageId: res.messageId };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/dispatch] Failed to dispatch ${source.name}: ${errorMsg}`);
        return { sourceId: source.id, name: source.name, dispatched: false, error: errorMsg };
      }
    }),
  );

  const dispatched = results.filter((r) => r.dispatched).length;
  const failed = results.filter((r) => !r.dispatched).length;

  console.log(
    `[cron/dispatch] Complete: ${dispatched} dispatched, ${failed} failed, ${skippedSources.length} skipped`,
  );

  return NextResponse.json({
    data: {
      success: failed === 0,
      force,
      dispatched,
      failed,
      skipped: skippedSources.length,
      total: sources.length,
      results,
    },
  });
}

/**
 * GET handler that delegates to POST for Vercel Cron compatibility.
 * Vercel Cron sends GET requests; this wrapper allows a seamless transition to QStash.
 */
export async function GET(request: Request) {
  return POST(request);
}
