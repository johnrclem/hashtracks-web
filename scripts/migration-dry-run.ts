/**
 * Dry-run a migration against DATABASE_URL: run it inside one transaction, report what it would
 * change, and always roll back.
 *
 *   npx tsx scripts/migration-dry-run.ts prisma/migrations/<dir>            # or …/<dir>/migration.sql
 *   npx tsx scripts/migration-dry-run.ts <file> --errors=sqlstate          # CI: no server error text
 *
 * Replaces `( echo 'BEGIN;'; cat migration.sql; echo 'ROLLBACK;' ) | psql`, which commits any file
 * that carries its own COMMIT. Here the file is parsed first and refused, before connecting, if it
 * has transaction control other than one leading BEGIN and one trailing COMMIT, or anything whose
 * effect escapes a rollback. Statements run through node-postgres, never psql, so psql
 * meta-commands like `\!` don't parse and are refused too.
 *
 * Remote hosts need BACKFILL_ALLOW_SELF_SIGNED_CERT=1 for the Railway proxy (see scripts/lib/db-pool.ts).
 *
 * Exit codes: 0 ran and rolled back; 1 a statement failed (rolled back); 2 refused or bad usage;
 * 3 the transaction ended early, so something may have committed.
 */
import "dotenv/config";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { parseMigrationSql } from "@/lib/migration-sql/parse";
import {
  analyzeTransactionShape,
  findDryRunEscapes,
  noTransactionReason,
} from "@/lib/migration-sql/transaction";
import { scriptSslConfig } from "./lib/db-pool";

/** Commands whose changes the per-table insert/update/delete counts include. */
const COUNTED_COMMANDS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE", "SELECT", "SET"]);

function fail(code: number, lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(code);
}

function resolveMigrationFile(arg: string): string {
  const file = statSync(arg, { throwIfNoEntry: false })?.isDirectory() ? path.join(arg, "migration.sql") : arg;
  if (!existsSync(file)) fail(2, [`No migration file at ${file}`]);
  return file;
}

interface StatementResult {
  index: number;
  command: string;
  rowCount: number | null;
}

interface TableDelta {
  relname: string;
  inserted: number;
  updated: number;
  deleted: number;
}

async function main() {
  const args = process.argv.slice(2);
  const sqlstateOnly = args.includes("--errors=sqlstate");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) fail(2, ["Usage: npx tsx scripts/migration-dry-run.ts <migration dir or .sql file> [--errors=sqlstate]"]);

  const file = resolveMigrationFile(target);
  const sql = readFileSync(file, "utf8");

  const reason = noTransactionReason(sql);
  if (reason !== undefined) {
    fail(2, [`Refused: ${file} is marked no-transaction (${reason}); it can't run inside a rollback.`]);
  }
  const parsed = await parseMigrationSql(sql);
  if (!parsed.ok) fail(2, [`Refused: ${file} does not parse as Postgres SQL: ${parsed.error}`]);
  const shape = analyzeTransactionShape(parsed.statements);
  const problems = shape.ok ? findDryRunEscapes(shape.body) : shape.problems;
  if (!shape.ok || problems.length > 0) {
    fail(2, [`Refused: ${file}`, ...problems.map((p) => `  - ${p}`)]);
  }
  // The file's own SET LOCAL runs after ours and wins, so say when it changes the limits.
  const ownTimeouts = shape.body.filter(
    (s) => s.type === "VariableSetStmt" && /^(lock|statement)_timeout$/.test(String(s.node.name)),
  );

  const url = process.env.DATABASE_URL;
  if (!url) fail(2, ["DATABASE_URL is not set"]);
  const client = new pg.Client({
    connectionString: url,
    ssl: scriptSslConfig(url),
    application_name: "migration-dry-run",
  });
  await client.connect();
  const currentXid = async (): Promise<string> =>
    (await client.query("SELECT pg_current_xact_id()::text AS xid")).rows[0].xid;

  const results: StatementResult[] = [];
  let failure: { index: number; sqlstate?: string; message: string } | undefined;
  let deltas: TableDelta[] = [];
  let endedEarly = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const xid = await currentXid();

    for (const stmt of shape.body) {
      try {
        const res = await client.query(stmt.text);
        results.push({ index: stmt.index, command: res.command, rowCount: res.rowCount });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        failure = { index: stmt.index, sqlstate: e.code, message: e.message ?? String(err) };
        break;
      }
    }

    if (!failure) {
      // Every statement must have run in the transaction opened above. A different xid means it
      // ended early and later statements autocommitted.
      const after = await currentXid();
      endedEarly = after !== xid;
      deltas = (
        await client.query<TableDelta>(
          `SELECT relname, n_tup_ins::int AS inserted, n_tup_upd::int AS updated, n_tup_del::int AS deleted
             FROM pg_stat_xact_user_tables
            WHERE n_tup_ins + n_tup_upd + n_tup_del > 0
            ORDER BY relname`,
        )
      ).rows;
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }

  console.log(`Dry run of ${file} (${shape.shape}, ${shape.body.length} statements)`);
  for (const s of ownTimeouts) {
    console.log(`  note: statement ${s.index + 1} sets its own ${String(s.node.name)}, replacing the dry run's limit`);
  }
  for (const r of results) {
    console.log(`  #${r.index + 1}  ${r.command}${r.rowCount === null ? "" : `  ${r.rowCount} rows`}`);
  }
  if (failure) {
    const detail = sqlstateOnly ? "" : `: ${failure.message}`;
    console.log(`  #${failure.index + 1}  FAILED  SQLSTATE ${failure.sqlstate ?? "unknown"}${detail}`);
  } else {
    console.log("Rows changed per table:");
    if (deltas.length === 0) console.log("  (none)");
    for (const d of deltas) {
      console.log(`  ${d.relname}: +${d.inserted} inserted, ${d.updated} updated, ${d.deleted} deleted`);
    }
    // TRUNCATE and DDL change data without touching these counters.
    const uncounted = results.filter((r) => !COUNTED_COMMANDS.has(r.command));
    if (uncounted.length > 0) {
      console.log("Not reflected in the counts above (TRUNCATE, DDL and the like):");
      for (const r of uncounted) console.log(`  #${r.index + 1}  ${r.command}`);
    }
  }
  if (endedEarly) {
    fail(3, ["The transaction ended early. Some statements may have committed: check the database now."]);
  }
  console.log("Rolled back. Nothing was committed.");
  process.exit(failure ? 1 : 0);
}

main().catch((err) => fail(2, [err instanceof Error ? err.message : String(err)]));
