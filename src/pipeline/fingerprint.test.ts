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
