/**
 * Safe migration script for Sprint 8f schema changes.
 *
 * Applies the KennelHasher.rosterGroupId migration to the production database
 * without data loss. Must be run BEFORE `prisma db push`.
 *
 * Changes:
 * 1. Adds rosterGroupId (nullable) + mergeLog columns to KennelHasher
 * 2. Creates standalone RosterGroup + RosterGroupKennel for orphan kennels
 * 3. Backfills rosterGroupId on all existing KennelHasher records
 * 4. Makes rosterGroupId NOT NULL, kennelId nullable
 * 5. Adds FK constraint and new indexes, drops old indexes
 *
 * Usage: npx tsx scripts/migrate-roster-group-id.ts
 */
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function cuid(): string {
  // Simple cuid-like ID generator for migration purposes
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `c${timestamp}${random}`;
}

async function main() {
  const client = await pool.connect();

  try {
    console.log("Starting Sprint 8f migration...\n");

    // ── Step 1: Add columns ──
    console.log("Step 1: Adding columns to KennelHasher...");

    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'KennelHasher' AND column_name = 'rosterGroupId'
    `);

    if (colCheck.rows.length > 0) {
      console.log("  ✓ rosterGroupId column already exists — skipping column additions");
    } else {
      await client.query(`
        ALTER TABLE "KennelHasher"
        ADD COLUMN IF NOT EXISTS "rosterGroupId" TEXT,
        ADD COLUMN IF NOT EXISTS "mergeLog" JSONB
      `);
      console.log("  ✓ Added rosterGroupId (nullable) and mergeLog columns");
    }

    // ── Step 2: Create RosterGroupKennel entries for orphan kennels ──
    console.log("\nStep 2: Creating RosterGroupKennel for orphan kennels...");

    const orphans = await client.query(`
      SELECT k.id, k."shortName" FROM "Kennel" k
      LEFT JOIN "RosterGroupKennel" rgk ON k.id = rgk."kennelId"
      WHERE rgk.id IS NULL
    `);

    console.log(`  Found ${orphans.rows.length} kennels without RosterGroupKennel`);

    for (const kennel of orphans.rows) {
      const groupId = cuid();
      const rgkId = cuid();

      await client.query(
        `INSERT INTO "RosterGroup" (id, name, "createdAt") VALUES ($1, $2, NOW())`,
        [groupId, kennel.shortName],
      );
      await client.query(
        `INSERT INTO "RosterGroupKennel" (id, "groupId", "kennelId") VALUES ($1, $2, $3)`,
        [rgkId, groupId, kennel.id],
      );
      console.log(`  + Created standalone group for ${kennel.shortName}`);
    }

    // ── Step 3: Backfill rosterGroupId ──
    console.log("\nStep 3: Backfilling rosterGroupId on KennelHasher...");

    const backfillResult = await client.query(`
      UPDATE "KennelHasher" kh
      SET "rosterGroupId" = rgk."groupId"
      FROM "RosterGroupKennel" rgk
      WHERE kh."kennelId" = rgk."kennelId"
      AND kh."rosterGroupId" IS NULL
    `);
    console.log(`  ✓ Updated ${backfillResult.rowCount} records`);

    // Verify no nulls remain
    const nullCheck = await client.query(`
      SELECT COUNT(*) FROM "KennelHasher" WHERE "rosterGroupId" IS NULL
    `);
    const nullCount = parseInt(nullCheck.rows[0].count, 10);
    if (nullCount > 0) {
      console.error(`  ✗ ERROR: ${nullCount} KennelHasher records still have NULL rosterGroupId!`);
      console.error("    These records have kennelId values without matching RosterGroupKennel entries.");

      // Show which ones are problematic
      const problematic = await client.query(`
        SELECT kh.id, kh."kennelId", kh."hashName"
        FROM "KennelHasher" kh
        WHERE kh."rosterGroupId" IS NULL
        LIMIT 10
      `);
      for (const row of problematic.rows) {
        console.error(`    - id=${row.id} kennelId=${row.kennelId} hashName=${row.hashName}`);
      }
      throw new Error("Cannot proceed — some KennelHasher records have no matching RosterGroupKennel");
    }
    console.log("  ✓ All records have rosterGroupId");

    // ── Step 4: Make rosterGroupId NOT NULL, kennelId nullable ──
    console.log("\nStep 4: Applying column constraints...");

    await client.query(`
      ALTER TABLE "KennelHasher"
      ALTER COLUMN "rosterGroupId" SET NOT NULL
    `);
    console.log("  ✓ rosterGroupId is now NOT NULL");

    await client.query(`
      ALTER TABLE "KennelHasher"
      ALTER COLUMN "kennelId" DROP NOT NULL
    `);
    console.log("  ✓ kennelId is now nullable");

    // ── Step 5: Add FK constraint and indexes ──
    console.log("\nStep 5: Adding FK constraint and indexes...");

    // Check if FK already exists
    const fkCheck = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'KennelHasher' AND constraint_name = 'KennelHasher_rosterGroupId_fkey'
    `);

    if (fkCheck.rows.length === 0) {
      await client.query(`
        ALTER TABLE "KennelHasher"
        ADD CONSTRAINT "KennelHasher_rosterGroupId_fkey"
        FOREIGN KEY ("rosterGroupId") REFERENCES "RosterGroup"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
      `);
      console.log("  ✓ Added FK constraint");
    } else {
      console.log("  ✓ FK constraint already exists");
    }

    // New indexes
    await client.query(`CREATE INDEX IF NOT EXISTS "KennelHasher_rosterGroupId_idx" ON "KennelHasher"("rosterGroupId")`);
    await client.query(`CREATE INDEX IF NOT EXISTS "KennelHasher_rosterGroupId_hashName_idx" ON "KennelHasher"("rosterGroupId", "hashName")`);
    await client.query(`CREATE INDEX IF NOT EXISTS "KennelHasher_rosterGroupId_nerdName_idx" ON "KennelHasher"("rosterGroupId", "nerdName")`);
    console.log("  ✓ Created new indexes");

    // Drop old indexes (replaced by rosterGroupId-based ones)
    await client.query(`DROP INDEX IF EXISTS "KennelHasher_kennelId_hashName_idx"`);
    await client.query(`DROP INDEX IF EXISTS "KennelHasher_kennelId_nerdName_idx"`);
    console.log("  ✓ Dropped old indexes");

    // ── Step 6: Verify ──
    console.log("\nStep 6: Verification...");

    const finalCols = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'KennelHasher'
      ORDER BY ordinal_position
    `);
    console.log("  KennelHasher columns:");
    for (const row of finalCols.rows) {
      console.log(`    ${row.column_name} (${row.data_type}, nullable: ${row.is_nullable})`);
    }

    const rgkTotal = await client.query(`SELECT COUNT(*) FROM "RosterGroupKennel"`);
    const kennelTotal = await client.query(`SELECT COUNT(*) FROM "Kennel"`);
    console.log(`\n  RosterGroupKennel entries: ${rgkTotal.rows[0].count}`);
    console.log(`  Total kennels: ${kennelTotal.rows[0].count}`);

    const orphanCheck = await client.query(`
      SELECT COUNT(*) FROM "Kennel" k
      LEFT JOIN "RosterGroupKennel" rgk ON k.id = rgk."kennelId"
      WHERE rgk.id IS NULL
    `);
    console.log(`  Kennels without RosterGroupKennel: ${orphanCheck.rows[0].count}`);

    console.log("\n✅ Migration complete!");
  } catch (error) {
    console.error("\n✗ Migration failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
