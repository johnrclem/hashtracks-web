import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runTravelDraftGc, DRAFT_GC_AGE_DAYS } from "@/pipeline/travel-draft-gc";

/**
 * Daily GC for orphan TravelSearch DRAFT rows.
 *
 * Drafts are created by the ghost-leg auto-save flow (see
 * src/components/travel/TravelSearchForm.tsx:persistDraft). When a user
 * abandons mid-flow the row stays behind — it's invisible from
 * /travel/saved but still occupies dedup-index slots and bloats the
 * table over time. This cron sweeps drafts older than
 * DRAFT_GC_AGE_DAYS.
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with
 * Bearer CRON_SECRET.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
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
  } catch (err) {
    console.error("[travel-draft-gc] failed:", err);
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/** Vercel Cron triggers GET requests. */
export async function GET(request: Request) {
  return POST(request);
}
