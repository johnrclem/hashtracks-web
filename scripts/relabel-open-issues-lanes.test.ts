import { emitIdentityMarker } from "@/lib/audit-canonical";
import { formatPlan, parseArgs, planRelabel, proposeLane, type OpenIssue } from "./relabel-open-issues-lanes";

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
    expect(audit).toMatchObject({ lane: "defect", addLabel: "lane:defect", dropAlert: true });
    expect(other).toMatchObject({ lane: "defect", addLabel: "lane:defect", dropAlert: false });
  });

  it("needs no write once an issue has its lane and no alert", () => {
    expect(planRelabel([issue(1, ["audit", "lane:defect"])])[0]).toMatchObject({ addLabel: null, dropAlert: false });
  });

  it("applies an override, but never on a conflict", () => {
    const overrides = new Map([[10, "coverage" as const], [11, "defect" as const]]);
    const [plain, conflict] = planRelabel([issue(10, ["kennel:lh3-pt"]), issue(11, ["lane:ops", "lane:decision"])], overrides);
    expect(plain).toMatchObject({ lane: "coverage", addLabel: "lane:coverage", reason: "--set (proposed: none)" });
    expect(conflict).toMatchObject({ lane: null, addLabel: null });
  });
});

describe("parseArgs", () => {
  it("parses --apply and repeated --set", () => {
    expect(parseArgs(["--set", "2048=coverage", "--apply", "--set", "102=decision"])).toEqual({
      apply: true,
      overrides: new Map([[2048, "coverage"], [102, "decision"]]),
    });
  });

  it.each([[["--set", "2048=urgent"]], [["--set"]], [["--force"]]])("rejects %j", (args) => {
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
