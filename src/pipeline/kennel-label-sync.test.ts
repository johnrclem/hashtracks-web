import { describe, it, expect } from "vitest";
import {
  planKennelLabelSync,
  type GitHubLabel,
} from "./kennel-label-sync";

const label = (overrides: Partial<GitHubLabel> & { name: string }): GitHubLabel => ({
  color: "ededed",
  description: null,
  ...overrides,
});

const kennel = (kennelCode: string, shortName: string) => ({ kennelCode, shortName });

describe("planKennelLabelSync", () => {
  const KENNELS = [
    kennel("agnews", "Agnews"),
    kennel("nych3", "NYCH3"),
    kennel("philly-h3", "Philly H3"),
  ];

  it("creates labels for every kennel when the repo is empty", () => {
    const plan = planKennelLabelSync(KENNELS, []);
    expect(plan.created).toBe(3 + 3); // 3 kennels + 3 stream labels
    expect(plan.updated).toBe(0);
    expect(plan.skippedCanonical).toBe(0);
    expect(plan.skippedExternal).toBe(0);
    const createNames = plan.actions.filter((a) => a.kind === "create").map((a) => a.name);
    expect(createNames).toContain("kennel:agnews");
    expect(createNames).toContain("kennel:nych3");
    expect(createNames).toContain("kennel:philly-h3");
    expect(createNames).toContain("audit:automated");
    expect(createNames).toContain("audit:chrome-event");
    expect(createNames).toContain("audit:chrome-kennel");
  });

  it("canonicalizes gray auto-created labels (grandfathering PR #580 backfill)", () => {
    const existing: GitHubLabel[] = [
      label({ name: "kennel:agnews", color: "ededed", description: null }),
      label({ name: "audit:automated", color: "ededed" }),
    ];
    const plan = planKennelLabelSync(KENNELS.slice(0, 1), existing);
    const updates = plan.actions.filter((a) => a.kind === "update");
    expect(updates.map((u) => u.name)).toEqual(
      expect.arrayContaining(["kennel:agnews", "audit:automated"]),
    );
    // Not a skip, not an external — the gray label was fair game.
    expect(plan.skippedExternal).toBe(0);
  });

  it("skips canonical labels (idempotent re-run)", () => {
    const existing: GitHubLabel[] = [
      label({
        name: "kennel:agnews",
        color: "d0e8ff",
        description: "Audit kennel attribution — Agnews",
      }),
    ];
    const plan = planKennelLabelSync(KENNELS.slice(0, 1), existing);
    const skips = plan.actions.filter((a) => a.kind === "skip");
    expect(skips.map((s) => s.name)).toContain("kennel:agnews");
    // Still creates the 3 stream labels since they're missing.
    expect(plan.created).toBe(3);
    expect(plan.updated).toBe(0);
  });

  it("leaves externally-owned kennel labels alone", () => {
    const existing: GitHubLabel[] = [
      label({
        name: "kennel:agnews",
        color: "ff0000",
        description: "Triage queue — blocker",
      }),
    ];
    const plan = planKennelLabelSync(KENNELS.slice(0, 1), existing);
    const externals = plan.actions.filter((a) => a.kind === "external");
    expect(externals).toHaveLength(1);
    expect(externals[0].name).toBe("kennel:agnews");
    expect(plan.updated).toBe(0);
    expect(plan.created).toBe(3); // stream labels only
  });

  it("rejects kennelCodes that fail the label-safety regex", () => {
    const plan = planKennelLabelSync(
      [kennel("Agnews!", "Bad"), kennel("has space", "Bad"), kennel("agnews", "Agnews")],
      [],
    );
    expect(plan.invalidKennelCodes).toEqual(["Agnews!", "has space"]);
    // Valid kennel still plans its label + the 3 streams
    expect(plan.created).toBe(4);
  });

  it("treats canonical-description labels as already owned", () => {
    const existing: GitHubLabel[] = [
      label({
        name: "kennel:agnews",
        color: "d0e8ff",
        description: "Audit kennel attribution — Agnews",
      }),
    ];
    const plan = planKennelLabelSync([kennel("agnews", "Agnews")], existing);
    expect(plan.actions.find((a) => a.name === "kennel:agnews")?.kind).toBe("skip");
  });

  it("treats empty-description labels as owned and canonicalizes them", () => {
    const existing: GitHubLabel[] = [
      label({ name: "kennel:agnews", color: "d0e8ff", description: null }),
    ];
    const plan = planKennelLabelSync([kennel("agnews", "Agnews")], existing);
    const agnewsAction = plan.actions.find((a) => a.name === "kennel:agnews");
    expect(agnewsAction?.kind).toBe("update");
  });

  it("canonicalizes drifted descriptions (kennel rename propagation)", () => {
    // A kennel was renamed — the label's description still references the
    // old shortName. Sync patches it in-place.
    const existing: GitHubLabel[] = [
      label({
        name: "kennel:agnews",
        color: "d0e8ff",
        description: "Audit kennel attribution — OldName",
      }),
    ];
    const plan = planKennelLabelSync([kennel("agnews", "Agnews")], existing);
    const updates = plan.actions.filter((a) => a.kind === "update");
    const agnewsUpdate = updates.find((u) => u.name === "kennel:agnews");
    expect(agnewsUpdate).toBeDefined();
    if (agnewsUpdate && agnewsUpdate.kind === "update") {
      expect(agnewsUpdate.description).toBe("Audit kennel attribution — Agnews");
    }
  });
});
