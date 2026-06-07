/**
 * One-shot prod fixup for PGH H3 (#2006).
 *
 * `ensureKennelProfiles` in `prisma/seed.ts` is fill-only — it writes a column
 * only when it is NULL and never overwrites a populated value (seed.ts:300). So
 * the wrong `foundedYear = 1983` already in prod cannot be corrected by the
 * normal `npx prisma db seed`; only a hand override can.
 *
 *   - foundedYear 1983 → 1980. The kennel's own history page
 *     (pghh3.com/a-brief-kennel-history-of-pittsburgh/) reads "founded in 1980 …
 *     Run #1 was June 14, 1980"; HashRego also says "Est. 1980".
 *
 * NOT included (intentionally):
 *   - hashCash — prod already holds the correct "$5" (the audit "$$5" was a
 *     markdown-escape display artifact, same as NSWHHH #1972). Nothing to fix.
 *   - logoUrl — NULL in prod, lands via the normal seed fill.
 *   - gm — left unset (the officers page lists "Grand Master Emeritus: Moon",
 *     which is an honorific, not a confirmed current GM).
 *
 * The rewrite carries the EXPECTED current value, so the shared runner refuses to
 * clobber an admin edit applied between merge and execution (drift guard).
 * Idempotent: a field already at the target is a no-op.
 *
 * Run order (POST-merge — Vercel deploys schema but not seed data):
 *   1. npx prisma db seed                                       # fills logoUrl, etc.
 *   2. npx tsx scripts/fix-pgh-h3-prod-profile.ts               # dry run
 *   3. npx tsx scripts/fix-pgh-h3-prod-profile.ts --execute     # apply
 *
 * IMPORTANT: .env must point at Railway prod for the update to take effect.
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "pgh-h3",
    rewrites: {
      foundedYear: { expected: 1983, target: 1980 },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "fix-pgh-h3-prod-profile",
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
