/** Request handling shared by POST /preview and POST /plan (design 7.2). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BACKFILL_AGENT_ID, planRateLimited, rejectBackfillCall, summarizeRun } from "./agent";
import { planFromPr } from "./service";

export async function handlePlanRequest(req: Request, preview: boolean): Promise<NextResponse> {
  const rejected = rejectBackfillCall(req, "plan");
  if (rejected) return rejected;
  const body = (await req.json().catch(() => null)) as { prNumber?: unknown } | null;
  const prNumber = Number(body?.prNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return NextResponse.json({ data: null, error: "prNumber is required" }, { status: 400 });
  // A PR with a final run gets it back without another round of GitHub calls (10.1).
  if (!preview) {
    const existing = await prisma.backfillRun.findFirst({ where: { prNumber, status: { notIn: ["PREVIEW", "WAITING"] } }, orderBy: { createdAt: "desc" } });
    if (existing) return NextResponse.json({ data: { run: summarizeRun(existing), reasons: existing.reasonCodes } });
  }
  if (await planRateLimited(prNumber)) {
    return NextResponse.json({ data: null, error: "One preview or plan per PR per 10 minutes" }, { status: 429 });
  }
  const result = await planFromPr(prNumber, preview, BACKFILL_AGENT_ID);
  if (result.kind === "waiting") return NextResponse.json({ data: { status: "WAITING", reason: result.reason } }, { status: 202 });
  if (result.kind === "refused") return NextResponse.json({ data: { status: "BLOCKED", reason: result.reason } }, { status: 409 });
  return NextResponse.json({ data: { run: summarizeRun(result.outcome.run), reasons: result.outcome.reasons } });
}
