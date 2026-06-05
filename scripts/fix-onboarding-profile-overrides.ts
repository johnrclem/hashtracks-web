/**
 * One-off profile overrides for the Paris / NSWHHH onboarding-cleanup bundle
 * (#1972, #1974).
 *
 * These fields are already non-null in prod, so the fill-only seed merge can't
 * correct them (see profile-override-runner.ts):
 *
 *   - sans-clue-h3.description → reattribute the "~1993" founding inference to
 *       Sans Clue itself instead of cross-wiring it onto Paris H3 (the 1981
 *       original). The prior wording "Paris H3 (est. ~1993)" contradicted
 *       Paris H3's own foundedYear/description. (#1974)
 *   - nswhhh.hashCash → drift-guarded no-op: the #1972 audit flagged a "$$5"
 *       double-dollar artifact, but a prod query (2026-06-04) showed prod
 *       already holds the correct "$5 (first run free)". Kept here as a safety
 *       net — the runner reports "already correct" when current === target, and
 *       still corrects a "$$5" value if one ever reappears. (#1972)
 *
 * Idempotent and drift-guarded. Default mode is DRY-RUN; pass --execute to apply.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/fix-onboarding-profile-overrides.ts            # dry-run
 *   npx tsx scripts/fix-onboarding-profile-overrides.ts --execute  # apply
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

// `expected` captured from the prod-state query at authoring time (2026-06-04).
const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "sans-clue-h3",
    rewrites: {
      description: {
        expected:
          "Sister hash to Paris H3 (est. ~1993), running alternating Sundays around central Paris. A-to-B trails set by a hare, beer stops along the way, most trails walker-friendly. 'Sans Clue' = without a clue.",
        target:
          "Sister hash to Paris H3 (France's original 1981 kennel), itself running alternating Sundays around central Paris since around 1993. A-to-B trails set by a hare, beer stops along the way, most trails walker-friendly. 'Sans Clue' = without a clue.",
      },
    },
  },
  {
    kennelCode: "nswhhh",
    rewrites: {
      hashCash: {
        // Accept either the audit-reported "$$5" artifact or the already-correct
        // value; current === target short-circuits to a no-op either way.
        expected: ["$$5 (first run free)", "$5 (first run free)"],
        target: "$5 (first run free)",
      },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "fix-onboarding-profile-overrides",
}).catch((err) => {
  console.error("\nFatal error:", err);
  // Set exitCode (not process.exit) so the runner's prisma.$disconnect()/pool.end()
  // in its finally block drain cleanly before the process ends.
  process.exitCode = 1;
});
