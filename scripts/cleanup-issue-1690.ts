/**
 * One-shot cleanup for issue #1690 — Houston H3 PII (medical appointment).
 *
 * A personal medical appointment ("Sleep Study - Christine Kuhl Remote visit")
 * was accidentally added to the shared Houston H3 Google Calendar by a
 * contributor. The adapter ingested it as a hash event and it surfaced on
 * the public hareline.
 *
 * The MEDICAL_TITLE_PATTERNS filter added in this PR prevents future leaks of
 * the same shape (medical / telehealth / sleep study) at adapter ingest, but
 * the existing row persists until cleaned up here. We also encourage the
 * kennel admin to remove the appointment from the upstream Google Calendar.
 *
 * Safe to re-run: no-ops if the Event has already been deleted.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const EVENT_TO_DELETE = "cmphcgutv001g04jljb96mv3g";

deleteLeakedEvent(prisma, EVENT_TO_DELETE)
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
