/**
 * One-off overrides for the cycle-6 profile bundle PR (#1380, #1392, #1393).
 *
 * Background: prisma/seed.ts performs a fill-only merge for existing kennels —
 * it never overwrites an already-populated column (seed.ts:296-301), and
 * `fullName` is set only at create time (not in PROFILE_FIELDS). This script
 * applies the rewrites that can't be expressed in seed:
 *   - gynoh3.fullName  → "Gyrls Night Out Hash House Harriers"     (#1393)
 *   - gynoh3.description → expanded blurb with founding details    (#1393)
 *   - kimchi-h3.description → expanded blurb with Korean lineage   (#1380)
 *
 * Each rewrite carries the EXPECTED current value (captured from the cycle-6 PR
 * Step 0 prod-state query) so the runner refuses to overwrite admin curations
 * applied between merge and execution.
 *
 * Idempotent and safe to re-run. Default mode is DRY-RUN; pass --execute to apply.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-cycle6-profile-overrides.ts            # dry-run
 *   npx tsx scripts/cleanup-cycle6-profile-overrides.ts --execute  # apply
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "gynoh3",
    rewrites: {
      fullName: {
        expected: "GyNO Hash House Harriers",
        target: "Gyrls Night Out Hash House Harriers",
      },
      description: {
        expected:
          "Memphis harriette kennel. Monthly events appearing on the Memphis H3 calendar.",
        target:
          "Women-only kennel in Memphis, TN, supported by Memphis Hash House Harriers. Founded October 20, 2025. Monthly trail on 3rd Mondays at 6:00 PM, with a Harriette Happy Hour the 1st Thursday of each month.",
      },
    },
  },
  {
    kennelCode: "kimchi-h3",
    rewrites: {
      description: {
        expected:
          "Colorado Springs biweekly Saturday afternoon hash, alternating weeks with Pikes Peak.",
        target:
          "Colorado Springs biweekly Saturday afternoon hash, alternating weeks with Pikes Peak. Founded in 2002 by Yongsan Kimchi H3 (Korea) alumni to offset PPH4 with a Saturday hash; name lineage from the original Seoul Kimchi kennel.",
      },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "cleanup-cycle6-profile-overrides",
}).catch((err) => {
  console.error("\nFatal error:", err);
  process.exitCode = 1;
});
