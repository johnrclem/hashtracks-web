import { createHash } from "crypto";
import type { RawEventData } from "@/adapters/types";

// The `\x01` sentinel is a non-printable byte that adapters cannot emit as a
// real text value, so it can never collide with a legitimate cell.
const EXPLICIT_CLEAR_TOKEN = "\x01";

/**
 * Tri-state token covering `undefined` (no signal) / `null` (explicit clear) /
 * a defined value rendered via `render`. Used for every fingerprint-input
 * field whose contract treats `null` as a clear-stale-data signal — without
 * this, an adapter that previously emitted `undefined` and later emits `null`
 * (or vice versa) would fingerprint identically. The per-source dedup table
 * would then mark the RawEvent as a duplicate and `handleDuplicateFingerprint`
 * would skip the canonical UPDATE, silently dropping the explicit clear
 * (WS6 / #1516 Codex round 3+4).
 *
 * Tested in `fingerprint.test.ts` for `location` and `hares`; the same
 * invariant holds for every other field that uses this helper.
 */
function withClearSignal<T>(v: T | null | undefined, render: (val: T) => string): string {
  if (v === null) return EXPLICIT_CLEAR_TOKEN;
  if (v === undefined) return "";
  return render(v);
}
const triStateStringToken = (v: string | null | undefined) => withClearSignal(v, (s) => s);

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
  // Every nullable field flows through withClearSignal so an explicit-clear
  // `null` hashes distinctly from `undefined`. Without this, an adapter that
  // flips from "no signal" to "explicit clear" (e.g. Facebook hosted-events
  // emitting `runNumber: null` on placeholder titles) would dedup against the
  // prior RawEvent row and the canonical UPDATE would never fire.
  const input = [
    data.date,
    sortedTags.join(","),
    withClearSignal(data.runNumber, (n) => n.toString()),
    data.title ?? "",
    triStateStringToken(data.location),
    data.locationUrl ?? "",
    triStateStringToken(data.hares),
    triStateStringToken(data.description),
    triStateStringToken(data.startTime),
    data.sourceUrl ?? "",
    // #1316 — structured hareline fields. Without these, a hareline edit
    // that only flips "Trail type: A to A → A to B" (or dogFriendly /
    // prelube) hashes identically and the scrape short-circuits as
    // unchanged, so the canonical Event never picks up the new value.
    // First scrape after deploy triggers a one-time re-merge wave (the
    // merge UPDATE branch fires per row); no duplicates because the
    // (sourceId, fingerprint) unique index + source-kennel guard hold.
    triStateStringToken(data.trailType),
    withClearSignal(data.dogFriendly, (b) => (b ? "1" : "0")),
    triStateStringToken(data.prelube),
    // WS6 Codex round 5: also cover the remaining mutable nullable fields so
    // an adapter that edits or explicit-clears any of them doesn't dedup
    // against the prior RawEvent row. Triggers a one-time re-merge wave on
    // first deploy (same comment block as #1316 above applies).
    triStateStringToken(data.endTime),
    triStateStringToken(data.cost),
    triStateStringToken(data.trailLengthText),
    withClearSignal(data.trailLengthMinMiles, (n) => n.toString()),
    withClearSignal(data.trailLengthMaxMiles, (n) => n.toString()),
    withClearSignal(data.difficulty, (n) => n.toString()),
  ].join("|");

  return createHash("sha256").update(input).digest("hex");
}
