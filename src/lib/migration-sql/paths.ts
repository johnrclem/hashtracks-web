/**
 * Where migrations live. Dependency-free, so the write gate and the backfill server can share it
 * without loading the SQL parser.
 */
export const MIGRATION_DIR_PREFIX = "prisma/migrations/";
export const MIGRATION_FILE_RE = /^prisma\/migrations\/[^/]+\/migration\.sql$/;
