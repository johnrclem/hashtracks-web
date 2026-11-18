/**
 * POST /api/agent/backfill/runs/:id/advance — the next step of a PLANNED or
 * APPLYING run: the cutoff, one batch, or the finish (design 7.2, 9.2).
 * Never resumes a HALTED run (owner only, from /admin/backfills).
 * Auth: BACKFILL_AGENT_TOKEN; G16: only when BACKFILL_AUTOMATION=apply.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BACKFILL_AGENT_ID, rejectBackfillCall, summarizeRun } from "@/lib/backfill/agent";
import { advanceFromCaller } from "@/lib/backfill/service";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rejected = rejectBackfillCall(req, "advance");
  if (rejected) return rejected;
  const id = (await params).id;
  const result = await advanceFromCaller(id, BACKFILL_AGENT_ID);
  if (result.status === "BUSY") return NextResponse.json({ data: null, error: "Another caller holds the lease" }, { status: 409 });
  if (result.status === "REFUSED") return NextResponse.json({ data: { status: "REFUSED", reason: result.reason } }, { status: 409 });
  if (result.status === "WAITING" && "reason" in result) return NextResponse.json({ data: { status: "WAITING", reason: result.reason } }, { status: 202 });
  const run = "run" in result ? result.run : await prisma.backfillRun.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ data: { step: result.status, run: summarizeRun(run) } });
}
