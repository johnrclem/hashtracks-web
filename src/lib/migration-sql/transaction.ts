/**
 * Transaction rules for migration files.
 *
 * `prisma migrate deploy` does not wrap a migration in a transaction: each statement autocommits.
 * A file without its own BEGIN/COMMIT can half-apply, and the failed row in `_prisma_migrations`
 * then blocks every later deploy until someone runs `prisma migrate resolve` (#2937). A file that
 * carries its own COMMIT also defeats the old `BEGIN; cat file; ROLLBACK` dry run, which commits
 * at the file's COMMIT. These checks catch both before anything runs.
 */
import { parseMigrationSql, type MigrationStatement } from "./parse";

/**
 * Marks a migration that cannot run in a transaction block. Must sit on its own line with a reason:
 * `-- migration: no-transaction (CREATE INDEX CONCURRENTLY on Event)`.
 */
const NO_TRANSACTION_MARKER_RE = /^--[ \t]*migration:[ \t]*no-transaction[ \t]*\(([^)\n]*)\)[ \t]*$/m;

/** "wrapped": one leading BEGIN and one trailing COMMIT. "bare": no transaction control at all. */
export type TransactionShape = "wrapped" | "bare";

export interface ShapeResult {
  shape?: TransactionShape;
  /** The statements between the wrapper, or every statement when bare. */
  body: MigrationStatement[];
  problems: string[];
}

function transactionKind(stmt: MigrationStatement): string | undefined {
  return stmt.type === "TransactionStmt" ? String(stmt.node.kind) : undefined;
}

function describe(stmt: MigrationStatement): string {
  const kind = transactionKind(stmt);
  const label = kind ? kind.replace("TRANS_STMT_", "") : stmt.type;
  return `statement ${stmt.index + 1} (${label}${stmt.node.chain ? " AND CHAIN" : ""})`;
}

/**
 * Accepts either no transaction control at all, or exactly one leading BEGIN and one trailing
 * plain COMMIT. Anything else (END or COMMIT mid-file, ABORT, ROLLBACK, START TRANSACTION,
 * COMMIT AND CHAIN, savepoints, PREPARE TRANSACTION) is a problem.
 */
export function analyzeTransactionShape(statements: MigrationStatement[]): ShapeResult {
  const first = statements[0];
  const last = statements.at(-1);
  const opens = first !== undefined && transactionKind(first) === "TRANS_STMT_BEGIN";
  const closes =
    statements.length > 1 &&
    last !== undefined &&
    transactionKind(last) === "TRANS_STMT_COMMIT" &&
    !last.node.chain;

  const wrapper = new Set<MigrationStatement>();
  if (opens && closes) {
    wrapper.add(first);
    wrapper.add(last);
  }
  const strays = statements.filter((s) => s.type === "TransactionStmt" && !wrapper.has(s));
  const problems = strays.map(
    (s) =>
      `${describe(s)}: transaction control is allowed only as one leading BEGIN and one trailing COMMIT`,
  );
  if (problems.length > 0) return { body: [], problems };

  if (wrapper.size > 0) return { shape: "wrapped", body: statements.slice(1, -1), problems };
  return { shape: "bare", body: statements, problems };
}

export function noTransactionReason(sql: string): string | undefined {
  const match = NO_TRANSACTION_MARKER_RE.exec(sql);
  return match ? match[1].trim() : undefined;
}

/** Statements that cannot run inside a transaction block, which the marker exists for. */
function isNonTransactionalDdl(stmt: MigrationStatement): boolean {
  if (stmt.type === "IndexStmt") return stmt.node.concurrent === true;
  // ALTER TYPE … ADD VALUE has `newVal` and no `oldVal`; RENAME VALUE has both.
  if (stmt.type === "AlterEnumStmt") return stmt.node.newVal !== undefined && stmt.node.oldVal === undefined;
  return false;
}

function isLocalLockTimeout(stmt: MigrationStatement | undefined): boolean {
  return (
    stmt?.type === "VariableSetStmt" &&
    stmt.node.name === "lock_timeout" &&
    stmt.node.is_local === true
  );
}

/**
 * The CI rule for a newly added migration file. Either:
 * - wrapped: BEGIN; SET LOCAL lock_timeout = '…'; …; COMMIT; with no other transaction control; or
 * - marked `-- migration: no-transaction (<reason>)` and made only of statements that cannot run in
 *   a transaction (CREATE INDEX CONCURRENTLY, ALTER TYPE … ADD VALUE).
 */
export async function checkNewMigration(sql: string): Promise<string[]> {
  const parsed = await parseMigrationSql(sql);
  if (!parsed.ok) return [`does not parse as Postgres SQL: ${parsed.error}`];
  const { statements } = parsed;
  if (statements.length === 0) return ["contains no statements"];

  const reason = noTransactionReason(sql);
  if (reason !== undefined) {
    if (reason === "") return ["the no-transaction marker needs a reason in its parentheses"];
    return statements
      .filter((s) => !isNonTransactionalDdl(s))
      .map(
        (s) =>
          `${describe(s)}: a no-transaction migration may contain only CREATE INDEX CONCURRENTLY or ALTER TYPE … ADD VALUE`,
      );
  }

  const shape = analyzeTransactionShape(statements);
  if (shape.problems.length > 0) return shape.problems;
  if (shape.shape !== "wrapped") {
    return [
      "must start with BEGIN; and end with COMMIT; (prisma migrate deploy autocommits each statement otherwise)",
    ];
  }
  if (!isLocalLockTimeout(shape.body[0])) {
    return ["the statement after BEGIN must be SET LOCAL lock_timeout = '5s' (or another value)"];
  }
  if (shape.body.length < 2) return ["contains no statements besides the transaction wrapper"];
  return [];
}

/** Names of functions that act outside the current transaction, so a rollback can't undo them. */
const OUT_OF_TRANSACTION_FUNCTION_RE = /^dblink/i;

function callsOutOfTransactionFunction(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(callsOutOfTransactionFunction);
  if (node === null || typeof node !== "object") return false;
  for (const [key, value] of Object.entries(node)) {
    if (key === "FuncCall") {
      const names = (value as { funcname?: { String?: { sval?: string } }[] }).funcname ?? [];
      const name = names.at(-1)?.String?.sval ?? "";
      if (OUT_OF_TRANSACTION_FUNCTION_RE.test(name)) return true;
    }
    if (callsOutOfTransactionFunction(value)) return true;
  }
  return false;
}

/**
 * Statements a dry run refuses because their effects escape the transaction or reach outside the
 * database. This guards against mistakes; it is not a sandbox for hostile SQL.
 */
export function findDryRunEscapes(statements: MigrationStatement[]): string[] {
  const problems: string[] = [];
  for (const stmt of statements) {
    if (stmt.type === "CopyStmt" || stmt.type === "CreateExtensionStmt" || stmt.type === "LoadStmt") {
      problems.push(`${describe(stmt)}: not allowed in a dry run`);
    } else if (callsOutOfTransactionFunction(stmt.node)) {
      problems.push(`${describe(stmt)}: calls a dblink function, which commits outside the transaction`);
    }
  }
  return problems;
}
