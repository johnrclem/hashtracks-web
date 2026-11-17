import { NextResponse } from "next/server";
import { parseMigrationSql } from "@/lib/migration-sql/parse";

/**
 * Proves the SQL parser loads in a server route (design 12.1a): `libpg-query`'s
 * WASM file must reach the function bundle, or the backfill plan's G17 check
 * fails at runtime. Parses a fixed statement; takes no input.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const parsed = await parseMigrationSql(`BEGIN;\nSET LOCAL lock_timeout = '5s';\nSELECT 1;\nCOMMIT;`);
  if (!parsed.ok) return NextResponse.json({ status: "unhealthy", error: parsed.error }, { status: 503 });
  return NextResponse.json({ status: "healthy", statements: parsed.statements.map((s) => s.type) });
}
