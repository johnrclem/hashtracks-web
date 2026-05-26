/**
 * One-shot cleanup for issue #1689 — Narwhal H3 Meetup admin notice.
 *
 * Narwhal H3 fully migrated off Meetup to cthashing.com on 2026-03-10. They
 * posted a farewell event ("Moving to a new website site - Last day in
 * Meetup is March 10th") and then deleted the entire Meetup group. The
 * adapter ingested the farewell as a hash event before the group was
 * removed; the source row is `enabled: false` in this PR and the Meetup
 * adapter now drops ADMIN_NOTICE_PATTERNS at ingest, so the leak can't
 * recur. This script removes the existing surfaced row.
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const EVENT_TO_DELETE = "cmmobywa3000304i8sxiz8i44";

deleteLeakedEvent(prisma, EVENT_TO_DELETE)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
