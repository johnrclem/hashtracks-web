/**
 * Owner step-up for /admin/backfills (docs/onboarding-backfill-automation-design.md 10.3).
 *
 * Resume, undo, and setting or clearing a cutoff by hand each need a fresh
 * second factor. Clerk's `strict_mfa` reverification alone isn't enough: it
 * downgrades to the first factor for an account with no second factor, and it
 * is a 10-minute window. So the server runs three checks when it mints a
 * nonce and again when the nonce is used:
 *
 * 1. Clerk's own reverification check (see step-up-server.ts for the level);
 * 2. the session's `fva` claim is `[first, second]` whole minutes and the
 *    second value is 0: a second factor was entered within the last minute
 *    (`-1` means no second factor; missing or malformed is a refusal);
 * 3. the session token was issued less than 60 s ago (`iat`), allowing up to
 *    5 s of clock skew into the future; missing or non-numeric is a refusal.
 *
 * Nonces are single-use, bound to the Clerk session, the action, its run or
 * kennel and a payload hash, and expire 2 minutes after minting. The checks
 * on use are what bound the window; the expiry only limits how long an unused
 * nonce lingers.
 */
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type BackfillStepUpAction } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const STEP_UP_TOKEN_MAX_AGE_S = 60;
export const STEP_UP_FUTURE_SKEW_S = 5;
export const STEP_UP_NONCE_TTL_MS = 2 * 60 * 1000;

export interface StepUpInput {
  /** Result of Clerk's own reverification check (`has({ reverification })`). */
  clerkStrictMfa: boolean;
  /** The session token's claims (`sessionClaims`). */
  claims: Record<string, unknown> | null | undefined;
  nowMs?: number;
}

export interface StepUpChecks {
  ok: boolean;
  /** One entry per failed check; empty when ok. */
  refusals: Array<"not-owner" | "session-mismatch" | "strict-mfa" | "fva-missing" | "fva-malformed" | "no-second-factor" | "second-factor-stale" | "iat-missing" | "token-stale" | "token-future">;
  fva: unknown;
  iat: unknown;
  checkedAt: string;
}

/** Run the three step-up checks. Pure: Clerk's answer and the claims come in. */
export function checkStepUp({ clerkStrictMfa, claims, nowMs = Date.now() }: StepUpInput): StepUpChecks {
  const refusals: StepUpChecks["refusals"] = [];
  if (!clerkStrictMfa) refusals.push("strict-mfa");

  const fva = claims?.fva;
  if (fva === undefined || fva === null) refusals.push("fva-missing");
  else if (!Array.isArray(fva) || fva.length !== 2 || !fva.every((v) => Number.isInteger(v) && v >= -1)) refusals.push("fva-malformed");
  else if (fva[1] === -1) refusals.push("no-second-factor");
  else if (fva[1] !== 0) refusals.push("second-factor-stale");

  const iat = claims?.iat;
  if (typeof iat !== "number" || !Number.isFinite(iat)) refusals.push("iat-missing");
  else {
    const ageS = nowMs / 1000 - iat;
    if (ageS < -STEP_UP_FUTURE_SKEW_S) refusals.push("token-future");
    else if (ageS >= STEP_UP_TOKEN_MAX_AGE_S) refusals.push("token-stale");
  }
  return { ok: refusals.length === 0, refusals, fva: fva ?? null, iat: iat ?? null, checkedAt: new Date(nowMs).toISOString() };
}

function hashNonce(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export interface StepUpBinding {
  clerkSessionId: string;
  adminUserId: string;
  action: BackfillStepUpAction;
  runId?: string | null;
  kennelId?: string | null;
  /** The undo plan's hash, a cutoff date: what the action is bound to beyond run/kennel. */
  payloadHash?: string | null;
}

/** Mint a nonce if the checks pass. Returns the raw nonce (only its hash is stored). */
export async function mintStepUpNonce(
  binding: StepUpBinding,
  checks: StepUpChecks,
  now = new Date(),
): Promise<{ ok: true; nonce: string } | { ok: false; checks: StepUpChecks }> {
  if (!checks.ok) return { ok: false, checks };
  const nonce = randomBytes(32).toString("hex");
  await prisma.backfillStepUpNonce.create({
    data: {
      nonceHash: hashNonce(nonce),
      clerkSessionId: binding.clerkSessionId,
      adminUserId: binding.adminUserId,
      action: binding.action,
      runId: binding.runId ?? null,
      kennelId: binding.kennelId ?? null,
      payloadHash: binding.payloadHash ?? null,
      mintChecks: checks as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(now.getTime() + STEP_UP_NONCE_TTL_MS),
    },
  });
  return { ok: true, nonce };
}

export type ConsumeResult = { ok: true } | { ok: false; reason: "unknown-or-used" | "checks" ; checks?: StepUpChecks };

/**
 * Use a nonce: it must exist, be unused, unexpired and bound to exactly this
 * session, action, target and payload, and the three checks must pass again on
 * this request. The nonce is spent either way, so a failed use can't be retried.
 */
export async function consumeStepUpNonce(
  nonce: string,
  binding: StepUpBinding,
  checks: StepUpChecks,
  now = new Date(),
): Promise<ConsumeResult> {
  const spent = await prisma.backfillStepUpNonce.updateMany({
    where: {
      nonceHash: hashNonce(nonce),
      consumedAt: null,
      expiresAt: { gt: now },
      clerkSessionId: binding.clerkSessionId,
      adminUserId: binding.adminUserId,
      action: binding.action,
      runId: binding.runId ?? null,
      kennelId: binding.kennelId ?? null,
      payloadHash: binding.payloadHash ?? null,
    },
    data: { consumedAt: now, useChecks: checks as unknown as Prisma.InputJsonValue },
  });
  if (spent.count !== 1) return { ok: false, reason: "unknown-or-used" };
  return checks.ok ? { ok: true } : { ok: false, reason: "checks", checks };
}
