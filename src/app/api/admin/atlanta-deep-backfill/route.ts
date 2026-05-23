/**
 * One-off deep historical backfill endpoint for the Atlanta Hash Board cluster
 * (PR #1622 follow-up — #1573, #1590).
 *
 * The recurring `AtlantaHashBoardAdapter` reads the per-forum Atom feed which
 * is a rolling 15-entry window. The deep history (~120 MLH4 + ~70 Black Sheep
 * historical trails) lives on the paginated topic listings at
 * `/viewforum.php?f={id}&start={k*25}`. The CLI scripts
 * (`scripts/backfill-mlh4-history.ts`, `scripts/backfill-black-sheep-history.ts`)
 * walk those pages but require local network reachability — `board.atlantahash.com`
 * is TCP-blocked from local + NAS egress. This endpoint runs the same walker
 * from Vercel's network where the origin IS reachable (the recurring scrape
 * succeeds today).
 *
 * INTENDED LIFETIME: short-lived. Once both backfills land, remove this route
 * in a cleanup PR. Tracked under the deferred-work bullets of PRs #1622/#1629.
 *
 * Usage:
 *   curl -X POST "$APP_URL/api/admin/atlanta-deep-backfill" \
 *     -H "Authorization: Bearer $CRON_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"kennel":"mlh4","apply":false}'  # dry run
 *   # then with "apply":true to write
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron-auth";
import { walkAtlantaForum } from "@/lib/atlanta-forum-walker";
import { processRawEvents } from "@/pipeline/merge";
import { todayInTimezone } from "@/lib/timezone";

// Vercel function timeout — the walker fetches each topic page sequentially.
// MLH4 has ~154 topics; at ~500ms each that's ~77s. Bump to 5 minutes to be
// safe; Vercel allows up to 300s on all plans (per Vercel 2026 knowledge).
export const maxDuration = 300;

const KENNEL_CONFIGS: Record<string, { forumId: number; hashDay: string; sourceName: string }> = {
  mlh4: { forumId: 8, hashDay: "Monday", sourceName: "Atlanta Hash Board" },
  bsh3: { forumId: 5, hashDay: "Sunday", sourceName: "Atlanta Hash Board" },
};

const KENNEL_TIMEZONE = "America/New_York";

export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  let body: { kennel?: string; apply?: boolean; maxPages?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ data: null, error: "Invalid JSON body" }, { status: 400 });
  }

  const kennel = body.kennel;
  if (!kennel || !KENNEL_CONFIGS[kennel]) {
    return NextResponse.json(
      { data: null, error: `Invalid 'kennel' — expected one of: ${Object.keys(KENNEL_CONFIGS).join(", ")}` },
      { status: 400 },
    );
  }
  const apply = body.apply === true;
  const cfg = KENNEL_CONFIGS[kennel];

  console.log(`[atlanta-deep-backfill] kennel=${kennel} apply=${apply} forumId=${cfg.forumId}`);

  try {
    // 1. Walk the forum — walker reads `maxPages = 30` default for undefined.
    const events = await walkAtlantaForum({
      forumId: cfg.forumId,
      kennelTag: kennel,
      hashDay: cfg.hashDay,
      maxPages: body.maxPages,
    });

    // 2. Partition past-only (matches runBackfillScript semantics)
    const today = todayInTimezone(KENNEL_TIMEZONE);
    const past = events.filter((e) => e.date < today);
    const skipped = events.length - past.length;
    past.sort((a, b) => a.date.localeCompare(b.date));

    const sampleIdx = past.length > 0 ? [0, Math.floor(past.length / 2), past.length - 1] : [];
    const samples = sampleIdx.map((i) => {
      const e = past[i];
      return {
        date: e.date,
        runNumber: e.runNumber ?? null,
        title: e.title ?? null,
        hares: e.hares ?? null,
        location: e.location ?? null,
        startTime: e.startTime ?? null,
      };
    });

    const partition = {
      parsedTotal: events.length,
      past: past.length,
      skippedFuture: skipped,
      dateRange: past.length > 0 ? { from: past[0].date, to: past.at(-1)!.date } : null,
      samples,
    };

    if (!apply) {
      return NextResponse.json({ data: { mode: "DRY_RUN", partition } });
    }

    if (past.length === 0) {
      return NextResponse.json({ data: { mode: "APPLY", partition, merge: { created: 0, updated: 0, skipped: 0, blocked: 0, eventErrors: 0, note: "no past events to insert" } } });
    }

    // 3. Resolve source + sanity-check SourceKennel links
    const sources = await prisma.source.findMany({
      where: { name: cfg.sourceName },
      select: { id: true },
    });
    if (sources.length !== 1) {
      return NextResponse.json(
        { data: null, error: `Expected exactly one source named "${cfg.sourceName}", found ${sources.length}` },
        { status: 500 },
      );
    }
    const sourceId = sources[0].id;

    const linkCount = await prisma.sourceKennel.count({ where: { sourceId } });
    if (linkCount === 0) {
      return NextResponse.json(
        { data: null, error: `Source "${cfg.sourceName}" has no SourceKennel links — merge would block every row.` },
        { status: 500 },
      );
    }

    // 4. Merge
    const result = await processRawEvents(sourceId, past);
    return NextResponse.json({
      data: {
        mode: "APPLY",
        partition,
        merge: {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          blocked: result.blocked,
          blockedTags: result.blockedTags,
          unmatched: result.unmatched,
          eventErrors: result.eventErrors,
          eventErrorMessages: result.eventErrorMessages.slice(0, 10),
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Stack stays in server logs only — not returned to the client. Even on a
    // CRON_SECRET-gated admin endpoint, leaking file paths and library
    // versions is unnecessary attack surface (Gemini PR #1634 review).
    console.warn(
      `[atlanta-deep-backfill] error: ${msg}`,
      err instanceof Error ? err.stack : undefined,
    );
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
