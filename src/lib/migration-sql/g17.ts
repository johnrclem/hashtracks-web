/**
 * G17: migration shape for automated backfills
 * (docs/onboarding-backfill-automation-design.md 8.1). Allow-list only, checked
 * with Postgres's own parser (libpg_query, via src/lib/migration-sql):
 *
 * - `INSERT … ON CONFLICT DO NOTHING` or `INSERT … SELECT … WHERE NOT EXISTS`
 *   into Kennel, KennelAlias, Region, Source, SourceKennel and ScheduleRule;
 * - `UPDATE "Region"` setting only parentId and updatedAt, whose target rows
 *   are restricted by literal names that the same migration inserts;
 * - transaction control only as the migration template's wrapper
 *   (docs/ops/system.md#migrations): one leading `BEGIN`, then one
 *   `SET LOCAL lock_timeout = '<literal>'`, and one trailing `COMMIT`.
 *
 * Nothing else: no CTE that modifies data, no DO blocks, and no function calls
 * but NOW() and timezone() with a literal zone. A Source insert that sets
 * archiveOnly true must also set enabled to the literal false (the CHECK in
 * 20261117120000_add_backfill_run_tables would otherwise fail the deploy).
 *
 * G17 only decides whether a backfill is automated; the migration still ships
 * through the ordinary code-merge review.
 *
 * Import from scripts and server-only code: the parser loads a WASM module (see
 * src/lib/migration-sql/parse.ts).
 */
import { parseMigrationSql, type MigrationStatement } from "./parse";
import { analyzeTransactionShape } from "./transaction";

type Node = Record<string, unknown>;

const INSERT_TABLES = new Set(["Kennel", "KennelAlias", "Region", "Source", "SourceKennel", "ScheduleRule"]);
const REGION_UPDATE_COLUMNS = new Set(["parentId", "updatedAt"]);
const DATA_MODIFYING = new Set(["InsertStmt", "UpdateStmt", "DeleteStmt", "MergeStmt"]);

function obj(v: unknown): Node | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : undefined;
}

/** The single `{ Type: node }` wrapper libpg_query uses for every node. */
function unwrap(v: unknown): [string, Node] | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const keys = Object.keys(o);
  return keys.length === 1 && obj(o[keys[0]]) ? [keys[0], o[keys[0]] as Node] : undefined;
}

function names(list: unknown): string[] {
  return Array.isArray(list) ? list.map((x) => String(obj(obj(x)?.String)?.sval ?? "")) : [];
}

/** A string literal, through any number of casts (`'x'::"RegionLevel"`). */
function stringLiteral(v: unknown): string | undefined {
  const w = unwrap(v);
  if (!w) return undefined;
  if (w[0] === "TypeCast") return stringLiteral(w[1].arg);
  if (w[0] === "A_Const") return obj(w[1].sval)?.sval as string | undefined;
  return undefined;
}

/** A boolean literal (`true`, `false`), or undefined for anything else. */
function boolLiteral(v: unknown): boolean | undefined {
  const w = unwrap(v);
  if (!w || w[0] !== "A_Const" || !("boolval" in w[1])) return undefined;
  return obj(w[1].boolval)?.boolval === true;
}

/** Walk every node of a parse tree, calling `visit(type, node)` for each wrapped node. */
function walk(v: unknown, visit: (type: string, node: Node) => void): void {
  if (Array.isArray(v)) {
    for (const x of v) walk(x, visit);
    return;
  }
  const o = obj(v);
  if (!o) return;
  for (const [k, child] of Object.entries(o)) {
    if (/^[A-Z]/.test(k) && obj(child)) visit(k, child as Node);
    walk(child, visit);
  }
}

function checkFunctionsAndCtes(stmt: MigrationStatement, problems: string[]): void {
  const where = `statement ${stmt.index + 1}`;
  walk(stmt.node, (type, node) => {
    if (type === "FuncCall") {
      const fn = names(node.funcname).filter((n) => n !== "pg_catalog").join(".").toLowerCase();
      if (fn === "now" && !(Array.isArray(node.args) && node.args.length)) return;
      if (fn === "timezone" && Array.isArray(node.args) && node.args.length === 2 && stringLiteral(node.args[0]) !== undefined) return;
      problems.push(`${where}: function ${fn || "?"}() is not allowed (only NOW() and timezone() with a literal zone)`);
    } else if (type === "SQLValueFunction") {
      problems.push(`${where}: SQL value functions like CURRENT_TIMESTAMP are not allowed; use NOW()`);
    } else if (type === "CommonTableExpr") {
      const inner = unwrap(node.ctequery);
      if (inner && DATA_MODIFYING.has(inner[0])) problems.push(`${where}: a CTE that modifies data is not allowed`);
    }
  });
}

/** `INSERT … SELECT … WHERE NOT EXISTS (…)`: the select's WHERE is, or ANDs in, NOT EXISTS. */
function hasNotExistsGuard(select: Node | undefined): boolean {
  const where = unwrap(select?.whereClause);
  if (!where || where[0] !== "BoolExpr") return false;
  const isNotExists = (n: [string, Node] | undefined) =>
    n?.[0] === "BoolExpr" &&
    n[1].boolop === "NOT_EXPR" &&
    unwrap((n[1].args as unknown[])?.[0])?.[0] === "SubLink" &&
    unwrap((n[1].args as unknown[])[0])?.[1].subLinkType === "EXISTS_SUBLINK";
  if (isNotExists(where)) return true;
  return where[1].boolop === "AND_EXPR" && ((where[1].args as unknown[]) ?? []).some((a) => isNotExists(unwrap(a)));
}

function valuesRows(insert: Node): unknown[][] | undefined {
  const select = obj(obj(insert.selectStmt)?.SelectStmt);
  const lists = select?.valuesLists;
  if (!Array.isArray(lists)) return undefined;
  return lists.map((l) => (obj(obj(l)?.List)?.items as unknown[]) ?? []);
}

function insertColumns(insert: Node): string[] {
  return ((insert.cols as unknown[]) ?? []).map((c) => String(obj(obj(c)?.ResTarget)?.name ?? ""));
}

function checkInsert(stmt: MigrationStatement, problems: string[]): void {
  const where = `statement ${stmt.index + 1}`;
  const node = stmt.node;
  const table = String(obj(node.relation)?.relname ?? "");
  if (!INSERT_TABLES.has(table)) return void problems.push(`${where}: INSERT into "${table}" is not allowed`);
  if (node.withClause) problems.push(`${where}: INSERT with a WITH clause is not allowed`);
  if (node.returningList) problems.push(`${where}: INSERT … RETURNING is not allowed`);
  const select = obj(obj(node.selectStmt)?.SelectStmt);
  const doNothing = obj(node.onConflictClause)?.action === "ONCONFLICT_NOTHING";
  if (!doNothing && !hasNotExistsGuard(select)) {
    problems.push(`${where}: INSERT into "${table}" needs ON CONFLICT DO NOTHING or SELECT … WHERE NOT EXISTS`);
  }

  if (table === "Source") {
    const cols = insertColumns(node);
    const archiveCol = cols.indexOf("archiveOnly");
    if (archiveCol === -1) return;
    const rows = valuesRows(node);
    if (!rows) return void problems.push(`${where}: a Source insert that sets archiveOnly must use VALUES`);
    const enabledCol = cols.indexOf("enabled");
    rows.forEach((row, i) => {
      const archive = boolLiteral(row[archiveCol]);
      if (archive === undefined) problems.push(`${where}: Source row ${i + 1} sets archiveOnly to a non-literal`);
      if (archive && (enabledCol === -1 || boolLiteral(row[enabledCol]) !== false)) {
        problems.push(`${where}: Source row ${i + 1} sets archiveOnly true without enabled = false`);
      }
    });
  }
}

/** Every top-level AND conjunct of a WHERE clause. */
function conjuncts(where: unknown): Array<[string, Node]> {
  const w = unwrap(where);
  if (!w) return [];
  if (w[0] === "BoolExpr" && w[1].boolop === "AND_EXPR") return ((w[1].args as unknown[]) ?? []).flatMap(conjuncts);
  return [w];
}

function checkRegionUpdate(stmt: MigrationStatement, insertedRegions: Set<string>, problems: string[]): void {
  const where = `statement ${stmt.index + 1}`;
  const node = stmt.node;
  const relation = obj(node.relation);
  if (relation?.relname !== "Region") return void problems.push(`${where}: UPDATE of "${String(relation?.relname)}" is not allowed`);
  if (node.withClause || node.returningList) problems.push(`${where}: UPDATE with WITH or RETURNING is not allowed`);
  for (const t of (node.targetList as unknown[]) ?? []) {
    const col = String(obj(obj(t)?.ResTarget)?.name ?? "");
    if (!REGION_UPDATE_COLUMNS.has(col)) problems.push(`${where}: UPDATE "Region" may set only parentId and updatedAt, not ${col}`);
  }
  const alias = String(obj(relation.alias)?.aliasname ?? "Region");
  // The target rows: a `<target>.name = '<lit>'` or `<target>.name IN (…)` conjunct.
  const targetNames: string[] = [];
  let restricted = false;
  for (const [type, expr] of conjuncts(node.whereClause)) {
    if (type !== "A_Expr") continue;
    const col = names(obj(obj(expr.lexpr)?.ColumnRef)?.fields);
    const isTargetName = col.at(-1) === "name" && (col.length === 1 || col[0] === alias);
    if (!isTargetName) continue;
    if (expr.kind === "AEXPR_OP" && names(expr.name)[0] === "=") {
      const lit = stringLiteral(expr.rexpr);
      if (lit !== undefined) {
        restricted = true;
        targetNames.push(lit);
      }
    } else if (expr.kind === "AEXPR_IN") {
      const items = (obj(obj(expr.rexpr)?.List)?.items as unknown[]) ?? [];
      const lits = items.map(stringLiteral);
      if (lits.length && lits.every((l) => l !== undefined)) {
        restricted = true;
        targetNames.push(...(lits as string[]));
      }
    }
  }
  if (!restricted) return void problems.push(`${where}: UPDATE "Region" must restrict its target by literal names`);
  for (const name of targetNames) {
    if (!insertedRegions.has(name)) problems.push(`${where}: UPDATE "Region" targets "${name}", which this migration doesn't insert`);
  }
}

function insertedRegionNames(statements: MigrationStatement[]): Set<string> {
  const out = new Set<string>();
  for (const s of statements) {
    if (s.type !== "InsertStmt" || obj(s.node.relation)?.relname !== "Region") continue;
    const col = insertColumns(s.node).indexOf("name");
    for (const row of valuesRows(s.node) ?? []) {
      const lit = col === -1 ? undefined : stringLiteral(row[col]);
      if (lit !== undefined) out.add(lit);
    }
  }
  return out;
}

/** The template's `SET LOCAL lock_timeout = '<literal>'`, as the first statement inside BEGIN … COMMIT. */
function isTemplateLockTimeout(stmt: MigrationStatement, shape: { shape: string; body: MigrationStatement[] }): boolean {
  const args = (stmt.node.args as unknown[]) ?? [];
  return (
    shape.shape === "wrapped" &&
    shape.body[0] === stmt &&
    stmt.node.kind === "VAR_SET_VALUE" &&
    stmt.node.name === "lock_timeout" &&
    stmt.node.is_local === true &&
    args.length === 1 &&
    stringLiteral(args[0]) !== undefined
  );
}

/** G17's problems with one migration file; an empty list passes. */
export async function checkMigrationForBackfill(sql: string): Promise<string[]> {
  const parsed = await parseMigrationSql(sql);
  if (!parsed.ok) return [`parse error: ${parsed.error}`];
  const shape = analyzeTransactionShape(parsed.statements);
  if (!shape.ok) return shape.problems;

  const problems: string[] = [];
  const regions = insertedRegionNames(shape.body);
  for (const stmt of shape.body) {
    checkFunctionsAndCtes(stmt, problems);
    switch (stmt.type) {
      case "InsertStmt":
        checkInsert(stmt, problems);
        break;
      case "UpdateStmt":
        checkRegionUpdate(stmt, regions, problems);
        break;
      case "VariableSetStmt":
        if (!isTemplateLockTimeout(stmt, shape)) {
          problems.push(`statement ${stmt.index + 1}: the only setting allowed is the template's SET LOCAL lock_timeout = '<literal>', first after BEGIN`);
        }
        break;
      default:
        problems.push(`statement ${stmt.index + 1}: ${stmt.type} is not allowed`);
    }
  }
  return problems;
}
