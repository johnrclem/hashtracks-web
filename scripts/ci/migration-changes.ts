/**
 * Which changed files are migrations, and which changes to them CI allows. Shared by the CI
 * migration check (`check-migrations.ts`) and the write gate (`write-gate.ts`), so the two agree
 * on what a migration change is. No I/O: callers pass file lists and contents in.
 */
export const MIGRATION_DIR_PREFIX = "prisma/migrations/";
export const MIGRATION_FILE_RE = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

export interface MigrationChange {
  /** git's name-status letter: A added, M modified, D deleted, … */
  status: string;
  file: string;
}

/** Parses `git diff --name-status` output, keeping only migration.sql files. */
export function parseNameStatus(out: string): MigrationChange[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status, file };
    })
    .filter((c) => MIGRATION_FILE_RE.test(c.file));
}

/**
 * Problems with one migration change, as CI annotations' text. Existing migration files are
 * immutable (editing one breaks its checksum and blocks every deploy) unless `allowModified`;
 * an added or allowed file must pass the template check.
 */
export async function checkMigrationChange(
  change: MigrationChange,
  readFile: (file: string) => string,
  allowModified: boolean,
): Promise<string[]> {
  if (change.status === "D" || (change.status !== "A" && !allowModified)) {
    return [
      `Migration files are immutable once added (git status ${change.status}). Add a new migration instead, or see docs/ops/system.md for fixing a migration that failed in prod.`,
    ];
  }
  // Loaded here, not at import: the write gate needs only the path rules, not the SQL parser.
  const { checkNewMigration } = await import("@/lib/migration-sql/transaction");
  return checkNewMigration(readFile(change.file));
}
