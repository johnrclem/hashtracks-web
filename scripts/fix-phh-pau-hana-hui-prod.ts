/**
 * One-shot prod fixup for PHH (phh-hi) — #2092.
 *
 * The stored kennel was mislabelled "Pearl Harbor Hash" with a "Pearl Harbor-area
 * hash kennel" description. PHH actually stands for **Pau Hana Hui** ("after-work
 * gathering"), the social arm of Aloha H3 — and it is NOT a hash at all. Every PHH
 * event DESCRIPTION self-defines: "PHH is not a hash, but an after-work social for
 * hashers (and the bold uninitiated)."
 *
 * `ensureKennelProfiles` in `prisma/seed.ts` is fill-only — it only writes a column
 * when it is NULL and never overwrites an existing value (seed.ts:300). Both
 * `fullName` and `description` are already non-NULL in prod with the wrong values,
 * so the corrected seed row alone cannot fix prod; this override is the only path.
 * `slug` ("phh") is a separate column and is left untouched, so /kennels/phh is
 * unaffected.
 *
 * Each rewrite carries the EXPECTED current value, so the shared runner refuses to
 * clobber an admin edit applied between merge and execution (drift guard).
 *
 * Run order (POST-merge — Vercel deploys schema but not seed data):
 *   1. npx tsx scripts/fix-phh-pau-hana-hui-prod.ts            # dry run
 *   2. npx tsx scripts/fix-phh-pau-hana-hui-prod.ts --execute  # apply
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

const NEW_DESCRIPTION =
  "Pau Hana Hui (PHH) is the after-work social arm of Aloha H3, Honolulu. Not a hash itself — no trails, no hares — but a regular gathering for hashers and the bold uninitiated. Events range from museum nights and burlesque festivals to monthly MisManagement meetings at local restaurants.";

const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "phh-hi",
    rewrites: {
      fullName: { expected: "Pearl Harbor Hash", target: "Pau Hana Hui" },
      description: {
        expected: "Pearl Harbor-area hash kennel. Events cross-posted on Aloha H3's shared calendar.",
        target: NEW_DESCRIPTION,
      },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "fix-phh-pau-hana-hui-prod",
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
