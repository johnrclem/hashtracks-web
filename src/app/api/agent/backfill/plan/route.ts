/**
 * POST /api/agent/backfill/plan { prNumber } — design 7.2.
 * A1–A6, then every plan guard and the matcher simulation, for a MERGED PR.
 * Returns PLANNED, WAITING or BLOCKED. Writes only the run row.
 * Auth: BACKFILL_AGENT_TOKEN; allowed in shadow and apply.
 */
import { handlePlanRequest } from "@/lib/backfill/routes";

export const maxDuration = 300;

export function POST(req: Request) {
  return handlePlanRequest(req, false);
}
