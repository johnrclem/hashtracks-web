/**
 * CI check for migration files a pull request adds or changes.
 *
 *   git diff --name-status --no-renames origin/main HEAD -- prisma/migrations \
 *     | npx tsx scripts/ci/check-migrations.ts --stdin          # CI uses HEAD^1 on the merge commit
 *   npx tsx scripts/ci/check-migrations.ts path/to/migration.sql …
 *
 * Each added migration must parse, and must be wrapped in one BEGIN/COMMIT with
 * `SET LOCAL lock_timeout` right after BEGIN and no other transaction control, or carry the
 * `-- migration: no-transaction (<reason>)` marker (see checkNewMigration). Existing migration
 * files are immutable: editing one breaks its checksum and blocks every deploy. The one exception is
 * fixing a migration that failed in prod and never applied (docs/ops/system.md, "When a migration
 * fails in prod"): the PR carries the `migration-recovery` label, which CI turns into
 * `--allow-modified`. The edited file must still pass the checks.
 */
import { readFileSync } from "node:fs";
import { checkMigrationChange, parseNameStatus, type MigrationChange } from "./migration-changes";

async function main() {
  const args = process.argv.slice(2);
  const fromStdin = args.includes("--stdin");
  const allowModified = args.includes("--allow-modified");
  const files = args.filter((a) => !a.startsWith("--"));
  if (!fromStdin && files.length === 0) {
    console.error("Pass migration files, or pipe `git diff --name-status` output with --stdin.");
    process.exit(2);
  }

  const changes: MigrationChange[] = fromStdin
    ? parseNameStatus(readFileSync(0, "utf8"))
    : files.map((file) => ({ status: "A", file }));

  let failed = false;
  for (const change of changes) {
    const problems = await checkMigrationChange(change, (file) => readFileSync(file, "utf8"), allowModified);
    if (problems.length === 0) {
      console.log(`ok  ${change.file}`);
      continue;
    }
    failed = true;
    for (const problem of problems) console.log(`::error file=${change.file}::${problem}`);
  }
  if (changes.length === 0) console.log("No migration files added or changed.");
  if (failed) {
    console.log("\nTemplate and rules: docs/ops/system.md#migrations");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
