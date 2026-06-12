import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { runPredictionLedger } from "@/pipeline/prediction-ledger";

/**
 * Weekly prospective prediction ledger (Travel Mode evaluation, Phase 2).
 *
 * Each run: scores matured snapshots against independent reality (HIT/MISS/
 * UNOBSERVED, with already-confirmed rows finalized as PRECONFIRMED), then freezes
 * the engine's current forward HIGH/MEDIUM predictions at 180/90/30-day bands and
 * records the observation census for the recall denominator. Over months this yields
 * a drift-proof forward-calibration scorecard (see scripts/score-prediction-ledger.ts).
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPredictionLedger(prisma);
    console.log(
      `[prediction-ledger] scored ${result.scored} (${JSON.stringify(result.outcomes)}), ` +
        `+${result.snapshotsCreated} snapshots, +${result.observationsCreated} observations`,
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("[prediction-ledger] failed:", err);
    Sentry.captureException(err);
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
