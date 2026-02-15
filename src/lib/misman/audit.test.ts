import { describe, it, expect } from "vitest";
import {
  appendAuditLog,
  buildFieldChanges,
  type AuditLogEntry,
} from "./audit";

describe("appendAuditLog", () => {
  const entry: AuditLogEntry = {
    action: "record",
    timestamp: "2026-02-15T12:00:00.000Z",
    userId: "user_1",
  };

  it("creates initial entry from null", () => {
    const result = appendAuditLog(null, entry);
    expect(result).toEqual([entry]);
  });

  it("creates initial entry from non-array value", () => {
    const result = appendAuditLog("not-an-array" as never, entry);
    expect(result).toEqual([entry]);
  });

  it("appends to existing array", () => {
    const existing: AuditLogEntry[] = [
      { action: "record", timestamp: "2026-02-14T12:00:00.000Z", userId: "user_1" },
    ];
    const result = appendAuditLog(existing as never, entry);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(existing[0]);
    expect(result[1]).toEqual(entry);
  });

  it("does not mutate the existing array", () => {
    const existing: AuditLogEntry[] = [
      { action: "record", timestamp: "2026-02-14T12:00:00.000Z", userId: "user_1" },
    ];
    const original = [...existing];
    appendAuditLog(existing as never, entry);
    expect(existing).toEqual(original);
  });
});

describe("buildFieldChanges", () => {
  it("detects changed fields", () => {
    const before = { paid: false, haredThisTrail: false, isVirgin: false };
    const after = { paid: true, haredThisTrail: false, isVirgin: true };
    const result = buildFieldChanges(before, after, ["paid", "haredThisTrail", "isVirgin"]);
    expect(result).toEqual({
      paid: { old: false, new: true },
      isVirgin: { old: false, new: true },
    });
  });

  it("returns undefined when nothing changed", () => {
    const before = { paid: true, haredThisTrail: false };
    const after = { paid: true, haredThisTrail: false };
    const result = buildFieldChanges(before, after, ["paid", "haredThisTrail"]);
    expect(result).toBeUndefined();
  });

  it("ignores fields not in trackedFields", () => {
    const before = { paid: false, untracked: "old" };
    const after = { paid: false, untracked: "new" };
    const result = buildFieldChanges(before, after, ["paid"]);
    expect(result).toBeUndefined();
  });

  it("detects null to value changes", () => {
    const before = { visitorLocation: null };
    const after = { visitorLocation: "Boston" };
    const result = buildFieldChanges(before, after, ["visitorLocation"]);
    expect(result).toEqual({
      visitorLocation: { old: null, new: "Boston" },
    });
  });

  it("detects value to null changes", () => {
    const before = { visitorLocation: "Boston" };
    const after = { visitorLocation: null };
    const result = buildFieldChanges(before, after, ["visitorLocation"]);
    expect(result).toEqual({
      visitorLocation: { old: "Boston", new: null },
    });
  });

  it("handles string enum changes", () => {
    const before = { referralSource: "REDDIT" };
    const after = { referralSource: "MEETUP" };
    const result = buildFieldChanges(before, after, ["referralSource"]);
    expect(result).toEqual({
      referralSource: { old: "REDDIT", new: "MEETUP" },
    });
  });
});
