"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  Activity,
  Plus,
  ShieldCheck,
  TrendingUp,
  Telescope,
  Copy,
  Check,
  Flame,
  Lock,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  createSuppression,
  deleteSuppression,
  getSuppressionImpact,
  getDeepDiveQueueToken,
  recordDeepDive,
  type TrendPoint,
  type TopOffender,
  type RecentRun,
  type SuppressionRow,
  type DeepDiveCandidate,
  type DeepDiveCoverage,
  type StreamTrendPoint,
  type StreamOpenCounts,
  type StreamCloseReasonRatio,
  type RecentOpenIssue,
  type EscalatedFinding,
} from "@/app/admin/audit/actions";
import { AuditStreamPanel } from "@/components/admin/AuditStreamPanel";
import { buildDeepDivePrompt } from "@/lib/admin/deep-dive-prompt";
import { HASHTRACKS_REPO } from "@/lib/github-repo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatCard, SectionHeader } from "./dashboard-shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const GLOBAL_KENNEL_VALUE = "__global__";

interface KennelOption {
  kennelCode: string;
  shortName: string;
}

interface Props {
  trends: TrendPoint[];
  topOffenders: TopOffender[];
  recentRuns: RecentRun[];
  suppressions: SuppressionRow[];
  kennels: KennelOption[];
  knownRules: string[];
  deepDiveQueue: DeepDiveCandidate[];
  deepDiveCoverage: DeepDiveCoverage;
  harelinePrompt: string | null;
  streamTrends: StreamTrendPoint[];
  streamOpenCounts: StreamOpenCounts[];
  /** `null` when the underlying query failed — the panel renders
   *  an explicit "metric unavailable" line instead of fake zeros. */
  streamCloseReasonRatios: StreamCloseReasonRatio[] | null;
  recentOpenIssues: RecentOpenIssue[];
  escalatedFindings: EscalatedFinding[];
}

const CATEGORY_LINES: { key: keyof TrendPoint; label: string; color: string }[] = [
  { key: "hares", label: "Hares", color: "#ef4444" },
  { key: "title", label: "Title", color: "#f97316" },
  { key: "location", label: "Location", color: "#eab308" },
  { key: "event", label: "Event", color: "#22c55e" },
  { key: "description", label: "Description", color: "#3b82f6" },
];

// ── Dashboard ───────────────────────────────────────────────────────

export function AuditDashboard({
  trends,
  topOffenders,
  recentRuns,
  suppressions,
  kennels,
  knownRules,
  deepDiveQueue,
  deepDiveCoverage,
  harelinePrompt,
  streamTrends,
  streamOpenCounts,
  streamCloseReasonRatios,
  recentOpenIssues,
  escalatedFindings,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ kennelCode: string | null; rule: string }>({
    kennelCode: null,
    rule: knownRules[0] ?? "",
  });

  const totalFindings = trends.reduce((sum, t) => sum + t.total, 0);
  const lastRunIssues = recentRuns[0]?.issuesFiled ?? 0;

  if (recentRuns.length === 0 && trends.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-10 text-center">
        <Activity className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-base font-semibold">No audit runs yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          First scheduled run is daily at 7:07 AM ET.
        </p>
      </div>
    );
  }

  function openDialog(
    kennelCode: string | null = null,
    rule: string = knownRules[0] ?? "",
  ) {
    setPrefill({ kennelCode, rule });
    setDialogOpen(true);
  }

  return (
    <div className="space-y-10">
      {/* ── Escalated findings (highest-priority signal post-5c-B) ── */}
      <NeedsDecisionPanel findings={escalatedFindings} />

      {/* ── Stream attribution ─────────────────────────────────── */}
      <AuditStreamPanel
        streamTrends={streamTrends}
        openCounts={streamOpenCounts}
        closeReasonRatios={streamCloseReasonRatios}
        recentOpenIssues={recentOpenIssues}
      />

      {/* ── Overview ───────────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <SectionHeader
            icon={ShieldCheck}
            title="Data Quality Audit"
            color="bg-blue-500/10 text-blue-500"
          />
          {harelinePrompt && <CopyHarelinePromptButton prompt={harelinePrompt} />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Findings (last 30d)"
            value={totalFindings}
            icon={AlertTriangle}
            color="orange"
          />
          <StatCard
            label="Issues filed (last run)"
            value={lastRunIssues}
            icon={Activity}
            color="blue"
          />
          <StatCard
            label="Active suppressions"
            value={suppressions.length}
            icon={BadgeCheck}
            color="green"
          />
        </div>

        {trends.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Findings Over Time
            </h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trends}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                {CATEGORY_LINES.map(line => (
                  <Line
                    key={line.key}
                    type="monotone"
                    dataKey={line.key}
                    name={line.label}
                    stroke={line.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ── Top Offenders ──────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={TrendingUp}
          title="Top Offenders (last 14 days)"
          color="bg-orange-500/10 text-orange-500"
        />
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {topOffenders.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No findings in window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Kennel
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Rule
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Count
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Last Seen
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {topOffenders.map(o => (
                    <tr
                      key={`${o.kennelCode}::${o.rule}`}
                      className="hover:bg-accent/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 font-medium">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{o.kennelShortName}</span>
                          {o.suppressed && (
                            <Badge variant="secondary" className="text-[10px]">
                              Suppressed
                            </Badge>
                          )}
                          {o.escalatedToIssueNumber !== null && (
                            <a
                              href={`https://github.com/${HASHTRACKS_REPO}/issues/${o.escalatedToIssueNumber}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-red-600 hover:bg-red-500/20 dark:text-red-400"
                              title={`Escalated meta-issue #${o.escalatedToIssueNumber}`}
                            >
                              <Flame className="h-3 w-3" />
                              #{o.escalatedToIssueNumber}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
                        {o.rule}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <div className="flex flex-col items-end gap-0.5 leading-tight">
                          <span className="tabular-nums font-mono text-xs">
                            {o.count}
                          </span>
                          {o.recurrenceCount !== null && o.recurrenceCount > 0 && (
                            <span
                              className="text-[10px] tabular-nums text-muted-foreground"
                              title="Strict-tier recurrence count from the AuditIssue mirror — distinct from per-event finding count above"
                            >
                              ×{o.recurrenceCount} recurs
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-muted-foreground tabular-nums text-xs">
                        {o.lastSeen}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {!o.suppressed && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => openDialog(o.kennelCode, o.rule)}
                          >
                            Suppress
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Kennel Deep Dive ───────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={Telescope}
          title="Kennel Deep Dive"
          color="bg-purple-500/10 text-purple-500"
        />
        <DeepDiveCard
          queue={deepDiveQueue}
          coverage={deepDiveCoverage}
          onCompleted={() => router.refresh()}
        />
      </section>

      {/* ── Suppressions ───────────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={BadgeCheck}
            title="Active Suppressions"
            color="bg-green-500/10 text-green-500"
          />
          <Button size="sm" onClick={() => openDialog()}>
            <Plus className="h-3.5 w-3.5" />
            Add suppression
          </Button>
        </div>
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {suppressions.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No active suppressions.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Scope
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Rule
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Reason
                    </th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Created By
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {suppressions.map(s => (
                    <SuppressionRowView
                      key={s.id}
                      row={s}
                      onChanged={() => router.refresh()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── Recent Runs ────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeader
          icon={Activity}
          title="Recent Audit Runs (last 14 days)"
          color="bg-purple-500/10 text-purple-500"
        />
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          {recentRuns.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground">
              No runs in window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30">
                    <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Date
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Events Scanned
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Findings
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Groups
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Issues Filed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {recentRuns.map(r => (
                    <tr key={r.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-5 py-2.5 text-muted-foreground tabular-nums text-xs">
                        {new Date(r.createdAt).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.eventsScanned}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.findingsCount}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.groupsCount}
                      </td>
                      <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                        {r.issuesFiled}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {dialogOpen && (
        <SuppressionDialog
          key={`${prefill.kennelCode ?? ""}::${prefill.rule}`}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kennels={kennels}
          knownRules={knownRules}
          initialKennelCode={prefill.kennelCode}
          initialRule={prefill.rule}
          onCreated={() => {
            setDialogOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Suppression Row + Delete Confirmation ───────────────────────────

// ── Needs Decision panel ────────────────────────────────────────────
//
// Surfaces open AuditIssue rows that crossed the recurrence escalation
// threshold (5c-B). Each row is a finding the auto-coalescer has given
// up on — the operator must pick fix / suppress / reclassify before
// the comment trail bloats further. Hidden when there's nothing to
// surface so the dashboard's first paint isn't a wall of red boxes for
// no reason.

function NeedsDecisionPanel({ findings }: { findings: EscalatedFinding[] }) {
  if (findings.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <SectionHeader
          icon={Flame}
          title={`Needs Decision (${findings.length})`}
          color="bg-red-500/10 text-red-500"
        />
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-muted-foreground max-w-md text-right">
            Recurred 5+ times; auto-coalesce gave up. Pick{" "}
            <span className="font-medium text-foreground">fix</span>,{" "}
            <span className="font-medium text-foreground">suppress</span>, or{" "}
            <span className="font-medium text-foreground">reclassify</span>.
          </p>
          <a
            href={`https://github.com/${HASHTRACKS_REPO}/issues?q=is%3Aopen+label%3A%22audit%3Aneeds-decision%22`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
          >
            View all on GitHub →
          </a>
        </div>
      </div>
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.03] overflow-hidden">
        <ul className="divide-y divide-red-500/15">
          {findings.map((f) => (
            <NeedsDecisionRow key={f.baseIssueNumber} finding={f} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function NeedsDecisionRow({ finding }: { finding: EscalatedFinding }) {
  return (
    <li className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {finding.baseKennelShortName && (
            <span className="font-medium">{finding.baseKennelShortName}</span>
          )}
          <Badge
            variant="outline"
            className="border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-[10px] tabular-nums"
          >
            ×{finding.recurrenceCount} recurrences
          </Badge>
          <span className="text-xs text-muted-foreground">
            escalated {finding.escalatedAgoLabel}
          </span>
        </div>
        <a
          href={finding.baseIssueUrl}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm hover:underline"
        >
          <span className="font-mono tabular-nums text-muted-foreground">
            #{finding.baseIssueNumber}
          </span>{" "}
          {finding.baseIssueTitle}
        </a>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        {finding.escalatedToIssueNumber !== null ? (
          <a
            href={`https://github.com/${HASHTRACKS_REPO}/issues/${finding.escalatedToIssueNumber}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-mono tabular-nums text-red-600 hover:bg-red-500/20 dark:text-red-400"
          >
            Decision → #{finding.escalatedToIssueNumber}
          </a>
        ) : (
          <span className="text-muted-foreground italic">
            meta unlinked — see logs
          </span>
        )}
      </div>
    </li>
  );
}

function SuppressionRowView({
  row,
  onChanged,
}: {
  row: SuppressionRow;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isGlobal = row.kennelCode === null;
  const scopeLabel = isGlobal ? "Global" : (row.kennelShortName ?? row.kennelCode);

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteSuppression(row.id);
        onChanged();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to remove suppression");
      }
    });
  }

  return (
    <tr className="hover:bg-accent/30 transition-colors">
      <td className="px-5 py-2.5 font-medium">
        {isGlobal ? <Badge variant="outline">Global</Badge> : scopeLabel}
      </td>
      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
        {row.rule}
      </td>
      <td className="px-5 py-2.5 text-muted-foreground max-w-sm truncate">
        {row.reason}
      </td>
      <td className="px-5 py-2.5 text-muted-foreground text-xs">
        {row.createdBy ?? "—"}
      </td>
      <td className="px-5 py-2.5 text-right">
        {deleteError && (
          <div className="mb-1 text-[10px] text-destructive">{deleteError}</div>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove suppression?</AlertDialogTitle>
              <AlertDialogDescription>
                Findings matching <span className="font-mono">{row.rule}</span> for{" "}
                <span className="font-medium">{scopeLabel}</span> will be flagged again
                on the next audit run.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={handleDelete}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {pending ? "Removing…" : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
}

// ── Suppression Dialog ──────────────────────────────────────────────

function SuppressionDialog({
  open,
  onOpenChange,
  kennels,
  knownRules,
  initialKennelCode,
  initialRule,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kennels: KennelOption[];
  knownRules: string[];
  initialKennelCode: string | null;
  initialRule: string;
  onCreated: () => void;
}) {
  const [kennelCode, setKennelCode] = useState<string | null>(initialKennelCode);
  const [rule, setRule] = useState(initialRule);
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<{ totalFindings: number; perDay: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const impactReqRef = useRef(0);

  useEffect(() => {
    void refreshImpact(initialKennelCode, initialRule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshImpact(nextKennel: string | null, nextRule: string) {
    if (!nextRule) return;
    setImpact(null);
    const reqId = ++impactReqRef.current;
    try {
      const result = await getSuppressionImpact(nextKennel, nextRule);
      if (reqId === impactReqRef.current) setImpact(result);
    } catch {
      if (reqId === impactReqRef.current) setImpact(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createSuppression({ kennelCode, rule, reason });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create suppression");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add suppression</DialogTitle>
          <DialogDescription>
            Skip findings matching this kennel + rule on future audit runs.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="audit-suppression-kennel">Kennel</Label>
            <Select
              value={kennelCode ?? GLOBAL_KENNEL_VALUE}
              onValueChange={v => {
                const next = v === GLOBAL_KENNEL_VALUE ? null : v;
                setKennelCode(next);
                void refreshImpact(next, rule);
              }}
            >
              <SelectTrigger id="audit-suppression-kennel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_KENNEL_VALUE}>Global (all kennels)</SelectItem>
                {kennels.map(k => (
                  <SelectItem key={k.kennelCode} value={k.kennelCode}>
                    {k.shortName}{" "}
                    <span className="text-xs text-muted-foreground">({k.kennelCode})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-suppression-rule">Rule</Label>
            <Select
              value={rule}
              onValueChange={v => {
                setRule(v);
                void refreshImpact(kennelCode, v);
              }}
            >
              <SelectTrigger id="audit-suppression-rule" className="font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {knownRules.map(r => (
                  <SelectItem key={r} value={r} className="font-mono text-xs">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-suppression-reason">Reason</Label>
            <Textarea
              id="audit-suppression-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              required
              minLength={10}
              rows={3}
              placeholder="Why is this finding accepted?"
            />
          </div>
          {impact && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Skips ~{impact.perDay} findings/day · {impact.totalFindings} in last 14 days.
            </div>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || reason.trim().length < 10}
            >
              {pending ? "Saving…" : "Suppress"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Hareline Prompt Copy Button ─────────────────────────────────────

function CopyHarelinePromptButton({ prompt }: Readonly<{ prompt: string }>) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API rejects when the document isn't focused or the page isn't HTTPS;
      // surface a brief error state instead of silently failing.
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  }

  let label = "Copy daily prompt";
  if (copied) label = "Copied";
  else if (copyError) label = "Copy failed";

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

// ── Deep Dive Card ──────────────────────────────────────────────────

function DeepDiveCard({
  queue,
  coverage,
  onCompleted,
}: {
  queue: DeepDiveCandidate[];
  coverage: DeepDiveCoverage;
  onCompleted: () => void;
}) {
  const [selectedCode, setSelectedCode] = useState(queue[0]?.kennelCode ?? "");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (queue.some((k) => k.kennelCode === selectedCode)) return;
    setSelectedCode(queue[0]?.kennelCode ?? "");
    setCopied(false);
  }, [queue, selectedCode]);

  const currentKennel = queue.find((k) => k.kennelCode === selectedCode) ?? queue[0];

  if (!currentKennel || queue.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-6 text-center">
        <Telescope className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No active kennels eligible for a deep dive.
        </p>
      </div>
    );
  }

  function handleCopy() {
    void navigator.clipboard.writeText(buildDeepDivePrompt(currentKennel));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const lastDived =
    currentKennel.lastDeepDiveAt === null
      ? "never"
      : new Date(currentKennel.lastDeepDiveAt).toISOString().split("T")[0];

  return (
    <>
      {/* ── Selected kennel card ── */}
      <div className="rounded-xl border border-border/50 bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              Deep dive target
            </div>
            <Select value={selectedCode} onValueChange={(v) => { setSelectedCode(v); setCopied(false); }}>
              <SelectTrigger className="h-9 w-full max-w-sm text-base font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {queue.map((k) => (
                  <SelectItem key={k.kennelCode} value={k.kennelCode}>
                    <span className="font-medium">{k.shortName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{k.region}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2 text-xs text-muted-foreground">
              {currentKennel.region} · {currentKennel.sources.length} source
              {currentKennel.sources.length === 1 ? "" : "s"} · {currentKennel.eventCount90d} events
              in last 90d · last dived {lastDived}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-center">
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy prompt"}
            </Button>
            <Button size="sm" onClick={() => setCompleteOpen(true)}>
              Mark complete
            </Button>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/30 pt-3 text-xs text-muted-foreground">
          <div>
            Coverage: <span className="font-mono tabular-nums">{coverage.audited}</span> /{" "}
            <span className="font-mono tabular-nums">{coverage.total}</span> active kennels (
            {coverage.percent}%)
          </div>
          {coverage.projectedFullCycleDate && (
            <div>
              Full cycle by{" "}
              <span className="font-mono tabular-nums">{coverage.projectedFullCycleDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Queue table (clickable rows select the kennel above) ── */}
      {queue.length > 1 && (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border/50">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Queue
            </h3>
            {/* Visual lock when the completion dialog is open: the
              * snapshot token from bundle 6 has bound `selectedCode`
              * for the duration of that submission. Reordering the
              * queue from a second tab during this window would now
              * 409 the submit; making it clear that the queue is
              * "frozen" prevents the operator from confusing
              * themselves. */}
            {completeOpen && (
              <span
                id="dd-queue-lock-message"
                className="inline-flex items-center gap-1.5 rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-purple-600 dark:text-purple-400"
                title="Snapshot token bound — cancel the dialog to retarget another kennel"
              >
                <Lock className="h-3 w-3" />
                Locked to {currentKennel.shortName}
              </span>
            )}
          </div>
          <div
            className={`overflow-x-auto transition-opacity ${
              completeOpen ? "opacity-50" : ""
            }`}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Kennel
                  </th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Region
                  </th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Last Dived
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Sources
                  </th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Events 90d
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {queue.map((k) => (
                  <tr
                    key={k.kennelCode}
                    role="button"
                    tabIndex={completeOpen ? -1 : 0}
                    aria-disabled={completeOpen || undefined}
                    aria-describedby={
                      completeOpen ? "dd-queue-lock-message" : undefined
                    }
                    className={`transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                      completeOpen ? "cursor-not-allowed" : "cursor-pointer"
                    } ${
                      k.kennelCode === selectedCode
                        ? "bg-accent/50 border-l-2 border-l-purple-500"
                        : completeOpen
                          ? ""
                          : "hover:bg-accent/30"
                    }`}
                    onClick={() => {
                      if (completeOpen) return;
                      setSelectedCode(k.kennelCode);
                      setCopied(false);
                    }}
                    onKeyDown={(e) => {
                      if (completeOpen) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedCode(k.kennelCode);
                        setCopied(false);
                      }
                    }}
                  >
                    <td className="px-5 py-2.5 font-medium">{k.shortName}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{k.region}</td>
                    <td className="px-5 py-2.5 text-muted-foreground tabular-nums text-xs">
                      {k.lastDeepDiveAt
                        ? new Date(k.lastDeepDiveAt).toISOString().split("T")[0]
                        : "never"}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                      {k.sources.length}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-mono text-xs">
                      {k.eventCount90d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DeepDiveCompleteDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        kennel={currentKennel}
        onCompleted={() => {
          setCompleteOpen(false);
          onCompleted();
        }}
      />
    </>
  );
}

function DeepDiveCompleteDialog({
  open,
  onOpenChange,
  kennel,
  onCompleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kennel: DeepDiveCandidate;
  onCompleted: () => void;
}) {
  const [findingsCount, setFindingsCount] = useState(0);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queueToken, setQueueToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  // Snapshot the kennel at dialog-open time so a parent-side queue
  // refresh while the modal is open can't silently retarget the
  // submission (CodeRabbit PR #1203 finding). All token fetches and
  // the submit payload key off this frozen value, not the live
  // `kennel` prop.
  const [boundKennel, setBoundKennel] = useState<DeepDiveCandidate | null>(
    null,
  );

  // Fetch the snapshot-bound token on open. The token captures the
  // queue's membership at click time so a queue change between
  // dialog-open and submit can't misattribute the deep dive
  // (issue #1160).
  useEffect(() => {
    if (!open) return;
    // Freeze the dialog target on this open transition. Subsequent
    // changes to `kennel` while open are ignored — the operator
    // must close + reopen to retarget.
    const frozen = kennel;
    setBoundKennel(frozen);
    setFindingsCount(0);
    setSummary("");
    setError(null);
    setQueueToken(null);
    setTokenLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const result = await getDeepDiveQueueToken(frozen.kennelCode);
        if (cancelled) return;
        if (!result) {
          setError(
            `${frozen.shortName} is no longer in the deep-dive queue. Cancel and refresh the page to pick another kennel.`,
          );
        } else {
          setQueueToken(result.token);
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to acquire submission token",
        );
      } finally {
        if (!cancelled) setTokenLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally exclude `kennel` from deps — see freeze rationale
    // above. Re-running this effect on `kennel` change would defeat
    // the misattribution defense.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The bound kennel is the source of truth from here on. Until the
  // first open transition lands, fall back to the prop so the title
  // renders cleanly on first paint.
  const dialogKennel = boundKennel ?? kennel;

  /** Refetch the token after the server reports a queue-changed
   *  rejection. Lets the operator re-confirm without closing the
   *  dialog when other admins edit the queue mid-session.
   *  Returns the token on success, or null on failure (in which
   *  case it has already set its own error message). */
  async function refetchToken(): Promise<string | null> {
    setTokenLoading(true);
    try {
      const result = await getDeepDiveQueueToken(dialogKennel.kennelCode);
      if (!result) {
        setError(
          `${dialogKennel.shortName} is no longer in the deep-dive queue. Cancel and refresh.`,
        );
        setQueueToken(null);
        return null;
      }
      setQueueToken(result.token);
      return result.token;
    } finally {
      setTokenLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!queueToken) {
      setError("No submission token available — please re-open the dialog.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await recordDeepDive({
          kennelCode: dialogKennel.kennelCode,
          findingsCount,
          summary: summary.trim() || "(no notes)",
          queueToken,
        });
        if (result.ok) {
          onCompleted();
          return;
        }
        if (result.error === "queueChanged") {
          // Refresh the token + show a one-shot warning. If the
          // operator submits again with the fresh token and the
          // queue still matches, it'll succeed. On refetch
          // failure, refetchToken has already set its own error
          // (kennelGone) — don't overwrite it (Gemini PR #1203).
          const fresh = await refetchToken();
          if (fresh) {
            setError(
              "The deep-dive queue was edited by someone else. Confirm by submitting again.",
            );
          }
          return;
        }
        if (result.error === "kennelGone") {
          setError(
            `${dialogKennel.shortName} was removed from the queue. Cancel and refresh the page.`,
          );
          return;
        }
        // invalidToken: session expired or tampered
        setError(
          "Submission token rejected. Cancel and re-open the dialog to refresh.",
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record deep dive");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Mark deep dive complete: {dialogKennel.shortName} ({dialogKennel.region})
          </DialogTitle>
          <DialogDescription>
            {`Recording a deep dive for `}
            <strong>{dialogKennel.shortName}</strong>
            {` `}
            <span className="text-xs text-muted-foreground">
              ({dialogKennel.region})
            </span>
            {`. The next-up queue will rotate to the next-oldest active kennel.`}
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {`If this isn't the kennel you intended to mark complete, cancel and re-select from the queue — see issue `}
          <a
            href={`https://github.com/${HASHTRACKS_REPO}/issues/1160`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >#1160</a>{`.`}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dd-findings-count">Findings filed</Label>
            <Input
              id="dd-findings-count"
              type="number"
              min={0}
              value={findingsCount}
              onChange={e => setFindingsCount(Math.max(0, Number(e.target.value)))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dd-summary">One-line summary</Label>
            <Textarea
              id="dd-summary"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={2}
              placeholder='e.g. "found 2 stale titles + 1 missing source"'
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending || tokenLoading || !queueToken}
            >
              {pending
                ? "Saving…"
                : tokenLoading
                  ? "Loading…"
                  : `Mark ${dialogKennel.shortName} complete`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
