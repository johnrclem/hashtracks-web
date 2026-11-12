"use server";

import { getAdminUser } from "@/lib/auth";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { refreshScheduleOnlyFlags, refreshKennelEvidence } from "@/pipeline/kennel-evidence";

export async function backfillLastEventDatesAction(): Promise<{
  error?: string;
  updated?: number;
  scheduleOnlyFlagged?: number;
  evidenceUpdated?: number;
}> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  try {
    const updated = await backfillLastEventDates();
    const scheduleOnlyFlagged = await refreshScheduleOnlyFlags("all");
    const evidenceUpdated = await refreshKennelEvidence();
    return { updated, scheduleOnlyFlagged, evidenceUpdated };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
