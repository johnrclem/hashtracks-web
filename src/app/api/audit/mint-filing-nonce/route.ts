/**
 * Mint a single-use, payload-bound nonce for the chrome-stream audit
 * filing flow. See `src/lib/audit-nonce.ts` for lifecycle background.
 *
 * Auth model: requires an active Clerk admin session AND a valid
 * Origin header matching `getCanonicalSiteUrl()`. The Origin check
 * defends against CSRF — without it, a malicious page in the admin's
 * browser could mint nonces by riding the Clerk cookie.
 *
 * The endpoint returns the raw nonce in the response body. Only its
 * sha256 hash is persisted (`AuditFilingNonce.nonceHash`). The DB row
 * carries `(adminUserId, kennelCode, ruleSlug, payloadHash)` so the
 * file-finding endpoint can verify on consume that the request body
 * matches the payload hash committed at mint time.
 */

import { NextResponse } from "next/server";

import { authorizeAuditApi } from "@/lib/audit-api-auth";
import { prisma } from "@/lib/db";
import {
  generateNonce,
  hashNonce,
  computeNonceExpiresAt,
  computePayloadHash,
  type FilingPayload,
} from "@/lib/audit-nonce";

/**
 * Pre-hashed shape: caller computed `payloadHash` client-side. Used
 * by tooling that wants an explicit binding of the agent's intent.
 */
interface PreHashedMintRequest {
  kennelCode: string;
  ruleSlug: string;
  payloadHash: string;
}

/**
 * Canonical-fields shape: caller posts the full payload and the
 * server computes the hash. This is the path used by the chrome
 * prompts (5c-C) — agents don't need to call `crypto.subtle`.
 *
 * Same security envelope as the pre-hashed variant: the server's
 * `computePayloadHash` produces the same value the consume
 * endpoint will recompute from its request body, so a leaked nonce
 * still only files the exact (kennel, rule, title, body) it was
 * minted for.
 */
interface CanonicalFieldsMintRequest {
  stream: "CHROME_KENNEL" | "CHROME_EVENT";
  kennelCode: string;
  ruleSlug: string;
  title: string;
  eventIds: string[];
  bodyMarkdown: string;
}

type MintRequest = PreHashedMintRequest | CanonicalFieldsMintRequest;

function isPreHashedMintRequest(v: Record<string, unknown>): v is PreHashedMintRequest & Record<string, unknown> {
  return (
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string" &&
    typeof v.payloadHash === "string" &&
    /^[0-9a-f]{64}$/.test(v.payloadHash)
  );
}

function isCanonicalFieldsMintRequest(
  v: Record<string, unknown>,
): v is CanonicalFieldsMintRequest & Record<string, unknown> {
  return (
    (v.stream === "CHROME_KENNEL" || v.stream === "CHROME_EVENT") &&
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string" &&
    typeof v.title === "string" &&
    Array.isArray(v.eventIds) &&
    v.eventIds.every((id) => typeof id === "string") &&
    typeof v.bodyMarkdown === "string"
  );
}

function isMintRequest(value: unknown): value is MintRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isPreHashedMintRequest(v) || isCanonicalFieldsMintRequest(v);
}

/**
 * Resolve the payload hash from either the pre-hashed shape or the
 * canonical-fields shape. Both end up persisted to the same nonce
 * row for verification at consume time.
 */
function resolvePayloadHash(req: MintRequest): string {
  if ("payloadHash" in req) return req.payloadHash;
  const payload: FilingPayload = {
    stream: req.stream,
    kennelCode: req.kennelCode,
    ruleSlug: req.ruleSlug,
    title: req.title,
    eventIds: req.eventIds,
    bodyMarkdown: req.bodyMarkdown,
  };
  return computePayloadHash(payload);
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await authorizeAuditApi(req);
  if (!auth.ok) return auth.response;
  const { admin, body } = auth;

  if (!isMintRequest(body)) {
    return NextResponse.json(
      {
        error:
          "Body must be either {kennelCode, ruleSlug, payloadHash} or {stream, kennelCode, ruleSlug, title, eventIds, bodyMarkdown}",
      },
      { status: 400 },
    );
  }

  const raw = generateNonce();
  await prisma.auditFilingNonce.create({
    data: {
      nonceHash: hashNonce(raw),
      adminUserId: admin.id,
      kennelCode: body.kennelCode,
      ruleSlug: body.ruleSlug,
      payloadHash: resolvePayloadHash(body),
      expiresAt: computeNonceExpiresAt(),
    },
  });

  // Don't cache — every response is unique and admin-bound.
  return NextResponse.json(
    { nonce: raw },
    { headers: { "Cache-Control": "no-store" } },
  );
}
