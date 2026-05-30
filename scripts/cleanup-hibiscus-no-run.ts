/**
 * One-shot cleanup for the Hibiscus H3 "King's Birthday — no run" phantom
 * event (#1786).
 *
 * Hibiscus H3's hareline Google Sheet carries holiday rows with a real date
 * but a "no run" note in the Where column (e.g. "Kings B'day, no run , Yours").
 * The GOOGLE_SHEETS adapter ingested this as a real run with a map + weather.
 * PR for #1739 adds a `silentlySkipPatterns` rule (`\bno\s+run\b` on location)
 * so such rows can never re-ingest; this script removes the already-persisted
 * phantom Event + its RawEvent(s) (two — a re-scrape produced a duplicate raw).
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-hibiscus-no-run.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-hibiscus-no-run.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { runPhantomCleanup } from "./lib/cleanup-phantom-event";

const NO_RUN_RE = /\bno\s+run\b/i;

/** True when a RawEvent.rawData is a "no run" holiday phantom (location note). */
function isPhantomRaw(rawData: unknown): boolean {
  if (!rawData || typeof rawData !== "object") return false;
  const location = (rawData as { location?: unknown }).location;
  return typeof location === "string" && NO_RUN_RE.test(location);
}

runPhantomCleanup(
  {
    logPrefix: "cleanup-hibiscus",
    issue: 1786,
    eventId: "cmp9wo2nx001q04lam9go48hk",
    sourceName: "Hibiscus H3 Hareline Sheet",
    targetLabel: '"no run" holiday row',
    isPhantomRaw,
    verify: (e) => !!e.locationName && NO_RUN_RE.test(e.locationName),
    describeDrift: (e) => `locationName is "${e.locationName}", expected it to contain "no run"`,
  },
  process.env.CLEANUP_APPLY === "1",
)
  .catch((err) => {
    console.error("[cleanup-hibiscus] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
