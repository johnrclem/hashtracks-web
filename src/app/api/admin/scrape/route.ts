import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents, updateSourceHealth } from "@/pipeline/merge";

export async function POST(request: NextRequest) {
  // Admin auth check
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { sourceId, days, force } = body as {
    sourceId: string;
    days?: number;
    force?: boolean;
  };

  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    );
  }

  // Look up the source
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
  });

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  // Create ScrapeLog record
  const startedAt = new Date();
  const scrapeLog = await prisma.scrapeLog.create({
    data: {
      sourceId,
      forced: force ?? false,
    },
  });

  try {
    // If force mode, delete old RawEvents to allow full re-processing
    if (force) {
      await prisma.rawEvent.deleteMany({
        where: { sourceId },
      });
    }

    // Get the adapter for this source type
    const adapter = getAdapter(source.type);

    // Run the scrape
    const scrapeResult = await adapter.fetch(source, { days: days ?? 90 });

    // Process raw events through the merge pipeline
    const mergeResult = await processRawEvents(sourceId, scrapeResult.events);

    // Update source health
    await updateSourceHealth(sourceId, mergeResult, scrapeResult.errors);

    // Update ScrapeLog with results
    const completedAt = new Date();
    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        status: scrapeResult.errors.length > 0 ? "SUCCESS" : "SUCCESS",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        eventsFound: scrapeResult.events.length,
        eventsCreated: mergeResult.created,
        eventsUpdated: mergeResult.updated,
        eventsSkipped: mergeResult.skipped,
        unmatchedTags: mergeResult.unmatched,
        errors: scrapeResult.errors,
      },
    });

    return NextResponse.json({
      success: true,
      scrapeLogId: scrapeLog.id,
      forced: force ?? false,
      scrape: {
        eventsFound: scrapeResult.events.length,
        errors: scrapeResult.errors,
      },
      merge: mergeResult,
    });
  } catch (err) {
    // Update ScrapeLog as failed
    const completedAt = new Date();
    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        status: "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errors: [err instanceof Error ? err.message : String(err)],
      },
    });

    // Update source as failing
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        lastScrapeAt: new Date(),
        healthStatus: "FAILING",
      },
    });

    return NextResponse.json(
      {
        error: `Scrape failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
