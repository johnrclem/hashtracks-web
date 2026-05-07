import { describe, it, expect } from "vitest";
import { syncStashFromConfig } from "./StaticScheduleConfigPanel";

/**
 * Pure derive-state-from-props rule for the panel's mode-switch stash.
 * Stash lives in `useState` (commit-safe; rolls back on aborted renders) —
 * see Codex pass-2/7/8/9/10 for the iterations that landed at this contract.
 */

describe("syncStashFromConfig", () => {
  const emptyPrev = { rrule: {}, lunar: undefined };

  it("captures the active rrule mode's draft when config has rrule set", () => {
    const next = syncStashFromConfig(emptyPrev, {
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: "2026-01-03",
    });
    expect(next.rrule).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: "2026-01-03",
    });
    expect(next.lunar).toBeUndefined();
  });

  it("captures the active lunar mode's draft when config has lunar set", () => {
    const next = syncStashFromConfig(emptyPrev, {
      lunar: { phase: "full", timezone: "America/Los_Angeles" },
    });
    expect(next.lunar).toEqual({
      phase: "full",
      timezone: "America/Los_Angeles",
    });
    // In lunar mode, rrule stash is preserved unchanged (it's the previous draft).
    expect(next.rrule).toEqual({});
  });

  it("captures anchorDate edits when in rrule mode even if rrule is empty (CodeRabbit fix)", () => {
    const next = syncStashFromConfig(
      { rrule: { rrule: "FREQ=WEEKLY;BYDAY=SA", anchorDate: "2026-01-03" }, lunar: undefined },
      // User cleared rrule and edited anchorDate (no lunar — still in rrule mode).
      { rrule: "", anchorDate: "2026-04-04" },
    );
    expect(next.rrule).toEqual({ rrule: "", anchorDate: "2026-04-04" });
  });

  it("preserves the inactive mode's stash across mode-switch transitions", () => {
    const initialPrev = { rrule: {}, lunar: undefined };

    // 1. RRULE source loaded
    const afterLoad = syncStashFromConfig(initialPrev, {
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: "2026-01-03",
    });
    expect(afterLoad.rrule).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: "2026-01-03",
    });

    // 2. User toggles to lunar mode (rrule cleared, fresh lunar form seeded)
    const afterToggleToLunar = syncStashFromConfig(afterLoad, {
      lunar: { phase: "full", timezone: "" },
    });
    expect(afterToggleToLunar.rrule).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: "2026-01-03",
    });

    // 3. User fills in lunar fields
    const afterFillLunar = syncStashFromConfig(afterToggleToLunar, {
      lunar: { phase: "full", timezone: "America/Los_Angeles" },
    });

    // 4. User toggles back to rrule — stashed lunar must persist for next toggle
    const afterToggleBack = syncStashFromConfig(afterFillLunar, {
      rrule: "FREQ=WEEKLY;BYDAY=SA",
      anchorDate: "2026-01-03",
    });
    expect(afterToggleBack.lunar).toEqual({
      phase: "full",
      timezone: "America/Los_Angeles",
    });
  });

  it("overwrites stash when the parent passes a different source's config", () => {
    const sourceAStash = {
      rrule: { rrule: "FREQ=WEEKLY;BYDAY=SA", anchorDate: "2026-01-03" },
      lunar: undefined,
    };
    const sourceBConfig = {
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      anchorDate: "2026-03-07",
    };
    const next = syncStashFromConfig(sourceAStash, sourceBConfig);
    expect(next.rrule).toEqual({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
      anchorDate: "2026-03-07",
    });
  });

  it("passes stash through unchanged when both modes are momentarily undefined", () => {
    const prev = {
      rrule: { rrule: "FREQ=WEEKLY;BYDAY=SA", anchorDate: "2026-01-03" },
      lunar: { phase: "full" as const, timezone: "America/Los_Angeles" },
    };
    const next = syncStashFromConfig(prev, {});
    expect(next).toEqual(prev);
  });
});
