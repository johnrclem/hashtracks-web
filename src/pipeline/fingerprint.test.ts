import { describe, it, expect } from "vitest";
import { generateFingerprint } from "./fingerprint";
import { buildRawEvent } from "@/test/factories";

describe("generateFingerprint", () => {
  it("produces deterministic output", () => {
    const event = buildRawEvent();
    expect(generateFingerprint(event)).toBe(generateFingerprint(event));
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const fp = generateFingerprint(buildRawEvent());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different dates produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ date: "2026-02-14" }));
    const b = generateFingerprint(buildRawEvent({ date: "2026-02-15" }));
    expect(a).not.toBe(b);
  });

  it("different kennel tags produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ kennelTags: ["NYCH3" ]}));
    const b = generateFingerprint(buildRawEvent({ kennelTags: ["BrH3" ]}));
    expect(a).not.toBe(b);
  });

  it("uses empty string for missing runNumber", () => {
    const a = generateFingerprint(buildRawEvent({ runNumber: undefined }));
    const b = generateFingerprint(buildRawEvent({ runNumber: 100 }));
    expect(a).not.toBe(b);
  });

  it("uses empty string for missing title", () => {
    const a = generateFingerprint(buildRawEvent({ title: undefined }));
    const b = generateFingerprint(buildRawEvent({ title: "Some Trail" }));
    expect(a).not.toBe(b);
  });

  it("different locations produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ location: undefined }));
    const b = generateFingerprint(buildRawEvent({ location: "Central Park" }));
    expect(a).not.toBe(b);
  });

  // #1579 follow-up — locationStreet is independent of location. Without
  // this field in the fingerprint, OKissMe-style adapters that newly emit a
  // street address would dedup against the prior RawEvent row and the
  // canonical UPDATE would never persist locationStreet.
  it("different locationStreet values produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ locationStreet: undefined }));
    const b = generateFingerprint(buildRawEvent({
      locationStreet: "215 Chapin St, Ann Arbor, MI, 48103",
    }));
    expect(a).not.toBe(b);
  });

  it("locationStreet null (explicit clear) differs from undefined", () => {
    const a = generateFingerprint(buildRawEvent({ locationStreet: undefined }));
    const b = generateFingerprint(buildRawEvent({ locationStreet: null }));
    expect(a).not.toBe(b);
  });

  // #1579 gating regression — a baseline event that never carries
  // locationStreet must fingerprint identically before and after the field
  // was added (Gemini PR #1636 review). Without gating, `triStateStringToken`
  // on undefined would append an empty token to every event's fingerprint
  // → global re-merge wave + RawEvent table doubling on next scrape.
  it("locationStreet=undefined contributes no token (no global re-merge wave)", () => {
    // Manually reconstruct the pre-#1579-followup fingerprint by stripping
    // locationStreet entirely. If the gated spread works, omitting the field
    // produces the same hash as passing `undefined`.
    const baseline = buildRawEvent();
    const withExplicitUndefined = buildRawEvent({ locationStreet: undefined });
    expect(generateFingerprint(baseline)).toBe(generateFingerprint(withExplicitUndefined));
  });

  // #1950 stability guard — the lower-trust enrich branch now fills cost +
  // endTime onto the canonical. Both fields already participate in the
  // fingerprint (cost/endTime are WS6 tokens), so a RawEvent that newly carries
  // them re-fingerprints and the canonical UPDATE persists the enriched value.
  // These assert that wiring stays intact: distinct values fork the fingerprint,
  // and a baseline event with neither field is unaffected (no re-merge churn).
  it.each([
    ["cost", { cost: "$10" } as const],
    ["endTime", { endTime: "21:30" } as const],
  ])("different %s values produce different fingerprints (#1950)", (_field, override) => {
    const a = generateFingerprint(buildRawEvent());
    const b = generateFingerprint(buildRawEvent(override));
    expect(a).not.toBe(b);
  });

  it.each([
    ["cost", { cost: undefined } as const],
    ["endTime", { endTime: undefined } as const],
  ])("%s=undefined leaves the baseline fingerprint unchanged (#1950)", (_field, override) => {
    expect(generateFingerprint(buildRawEvent())).toBe(
      generateFingerprint(buildRawEvent(override)),
    );
  });

  // #1624 — eventLabel must participate in the fingerprint so a label edit
  // (e.g. "Birthday" → "Pink Moon") re-fingerprints and the canonical UPDATE
  // fires; otherwise the dedup map silently swallows the new label.
  it("different eventLabel values produce different fingerprints (#1624)", () => {
    const a = generateFingerprint(buildRawEvent({ eventLabel: undefined }));
    const b = generateFingerprint(buildRawEvent({ eventLabel: "Bayern Nash Hash" }));
    expect(a).not.toBe(b);
  });

  it("eventLabel null (explicit clear) differs from undefined (#1624)", () => {
    const a = generateFingerprint(buildRawEvent({ eventLabel: undefined }));
    const b = generateFingerprint(buildRawEvent({ eventLabel: null }));
    expect(a).not.toBe(b);
  });

  // Gating regression — same shape as the #1579 locationStreet guard.
  // An event with no eventLabel signal must hash identically before and
  // after the field was added; otherwise rolling out eventLabel re-
  // fingerprints every existing event and doubles the RawEvent table.
  it("eventLabel=undefined contributes no token (no global re-merge wave)", () => {
    const baseline = buildRawEvent();
    const withExplicitUndefined = buildRawEvent({ eventLabel: undefined });
    expect(generateFingerprint(baseline)).toBe(generateFingerprint(withExplicitUndefined));
  });

  it("different hares produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ hares: undefined }));
    const b = generateFingerprint(buildRawEvent({ hares: "Mudflap, Just Simon" }));
    expect(a).not.toBe(b);
  });

  it("different descriptions produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ description: undefined }));
    const b = generateFingerprint(buildRawEvent({ description: "A-to-B trail" }));
    expect(a).not.toBe(b);
  });

  it("different startTimes produce different fingerprints", () => {
    const a = generateFingerprint(buildRawEvent({ startTime: undefined }));
    const b = generateFingerprint(buildRawEvent({ startTime: "14:00" }));
    expect(a).not.toBe(b);
  });

  it("distinguishes location null (explicit clear) from undefined / empty (#1516 WS6)", () => {
    // The explicit-clear `location: null` MUST hash differently from
    // `undefined` and `""` so a previously processed RawEvent with no
    // location signal doesn't match a later scrape that explicitly clears
    // the field — otherwise `handleDuplicateFingerprint` would skip the
    // canonical UPDATE and the clear would never land.
    const undef = generateFingerprint(buildRawEvent({ location: undefined }));
    const empty = generateFingerprint(buildRawEvent({ location: "" }));
    const cleared = generateFingerprint(buildRawEvent({ location: null }));
    expect(cleared).not.toBe(undef);
    expect(cleared).not.toBe(empty);
    // Same invariant for hares — Capital H3 #1521 relies on it too.
    const haresUndef = generateFingerprint(buildRawEvent({ hares: undefined }));
    const haresCleared = generateFingerprint(buildRawEvent({ hares: null }));
    expect(haresCleared).not.toBe(haresUndef);
  });

  it("distinguishes null from undefined for every other tri-state field (Codex round 4)", () => {
    // The Facebook hosted-events adapter and others emit explicit `null` on
    // fields like runNumber / description / startTime when the source signals
    // "explicit clear" (e.g. `H6#28?` placeholder titles). WS6 generalised
    // the fingerprint so those clears propagate too.
    const base = buildRawEvent();
    const baseFp = generateFingerprint(base);
    const cases: Array<[string, Partial<typeof base>]> = [
      ["runNumber", { runNumber: null }],
      ["description", { description: null }],
      ["startTime", { startTime: null }],
      ["trailType", { trailType: null }],
      ["dogFriendly", { dogFriendly: null }],
      ["prelube", { prelube: null }],
    ];
    for (const [field, override] of cases) {
      const cleared = generateFingerprint(buildRawEvent(override));
      expect(cleared, `${field}: null clear should differ from undefined`).not.toBe(baseFp);
    }
  });
});
