/**
 * One-off profile overrides for the O-cluster A bundle (#1818 OCHHH, #1866 Oregon H3).
 *
 * These fields are already non-null in prod with the old value, so the
 * fill-only seed merge can't correct them (see profile-override-runner.ts:
 * seed.ts:296-301 only fills NULL columns). `foundedYear` (Oregon, null→1987)
 * is NOT here — the seed fills it on the null path.
 *
 *   - ochhh.scheduleFrequency  Monthly → Biweekly                              (#1818)
 *   - ochhh.description        "…monthly Saturday morning hash." → "…biweekly…" (#1818)
 *   - oh3.scheduleFrequency    Biweekly → "Biweekly + Full Moon"               (#1866)
 *   - oh3.scheduleNotes        → "2nd & 4th Saturdays at 1pm plus Full Moon…"  (#1866)
 *   - oh3.description          → founder / Mother-Hash blurb                    (#1866)
 *
 * `expected` values captured from a prod read at planning time (2026-05-31);
 * the runner's drift guard refuses to clobber an admin edit made since.
 * Idempotent and drift-guarded. Default mode is DRY-RUN; pass --execute to apply.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-ocluster-a-profiles.ts            # dry-run
 *   npx tsx scripts/cleanup-ocluster-a-profiles.ts --execute  # apply
 */

import "dotenv/config";
import { runProfileOverrides, type ProfileOverride } from "./lib/profile-override-runner";

const OVERRIDES: ProfileOverride[] = [
  {
    kennelCode: "ochhh",
    rewrites: {
      scheduleFrequency: { expected: "Monthly", target: "Biweekly" },
      description: {
        expected: "Orange County monthly Saturday morning hash.",
        target: "Orange County biweekly Saturday morning hash.",
      },
    },
  },
  {
    kennelCode: "oh3",
    rewrites: {
      scheduleFrequency: { expected: "Biweekly", target: "Biweekly + Full Moon" },
      scheduleNotes: {
        expected: "Bi-weekly Saturdays plus full moon runs",
        target: "2nd & 4th Saturdays at 1pm plus Full Moon evening runs. Hotline 866-656-5477 for run info.",
      },
      description: {
        expected:
          "Oregon's flagship kennel. Bi-weekly Saturday afternoon trails plus full moon evening runs in the Portland metro area.",
        target:
          "Founded 17 May 1987 by Wrong Way Corrigan — THE Mother Hash of Oregon. Biweekly Saturday afternoon trails plus Full Moon evening runs in the Portland metro area. Tyrant I and founder: Mark 'Wrong Way Corrigan' Cook.",
      },
    },
  },
];

runProfileOverrides(OVERRIDES, {
  execute: process.argv.includes("--execute"),
  scriptName: "cleanup-ocluster-a-profiles",
}).catch((err) => {
  console.error("\nFatal error:", err);
  // Set exitCode (not process.exit) so the runner's prisma.$disconnect()/pool.end()
  // in its finally block drain cleanly before the process ends.
  process.exitCode = 1;
});
