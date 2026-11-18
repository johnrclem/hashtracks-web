/**
 * The server half of the owner step-up (design 10.3): Clerk's own check plus
 * the server's `fva`/`iat` checks on a token the page fetched fresh for this
 * request. The token is verified with the app's Clerk key and must belong to
 * the signed-in session, so a token minted for another session can't be
 * replayed here. Only the owner (OWNER_CLERK_USER_ID) may step up; with the
 * variable unset, every step-up is refused.
 *
 * Clerk's check is `{ level: "second_factor", afterMinutes: 1 }`. The design
 * names `strict_mfa`, but Clerk defines that as BOTH factors within 10
 * minutes, which a TOTP-only verification can't meet unless the owner also
 * signed in in the last 10 minutes. The server's own `fva[1] === 0` check is
 * the binding one either way, and it refuses an account with no second
 * factor, the downgrade case `strict_mfa` was chosen to catch.
 */
import { auth, verifyToken } from "@clerk/nextjs/server";
import { checkStepUp, type StepUpChecks } from "./step-up";

export const STEP_UP_CLERK_CHECK = { level: "second_factor", afterMinutes: 1 } as const;

export interface StepUpRequest {
  checks: StepUpChecks;
  clerkSessionId: string | null;
  clerkUserId: string | null;
}

export async function serverStepUpChecks(freshToken: string, nowMs = Date.now()): Promise<StepUpRequest> {
  const session = await auth();
  let claims: Record<string, unknown> | null = null;
  try {
    claims = (await verifyToken(freshToken, { secretKey: process.env.CLERK_SECRET_KEY })) as unknown as Record<string, unknown>;
  } catch {
    claims = null; // expired, malformed or foreign: the checks below refuse it
  }
  const checks = checkStepUp({ clerkStrictMfa: session.has({ reverification: STEP_UP_CLERK_CHECK }), claims, nowMs });
  if (!session.sessionId || claims?.sid !== session.sessionId) {
    checks.refusals.unshift("session-mismatch");
    checks.ok = false;
  }
  const owner = process.env.OWNER_CLERK_USER_ID?.trim();
  if (!owner || session.userId !== owner) {
    checks.refusals.unshift("not-owner");
    checks.ok = false;
  }
  return { checks, clerkSessionId: session.sessionId ?? null, clerkUserId: session.userId ?? null };
}
