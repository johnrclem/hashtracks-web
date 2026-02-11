import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { scrapeSource } from "@/pipeline/scrape";

export async function POST(request: NextRequest) {
  // Admin auth check
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = await request.json();
  const { sourceId, days, force } = body as {
    sourceId: string;
    days?: number;
    force?: boolean;
  };

  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    );
  }

  try {
    const result = await scrapeSource(sourceId, { days, force });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
