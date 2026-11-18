import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { runTravelDraftGc, DRAFT_GC_AGE_DAYS } from "@/pipeline/travel-draft-gc";

/**
 * Daily GC for orphan TravelSearch DRAFT rows.
 *
 * Drafts are created by the ghost-leg auto-save flow (see
 * src/components/travel/TravelSearchForm/TravelSearchForm.tsx:persistDraft). When a user
 * abandons mid-flow the row stays behind — it's invisible from
 * /travel/saved but still occupies dedup-index slots and bloats the
 * table over time. This cron sweeps drafts older than
 * DRAFT_GC_AGE_DAYS.
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with
 * Bearer CRON_SECRET.
 */
export const POST = withCronRun("cron:travel-draft-gc", async () => {
  const result = await runTravelDraftGc();
  console.log(
    `[travel-draft-gc] deleted ${result.deleted} drafts older than ${result.olderThan.toISOString()}`,
  );
  return NextResponse.json({
    data: {
      deleted: result.deleted,
      olderThan: result.olderThan.toISOString(),
      ageDays: DRAFT_GC_AGE_DAYS,
    },
  });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
