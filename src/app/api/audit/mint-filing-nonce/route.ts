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

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  generateNonce,
  hashNonce,
  computeNonceExpiresAt,
  isValidOrigin,
} from "@/lib/audit-nonce";

interface MintRequest {
  kennelCode: string;
  ruleSlug: string;
  /** sha256 of the canonical filing payload — see
   *  `computePayloadHash` in audit-nonce.ts. The agent computes
   *  this client-side, the consume endpoint recomputes from the
   *  posted body and rejects on mismatch. */
  payloadHash: string;
}

function isMintRequest(value: unknown): value is MintRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kennelCode === "string" &&
    typeof v.ruleSlug === "string" &&
    typeof v.payloadHash === "string" &&
    /^[0-9a-f]{64}$/.test(v.payloadHash)
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  // Origin check first so CSRF attempts don't even reach the DB.
  if (!isValidOrigin(req.headers.get("origin"))) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isMintRequest(body)) {
    return NextResponse.json(
      { error: "Missing or malformed kennelCode / ruleSlug / payloadHash" },
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
      payloadHash: body.payloadHash,
      expiresAt: computeNonceExpiresAt(),
    },
  });

  // Don't cache — every response is unique and admin-bound.
  return NextResponse.json(
    { nonce: raw },
    { headers: { "Cache-Control": "no-store" } },
  );
}
