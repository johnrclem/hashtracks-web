import { emitIdentityMarker } from "@/lib/audit-canonical";
import { formatPlan, overrideProblems, parseArgs, planRelabel, proposeLane, type OpenIssue } from "./relabel-open-issues-lanes";

const issue = (number: number, labels: string[], body = ""): OpenIssue => ({ number, title: `Issue ${number}`, body, labels });
const identity = (ruleSlug: string) => emitIdentityMarker({ stream: "CHROME_KENNEL", kennelCode: "nych3", ruleSlug });

describe("proposeLane", () => {
  it.each([
    ["an audit finding", issue(1, ["audit", "alert"], identity("hares-theme-leak")), "defect"],
    ["a source-gap rule", issue(2, ["audit", "alert"], identity("historical-events-gap")), "coverage"],
    ["a schema gap", issue(3, ["audit"], identity("schema-gap")), "decision"],
    ["onboarding-candidate", issue(4, ["audit", "onboarding-candidate"]), "coverage"],
    ["audit:needs-decision", issue(5, ["audit", "audit:needs-decision"]), "decision"],
    ["audit-fixer:skip", issue(6, ["audit", "audit-fixer:skip"], identity("hares-theme-leak")), "decision"],
    ["rule-drift", issue(7, ["rule-drift"]), "defect"],
    ["user feedback", issue(8, ["user-feedback", "enhancement"]), "decision"],
    ["an existing lane", issue(9, ["audit", "lane:coverage"]), "coverage"],
  ])("puts %s in its lane", (_label, input, lane) => {
    expect(proposeLane(input).lane).toBe(lane);
  });

  it("proposes nothing for an issue no rule covers", () => {
    expect(proposeLane(issue(10, ["kennel:lh3-pt"])).lane).toBeNull();
  });

  it("flags two lane labels as a conflict", () => {
    expect(proposeLane(issue(11, ["lane:defect", "lane:ops"]))).toMatchObject({ lane: null, conflict: true });
  });
});

describe("planRelabel", () => {
  it("adds the lane and drops alert from audit issues only", () => {
    const [audit, other] = planRelabel([issue(1, ["audit", "alert"]), issue(2, ["alert", "rule-drift"])]);
    expect(audit).toMatchObject({ lane: "defect", addLabels: ["lane:defect"], dropAlert: true });
    expect(other).toMatchObject({ lane: "defect", addLabels: ["lane:defect"], dropAlert: false });
  });

  it("needs no write once an issue has its lane and no alert", () => {
    expect(planRelabel([issue(1, ["audit", "lane:defect"])])[0]).toMatchObject({ addLabels: [], dropAlert: false });
  });

  it("adds the onboarding-candidate alias to a coverage issue without it, as the filers do", () => {
    const [gap] = planRelabel([issue(1, ["audit"], identity("historical-events-gap"))]);
    expect(gap.addLabels).toEqual(["lane:coverage", "onboarding-candidate"]);
  });

  it("applies an override only to an issue without a lane", () => {
    const overrides = new Map([[10, "coverage" as const], [11, "defect" as const], [12, "decision" as const], [13, "defect" as const], [99, "ops" as const]]);
    const plan = planRelabel(
      [
        issue(10, ["kennel:lh3-pt"]),
        issue(11, ["lane:ops", "lane:decision"]),
        issue(12, ["audit", "lane:defect", "alert"]),
        issue(13, ["audit", "lane:defect"]),
      ],
      overrides,
    );
    expect(plan[0]).toMatchObject({ lane: "coverage", addLabels: ["lane:coverage", "onboarding-candidate"], reason: "--set (proposed: none)" });
    expect(plan[1]).toMatchObject({ lane: null, addLabels: [], overrideRejected: true });
    // Adding lane:decision would leave lane:defect on too.
    expect(plan[2]).toMatchObject({ addLabels: [], dropAlert: false, overrideRejected: true });
    // The same lane is a no-op, not a problem.
    expect(plan[3]).toMatchObject({ addLabels: [] });
    expect(plan[3].overrideRejected).toBeUndefined();
    expect(overrideProblems(plan, overrides)).toEqual([
      "--set 99: not an open issue",
      expect.stringMatching(/^#11: --set defect rejected/),
      expect.stringMatching(/^#12: --set decision rejected/),
    ]);
  });
});

describe("parseArgs", () => {
  it("parses --apply and repeated --set", () => {
    expect(parseArgs(["--set", "2048=coverage", "--apply", "--set", "102=decision"])).toEqual({
      apply: true,
      overrides: new Map([[2048, "coverage"], [102, "decision"]]),
    });
  });

  it.each([[["--set", "2048=urgent"]], [["--set"]], [["--force"]], [["--set", "0=coverage"]], [["--set", "99999999999999999999=coverage"]]])("rejects %j", (args) => {
    expect(parseArgs(args)).toBeNull();
  });
});

describe("formatPlan", () => {
  it("lists each issue and counts per lane", () => {
    const text = formatPlan(planRelabel([issue(1, ["audit", "alert"]), issue(2, ["kennel:x"])]));
    expect(text).toContain("#1\tlane:defect\t+lane:defect -alert");
    expect(text).toContain("#2\t(no lane)\tno change");
    expect(text).toContain("2 open issues. (no lane): 1, lane:defect: 1.");
    expect(text).toContain("1 issues need a write; 1 drop `alert`.");
  });
});
