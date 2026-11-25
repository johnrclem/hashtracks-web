import { describe, expect, it } from "vitest";

import { MEASURES, type Values } from "./config";
import { checkpointFor, evaluate, misses, renderMarkdown, scorecardTitle, targetFor, type Scorecard } from "./evaluate";

const measure = (id: string) => {
  const m = MEASURES.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return m;
};
const row = (rows: ReturnType<typeof evaluate>, id: string) => rows.find((r) => r.id === id);

describe("checkpointFor", () => {
  it("is the checkpoint itself on its Monday", () => {
    expect(checkpointFor(new Date("2026-11-30T06:00:00Z"))).toEqual({ checkpoint: { id: "CP1", date: "2026-11-30" }, preview: false });
  });

  it("previews the next checkpoint on any other day, and is null after the round", () => {
    expect(checkpointFor(new Date("2026-11-26T15:00:00Z"))).toMatchObject({ checkpoint: { id: "CP1" }, preview: true });
    expect(checkpointFor(new Date("2026-12-01T06:00:00Z"))).toMatchObject({ checkpoint: { id: "CP2" }, preview: true });
    expect(checkpointFor(new Date("2026-12-28T06:00:00Z"))).toEqual({ checkpoint: null, preview: false });
  });
});

describe("targetFor", () => {
  it("uses the checkpoint's own target, else the next one's", () => {
    expect(targetFor(measure("o6_failing_sources"), "CP2")).toEqual({ target: { kind: "atMost", value: 10 }, from: "CP2" });
    expect(targetFor(measure("o6_failing_sources"), "CP1")).toEqual({ target: { kind: "atMost", value: 10 }, from: "CP2" });
    expect(targetFor(measure("o6_failing_sources"), "CP3")).toEqual({ target: { kind: "atMost", value: 5 }, from: "CP4" });
  });
});

describe("evaluate", () => {
  const values: Values = {
    o6_failing_sources: { value: 12 },
    o6_alerts_week: { value: 50 },
    o6_scrape_success_7d: { value: 97.9 },
    o2_human_visitors_week: { value: null, note: "needs PostHog" },
    o7_kennels_real_run_60d: { value: 300 },
    o3_defects_closed_week: { value: 30 },
    o3_defects_opened_week: { value: 33 },
    o3_open_defects: { value: 120 },
  };

  it("marks a later checkpoint's unmet target 'not yet', and its own 'missed'", () => {
    expect(row(evaluate(values, "CP1", null), "o6_failing_sources")).toMatchObject({ status: "not yet", target: "≤10 (CP2)" });
    expect(row(evaluate(values, "CP2", null), "o6_failing_sources")).toMatchObject({ status: "missed", target: "≤10" });
    expect(row(evaluate(values, "CP2", null), "o6_alerts_week")).toMatchObject({ status: "met" });
  });

  it("misses a guardrail at every checkpoint", () => {
    expect(row(evaluate(values, "CP1", null), "o6_scrape_success_7d")).toMatchObject({ status: "missed", shown: "97.9%" });
  });

  it("reports unavailable and tracked measures without judging them", () => {
    const rows = evaluate(values, "CP2", null);
    expect(row(rows, "o2_human_visitors_week")).toMatchObject({ status: "n/a", shown: "not available", note: "needs PostHog" });
    expect(row(rows, "o7_kennels_real_run_60d")).toMatchObject({ status: "tracked" });
    expect(row(rows, "o10_ruleset_on")).toMatchObject({ status: "n/a" });
  });

  it("judges relative targets against this week's inflow and last week's value", () => {
    const rows = evaluate(values, "CP4", { o3_open_defects: { value: 118 } });
    expect(row(rows, "o3_defects_closed_week")).toMatchObject({ status: "missed", target: "≥ this week's inflow" });
    expect(row(rows, "o3_open_defects")).toMatchObject({ status: "missed", target: "below last week" });
    expect(row(evaluate(values, "CP4", null), "o3_open_defects")).toMatchObject({ status: "unjudged" });
  });
});

describe("rendering", () => {
  const card: Scorecard = {
    generatedAt: "2026-11-30T06:00:12.000Z",
    checkpoint: "CP1",
    preview: false,
    rows: evaluate({ o6_scrape_success_7d: { value: 97 }, o6_failing_sources: { value: 3 } }, "CP1", null),
    datedChecks: [{ id: "cp1_sitemap_read", title: "Google reads the sitemap", ok: false, detail: "no: never read" }],
  };

  it("titles the issue by checkpoint and date", () => {
    expect(scorecardTitle(card)).toBe("Checkpoint CP1 — 2026-11-30");
    expect(scorecardTitle({ ...card, preview: true })).toBe("Checkpoint CP1 (preview) — 2026-11-30");
    expect(scorecardTitle({ ...card, checkpoint: null })).toBe("Weekly scorecard — 2026-11-30");
  });

  it("lists misses, the table, dated checks and unavailable measures", () => {
    expect(misses(card).map((r) => r.id)).toEqual(["o6_scrape_success_7d"]);
    const md = renderMarkdown(card);
    expect(md).toContain("## Misses (1)");
    expect(md).toContain("| O6 | Failing enabled sources | 17 | **3** | ≤10 (CP2) | ✅ met |");
    expect(md).toContain("❌ **Google reads the sitemap**: no: never read");
    expect(md).toContain("## Not available from the server");
    expect(md).toContain("docs/ops/checkpoint-review-prompt.md");
  });
});
