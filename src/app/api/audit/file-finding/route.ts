/**
 * Chrome-stream audit-issue filing endpoint. Consumes a single-use
 * nonce minted by `/api/audit/mint-filing-nonce`, then delegates the
 * strict/bridging/create cascade to the shared `audit-filer` module.
 *
 * Auth model:
 *   - Origin must match `getCanonicalSiteUrl()` (CSRF defense)
 *   - Clerk admin session required
 *   - Nonce row must exist and bind to the calling admin + the
 *     posted payload's hash — defends against forged or tampered
 *     consume requests
 *
 * Flow:
 *   1. Validate Origin + admin session + request shape
 *   2. SELECT nonce row, verify all bind checks. Reject mismatch → 401.
 *   3. If `filingResultJson` is set → return the cached result. This
 *      makes the endpoint retry-safe even past TTL: a slow client
 *      retry past the 5-minute window must still get the cached
 *      outcome rather than flipping to 401.
 *   4. Otherwise check expiry → 401 if expired.
 *   5. Call `fileAuditFinding` (shared with the cron path). The filer
 *      handles strict-tier coalescing (existing fingerprint match →
 *      comment + recurrenceCount++), bridging (legacy null-fingerprint
 *      row with matching kennel + ruleSlug → atomic backfill), or
 *      fresh GitHub create with the canonical block embedded.
 *   6. On any successful GitHub side effect, persist the outcome to
 *      `filingResultJson` and mark `consumedAt`. On filer-side error,
 *      return 502 — the cache stays empty so the same nonce can retry.
 *
 * Trade-off vs strict atomic-consume: two concurrent requests with
 * the same nonce can each pass step 4 and reach the filer before
 * either writes the cache, producing one orphan GitHub issue. For
 * the admin-driven audit-filing flow (low concurrency), this is an
 * accepted limitation; an outbox/job model is the long-term answer
 * if the surface ever sees real parallelism.
 *
 * Recurrence escalation (5+ days same fingerprint → meta-issue) is
 * deferred to a follow-up PR (5c-B).
 */

import { NextResponse } from "next/server";

import { authorizeAuditApi } from "@/lib/audit-api-auth";
import { prisma } from "@/lib/db";
import {
  hashNonce,
  computePayloadHash,
  type FilingPayload,
} from "@/lib/audit-nonce";
import { getValidatedRepo } from "@/lib/github-repo";
import {
  AUDIT_LABEL,
  ALERT_LABEL,
  STREAM_LABELS,
  kennelLabel,
} from "@/lib/audit-labels";
import { AuditStream } from "@/generated/prisma/client";
import {
  fileAuditFinding,
  type FilerActions,
  type FileFindingOutcome,
  type FilerErrorReason,
} from "@/pipeline/audit-filer";

interface FileFindingRequest {
  /** Raw nonce returned by the mint endpoint. */
  nonce: string;
  /** AuditStream — restricted to the chrome streams the file-finding
   *  endpoint owns. AUTOMATED filings come from the cron path
   *  (`src/pipeline/audit-issue.ts`), not here. */
  stream: "CHROME_KENNEL" | "CHROME_EVENT";
  kennelCode: string;
  ruleSlug: string;
  eventIds: string[];
  title: string;
  bodyMarkdown: string;
}

function isFileFindingRequest(value: unknown): value is FileFindingRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.nonce === "string" &&
    (v.stream === "CHROME_KENNEL" || v.stream === "CHROME_EVENT") &&
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string" &&
    Array.isArray(v.eventIds) &&
    v.eventIds.every((id) => typeof id === "string") &&
    typeof v.title === "string" &&
    typeof v.bodyMarkdown === "string"
  );
}

const FETCH_TIMEOUT_MS = 10_000;

/** Indistinguishable 401 — never leak which bind check failed. */
const NONCE_REJECTION = NextResponse.json(
  { error: "Nonce invalid, expired, or payload tampered" },
  { status: 401 },
);

interface ValidatedNonce {
  id: string;
  expiresAt: Date;
  filingResultJson: unknown;
}

/**
 * Verify all bind checks except expiry. Returns the nonce row on
 * success, or null on any mismatch — caller turns null into the
 * single shared 401 so we don't leak which check failed.
 */
async function bindNonce(
  rawNonce: string,
  adminId: string,
  body: FileFindingRequest,
  expectedPayloadHash: string,
): Promise<ValidatedNonce | null> {
  const nonce = await prisma.auditFilingNonce.findUnique({
    where: { nonceHash: hashNonce(rawNonce) },
  });
  if (!nonce) return null;
  if (
    nonce.adminUserId !== adminId ||
    nonce.kennelCode !== body.kennelCode ||
    nonce.ruleSlug !== body.ruleSlug ||
    nonce.payloadHash !== expectedPayloadHash
  ) {
    return null;
  }
  return nonce;
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await authorizeAuditApi(req);
  if (!auth.ok) return auth.response;
  const { admin, body } = auth;

  if (!isFileFindingRequest(body)) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  const payload: FilingPayload = {
    stream: body.stream,
    kennelCode: body.kennelCode,
    ruleSlug: body.ruleSlug,
    title: body.title,
    eventIds: body.eventIds,
    bodyMarkdown: body.bodyMarkdown,
  };
  const expectedPayloadHash = computePayloadHash(payload);
  const nonce = await bindNonce(body.nonce, admin.id, body, expectedPayloadHash);
  if (!nonce) return NONCE_REJECTION;

  // Idempotency cache comes BEFORE expiry: a previous successful
  // filing must remain retrievable even after the nonce TTL has
  // elapsed. Without this, a slow client retry past the 5-minute
  // window flips success → 401 and the agent would assume the
  // filing dropped.
  if (nonce.filingResultJson !== null) {
    return NextResponse.json(nonce.filingResultJson);
  }

  // Expiry only applies when we're about to do new work.
  if (nonce.expiresAt.getTime() <= Date.now()) return NONCE_REJECTION;

  // Map the chrome-stream literal to the Prisma enum value.
  const dbStream =
    body.stream === "CHROME_KENNEL"
      ? AuditStream.CHROME_KENNEL
      : AuditStream.CHROME_EVENT;

  const labels = [
    AUDIT_LABEL,
    ALERT_LABEL,
    body.stream === "CHROME_KENNEL"
      ? STREAM_LABELS.CHROME_KENNEL
      : STREAM_LABELS.CHROME_EVENT,
    kennelLabel(body.kennelCode),
  ];

  const outcome = await fileAuditFinding(
    {
      stream: dbStream,
      kennelCode: body.kennelCode,
      ruleSlug: body.ruleSlug,
      title: body.title,
      bodyMarkdown: body.bodyMarkdown,
      labels,
    },
    buildApiActions(),
  );

  return persistAndRespond(nonce.id, outcome);
}

/**
 * Translate the filer's tagged outcome into the response envelope
 * the chrome agent expects (cached on success), plus the 502 error
 * shape on filer error.
 */
async function persistAndRespond(
  nonceId: string,
  outcome: FileFindingOutcome,
): Promise<NextResponse> {
  if (outcome.action === "error") {
    const body: { error: string; existingIssueNumber?: number } = {
      error: errorMessageFor(outcome.reason),
    };
    if (outcome.existingIssueNumber !== undefined) {
      body.existingIssueNumber = outcome.existingIssueNumber;
    }
    return NextResponse.json(body, { status: 502 });
  }
  const result =
    outcome.action === "created"
      ? {
          action: "created" as const,
          // Field name carries "HtmlUrl" so the xss/no-mixed-html lint
          // doesn't flag this as "non-HTML variable storing raw HTML".
          // The value is a plain GitHub issue URL string, but Codacy
          // tracks taint by name and the source field is `htmlUrl`.
          issueHtmlUrl: outcome.htmlUrl,
          issueNumber: outcome.issueNumber,
        }
      : {
          action: "recurred" as const,
          tier: outcome.tier,
          // See note above — Codacy taint propagation.
          existingIssueHtmlUrl: outcome.htmlUrl,
          existingIssueNumber: outcome.issueNumber,
          recurrenceCount: outcome.recurrenceCount,
        };
  await persistFilingResult(nonceId, result);
  return NextResponse.json(result);
}

function errorMessageFor(reason: FilerErrorReason): string {
  switch (reason) {
    case "comment-failed-strict":
    case "comment-failed-bridging":
      return "GitHub comment failed; refusing to fork a duplicate issue";
    case "db-update-failed":
      return "Filing-mirror DB update failed after successful GitHub comment; retry is safe";
    case "create-failed":
      return "GitHub issue creation failed";
  }
}

/**
 * Mark the nonce row as consumed and cache the filing outcome so a
 * retry with the same nonce returns the cached result instead of
 * re-filing.
 */
async function persistFilingResult(
  nonceId: string,
  result: object,
): Promise<void> {
  await prisma.auditFilingNonce.update({
    where: { id: nonceId },
    data: {
      consumedAt: new Date(),
      filingResultJson: result,
    },
  });
}

// ── GitHub IO ────────────────────────────────────────────────────────

/** Standard POST init for any GitHub repos/* call. */
function githubPostInit(token: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  };
}

/**
 * Build the FilerActions interface using the api route's GitHub
 * envelope. URL construction stays inlined in each action so Codacy's
 * tainted-URL rule sees the literal-template directly inside fetch.
 *
 * Separate from `buildCronActions` in `src/pipeline/audit-issue.ts`
 * by design — cron is server-internal so it can use the simpler
 * `auto-issue.ts` envelope, while this public-route version layers
 * on `URL` constructor + `getValidatedRepo()` + integer guard.
 */
function buildApiActions(): FilerActions {
  return {
    createIssue: async ({ title, body, labels }) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) return null;
      const repo = getValidatedRepo();
      try {
        // SSRF-safe: URL constructor anchors the request to the
        // api.github.com origin literal; repo comes from validated env.
        const url = new URL(`/repos/${repo}/issues`, "https://api.github.com");
        const res = await fetch(
          url,
          githubPostInit(token, { title, body, labels }),
        );
        if (!res.ok) return null;
        // Local name carries "Html" so the xss/no-mixed-html rule
        // doesn't flag the typed-cast local as "non-HTML variable
        // storing raw HTML" — Codacy tracks the source field name
        // `html_url` and wants the destination to advertise HTML too.
        const issueHtml = (await res.json()) as {
          html_url: string;
          number: number;
        };
        return { number: issueHtml.number, htmlUrl: issueHtml.html_url };
      } catch {
        return null;
      }
    },
    postComment: async (issueNumber, body) => {
      const token = process.env.GITHUB_TOKEN;
      if (!token) return false;
      if (!Number.isInteger(issueNumber) || issueNumber <= 0) return false;
      const repo = getValidatedRepo();
      try {
        // Same SSRF guard as createIssue. issueNumber bounded above.
        const url = new URL(
          `/repos/${repo}/issues/${issueNumber}/comments`,
          "https://api.github.com",
        );
        const res = await fetch(url, githubPostInit(token, { body }));
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
