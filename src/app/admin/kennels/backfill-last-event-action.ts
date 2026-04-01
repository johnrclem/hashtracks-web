"use server";

import { getAdminUser } from "@/lib/auth";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";

export async function backfillLastEventDatesAction(): Promise<{ error?: string; updated?: number }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  try {
    const updated = await backfillLastEventDates();
    return { updated };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
