import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { checkMigrationForBackfill, findSourceInserts } from "./g17";
import { SAMPLE_ARCHIVE_ONBOARDING, TEMPLATE_ONBOARDING, wrap } from "./g17.test-fixtures";

/** The last eight onboarding migrations on main when G17 shipped (design 8.1, section 13). */
const ONBOARDING = readdirSync("prisma/migrations")
  .filter((d) => d.includes("_onboard_") && d <= "20261112130000_onboard_zh4")
  .sort()
  .slice(-8);

const KENNEL = `INSERT INTO "Kennel" (id, "kennelCode") VALUES ('knl_x', 'x') ON CONFLICT DO NOTHING;`;

describe("G17 migration checker", () => {
  it.each(ONBOARDING)("passes the onboarding migration %s", async (dir) => {
    expect(ONBOARDING).toHaveLength(8);
    const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, "utf8");
    expect(await checkMigrationForBackfill(sql)).toEqual([]);
  });

  it("passes a migration written to the template (BEGIN, SET LOCAL lock_timeout, COMMIT)", async () => {
    expect(await checkMigrationForBackfill(TEMPLATE_ONBOARDING)).toEqual([]);
  });

  it("passes a sample onboarding migration that creates an archive source", async () => {
    expect(await checkMigrationForBackfill(SAMPLE_ARCHIVE_ONBOARDING)).toEqual([]);
  });

  const BYPASSES: Array<[string, string, RegExp]> = [
    ["a DELETE", `DELETE FROM "Event" WHERE id = 'x';`, /DeleteStmt is not allowed/],
    ["an UPDATE of another table", `UPDATE "Kennel" SET "shortName" = 'y' WHERE "kennelCode" = 'x';`, /UPDATE of "Kennel"/],
    ["an INSERT into Event", `INSERT INTO "Event" (id) VALUES ('e') ON CONFLICT DO NOTHING;`, /INSERT into "Event"/],
    ["an unguarded INSERT", `INSERT INTO "Kennel" (id) VALUES ('k');`, /ON CONFLICT DO NOTHING or SELECT/],
    ["ON CONFLICT DO UPDATE", `INSERT INTO "Kennel" (id) VALUES ('k') ON CONFLICT (id) DO UPDATE SET "shortName" = 'z';`, /ON CONFLICT DO NOTHING/],
    ["a DO block", `DO $$ BEGIN DELETE FROM "Event"; END $$;`, /DoStmt is not allowed/],
    ["a DO block hidden in a comment-shaped string", `INSERT INTO "Kennel" (id) VALUES ('-- */ ') ON CONFLICT DO NOTHING; DO $$ BEGIN PERFORM 1; END $$;`, /DoStmt/],
    ["a data-modifying CTE", `WITH d AS (DELETE FROM "Event" RETURNING id) INSERT INTO "Kennel" (id) SELECT id FROM d ON CONFLICT DO NOTHING;`, /WITH clause|CTE that modifies data/],
    ["a function call", `INSERT INTO "Kennel" (id) VALUES (pg_sleep(10)::text) ON CONFLICT DO NOTHING;`, /function pg_sleep/],
    ["set_config", `INSERT INTO "Kennel" (id) VALUES (set_config('session_replication_role', 'replica', true)) ON CONFLICT DO NOTHING;`, /function set_config/],
    ["timezone with a non-literal zone", `INSERT INTO "Kennel" (id, "createdAt") VALUES ('k', NOW() AT TIME ZONE (SELECT 'UTC')) ON CONFLICT DO NOTHING;`, /timezone/],
    ["CURRENT_TIMESTAMP", `INSERT INTO "Kennel" (id, "createdAt") VALUES ('k', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;`, /CURRENT_TIMESTAMP/],
    ["a Region rename", `INSERT INTO "Region" (id, name) VALUES ('r', 'New') ON CONFLICT DO NOTHING;\nUPDATE "Region" SET name = 'Hijacked' WHERE name = 'New';`, /only parentId and updatedAt, not name/],
    ["a Region update of a region the migration didn't insert", `UPDATE "Region" m SET "parentId" = c.id FROM "Region" c WHERE m.name = 'Germany' AND c.name = 'Europe';`, /targets "Germany"/],
    ["a Region update with no literal restriction", `UPDATE "Region" SET "parentId" = NULL WHERE level = 'METRO';`, /restrict its target by literal names/],
    ["a Region update matching through the joined table only", `INSERT INTO "Region" (id, name) VALUES ('r', 'New') ON CONFLICT DO NOTHING;\nUPDATE "Region" m SET "parentId" = NULL FROM "Region" c WHERE c.name = 'New';`, /restrict its target/],
    ["an archive source without enabled", `INSERT INTO "Source" (id, "archiveOnly") VALUES ('s', true) ON CONFLICT DO NOTHING;`, /without enabled = false/],
    ["an enabled archive source", `INSERT INTO "Source" (id, enabled, "archiveOnly") VALUES ('s', true, true) ON CONFLICT DO NOTHING;`, /without enabled = false/],
    ["a non-literal archiveOnly", `INSERT INTO "Source" (id, enabled, "archiveOnly") VALUES ('s', false, 1 = 1) ON CONFLICT DO NOTHING;`, /non-literal/],
    ["an archive source through SELECT", `INSERT INTO "Source" (id, enabled, "archiveOnly") SELECT 's', false, true WHERE NOT EXISTS (SELECT 1 FROM "Source" WHERE id = 's');`, /must use VALUES/],
    ["another SET", `SET LOCAL session_replication_role = replica;`, /the only setting allowed/],
    ["a session-level lock_timeout", `SET lock_timeout = '1s';`, /the only setting allowed/],
    ["a second lock_timeout later in the file", `SET LOCAL lock_timeout = '0';`, /the only setting allowed/],
    ["a lock_timeout to DEFAULT", `SET LOCAL lock_timeout TO DEFAULT;`, /the only setting allowed/],
    ["RETURNING", `INSERT INTO "Kennel" (id) VALUES ('k') ON CONFLICT DO NOTHING RETURNING id;`, /RETURNING/],
    ["ALTER TABLE", `ALTER TABLE "Source" DROP CONSTRAINT "Source_archiveOnly_not_enabled";`, /AlterTableStmt is not allowed/],
  ];

  it.each(BYPASSES)("refuses %s", async (_label, body, expected) => {
    const problems = await checkMigrationForBackfill(wrap(`${KENNEL}\n${body}`));
    expect(problems.join("\n")).toMatch(expected);
  });

  it("refuses the lock_timeout outside a BEGIN … COMMIT wrapper, or not first", async () => {
    expect((await checkMigrationForBackfill(`SET LOCAL lock_timeout = '5s';\n${KENNEL}`)).join()).toMatch(/the only setting allowed/);
    expect((await checkMigrationForBackfill(`BEGIN;\n${KENNEL}\nSET LOCAL lock_timeout = '5s';\nCOMMIT;`)).join()).toMatch(/the only setting allowed/);
    expect((await checkMigrationForBackfill(`BEGIN;\nSET LOCAL lock_timeout = '5s';\nSAVEPOINT a;\n${KENNEL}\nCOMMIT;`)).length).toBeGreaterThan(0);
  });

  it("refuses a COMMIT mid-file and an unparseable file", async () => {
    expect((await checkMigrationForBackfill(`BEGIN;\n${KENNEL}\nCOMMIT;\nDELETE FROM "Event";\nCOMMIT;`)).length).toBeGreaterThan(0);
    expect(await checkMigrationForBackfill(`BEGIN;\n\\! rm -rf /\nCOMMIT;`)).toEqual([expect.stringMatching(/parse error/)]);
  });
});

describe("findSourceInserts (CI's archive-source check)", () => {
  it("reads the archive source's literal id, archiveOnly and enabled", async () => {
    expect(await findSourceInserts(SAMPLE_ARCHIVE_ONBOARDING, "G17 Test H3 run history")).toEqual([
      { id: "src_g17_archive", archiveOnly: true, enabled: false },
    ]);
    expect(await findSourceInserts(SAMPLE_ARCHIVE_ONBOARDING, "G17 Test Sheet")).toEqual([{ id: "src_g17_live", archiveOnly: undefined, enabled: true }]);
    expect(await findSourceInserts(SAMPLE_ARCHIVE_ONBOARDING, "Nope")).toEqual([]);
  });
});
