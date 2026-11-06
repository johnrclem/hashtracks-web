/**
 * Shared handler for audit-queue submissions: queue a chrome-stream finding,
 * or record a per-kennel deep-dive completion. Both are NON-PUBLISHING,
 * reversible internal writes. A trusted server cron
 * (`/api/cron/promote-audit-findings`) files the reviewed findings as GitHub
 * issues later.
 *
 * Two routes use it and differ only in auth:
 * - `/api/audit/submit-finding`: Origin plus Clerk admin session (browser agent)
 * - `/api/audit/agent/submit-finding`: `AUDIT_AGENT_TOKEN` bearer (scheduled agent)
 */

import { NextResponse } from "next/server";

import { computeDraftContentHash } from "@/lib/audit-nonce";
import { prisma } from "@/lib/db";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";

const TITLE_MAX = 256;
const BODY_MAX = 32_768;
const EVENT_IDS_MAX = 50;
const EVENT_ID_MAX = 64;
const SUMMARY_MAX = 500;
const RULE_SLUG_RE = /^[a-z0-9-]{1,64}$/;

interface FindingRequest {
  kind: "finding";
  stream: "CHROME_KENNEL" | "CHROME_EVENT";
  kennelCode: string;
  ruleSlug: string;
  title: string;
  eventIds?: string[];
  bodyMarkdown: string;
}

interface CompletionRequest {
  kind: "completion";
  kennelCode: string;
  findingsCount: number;
  summary: string;
}

function isFindingRequest(v: Record<string, unknown>): v is FindingRequest & Record<string, unknown> {
  return (
    v.kind === "finding" &&
    (v.stream === "CHROME_KENNEL" || v.stream === "CHROME_EVENT") &&
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string" &&
    typeof v.title === "string" &&
    typeof v.bodyMarkdown === "string" &&
    (v.eventIds === undefined ||
      (Array.isArray(v.eventIds) && v.eventIds.every((id) => typeof id === "string")))
  );
}

function isCompletionRequest(v: Record<string, unknown>): v is CompletionRequest & Record<string, unknown> {
  return (
    v.kind === "completion" &&
    typeof v.kennelCode === "string" &&
    // Number.isInteger (not typeof "number") so NaN / Infinity / floats are
    // rejected before they hit the Prisma INTEGER column (Gemini/Sonar #2298).
    Number.isInteger(v.findingsCount) &&
    typeof v.summary === "string"
  );
}

function badRequest(message: string, status = 400): NextResponse {
  // Consistent API envelope { data, error } for success + failure (CLAUDE.md).
  return NextResponse.json({ data: null, error: message }, { status });
}

/** Reject obviously-malformed findings before touching the DB. */
function validateFinding(req: FindingRequest): string | null {
  if (!RULE_SLUG_RE.test(req.ruleSlug)) return "ruleSlug must be lowercase-hyphenated, ≤64 chars";
  if (req.title.length === 0 || req.title.length > TITLE_MAX) return `title must be 1–${TITLE_MAX} chars`;
  if (req.bodyMarkdown.length === 0 || req.bodyMarkdown.length > BODY_MAX) return `bodyMarkdown must be 1–${BODY_MAX} chars`;
  const eventIds = req.eventIds ?? [];
  if (eventIds.length > EVENT_IDS_MAX) return `eventIds must be ≤${EVENT_IDS_MAX} entries`;
  if (eventIds.some((id) => id.length > EVENT_ID_MAX)) return `each eventId must be ≤${EVENT_ID_MAX} chars`;
  return null;
}

/**
 * Resolve the submitted kennel identifier to a canonical `kennelCode`. Submitters are told to use
 * the last path segment of the kennel's HashTracks page, which is the name-derived `slug` — and
 * for some kennels that differs from the internal code (`hk-h3` → `hkh3`,
 * `north-shore-wanderers-h3` → `nswhhh`; #2588). An exact kennelCode match wins; otherwise fall
 * back to the slug. Both columns are unique, so each lookup yields at most one kennel.
 */
async function resolveKennelCode(input: string): Promise<string | null> {
  const byCode = await prisma.kennel.findUnique({ where: { kennelCode: input }, select: { kennelCode: true } });
  if (byCode) return byCode.kennelCode;
  const bySlug = await prisma.kennel.findUnique({ where: { slug: input }, select: { kennelCode: true } });
  return bySlug?.kennelCode ?? null;
}

async function handleFinding(rawReq: FindingRequest, adminId: string): Promise<NextResponse> {
  const validationError = validateFinding(rawReq);
  if (validationError) return badRequest(validationError);

  const kennelCode = await resolveKennelCode(rawReq.kennelCode);
  if (!kennelCode) return badRequest("Unknown kennelCode", 422);
  const req = { ...rawReq, kennelCode };

  const eventIds = req.eventIds ?? [];
  const contentHash = computeDraftContentHash({
    stream: req.stream,
    kennelCode: req.kennelCode,
    ruleSlug: req.ruleSlug,
    eventIds,
    bodyMarkdown: req.bodyMarkdown,
  });

  try {
    const draft = await prisma.auditFindingDraft.create({
      data: {
        stream: req.stream,
        kennelCode: req.kennelCode,
        ruleSlug: req.ruleSlug,
        title: req.title,
        bodyMarkdown: req.bodyMarkdown,
        affectedEventIds: eventIds,
        contentHash,
        submittedByUserId: adminId,
      },
      select: { id: true },
    });
    return NextResponse.json({ data: { queued: true, draftId: draft.id, deduped: false } }, { status: 201 });
  } catch (err) {
    // Partial-unique violation on (contentHash WHERE status=PENDING): the same
    // finding is already queued this run. Idempotent no-op — return the existing row.
    if (isUniqueConstraintViolation(err)) {
      const existing = await prisma.auditFindingDraft.findFirst({
        where: { contentHash, status: "PENDING" },
        select: { id: true },
      });
      return NextResponse.json({ data: { queued: true, draftId: existing?.id ?? null, deduped: true } });
    }
    throw err;
  }
}

async function handleCompletion(rawReq: CompletionRequest, submitterId: string): Promise<NextResponse> {
  if (rawReq.findingsCount < 0) return badRequest("findingsCount must be ≥ 0");
  if (rawReq.summary.length > SUMMARY_MAX) return badRequest(`summary must be ≤${SUMMARY_MAX} chars`);

  const kennelCode = await resolveKennelCode(rawReq.kennelCode);
  if (!kennelCode) return badRequest("Unknown kennelCode", 422);
  const req = { ...rawReq, kennelCode };

  // Same-day idempotency: a deep-dive completion is recorded as a KENNEL_DEEP_DIVE
  // AuditLog row (the rotation's lastDeepDiveAt is DERIVED from these rows, so writing
  // one advances the rotation). A replayed completion (retry / double-fire) on the same
  // UTC day returns the existing row instead of writing a duplicate.
  //
  // #1160 anti-misattribution is preserved WITHOUT the HMAC queue token: the agent
  // submits an explicit kennelCode (no position-based dropdown index that can go stale),
  // which is the same property recordDeepDiveManual relies on to skip the token.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const existing = await prisma.auditLog.findFirst({
    where: { type: "KENNEL_DEEP_DIVE", kennelCode: req.kennelCode, createdAt: { gte: dayStart } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ data: { recorded: true, deepDive: "already-recorded", auditLogId: existing.id } });
  }

  const log = await prisma.auditLog.create({
    data: {
      type: "KENNEL_DEEP_DIVE",
      kennelCode: req.kennelCode,
      eventsScanned: 0,
      findingsCount: req.findingsCount,
      groupsCount: 0,
      // This endpoint only QUEUES findings — nothing is filed here. The promotion
      // cron files them later. Counting them as filed would overstate the metric.
      issuesFiled: 0,
      findings: [],
      summary: { note: req.summary, viaSubmitEndpoint: true, submitter: submitterId },
    },
    select: { id: true },
  });
  return NextResponse.json({ data: { recorded: true, deepDive: "recorded", auditLogId: log.id } });
}

/**
 * Dispatch a parsed request body to the finding or completion handler.
 * `submitterId` is the admin's user id, or `AUDIT_AGENT_SUBMITTER_ID` for the
 * token-authenticated agent.
 */
export async function handleAuditSubmission(body: unknown, submitterId: string): Promise<NextResponse> {
  if (typeof body !== "object" || body === null) {
    return badRequest("Body must be a JSON object with a `kind` of 'finding' or 'completion'");
  }
  const v = body as Record<string, unknown>;

  if (isFindingRequest(v)) return handleFinding(v, submitterId);
  if (isCompletionRequest(v)) return handleCompletion(v, submitterId);

  return badRequest(
    "Body must be {kind:'finding', stream, kennelCode, ruleSlug, title, eventIds?, bodyMarkdown} or {kind:'completion', kennelCode, findingsCount, summary}",
  );
}
