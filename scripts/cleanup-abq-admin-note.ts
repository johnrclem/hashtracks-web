/**
 * One-shot cleanup for the ABQ H3 "LYNNE OFF" phantom event (#1783).
 *
 * ABQ H3's Google Calendar opts into `includeAllDayEvents` (their Tuesday CLiT
 * runs are all-day blocks), which also admitted the kennel admin's personal
 * all-day OOO block "LYNNE OFF" — surfaced on /hareline as a phantom Friday
 * run. PR for #1739 adds a `silentlySkipPatterns` rule so the row can never
 * re-ingest; this script removes the already-persisted phantom Event + raw.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-abq-admin-note.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-abq-admin-note.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { runPhantomCleanup } from "./lib/cleanup-phantom-event";

const EXPECTED_TITLE = "LYNNE OFF";

/** True when a RawEvent.rawData is the "LYNNE OFF" phantom. */
function isPhantomRaw(rawData: unknown): boolean {
  if (!rawData || typeof rawData !== "object") return false;
  const title = (rawData as { title?: unknown }).title;
  return typeof title === "string" && title.trim().toUpperCase() === EXPECTED_TITLE;
}

runPhantomCleanup(
  {
    logPrefix: "cleanup-abq",
    issue: 1783,
    eventId: "cmpqmy3m9000b04joivvx6nt1",
    sourceName: "ABQ H3 Google Calendar",
    targetLabel: `"${EXPECTED_TITLE}"`,
    isPhantomRaw,
    verify: (e) => e.title?.trim().toUpperCase() === EXPECTED_TITLE,
    describeDrift: (e) => `title is "${e.title}", expected "${EXPECTED_TITLE}"`,
  },
  process.env.CLEANUP_APPLY === "1",
)
  .catch((err) => {
    console.error("[cleanup-abq] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
