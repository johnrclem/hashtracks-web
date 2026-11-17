/** GET /api/agent/backfill/runs/:id — status, counts, reason codes, verification (design 7.2). Read-only. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rejectBackfillCall, summarizeRun } from "@/lib/backfill/agent";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const rejected = rejectBackfillCall(req, "read");
  if (rejected) return rejected;
  const run = await prisma.backfillRun.findUnique({ where: { id: (await params).id } });
  if (!run) return NextResponse.json({ data: null, error: "Not found" }, { status: 404 });
  return NextResponse.json({ data: summarizeRun(run) });
}
