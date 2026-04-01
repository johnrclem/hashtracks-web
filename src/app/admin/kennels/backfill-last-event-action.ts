"use server";

import { getAdminUser } from "@/lib/auth";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";

export async function backfillLastEventDatesAction(): Promise<{ error?: string; updated?: number }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const updated = await backfillLastEventDates();
  return { updated };
}
