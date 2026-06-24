/**
 * Deposit a chrome-stream audit finding into the first-party review queue,
 * OR record a per-kennel deep-dive completion. Both are NON-PUBLISHING,
 * reversible internal writes — this endpoint never creates a GitHub issue or
 * touches any external system. A trusted server cron
 * (`/api/cron/promote-audit-findings`) promotes queued findings into GitHub
 * issues later, with server credentials.
 *
 * This is the decouple that lets the daily Chrome audit run unattended: an
 * interactive Claude-in-Chrome agent refuses unattended *external* writes
 * (filing GitHub issues, admin-UI state changes) regardless of prompt wording,
 * but will deposit findings into an internal, reviewed-before-public queue.
 *
 * Auth: Origin check + Clerk admin session (same envelope as the nonce route,
 * via `authorizeAuditApi`). NO nonce — the nonce hardened an *external publish*
 * (a leaked cookie could make public GitHub issues appear under the org); a
 * non-publishing, reversible internal insert gated by Origin + admin +
 * `contentHash` idempotency doesn't need it, and dropping the mint round-trip
 * removes the two-step privileged pattern the agent balks at.
 */

import { NextResponse } from "next/server";

import { authorizeAuditApi } from "@/lib/audit-api-auth";
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
    typeof v.findingsCount === "number" &&
    typeof v.summary === "string"
  );
}

function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
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

async function handleFinding(req: FindingRequest, adminId: string): Promise<NextResponse> {
  const validationError = validateFinding(req);
  if (validationError) return badRequest(validationError);

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: req.kennelCode },
    select: { kennelCode: true },
  });
  if (!kennel) return badRequest("Unknown kennelCode", 422);

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

async function handleCompletion(req: CompletionRequest): Promise<NextResponse> {
  if (req.findingsCount < 0) return badRequest("findingsCount must be ≥ 0");
  if (req.summary.length > SUMMARY_MAX) return badRequest(`summary must be ≤${SUMMARY_MAX} chars`);

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: req.kennelCode },
    select: { kennelCode: true },
  });
  if (!kennel) return badRequest("Unknown kennelCode", 422);

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
      issuesFiled: req.findingsCount,
      findings: [],
      summary: { note: req.summary, viaSubmitEndpoint: true },
    },
    select: { id: true },
  });
  return NextResponse.json({ data: { recorded: true, deepDive: "recorded", auditLogId: log.id } });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await authorizeAuditApi(req);
  if (!auth.ok) return auth.response;
  const { admin, body } = auth;

  if (typeof body !== "object" || body === null) {
    return badRequest("Body must be a JSON object with a `kind` of 'finding' or 'completion'");
  }
  const v = body as Record<string, unknown>;

  if (isFindingRequest(v)) return handleFinding(v, admin.id);
  if (isCompletionRequest(v)) return handleCompletion(v);

  return badRequest(
    "Body must be {kind:'finding', stream, kennelCode, ruleSlug, title, eventIds?, bodyMarkdown} or {kind:'completion', kennelCode, findingsCount, summary}",
  );
}
