import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    // Debug: show what hostname the DATABASE_URL resolves to
    const dbUrl = process.env.DATABASE_URL;
    let dbHost = "not set";
    if (dbUrl) {
      try {
        const parsed = new URL(dbUrl);
        dbHost = parsed.hostname;
      } catch {
        dbHost = `parse error (length: ${dbUrl.length}, starts: ${dbUrl.substring(0, 20)})`;
      }
    }

    await prisma.$queryRawUnsafe("SELECT 1");

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      dbHost,
    });
  } catch (err) {
    const dbUrl = process.env.DATABASE_URL;
    let dbHost = "not set";
    if (dbUrl) {
      try {
        const parsed = new URL(dbUrl);
        dbHost = parsed.hostname;
      } catch {
        dbHost = `parse error (length: ${dbUrl.length}, starts: ${dbUrl.substring(0, 20)})`;
      }
    }

    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        dbHost,
        error: err instanceof Error ? err.message : "Database connection failed",
      },
      { status: 503 },
    );
  }
}
