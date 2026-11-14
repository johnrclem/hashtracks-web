/**
 * CI check for migration files a pull request adds or changes.
 *
 *   npx tsx scripts/ci/check-migrations.ts --base HEAD^1     # CI, on the PR merge commit
 *   npx tsx scripts/ci/check-migrations.ts                    # local, against origin/main
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
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkNewMigration } from "@/lib/migration-sql/transaction";

const MIGRATION_FILE_RE = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

interface ChangedFile {
  status: string;
  file: string;
}

function changedMigrations(base: string): ChangedFile[] {
  const out = execFileSync("git", ["diff", "--name-status", "--no-renames", base, "HEAD", "--", "prisma/migrations"], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status, file };
    })
    .filter((c) => MIGRATION_FILE_RE.test(c.file));
}

async function main() {
  const args = process.argv.slice(2);
  let base = "origin/main";
  let allowModified = false;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base") base = args[++i];
    else if (args[i] === "--allow-modified") allowModified = true;
    else files.push(args[i]);
  }

  const changes: ChangedFile[] =
    files.length > 0 ? files.map((file) => ({ status: "A", file })) : changedMigrations(base);

  let failed = false;
  for (const { status, file } of changes) {
    if (status === "D" || (status !== "A" && !allowModified)) {
      console.log(
        `::error file=${file}::Migration files are immutable once added (git status ${status}). Add a new migration instead, or see docs/ops/system.md for fixing a migration that failed in prod.`,
      );
      failed = true;
      continue;
    }
    const problems = await checkNewMigration(readFileSync(file, "utf8"));
    if (problems.length === 0) {
      console.log(`ok  ${file}`);
      continue;
    }
    failed = true;
    for (const problem of problems) console.log(`::error file=${file}::${problem}`);
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
