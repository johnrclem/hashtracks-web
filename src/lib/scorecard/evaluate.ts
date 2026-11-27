/**
 * Judges a week's measure values against the round's targets and renders the checkpoint table.
 * Pure: no database or network.
 */
import { CHECKPOINTS, MEASURES, type Checkpoint, type CheckpointId, type Measure, type Target, type Values } from "./config";

export type RowStatus = "met" | "missed" | "not yet" | "tracked" | "n/a" | "unjudged";

export interface ScoreRow {
  id: string;
  objective: string;
  label: string;
  baseline: string;
  value: number | null;
  shown: string;
  target: string;
  /** The checkpoint whose target this row was judged against. */
  targetFrom: CheckpointId | null;
  status: RowStatus;
  guardrail: boolean;
  note?: string;
}

export interface DatedCheckResult {
  id: string;
  title: string;
  /** null for a manual check the review session does. */
  ok: boolean | null;
  detail: string;
}

export interface Scorecard {
  generatedAt: string;
  /** The checkpoint this run reports on; null after the round's last checkpoint. */
  checkpoint: CheckpointId | null;
  /** True when the run isn't on the checkpoint's Monday (a manual or mid-week run). */
  preview: boolean;
  rows: ScoreRow[];
  datedChecks: DatedCheckResult[];
}

const utcDate = (d: Date) => d.toISOString().slice(0, 10);

/** The checkpoint on `now`'s UTC date, else the next one (as a preview); null once the round is over. */
export function checkpointFor(now: Date, checkpoints: readonly Checkpoint[] = CHECKPOINTS): { checkpoint: Checkpoint | null; preview: boolean } {
  const today = utcDate(now);
  const exact = checkpoints.find((c) => c.date === today);
  if (exact) return { checkpoint: exact, preview: false };
  const next = checkpoints.find((c) => c.date > today);
  return { checkpoint: next ?? null, preview: next !== undefined };
}

/** The measure's target at `cp`, or the next checkpoint's (judged as "not yet" when unmet). */
export function targetFor(measure: Measure, cp: CheckpointId): { target: Target; from: CheckpointId } | null {
  const order = CHECKPOINTS.map((c) => c.id);
  for (const id of order.slice(order.indexOf(cp))) {
    const target = measure.targets[id];
    if (target) return { target, from: id };
  }
  return null;
}

function unitSuffix(unit: Measure["unit"]): string {
  if (!unit) return "";
  return unit === "%" ? "%" : ` ${unit}`;
}

function describeTarget(t: Target, unit: Measure["unit"]): string {
  const u = unitSuffix(unit);
  switch (t.kind) {
    case "atLeast":
      return `≥${t.value}${u}`;
    case "atMost":
      return `≤${t.value}${u}`;
    case "tracked":
      return "tracked";
    case "relative":
      return t.describe;
  }
}

function judge(t: Target, value: number, values: Values, previous: Values | null): boolean | null {
  switch (t.kind) {
    case "atLeast":
      return value >= t.value;
    case "atMost":
      return value <= t.value;
    case "tracked":
      return null;
    case "relative":
      return t.judge(value, values, previous);
  }
}

function shownValue(m: Measure, v: Values[string] | undefined): string {
  if (v?.value == null) return "not available";
  if (v.display) return v.display;
  const n = Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(1);
  return n + unitSuffix(m.unit);
}

function targetText(resolved: ReturnType<typeof targetFor>, cp: CheckpointId | null, unit: Measure["unit"]): string {
  if (!resolved) return "—";
  const from = resolved.from === cp ? "" : ` (${resolved.from})`;
  return describeTarget(resolved.target, unit) + from;
}

export function evaluate(values: Values, cp: CheckpointId | null, previous: Values | null): ScoreRow[] {
  return MEASURES.map((m) => {
    const v = values[m.id];
    const resolved = cp ? targetFor(m, cp) : null;
    const base = {
      id: m.id,
      objective: m.objective,
      label: m.label,
      baseline: m.baseline,
      value: v?.value ?? null,
      shown: shownValue(m, v),
      target: targetText(resolved, cp, m.unit),
      targetFrom: resolved?.from ?? null,
      guardrail: m.guardrail === true,
      ...(v?.note ? { note: v.note } : {}),
    };
    if (v?.value == null) return { ...base, status: "n/a" as const };
    if (!resolved || resolved.target.kind === "tracked") return { ...base, status: "tracked" as const };
    const ok = judge(resolved.target, v.value, values, previous);
    if (ok === null || (ok === false && v.partial && resolved.target.kind === "atLeast")) return { ...base, status: "unjudged" as const };
    if (ok) return { ...base, status: "met" as const };
    const status: RowStatus = resolved.from === cp ? "missed" : "not yet";
    return { ...base, status };
  });
}

const STATUS_MARK: Record<RowStatus, string> = {
  met: "✅ met",
  missed: "❌ missed",
  "not yet": "⏳ not yet",
  tracked: "· tracked",
  "n/a": "— n/a",
  unjudged: "? unjudged",
};

const cell = (s: string) => s.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");

function checkMark(ok: boolean | null, marks: [string, string, string]): string {
  if (ok === null) return marks[0];
  return ok ? marks[1] : marks[2];
}

function tableRow(r: ScoreRow): string {
  const guard = r.guardrail ? " *(guardrail)*" : "";
  const note = r.note ? " " + cell(r.note) : "";
  return `| ${r.objective} | ${cell(r.label)}${guard} | ${cell(r.baseline)} | **${cell(r.shown)}** | ${cell(r.target)} | ${STATUS_MARK[r.status]} |${note}`;
}

const missLine = (r: ScoreRow) => `- ${r.objective} ${r.label}: ${r.shown} vs ${r.target}`;

export function scorecardTitle(card: Pick<Scorecard, "checkpoint" | "preview" | "generatedAt">): string {
  const date = card.generatedAt.slice(0, 10);
  if (!card.checkpoint) return `Weekly scorecard — ${date}`;
  return `Checkpoint ${card.checkpoint}${card.preview ? " (preview)" : ""} — ${date}`;
}

/** Rows that need the review's attention: misses, guardrail regressions and unavailable targets. */
export function misses(card: Scorecard): ScoreRow[] {
  return card.rows.filter((r) => r.status === "missed" || (r.guardrail && r.status === "not yet"));
}

export function renderMarkdown(card: Scorecard): string {
  const rows = card.rows.map(tableRow);
  const missed = misses(card);
  const unavailable = card.rows.filter((r) => r.status === "n/a");
  const checks = card.datedChecks.map(
    (c) => `- ${checkMark(c.ok, ["📝 manual", "✅", "❌"])} **${c.title}**: ${c.detail}`,
  );
  return [
    `Computed by \`/api/cron/weekly-scorecard\` at ${card.generatedAt}. Targets: \`src/lib/scorecard/config.ts\`.`,
    card.preview ? `\nThis is a **preview**: ${card.checkpoint} itself runs on its Monday.` : "",
    "",
    `## Misses (${missed.length})`,
    missed.length ? missed.map(missLine).join("\n") : "None.",
    "",
    "## Scorecard",
    "",
    "| Obj | Measure | Baseline | Now | Target | Status | Note |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    checks.length ? `## Dated checks\n\n${checks.join("\n")}\n` : "",
    unavailable.length
      ? `## Not available from the server (${unavailable.length})\n\nThe checkpoint review fills these in: ${unavailable.map((r) => r.label).join("; ")}.\n`
      : "",
    "## Next step",
    "",
    "Open a session with `docs/ops/checkpoint-review-prompt.md`. It reports causes for each miss, proposes re-prioritisation, updates the review page and closes this issue.",
  ].join("\n");
}

export function renderText(card: Scorecard, issueUrl: string | null): string {
  const missed = misses(card);
  const lines = card.rows.map((r) => `${r.objective}  ${r.label}: ${r.shown} (target ${r.target}) ${r.status}`);
  return [
    scorecardTitle(card),
    "",
    missed.length ? `Misses (${missed.length}):\n` + missed.map(missLine).join("\n") : "No misses.",
    "",
    ...lines,
    "",
    ...card.datedChecks.map((c) => `[${checkMark(c.ok, ["manual", "ok", "FAIL"])}] ${c.title}: ${c.detail}`),
    "",
    issueUrl ? `Checkpoint issue: ${issueUrl}` : "The checkpoint issue could not be filed; see the run's summary.",
    "Review: open a session with docs/ops/checkpoint-review-prompt.md.",
  ].join("\n");
}
