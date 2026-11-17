import type { ConfirmationVia } from "@/lib/kennel-status";

/** The "How we know" label for a RUNNING confirmation, by who made it. Pure and client-safe. */
export function confirmedLabel(via: ConfirmationVia): string {
  return via === "HALF_MIND" ? "Half-Mind listing checked" : "Checked running";
}
