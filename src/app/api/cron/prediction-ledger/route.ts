import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { prisma } from "@/lib/db";
import { runPredictionLedger } from "@/pipeline/prediction-ledger";

/**
 * Weekly prospective prediction ledger (Travel Mode evaluation, Phase 2).
 *
 * Each run: scores matured snapshots against independent reality (HIT/MISS/
 * UNOBSERVED, with already-confirmed rows finalized as PRECONFIRMED), then freezes
 * the engine's current forward HIGH/MEDIUM predictions into 180/90/30-day bands. Over
 * months this yields a drift-proof forward-calibration scorecard (precision; recall is
 * a deferred follow-up — see scripts/score-prediction-ledger.ts).
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
export const maxDuration = 300;

export const POST = withCronRun("cron:prediction-ledger", async () => {
  const result = await runPredictionLedger(prisma);
  console.log(
    `[prediction-ledger] scored ${result.scored} (${JSON.stringify(result.outcomes)}), ` +
      `re-scored ${result.rescored} (${JSON.stringify(result.rescoredTo)}), ` +
      `+${result.snapshotsCreated} snapshots`,
  );
  return NextResponse.json({ data: result });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
