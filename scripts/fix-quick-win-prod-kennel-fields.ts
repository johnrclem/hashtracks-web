/**
 * One-shot prod fixups for kennel profile fields the seed merge cannot apply.
 * `ensureKennelProfiles` in `prisma/seed.ts` is fill-only — it only writes a
 * field when the column is NULL, and never nulls a column. So two changes need
 * a hand override:
 *
 *   - PalH3 (#1903/#1904): schedule was "Monthly" (wrong) and the description
 *     described monthly 3rd-Saturday runs. The kennel runs the 2nd & 4th
 *     Saturday — both are non-NULL overwrites the seed won't make.
 *   - PBH3 (#1921): `website` https://www.pbh3.org is a dead GoDaddy parking
 *     page; the seed never nulls a value, so removing it from the seed file
 *     alone leaves prod untouched. Cleared here.
 *
 * All other new PalH3/OSH3/H7 profile fields (logoUrl, contactEmail, hashCash,
 * scheduleTime, scheduleNotes, website) are NULL in prod and land via the
 * normal `npx prisma db seed` fill — they are intentionally NOT repeated here.
 *
 * Each rewrite carries the EXPECTED current value, so the shared runner refuses
 * to clobber an admin edit applied between merge and execution (drift guard).
 *
 * Run order (POST-merge — Vercel deploys schema but not seed data):
 *   1. npx prisma db seed                                            # fills NULLs
 *   2. npx tsx scripts/fix-quick-win-prod-kennel-fields.ts           # dry run
 *   3. npx tsx scripts/fix-quick-win-prod-kennel-fields.ts --execute # apply
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "palh3",
    rewrites: {
      scheduleFrequency: { expected: "Monthly", target: "Twice monthly" },
      description: {
        expected: "Monthly Saturday runs based in Sumter, SC. Small kennel from Columbia-area hashers.",
        target:
          "Twice-monthly Saturday runs (2nd & 4th Saturday) based in Sumter, SC. Small kennel from Columbia-area hashers.",
      },
    },
  },
  {
    kennelCode: "pbh3",
    rewrites: {
      // Dead GoDaddy parking page (#1921). Cleared to NULL. Prod currently
      // stores the http:// form (verified by dry-run against the live DB); the
      // https:// form is accepted too so the clear works regardless of scheme.
      website: { expected: ["http://www.pbh3.org", "https://www.pbh3.org"], target: null },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "fix-quick-win-prod-kennel-fields",
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
