/**
 * Phase 0 check (docs/onboarding-backfill-automation-design.md 10.3, section 13):
 * read the `fva` of a session token minted through Clerk's Backend API
 * (`sessions.getToken`) for a session with no recent second factor, and say
 * whether the server's step-up checks would accept it.
 *
 * Development instance only: refuses a live key.
 *
 *   CLERK_SECRET_KEY=sk_test_... npx tsx scripts/backfill/clerk-backend-token-fva.ts <sessionId>
 *
 * Prints the token's fva, iat and the checks' verdict. Never prints the token.
 */
import "dotenv/config";
import { createClerkClient } from "@clerk/backend";
import { checkStepUp } from "@/lib/backfill/step-up";

async function main() {
  const sessionId = process.argv[2];
  const secretKey = process.env.CLERK_SECRET_KEY ?? "";
  if (!sessionId) throw new Error("usage: clerk-backend-token-fva.ts <sessionId>");
  if (!secretKey.startsWith("sk_test_")) throw new Error("Refusing: CLERK_SECRET_KEY is not a development (sk_test_) key");
  const clerk = createClerkClient({ secretKey });
  const { jwt } = await clerk.sessions.getToken(sessionId);
  const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
  const checks = checkStepUp({ clerkStrictMfa: true, claims });
  console.log(JSON.stringify({ sessionId, fva: claims.fva ?? null, iat: claims.iat ?? null, verdict: checks.ok ? "would pass checks 2 and 3" : checks.refusals }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
