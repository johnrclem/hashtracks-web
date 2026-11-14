import { parseMigrationSql, type MigrationStatement } from "./parse";
import {
  analyzeTransactionShape,
  checkNewMigration,
  findDryRunEscapes,
  noTransactionReason,
} from "./transaction";

async function statements(sql: string): Promise<MigrationStatement[]> {
  const parsed = await parseMigrationSql(sql);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.statements;
}

const INSERT = `INSERT INTO "Kennel" (id, "kennelCode") VALUES ('knl_x', 'x') ON CONFLICT DO NOTHING;`;
const WRAPPED = `BEGIN;\nSET LOCAL lock_timeout = '5s';\n${INSERT}\nCOMMIT;\n`;

describe("parseMigrationSql", () => {
  it("returns each statement's exact text, slicing by UTF-8 byte offsets", async () => {
    const stmts = await statements(
      `UPDATE "Region" SET name = 'São Paulo';\nUPDATE "Region" SET name = 'Zürich';`,
    );
    expect(stmts.map((s) => s.text)).toEqual([
      `UPDATE "Region" SET name = 'São Paulo'`,
      `UPDATE "Region" SET name = 'Zürich'`,
    ]);
  });

  it("keeps a dollar-quoted body that mentions COMMIT as one statement", async () => {
    const stmts = await statements(`DO $$ BEGIN RAISE NOTICE 'COMMIT;'; END $$;`);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].type).toBe("DoStmt");
  });

  it("refuses psql meta-commands", async () => {
    const parsed = await parseMigrationSql(`BEGIN;\n\\! touch /tmp/x\nCOMMIT;`);
    expect(parsed.ok).toBe(false);
  });
});

describe("analyzeTransactionShape", () => {
  it("accepts one leading BEGIN and one trailing COMMIT", async () => {
    const result = analyzeTransactionShape(await statements(WRAPPED));
    expect(result.problems).toEqual([]);
    expect(result.shape).toBe("wrapped");
    expect(result.body.map((s) => s.type)).toEqual(["VariableSetStmt", "InsertStmt"]);
  });

  it("accepts a file with no transaction control", async () => {
    const result = analyzeTransactionShape(await statements(INSERT));
    expect(result.shape).toBe("bare");
    expect(result.body).toHaveLength(1);
  });

  it.each([
    ["END mid-file", `BEGIN;\n${INSERT}\nEND;\n${INSERT}\nCOMMIT;`],
    ["COMMIT hidden after a comment", `BEGIN;\n${INSERT}\n-- done with kennels\nCOMMIT;\n${INSERT}\nCOMMIT;`],
    ["COMMIT AND CHAIN", `BEGIN;\n${INSERT}\nCOMMIT AND CHAIN;\n${INSERT}\nCOMMIT;`],
    ["trailing COMMIT AND CHAIN", `BEGIN;\n${INSERT}\nCOMMIT AND CHAIN;`],
    ["START TRANSACTION", `START TRANSACTION;\n${INSERT}\nCOMMIT;`],
    ["ABORT", `BEGIN;\n${INSERT}\nABORT;`],
    ["ROLLBACK", `${INSERT}\nROLLBACK;`],
    ["a savepoint", `BEGIN;\nSAVEPOINT a;\n${INSERT}\nCOMMIT;`],
    ["BEGIN without COMMIT", `BEGIN;\n${INSERT}`],
    ["COMMIT without BEGIN", `${INSERT}\nCOMMIT;`],
    ["PREPARE TRANSACTION", `BEGIN;\n${INSERT}\nPREPARE TRANSACTION 'x';`],
  ])("refuses %s", async (_label, sql) => {
    const result = analyzeTransactionShape(await statements(sql));
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.shape).toBeUndefined();
  });
});

describe("checkNewMigration", () => {
  it("passes a wrapped migration with SET LOCAL lock_timeout", async () => {
    expect(await checkNewMigration(WRAPPED)).toEqual([]);
  });

  it("requires the transaction wrapper", async () => {
    expect(await checkNewMigration(INSERT)).toEqual([expect.stringContaining("must start with BEGIN")]);
  });

  it("requires SET LOCAL lock_timeout right after BEGIN", async () => {
    const noTimeout = `BEGIN;\n${INSERT}\nCOMMIT;`;
    const sessionTimeout = `BEGIN;\nSET lock_timeout = '5s';\n${INSERT}\nCOMMIT;`;
    expect(await checkNewMigration(noTimeout)).toEqual([expect.stringContaining("lock_timeout")]);
    expect(await checkNewMigration(sessionTimeout)).toEqual([expect.stringContaining("lock_timeout")]);
  });

  it("refuses a wrapper with nothing inside", async () => {
    const empty = `BEGIN;\nSET LOCAL lock_timeout = '5s';\nCOMMIT;`;
    expect(await checkNewMigration(empty)).toEqual([expect.stringContaining("no statements")]);
  });

  it("reports unparseable SQL", async () => {
    expect(await checkNewMigration(`BEGIN;\n\\! id\nCOMMIT;`)).toEqual([
      expect.stringContaining("does not parse"),
    ]);
  });

  it("allows a marked no-transaction migration of concurrent indexes and enum values", async () => {
    const sql = [
      "-- migration: no-transaction (CREATE INDEX CONCURRENTLY on a busy table)",
      `CREATE INDEX CONCURRENTLY "Event_date_idx" ON "Event" ("date");`,
      `ALTER TYPE "AlertType" ADD VALUE 'NEW_KIND';`,
    ].join("\n");
    expect(noTransactionReason(sql)).toBe("CREATE INDEX CONCURRENTLY on a busy table");
    expect(await checkNewMigration(sql)).toEqual([]);
  });

  it("refuses other statements in a no-transaction migration", async () => {
    const sql = [
      "-- migration: no-transaction (index)",
      `CREATE INDEX CONCURRENTLY "Event_date_idx" ON "Event" ("date");`,
      `UPDATE "Event" SET status = 'CANCELLED';`,
      `ALTER TYPE "AlertType" RENAME VALUE 'A' TO 'B';`,
    ].join("\n");
    expect(await checkNewMigration(sql)).toHaveLength(2);
  });

  it("requires a reason on the no-transaction marker", async () => {
    const sql = `-- migration: no-transaction ()\nCREATE INDEX CONCURRENTLY "i" ON "Event" ("date");`;
    expect(await checkNewMigration(sql)).toEqual([expect.stringContaining("reason")]);
  });
});

describe("findDryRunEscapes", () => {
  it("refuses statements whose effects escape a rollback", async () => {
    const stmts = await statements(
      [
        `COPY "Kennel" TO PROGRAM 'cat';`,
        `CREATE EXTENSION dblink;`,
        `SELECT dblink_exec('dbname=x', 'DELETE FROM "Kennel"');`,
        INSERT,
      ].join("\n"),
    );
    expect(findDryRunEscapes(stmts)).toHaveLength(3);
  });
});
