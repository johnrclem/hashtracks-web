import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { scrapeSource, type ScrapeSourceResult } from "@/pipeline/scrape";

export const maxDuration = 120; // seconds — needed for browser-rendered adapters (Hash Rego, Wix, etc.)

/**
 * Per-source scrape handler invoked by QStash. Validates the source exists and is enabled,
 * reads an optional `days` override from the message body, and runs the scrape pipeline.
 * Returns 500 on failure to trigger QStash automatic retry.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  const { sourceId } = await params;

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { id: true, name: true, enabled: true, scrapeDays: true },
  });

  if (!source) {
    return NextResponse.json({ data: null, error: "Source not found" }, { status: 404 });
  }

  if (!source.enabled) {
    return NextResponse.json({
      data: {
        success: true,
        skipped: true,
        reason: "Source is disabled",
        sourceId: source.id,
        name: source.name,
      },
    });
  }

  // Read optional days override from request body (QStash message payload)
  let days = source.scrapeDays;
  try {
    const body = await request.clone().json();
    if (typeof body?.days === "number" && body.days >= 1 && body.days <= 365) {
      days = body.days;
    }
  } catch {
    // No body or invalid JSON — use source default
  }

  console.log(`[cron/source] Scraping ${source.name} (${sourceId}), days=${days}, auth=${auth.method}`);

  let result: ScrapeSourceResult;
  try {
    result = await scrapeSource(sourceId, { days });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/source] Unhandled error scraping ${source.name}: ${errorMsg}`);
    return NextResponse.json(
      { data: null, error: `Scrape crashed: ${errorMsg}` },
      { status: 500 },
    );
  }

  if (!result.success) {
    // Return 500 so QStash retries this source
    return NextResponse.json(
      { data: { ...result, sourceId, name: source.name }, error: "Scrape failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    data: {
      ...result,
      sourceId,
      name: source.name,
    },
  });
}
