/**
 * POST /api/agent/backfill/runs/:id/verify — V1–V5 (design 9.3). Writes only
 * the run's verification record. Auth: BACKFILL_AGENT_TOKEN; shadow or apply.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rejectBackfillCall } from "@/lib/backfill/agent";
import { verifyFromCaller } from "@/lib/backfill/service";

export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rejected = rejectBackfillCall(req, "plan");
  if (rejected) return rejected;
  const id = (await params).id;
  if (!(await prisma.backfillRun.count({ where: { id } }))) return NextResponse.json({ data: null, error: "Not found" }, { status: 404 });
  const verified = await verifyFromCaller(id);
  if (!verified) return NextResponse.json({ data: null, error: "Only an applied run can be verified" }, { status: 409 });
  const { result, v5 } = verified;
  return NextResponse.json({ data: { ok: result.ok && (v5?.ok ?? true), failures: result.failures, notes: result.notes, coverage: result.coverage, counts: result.counts, v5 } });
}
