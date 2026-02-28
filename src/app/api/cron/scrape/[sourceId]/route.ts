import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { scrapeSource } from "@/pipeline/scrape";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sourceId } = await params;

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { id: true, name: true, enabled: true, scrapeDays: true },
  });

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  if (!source.enabled) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "Source is disabled",
      sourceId: source.id,
      name: source.name,
    });
  }

  // Read optional days override from request body (QStash message payload)
  let days = source.scrapeDays;
  try {
    const body = await request.clone().text();
    if (body) {
      const parsed = JSON.parse(body);
      if (typeof parsed.days === "number" && parsed.days >= 1 && parsed.days <= 365) {
        days = parsed.days;
      }
    }
  } catch (err) {
    console.warn(`[cron/source] Failed to parse request body for ${sourceId}:`, err);
  }

  console.log(`[cron/source] Scraping ${source.name} (${sourceId}), days=${days}, auth=${auth.method}`);

  const result = await scrapeSource(sourceId, { days });

  if (!result.success) {
    // Return 500 so QStash retries this source
    return NextResponse.json(
      { ...result, sourceId, name: source.name },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ...result,
    sourceId,
    name: source.name,
  });
}
