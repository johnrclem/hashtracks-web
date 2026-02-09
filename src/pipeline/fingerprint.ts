import { createHash } from "crypto";
import type { RawEventData } from "@/adapters/types";

/**
 * Generate a deterministic fingerprint for a raw event.
 * Used to detect unchanged events and skip re-processing.
 */
export function generateFingerprint(data: RawEventData): string {
  const input = [
    data.date,
    data.kennelTag,
    data.runNumber?.toString() ?? "",
    data.title ?? "",
  ].join("|");

  return createHash("sha256").update(input).digest("hex");
}
