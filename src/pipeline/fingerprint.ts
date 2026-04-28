import { createHash } from "crypto";
import type { RawEventData } from "@/adapters/types";

/**
 * Generate a deterministic fingerprint for a raw event.
 * Used to detect unchanged events and skip re-processing.
 *
 * `kennelTags` is sorted before joining — adapters that emit multi-kennel
 * tags from set-typed sources (e.g. Hash Rego API) can return them in
 * non-deterministic order, and an unsorted join would produce a fresh
 * fingerprint on every scrape and break idempotency
 * (memory: feedback_fingerprint_stability — Seletar PR #541, 74 dups).
 *
 * Single-tag events fingerprint identically to pre-#1023 (single-element
 * sorted-join is the same string as the bare tag).
 */
export function generateFingerprint(data: RawEventData): string {
  // Dedupe before sorting so an adapter that accidentally emits a duplicate
  // tag (`["A", "B", "A"]`) fingerprints the same as the canonical set
  // (`["A", "B"]`) — preserves idempotency across set-typed sources.
  const sortedTags = [...new Set(data.kennelTags)].sort((a, b) => a.localeCompare(b));
  const input = [
    data.date,
    sortedTags.join(","),
    data.runNumber?.toString() ?? "",
    data.title ?? "",
    data.location ?? "",
    data.locationUrl ?? "",
    data.hares ?? "",
    data.description ?? "",
    data.startTime ?? "",
    data.sourceUrl ?? "",
  ].join("|");

  return createHash("sha256").update(input).digest("hex");
}
