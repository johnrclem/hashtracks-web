/**
 * POST /api/agent/backfill/preview { prNumber } — design 7.2.
 * Plans an OPEN PR's archive at its head against prod, for the PR body.
 * Status PREVIEW, never applicable. Writes only the run row.
 * Auth: BACKFILL_AGENT_TOKEN; allowed in shadow and apply.
 */
import { handlePlanRequest } from "@/lib/backfill/routes";

export const maxDuration = 300;

export function POST(req: Request) {
  return handlePlanRequest(req, true);
}
