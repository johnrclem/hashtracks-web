import { describe, it, expect } from "vitest";
import {
  STREAM_LABELS,
  ALL_STREAM_LABELS,
  LANES,
  LANE_LABELS,
  LANE_LABEL_META,
  auditIssueLabels,
  kennelLabel,
  laneForRule,
  parseKennelLabel,
  parseLaneLabel,
  parseStreamLabel,
} from "./audit-labels";

describe("audit-labels", () => {
  it("exposes the three forward streams", () => {
    expect(STREAM_LABELS.AUTOMATED).toBe("audit:automated");
    expect(STREAM_LABELS.CHROME_EVENT).toBe("audit:chrome-event");
    expect(STREAM_LABELS.CHROME_KENNEL).toBe("audit:chrome-kennel");
  });

  it("ALL_STREAM_LABELS contains every sub-label", () => {
    expect(ALL_STREAM_LABELS).toContain("audit:automated");
    expect(ALL_STREAM_LABELS).toContain("audit:chrome-event");
    expect(ALL_STREAM_LABELS).toContain("audit:chrome-kennel");
    expect(ALL_STREAM_LABELS).toHaveLength(3);
  });

  it("kennelLabel + parseKennelLabel are inverses", () => {
    expect(kennelLabel("agnews")).toBe("kennel:agnews");
    expect(parseKennelLabel("kennel:agnews")).toBe("agnews");
    expect(parseKennelLabel("kennel:nych3")).toBe("nych3");
  });

  it("parseKennelLabel rejects non-kennel labels and empty codes", () => {
    expect(parseKennelLabel("audit")).toBeNull();
    expect(parseKennelLabel("audit:automated")).toBeNull();
    expect(parseKennelLabel("kennel:")).toBeNull();
    expect(parseKennelLabel("kennel:   ")).toBeNull();
  });

  it("parseStreamLabel returns the canonical key", () => {
    expect(parseStreamLabel("audit:automated")).toBe("AUTOMATED");
    expect(parseStreamLabel("audit:chrome-event")).toBe("CHROME_EVENT");
    expect(parseStreamLabel("audit:chrome-kennel")).toBe("CHROME_KENNEL");
    expect(parseStreamLabel("audit")).toBeNull();
    expect(parseStreamLabel("kennel:agnews")).toBeNull();
  });
});

describe("lanes", () => {
  it("parseLaneLabel inverts LANE_LABELS and rejects anything else", () => {
    for (const lane of LANES) expect(parseLaneLabel(LANE_LABELS[lane])).toBe(lane);
    expect(parseLaneLabel("lane:")).toBeNull();
    expect(parseLaneLabel("lane:urgent")).toBeNull();
    expect(parseLaneLabel("audit")).toBeNull();
    expect(parseLaneLabel("onboarding-candidate")).toBeNull();
  });

  it("gives every lane label a color and an owned description", () => {
    for (const lane of LANES) {
      const meta = LANE_LABEL_META[LANE_LABELS[lane]];
      expect(meta.color).toMatch(/^[0-9a-f]{6}$/);
      expect(meta.description.startsWith("Work lane")).toBe(true);
    }
  });

  it.each([
    ["source-coverage-gap", "coverage"],
    ["historical-events-gap", "coverage"],
    ["historical-backfill", "coverage"],
    ["schema-gap", "decision"],
    ["hares-theme-leak", "defect"],
    // A run missing inside a window we already scrape is an adapter bug, not coverage.
    ["source-event-missing", "defect"],
  ])("laneForRule(%s) → %s", (ruleSlug, lane) => {
    expect(laneForRule(ruleSlug)).toBe(lane);
  });
});

describe("auditIssueLabels", () => {
  it("files a defect with origin, stream, kennel and one lane, and no alert", () => {
    expect(auditIssueLabels({ stream: "AUTOMATED", kennelCode: "nych3", ruleSlug: "hare-url" })).toEqual([
      "audit",
      "audit:automated",
      "kennel:nych3",
      "lane:defect",
    ]);
  });

  it("adds the onboarding-candidate alias to a coverage finding", () => {
    expect(
      auditIssueLabels({ stream: "CHROME_KENNEL", kennelCode: "sloh3", ruleSlug: "source-coverage-gap" }),
    ).toEqual(["audit", "audit:chrome-kennel", "kennel:sloh3", "lane:coverage", "onboarding-candidate"]);
  });

  it("puts a finding the agent marked for the owner in the decision lane only", () => {
    expect(
      auditIssueLabels({
        stream: "CHROME_EVENT",
        kennelCode: "sloh3",
        ruleSlug: "source-coverage-gap",
        requestedLabels: ["lane:decision"],
      }),
    ).toEqual(["audit", "audit:chrome-event", "kennel:sloh3", "lane:decision"]);
  });

  it("leaves out the stream sub-label for UNKNOWN", () => {
    expect(auditIssueLabels({ stream: "UNKNOWN", kennelCode: "nych3", ruleSlug: "hare-url" })).toEqual([
      "audit",
      "kennel:nych3",
      "lane:defect",
    ]);
  });
});
