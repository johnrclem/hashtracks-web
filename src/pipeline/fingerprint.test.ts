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
    const a = generateFingerprint(buildRawEvent({ kennelTag: "NYCH3" }));
    const b = generateFingerprint(buildRawEvent({ kennelTag: "BrH3" }));
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
});
