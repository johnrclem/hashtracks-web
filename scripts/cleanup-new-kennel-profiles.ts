/**
 * One-off profile overrides for the new-kennel hardening bundle (#1839, #1849).
 *
 * These two fields are already non-null in prod with the wrong value, so the
 * fill-only seed merge can't correct them (see profile-override-runner.ts):
 *   - bali-hash-2.facebookUrl → https://www.facebook.com/groups/balihash2/  (#1839)
 *       (was the bare page handle /BaliHash2; the site only links the group)
 *   - mijash3.contactEmail    → info@mijash3.com                            (#1849)
 *       (was the 5ksmh3 hareraiser mailbox; info@ is the site's canonical inbox)
 *
 * Idempotent and drift-guarded. Default mode is DRY-RUN; pass --execute to apply.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-new-kennel-profiles.ts            # dry-run
 *   npx tsx scripts/cleanup-new-kennel-profiles.ts --execute  # apply
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

// `expected` captured from the prod-state query at planning time (2026-05-30).
const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "bali-hash-2",
    rewrites: {
      facebookUrl: {
        expected: "https://www.facebook.com/BaliHash2",
        target: "https://www.facebook.com/groups/balihash2/",
      },
    },
  },
  {
    kennelCode: "mijash3",
    rewrites: {
      contactEmail: {
        expected: "5ksmh3@gmail.com",
        target: "info@mijash3.com",
      },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "cleanup-new-kennel-profiles",
}).catch((err) => {
  console.error("\nFatal error:", err);
  // Set exitCode (not process.exit) so the runner's prisma.$disconnect()/pool.end()
  // in its finally block drain cleanly before the process ends.
  process.exitCode = 1;
});
