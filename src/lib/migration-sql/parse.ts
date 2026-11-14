/**
 * Splits a migration file into statements with Postgres's own parser (libpg_query, Postgres 17
 * grammar, matching Railway). Comments, string literals and dollar-quoted bodies can't hide a
 * statement from it the way they can from a regex or a line scan. Shared by the dry-run tool,
 * the CI migration check and, later, the G17 allow-list checker.
 */
import { loadModule, parseSync } from "libpg-query";

export interface MigrationStatement {
  /** 0-based position in the file. */
  index: number;
  /** Parse-node type, e.g. "InsertStmt" or "TransactionStmt". */
  type: string;
  /** The parse-tree node under `type`. */
  node: Record<string, unknown>;
  /** Source text of the statement, without its trailing semicolon. May carry leading comments. */
  text: string;
}

export type ParseOutcome =
  | { ok: true; statements: MigrationStatement[] }
  | { ok: false; error: string };

interface RawStmt {
  stmt: Record<string, Record<string, unknown>>;
  stmt_location?: number;
  stmt_len?: number;
}

let moduleReady: Promise<void> | undefined;

export async function parseMigrationSql(sql: string): Promise<ParseOutcome> {
  moduleReady ??= loadModule();
  await moduleReady;

  let stmts: RawStmt[];
  try {
    stmts = (parseSync(sql) as { stmts?: RawStmt[] }).stmts ?? [];
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // libpg_query reports UTF-8 byte offsets, so slice bytes, not UTF-16 string indexes:
  // migrations carry names like "São Paulo" and "Zürich".
  const bytes = new TextEncoder().encode(sql);
  const decoder = new TextDecoder();
  const statements = stmts.map((raw, index): MigrationStatement => {
    const [type, node] = Object.entries(raw.stmt)[0];
    const start = raw.stmt_location ?? 0;
    // A zero or missing length means "to the end of the input" (the last statement).
    const end = raw.stmt_len ? start + raw.stmt_len : bytes.length;
    return { index, type, node, text: decoder.decode(bytes.subarray(start, end)).trim() };
  });
  return { ok: true, statements };
}
